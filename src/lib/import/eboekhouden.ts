import { MERK } from "@/lib/merk";
import { db } from "@/lib/db";
import { centen, haalJson, kanaalConfig } from "@/lib/kanalen/basis";
import { maakHash } from "@/lib/bank/csv";
import { koppelingStatus } from "@/lib/koppelingen";

/**
 * Overstappen vanuit e-Boekhouden (REST API v1). OpenAPI: https://api.e-boekhouden.nl/openapi/v1.json
 * API-token uit Beheer → Instellingen → Koppelingen → API. Config: { token }.
 *
 * - POST /v1/session { accessToken, source (max 10 tekens, [\w ]) } → { token, expiresIn }; daarna header "Authorization: <token>" (zonder Bearer);
 * - lijsten: limit 1-2000 (standaard 100) en offset, antwoord { items, count };
 * - GET /v1/relation: id, type (B/P), code, name, contact, emailAddress, address, postalCode, city, country, phoneNumber, vatNumber, companyRegistrationNumber;
 * - GET /v1/mutation geeft per mutatie alleen id, type, date, invoiceNumber, ledgerId, amount, entryNumber;
 *   omschrijving, regels en btw staan in GET /v1/mutation/{id} (rows[], vat[], inExVat "IN"/"EX");
 * - type is een getal: 1 factuur ontvangen, 2 factuur verstuurd, 3 factuurbetaling ontvangen, 4 factuurbetaling verstuurd,
 *   5 geld ontvangen, 6 geld uitgegeven, 7 memoriaal.
 * Relaties → Klant; types 3-6 → Transactie (bank); types 1, 2 en 7 → Boekingsregel.
 */
const API = "https://api.e-boekhouden.nl/v1";

/** Sleutels naar camelCase (de voorbeelden in de spec staan in PascalCase, de schema's in camelCase). */
export function camel<T>(o: unknown): T {
  if (Array.isArray(o)) return o.map((x) => camel(x)) as T;
  if (o && typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) => [k.charAt(0).toLowerCase() + k.slice(1), camel(v)])) as T;
  return o as T;
}

export type EbRelatie = { id: number; type?: string; code?: string; name?: string | null; contact?: string | null; emailAddress?: string | null; address?: string | null; postalCode?: string | null; city?: string | null; country?: string | null; phoneNumber?: string | null; vatNumber?: string | null; companyRegistrationNumber?: string | null };
export type EbMutatieKort = { id: number; type: number | string; date: string; invoiceNumber?: string | null; ledgerId?: number; amount?: number; entryNumber?: string | null };
export type EbMutatie = EbMutatieKort & { description?: string | null; relationId?: number | null; inExVat?: "IN" | "EX" | string | null; rows?: { ledgerId?: number; vatCode?: string | null; vatAmount?: number | null; amount: number; description?: string | null }[]; vat?: { vatCode?: string; amount: number }[] };

export type EboekhoudenData = { relaties: EbRelatie[]; mutaties: EbMutatie[] };

/** Bedrag inclusief btw en het btw-bedrag van een volledige mutatie. */
export function ebTotalen(m: EbMutatie) {
  const rijen = m.rows ?? [];
  const btw = centen((m.vat ?? []).reduce((s, v) => s + (v.amount ?? 0), 0) || rijen.reduce((s, r) => s + (r.vatAmount ?? 0), 0));
  const som = rijen.reduce((s, r) => s + (r.amount ?? 0), 0);
  const incl = rijen.length ? centen(String(m.inExVat).toUpperCase() === "EX" ? som + btw : som) : (m.amount ?? 0);
  return { incl, btw };
}

/** Indeling per mutatietype: waarheen en met welk teken. */
export function ebSoort(type: number | string): { doel: "bank" | "boeking"; teken: 1 | -1 | 0; label: string } {
  switch (Number(type)) {
    case 1: return { doel: "boeking", teken: -1, label: "Factuur ontvangen" };
    case 2: return { doel: "boeking", teken: 1, label: "Factuur verstuurd" };
    case 3: return { doel: "bank", teken: 1, label: "Factuurbetaling ontvangen" };
    case 4: return { doel: "bank", teken: -1, label: "Factuurbetaling verstuurd" };
    case 5: return { doel: "bank", teken: 1, label: "Geld ontvangen" };
    case 6: return { doel: "bank", teken: -1, label: "Geld uitgegeven" };
    default: return { doel: "boeking", teken: 0, label: "Memoriaal" }; // 7: teken zoals het bedrag zelf
  }
}

/** Alles ophalen; raakt de database niet. */
export async function haalEboekhoudenData(token: string): Promise<EboekhoudenData> {
  const sessie = await haalJson<{ token: string; expiresIn: number }>(`${API}/session`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ accessToken: token, source: MERK.replace(/[^\w ]/g, "").slice(0, 10) }),
  }, "e-Boekhouden");
  const headers = { Authorization: sessie.token, Accept: "application/json" };
  const LIMIET = 2000;
  const pagina = async <T,>(pad: string): Promise<T[]> => {
    const alles: T[] = [];
    for (let offset = 0; offset < 1_000_000; offset += LIMIET) {
      const r = camel<{ items: T[] | null; count?: number }>(await haalJson(`${API}/${pad}?limit=${LIMIET}&offset=${offset}`, { headers }, "e-Boekhouden"));
      const items = r.items ?? [];
      alles.push(...items);
      if (items.length < LIMIET || (r.count !== undefined && alles.length >= Number(r.count))) break;
    }
    return alles;
  };
  const relaties = await pagina<EbRelatie>("relation");
  const kort = await pagina<EbMutatieKort>("mutation");
  // Details (omschrijving, regels, btw) per mutatie, met een paar tegelijk
  const mutaties: EbMutatie[] = new Array(kort.length);
  let volgende = 0;
  const werker = async () => {
    while (volgende < kort.length) {
      const i = volgende++;
      mutaties[i] = { ...kort[i], ...camel<EbMutatie>(await haalJson(`${API}/mutation/${kort[i].id}`, { headers }, "e-Boekhouden")) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, kort.length) }, werker));
  return { relaties, mutaties };
}

export async function importeerEboekhouden(ondernemingId: string): Promise<{ klanten: number; transacties: number; boekingen: number; fouten: string[] }> {
  const uit = { klanten: 0, transacties: 0, boekingen: 0, fouten: [] as string[] };
  try {
    const cfg = await kanaalConfig<{ token: string }>(ondernemingId, "eboekhouden", ["token"], "e-Boekhouden");
    const { relaties, mutaties } = await haalEboekhoudenData(cfg.token);
    const relatieNaam = new Map<number, string>();

    for (const r of relaties) {
      const naam = r.name || r.contact || r.code || "Onbekend";
      relatieNaam.set(r.id, naam);
      const bestaand = await db.klant.findFirst({ where: { ondernemingId, externId: `eboekhouden:${r.id}` } });
      const data = { naam, email: r.emailAddress ?? null, adres: r.address ?? null, postcode: r.postalCode ?? null, plaats: r.city ?? null, land: r.country || "NL", kvk: r.companyRegistrationNumber ?? null, btwNummer: r.vatNumber ?? null, telefoon: r.phoneNumber ?? null, contactpersoon: r.contact ?? null };
      if (bestaand) await db.klant.update({ where: { id: bestaand.id }, data });
      else { await db.klant.create({ data: { ...data, ondernemingId, externId: `eboekhouden:${r.id}` } }); uit.klanten++; }
    }

    for (const m of mutaties) {
      const d = new Date(m.date);
      const soort = ebSoort(m.type);
      const { incl, btw } = ebTotalen(m);
      const bedrag = soort.teken === 0 ? incl : soort.teken * Math.abs(incl);
      const oms = m.description || m.invoiceNumber || soort.label;
      const tegen = (m.relationId ? relatieNaam.get(m.relationId) : undefined) ?? "";
      if (soort.doel === "bank") {
        const r = await db.transactie.createMany({
          data: [{ ondernemingId, datum: d, bedrag, tegenpartij: tegen || oms.slice(0, 60) || "Onbekend", omschrijving: oms, hash: maakHash(d, bedrag, tegen, oms, `eboekhouden:${m.id}`), bron: "import", externId: `eboekhouden:${m.id}` }],
        }).catch(() => ({ count: 0 }));
        uit.transacties += r.count;
      } else {
        const r = await db.boekingsregel.createMany({
          data: [{ ondernemingId, datum: d, omschrijving: [tegen, oms].filter(Boolean).join(" ").trim() || soort.label, bedrag, btwBedrag: btw, categorie: bedrag > 0 && Number(m.type) === 2 ? "omzet" : "overig", bron: "eboekhouden", externId: String(m.id) }],
        }).catch(() => ({ count: 0 }));
        uit.boekingen += r.count;
      }
    }
    await koppelingStatus(ondernemingId, "eboekhouden", "actief");
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    uit.fouten.push(m);
    await koppelingStatus(ondernemingId, "eboekhouden", "fout", m).catch(() => undefined);
  }
  return uit;
}
