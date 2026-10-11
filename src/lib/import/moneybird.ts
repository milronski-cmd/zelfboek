import { db } from "@/lib/db";
import { bedragUit, centen, haalJson, kanaalConfig } from "@/lib/kanalen/basis";
import { maakHash } from "@/lib/bank/csv";
import { koppelingStatus } from "@/lib/koppelingen";

/**
 * Overstappen vanuit Moneybird (REST API v2, persoonlijk token: Instellingen → Ontwikkelaars → API-tokens).
 * Docs: https://developer.moneybird.com/ (contacts, sales_invoices, financial_mutations, documents_purchase_invoices, tax_rates)
 * Config: { token, administrationId? }. Idempotent via externId.
 *
 * Wat de documentatie voorschrijft en hier gevolgd wordt:
 * - Bearer-token, basis https://moneybird.com/api/v2/{administration_id}/...json, max 150 verzoeken per 5 minuten (429 + Retry-After);
 * - lijsten: per_page max 100 en page; financial_mutations geeft maximaal 100 zonder paginering, dus via de synchronization-API:
 *   GET .../synchronization.json?filter=... → [{ id, version }], POST .../synchronization.json { ids } → max 100 volledige records;
 * - zonder filter is de periode "this_year": we geven altijd een expliciete periode mee (YYYYMMDD..YYYYMMDD);
 * - bedragen zijn decimale strings; er is géén veld total_tax: btw = total_price_incl_tax − total_price_excl_tax;
 * - het btw-percentage van een factuurregel staat in tax_rates (tax_rate_id → percentage).
 */
export type MbContact = { id: string; company_name?: string | null; firstname?: string | null; lastname?: string | null; email?: string | null; address1?: string | null; zipcode?: string | null; city?: string | null; country?: string | null; chamber_of_commerce?: string | null; tax_number?: string | null; phone?: string | null };
export type MbVerkoopFactuur = {
  id: string; invoice_id?: string | null; contact_id?: string | null; invoice_date?: string | null; due_date?: string | null; state: string;
  prices_are_incl_tax?: boolean; total_price_excl_tax: string; total_price_incl_tax: string; total_unpaid?: string | null; paid_at?: string | null; reference?: string | null;
  details: { description: string; amount?: string | null; amount_decimal?: string | null; price: string; tax_rate_id?: string | null }[];
};
export type MbMutatie = { id: string; date: string; amount: string; message?: string | null; contra_account_name?: string | null; contra_account_number?: string | null; financial_account_id?: string; state?: string };
export type MbInkoopFactuur = { id: string; reference?: string | null; date?: string | null; contact?: { company_name?: string | null; firstname?: string | null; lastname?: string | null } | null; total_price_excl_tax: string; total_price_incl_tax: string };
export type MbBtwTarief = { id: string; name?: string; percentage: string | null; tax_rate_type?: string };

const API = "https://moneybird.com/api/v2";

export type MoneybirdData = { contacten: MbContact[]; facturen: MbVerkoopFactuur[]; mutaties: MbMutatie[]; inkoop: MbInkoopFactuur[]; btwTarieven: MbBtwTarief[] };

const dag = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

/** Alle gegevens ophalen; raakt de database niet. */
export async function haalMoneybirdData(cfg: { token: string; administrationId?: string }, vanaf = new Date("2000-01-01"), tot = new Date()): Promise<MoneybirdData & { administrationId: string }> {
  const headers = { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" };
  let admin = cfg.administrationId;
  if (!admin) {
    const admins = await haalJson<{ id: string }[]>(`${API}/administrations.json`, { headers }, "Moneybird");
    if (!admins[0]) throw new Error("Geen administratie gevonden bij dit token.");
    admin = admins[0].id;
  }
  const lijst = async <T,>(pad: string): Promise<T[]> => {
    const alles: T[] = [];
    for (let p = 1; p < 500; p++) {
      const r = await haalJson<T[]>(`${API}/${admin}/${pad}${pad.includes("?") ? "&" : "?"}per_page=100&page=${p}`, { headers }, "Moneybird");
      alles.push(...r);
      if (r.length < 100) break;
    }
    return alles;
  };
  const synchroniseer = async <T,>(pad: string, filter: string): Promise<T[]> => {
    const ids = await haalJson<{ id: string; version: number }[]>(`${API}/${admin}/${pad}/synchronization.json?filter=${encodeURIComponent(filter)}`, { headers }, "Moneybird");
    const alles: T[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const deel = await haalJson<T[]>(`${API}/${admin}/${pad}/synchronization.json`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ ids: ids.slice(i, i + 100).map((x) => x.id) }),
      }, "Moneybird");
      alles.push(...deel);
    }
    return alles;
  };
  const periode = `period:${dag(vanaf)}..${dag(tot)}`;
  const contacten = await lijst<MbContact>("contacts.json");
  const btwTarieven = await lijst<MbBtwTarief>("tax_rates.json");
  const facturen = await synchroniseer<MbVerkoopFactuur>("sales_invoices", `state:all,${periode}`);
  const mutaties = await synchroniseer<MbMutatie>("financial_mutations", `state:all,${periode}`);
  const inkoop = await synchroniseer<MbInkoopFactuur>("documents/purchase_invoices", periode);
  return { administrationId: admin, contacten, facturen, mutaties, inkoop, btwTarieven };
}

const STATUS: Record<string, string> = { open: "verzonden", pending_payment: "verzonden", late: "herinnerd", reminded: "herinnerd", paid: "betaald", uncollectible: "oninbaar" };

/** Verkoopfactuur naar onze factuurvorm (zonder klant-id). null voor concepten en geplande facturen. */
export function mbFactuurNaarData(f: MbVerkoopFactuur, tarieven: MbBtwTarief[]) {
  if (!f.invoice_id || f.state === "draft" || f.state === "scheduled") return null;
  const pct = new Map(tarieven.map((t) => [t.id, bedragUit(t.percentage)]));
  const regels = f.details.map((d) => {
    const btw = d.tax_rate_id ? (pct.get(d.tax_rate_id) ?? 21) : 0;
    const aantal = bedragUit(d.amount_decimal ?? d.amount) || 1;
    const prijs = bedragUit(d.price);
    return { omschrijving: d.description, aantal, prijs: f.prices_are_incl_tax ? centen(prijs / (1 + btw / 100)) : prijs, btw };
  });
  const excl = bedragUit(f.total_price_excl_tax);
  const incl = bedragUit(f.total_price_incl_tax);
  return {
    nummer: f.invoice_id,
    datum: new Date(f.invoice_date ?? Date.now()),
    vervaldatum: new Date(f.due_date ?? f.invoice_date ?? Date.now()),
    regels,
    subtotaal: excl,
    btw: centen(incl - excl),
    totaal: incl,
    status: STATUS[f.state] ?? "verzonden",
    betaaldOp: f.paid_at ? new Date(f.paid_at) : null,
    betaaldBedrag: centen(incl - bedragUit(f.total_unpaid)),
    referentie: f.reference ?? null,
  };
}

export const mbContactNaam = (c: { company_name?: string | null; firstname?: string | null; lastname?: string | null } | null | undefined) =>
  c?.company_name || [c?.firstname, c?.lastname].filter(Boolean).join(" ") || "";

export async function importeerMoneybird(ondernemingId: string): Promise<{ klanten: number; facturen: number; transacties: number; inkoop: number; fouten: string[] }> {
  const uit = { klanten: 0, facturen: 0, transacties: 0, inkoop: 0, fouten: [] as string[] };
  try {
    const cfg = await kanaalConfig<{ token: string; administrationId: string }>(ondernemingId, "moneybird", ["token"], "Moneybird");
    const data = await haalMoneybirdData(cfg);

    // Contacten → Klant
    const klantPerExtern = new Map<string, string>();
    for (const c of data.contacten) {
      const naam = mbContactNaam(c) || "Onbekend";
      const bestaand = await db.klant.findFirst({ where: { ondernemingId, externId: `moneybird:${c.id}` } });
      const k = { naam, email: c.email ?? null, adres: c.address1 ?? null, postcode: c.zipcode ?? null, plaats: c.city ?? null, land: c.country || "NL", kvk: c.chamber_of_commerce ?? null, btwNummer: c.tax_number ?? null, telefoon: c.phone ?? null };
      const rij = bestaand
        ? await db.klant.update({ where: { id: bestaand.id }, data: k })
        : await db.klant.create({ data: { ...k, ondernemingId, externId: `moneybird:${c.id}` } });
      if (!bestaand) uit.klanten++;
      klantPerExtern.set(c.id, rij.id);
    }

    // Verkoopfacturen → Factuur
    for (const f of data.facturen) {
      const v = mbFactuurNaarData(f, data.btwTarieven);
      if (!v) continue;
      const klantId = f.contact_id ? klantPerExtern.get(f.contact_id) : undefined;
      if (!klantId) continue;
      const bestaat = await db.factuur.findUnique({ where: { ondernemingId_nummer: { ondernemingId, nummer: v.nummer } } });
      if (bestaat) continue;
      await db.factuur.create({ data: { ...v, regels: JSON.stringify(v.regels), ondernemingId, klantId, verzondenOp: v.datum } });
      uit.facturen++;
    }

    // Financiële mutaties → Transactie (bron import, nog door AI te beoordelen)
    for (const m of data.mutaties) {
      const d = new Date(m.date);
      const bedrag = bedragUit(m.amount);
      const tegen = m.contra_account_name ?? "";
      const oms = m.message ?? "";
      const r = await db.transactie.createMany({
        data: [{ ondernemingId, datum: d, bedrag, tegenpartij: tegen || "Onbekend", tegenIban: m.contra_account_number ?? null, omschrijving: oms, hash: maakHash(d, bedrag, tegen, oms, `moneybird:${m.id}`), bron: "import", externId: `moneybird:${m.id}` }],
      }).catch(() => ({ count: 0 }));
      uit.transacties += r.count;
    }

    // Inkoopfacturen → Boekingsregel
    for (const i of data.inkoop) {
      const incl = bedragUit(i.total_price_incl_tax);
      const r = await db.boekingsregel.createMany({
        data: [{ ondernemingId, datum: new Date(i.date ?? Date.now()), omschrijving: `${mbContactNaam(i.contact) || "Leverancier"} ${i.reference ?? ""}`.trim(), bedrag: -incl, btwBedrag: centen(incl - bedragUit(i.total_price_excl_tax)), categorie: "overig", bron: "moneybird", externId: i.id }],
      }).catch(() => ({ count: 0 }));
      uit.inkoop += r.count;
    }
    await koppelingStatus(ondernemingId, "moneybird", "actief");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    uit.fouten.push(m);
    await koppelingStatus(ondernemingId, "moneybird", "fout", m).catch(() => undefined);
  }
  return uit;
}
