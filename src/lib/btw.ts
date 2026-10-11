import { CATEGORIE_INFO, type Categorie } from "./categorieen";

export const rond = (n: number) => Math.round(n * 100) / 100;

/** Btw uit een bedrag inclusief btw halen. Verlegde codes leveren 0 op (die btw zit niet in het bedrag). */
export function btwUitInclusief(bedragIncl: number, code: string | null | undefined): number {
  const pct = code === "21" ? 21 : code === "9" ? 9 : 0;
  if (pct === 0) return 0;
  return rond(bedragIncl - bedragIncl / (1 + pct / 100));
}

export function kwartaalVan(d: Date) {
  return { jaar: d.getFullYear(), kwartaal: Math.floor(d.getMonth() / 3) + 1 };
}

export function kwartaalBereik(jaar: number, kwartaal: number) {
  return { start: new Date(jaar, (kwartaal - 1) * 3, 1), eind: new Date(jaar, kwartaal * 3, 1) };
}

export function maandBereik(jaar: number, maand: number) {
  return { start: new Date(jaar, maand - 1, 1), eind: new Date(jaar, maand, 1) };
}

export function periodeBereik(tijdvak: string, jaar: number, periode: number) {
  if (tijdvak === "maand") return maandBereik(jaar, periode);
  if (tijdvak === "jaar") return { start: new Date(jaar, 0, 1), eind: new Date(jaar + 1, 0, 1) };
  return kwartaalBereik(jaar, periode);
}

/** Uiterste indien- en betaaldatum: laatste dag van de maand na het tijdvak. */
export function btwDeadline(eind: Date) {
  return new Date(eind.getFullYear(), eind.getMonth() + 1, 0);
}

export type Regel = {
  bedrag: number;
  btwCode: string | null;
  btwBedrag: number | null;
  zakelijk: boolean | null;
  categorie: string | null;
  priveDeel?: number;
};

export type Aangifte = {
  "1a_omzet": number; "1a_btw": number;
  "1b_omzet": number; "1b_btw": number;
  "1c_omzet": number; "1c_btw": number;
  "1e_omzet": number;
  "2a_omzet": number; "2a_btw": number;
  "3a_omzet": number;
  "3b_omzet": number;
  "4a_omzet": number; "4a_btw": number;
  "4b_omzet": number; "4b_btw": number;
  "5a_verschuldigd": number;
  "5b_voorbelasting": number;
  "5c_te_betalen": number;
};

/**
 * Rubrieken van de Nederlandse btw-aangifte voor een eenmanszaak.
 * 1a hoog, 1b laag, 1e 0%/vrijgesteld, 2a verlegd naar mij (NL), 3a buiten EU, 3b binnen EU,
 * 4a van buiten EU, 4b van binnen EU, 5a verschuldigd, 5b voorbelasting, 5c saldo.
 */
export function btwAangifte(regels: Regel[]): Aangifte {
  const r: Record<string, number> = {};
  const tel = (k: string, v: number) => (r[k] = (r[k] ?? 0) + v);
  for (const x of regels) {
    if (x.zakelijk === false) continue;
    const zakelijkDeel = 1 - (x.priveDeel ?? 0);
    const incl = Math.abs(x.bedrag) * zakelijkDeel;
    const btw = (x.btwBedrag ?? btwUitInclusief(Math.abs(x.bedrag), x.btwCode)) * zakelijkDeel;
    const excl = incl - btw;
    const code = x.btwCode ?? "geen";
    const soort = x.categorie && x.categorie in CATEGORIE_INFO ? CATEGORIE_INFO[x.categorie as Categorie].soort : "kosten";
    if (soort === "balans" || soort === "prive") continue;

    if (x.bedrag > 0) {
      if (code === "21") { tel("1a_omzet", excl); tel("1a_btw", btw); }
      else if (code === "9") { tel("1b_omzet", excl); tel("1b_btw", btw); }
      else if (code === "verlegd") { tel("1e_omzet", excl); }
      else if (code === "eu_dienst" || code === "eu_goed" || x.categorie === "omzet_eu") { tel("3b_omzet", excl); }
      else if (code === "buiten_eu" || x.categorie === "omzet_buiten_eu") { tel("3a_omzet", excl); }
      else if (code === "0" || code === "vrijgesteld") { tel("1e_omzet", excl); }
    } else {
      if (code === "eu_dienst" || code === "eu_goed") {
        const b = rond(incl * 0.21);
        tel("4b_omzet", incl); tel("4b_btw", b); tel("5b_voorbelasting", b);
      } else if (code === "buiten_eu") {
        const b = rond(incl * 0.21);
        tel("4a_omzet", incl); tel("4a_btw", b); tel("5b_voorbelasting", b);
      } else if (code === "verlegd") {
        const b = rond(incl * 0.21);
        tel("2a_omzet", incl); tel("2a_btw", b); tel("5b_voorbelasting", b);
      } else {
        tel("5b_voorbelasting", btw);
      }
    }
  }
  const verschuldigd = (r["1a_btw"] ?? 0) + (r["1b_btw"] ?? 0) + (r["1c_btw"] ?? 0) + (r["2a_btw"] ?? 0) + (r["4a_btw"] ?? 0) + (r["4b_btw"] ?? 0);
  const g = (k: string) => rond(r[k] ?? 0);
  return {
    "1a_omzet": g("1a_omzet"), "1a_btw": g("1a_btw"),
    "1b_omzet": g("1b_omzet"), "1b_btw": g("1b_btw"),
    "1c_omzet": g("1c_omzet"), "1c_btw": g("1c_btw"),
    "1e_omzet": g("1e_omzet"),
    "2a_omzet": g("2a_omzet"), "2a_btw": g("2a_btw"),
    "3a_omzet": g("3a_omzet"),
    "3b_omzet": g("3b_omzet"),
    "4a_omzet": g("4a_omzet"), "4a_btw": g("4a_btw"),
    "4b_omzet": g("4b_omzet"), "4b_btw": g("4b_btw"),
    "5a_verschuldigd": rond(verschuldigd),
    "5b_voorbelasting": g("5b_voorbelasting"),
    "5c_te_betalen": rond(verschuldigd - (r["5b_voorbelasting"] ?? 0)),
  };
}

export const euro = (n: number) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);

/** Datums tonen we altijd als Nederlandse kalenderdatum, los van de tijdzone van de server. */
export const TIJDZONE = "Europe/Amsterdam";

const nlDatum = new Intl.DateTimeFormat("nl-NL", { timeZone: TIJDZONE, day: "2-digit", month: "2-digit", year: "numeric" });
export const datumNl = (d: Date) => nlDatum.format(d);

const isoFormaat = new Intl.DateTimeFormat("en-CA", { timeZone: TIJDZONE, year: "numeric", month: "2-digit", day: "2-digit" });
/**
 * Kalenderdatum JJJJ-MM-DD in Nederlandse tijd. toISOString() gaf de UTC-datum, waardoor lokale middernacht
 * (new Date(2026, 0, 1) op een machine in NL) 2025-12-31 werd. UTC-middernacht (new Date("2026-01-01")) en
 * lokale middernacht in NL of UTC vallen in Nederland op dezelfde kalenderdag, dus dit klopt in beide tijdzones.
 */
export const isoDatum = (d: Date) => {
  const p = Object.fromEntries(isoFormaat.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
};

/** Maandnummer 1-12 van de Nederlandse kalenderdatum (zelfde regel als isoDatum). */
export const maandNl = (d: Date) => Number(isoDatum(d).slice(5, 7));
