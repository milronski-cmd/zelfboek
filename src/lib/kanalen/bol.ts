import { bewaarKanaalRegels, centen, haalJson, isoDag, kanaalConfig, voerKanaalUit, type KanaalRegel, type KanaalUitkomst } from "./basis";

/**
 * bol Retailer API v10, Invoices API (https://api.bol.com/retailer/public/Retailer-API/v10/functional/retailer-api/invoices.html).
 * Per ALL_IN_ONE-factuur halen we de specificatie op: regels met naam TURNOVER zijn de doorgestorte verkoopopbrengst (omzet),
 * alle andere regels (COMMISSION, SHIPMENT_LABEL, PICK_PACK, STOCK, ...) zijn kosten van bol.com B.V. (btw 21 of zonder btw).
 * Config: { clientId, clientSecret, demo? } van het partnerplatform. demo = "true" gebruikt https://api.bol.com/retailer-demo.
 *
 * Belangrijk uit de documentatie:
 * - token: POST https://login.bol.com/token?grant_type=client_credentials met Basic-authenticatie, geldig 299 seconden;
 * - GET /retailer/invoices?period-start-date&period-end-date (yyyy-mm-dd), periode maximaal 32 dagen;
 * - GET /retailer/invoices/{id}/specification?page=n, maximaal 25.000 regels per pagina;
 * - Accept: application/vnd.retailer.v10+json.
 */
const ACCEPT = "application/vnd.retailer.v10+json";
const DAG = 864e5;
const PAGINA = 25000;

type Bedrag = { amount?: number; currencyID?: string };
type Waarde = { value?: number | string; currencyID?: string };
export type BolFactuur = {
  invoiceId: string;
  invoiceType?: string;
  issueDate?: number | string;
  invoicePeriod?: { startDate?: number | string; endDate?: number | string };
  legalMonetaryTotal?: { lineExtensionAmount?: Bedrag; payableAmount?: Bedrag; taxExclusiveAmount?: Bedrag; taxInclusiveAmount?: Bedrag };
};
export type BolSpecRegel = {
  id?: string;
  invoiceLineRef?: string;
  item?: { Name?: Waarde; Description?: Waarde[] };
  lineExtensionAmount?: Waarde;
  taxTotal?: { TaxAmount?: Waarde };
};

export type BolConfig = { clientId: string; clientSecret: string; demo?: string };

export async function bolToken(clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch("https://login.bol.com/token?grant_type=client_credentials", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`bol.com: client-id of client-secret ongeldig (${r.status}).`);
  return ((await r.json()) as { access_token: string }).access_token;
}

/** bol geeft datums als epoch (seconden of milliseconden) of als ISO-tekst. */
export function bolDatum(v: number | string | undefined): Date {
  if (v === undefined || v === null || v === "") return new Date(NaN);
  if (typeof v === "number" || /^\d+$/.test(v)) {
    const n = Number(v);
    return new Date(n < 1e11 ? n * 1000 : n);
  }
  return new Date(v);
}

const getal = (w?: Waarde) => {
  const n = typeof w?.value === "number" ? w.value : parseFloat(String(w?.value ?? ""));
  return Number.isFinite(n) ? n : 0;
};

/** Specificatieregels van één factuur optellen tot omzet en kosten (met en zonder btw), inclusief btw. */
export function telSpecificatie(regels: BolSpecRegel[]) {
  let omzet = 0, kostenBtw = 0, kostenZonder = 0;
  for (const s of regels) {
    const naam = String(s.item?.Name?.value ?? s.invoiceLineRef?.split("#")[1] ?? "").toUpperCase();
    const excl = getal(s.lineExtensionAmount);
    const btw = getal(s.taxTotal?.TaxAmount);
    if (naam.includes("TURNOVER")) omzet += excl + btw;
    else if (btw !== 0) kostenBtw += excl + btw;
    else kostenZonder += excl;
  }
  return { omzet: centen(omzet), kostenBtw: centen(kostenBtw), kostenZonder: centen(kostenZonder) };
}

/** Alle uitbetalingen en kosten van bol.com in [vanaf, nu] als kanaalregels. Raakt de database niet. */
export async function haalBolRegels(cfg: BolConfig, vanaf: Date, nu = new Date()): Promise<KanaalRegel[]> {
  const basis = cfg.demo === "true" ? "https://api.bol.com/retailer-demo" : "https://api.bol.com/retailer";
  let token = await bolToken(cfg.clientId, cfg.clientSecret);
  let tokenTijd = Date.now();
  const kop = async () => {
    if (Date.now() - tokenTijd > 240_000) { token = await bolToken(cfg.clientId, cfg.clientSecret); tokenTijd = Date.now(); }
    return { Authorization: `Bearer ${token}`, Accept: ACCEPT };
  };

  // Facturen per venster van maximaal 31 dagen (de API weigert langere perioden)
  const facturen = new Map<string, BolFactuur>();
  for (let start = new Date(isoDag(vanaf)); start <= nu; start = new Date(start.getTime() + 31 * DAG)) {
    const eind = new Date(Math.min(start.getTime() + 30 * DAG, nu.getTime()));
    const r = await haalJson<{ invoiceListItems?: BolFactuur[] }>(
      `${basis}/invoices?period-start-date=${isoDag(start)}&period-end-date=${isoDag(eind)}`, { headers: await kop() }, "bol.com",
    );
    for (const f of r?.invoiceListItems ?? []) facturen.set(f.invoiceId, f);
  }

  const regels: KanaalRegel[] = [];
  for (const f of facturen.values()) {
    // Advertentiefacturen (ADVERTISING_VIA_BOL) betaal je los; die komen als inkoopfactuur of bankafschrijving binnen.
    if (f.invoiceType && f.invoiceType !== "ALL_IN_ONE") continue;
    const d = bolDatum(f.issueDate ?? f.invoicePeriod?.endDate);
    const spec: BolSpecRegel[] = [];
    for (let page = 1; page <= 40; page++) {
      const r = await haalJson<{ invoiceSpecification?: BolSpecRegel[] }>(
        `${basis}/invoices/${encodeURIComponent(f.invoiceId)}/specification?page=${page}`, { headers: await kop() }, "bol.com",
      );
      const deel = r?.invoiceSpecification ?? [];
      spec.push(...deel);
      if (deel.length < PAGINA) break;
    }
    const t = telSpecificatie(spec);
    if (t.omzet) regels.push({ datum: d, bedrag: t.omzet, tegenpartij: "bol.com", omschrijving: `Verkopen bol.com factuur ${f.invoiceId}`, externId: f.invoiceId, categorie: "omzet", btwCode: "21" });
    if (t.kostenBtw) regels.push({ datum: d, bedrag: -t.kostenBtw, tegenpartij: "bol.com", omschrijving: `Commissie en kosten ${f.invoiceId}`, externId: `${f.invoiceId}-commissie`, categorie: "betaalprovider", btwCode: "21" });
    if (t.kostenZonder) regels.push({ datum: d, bedrag: -t.kostenZonder, tegenpartij: "bol.com", omschrijving: `Kosten zonder btw ${f.invoiceId}`, externId: `${f.invoiceId}-kosten0`, categorie: "betaalprovider", btwCode: "geen" });
  }
  return regels;
}

export async function haalTransacties(ondernemingId: string, vanaf: Date): Promise<KanaalUitkomst> {
  return voerKanaalUit(ondernemingId, "bol", async () => {
    const cfg = await kanaalConfig<BolConfig>(ondernemingId, "bol", ["clientId", "clientSecret"], "bol.com");
    return bewaarKanaalRegels(ondernemingId, "bol", await haalBolRegels(cfg, vanaf));
  });
}
