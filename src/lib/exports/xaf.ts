import { MERK } from "@/lib/merk";
import { db } from "@/lib/db";
import { btwUitInclusief, isoDatum, maandNl, rond } from "@/lib/btw";
import { CATEGORIE_INFO, RGS_OMSCHRIJVING, type Categorie } from "@/lib/categorieen";

/**
 * XML Auditfile Financieel (XAF). Twee formaten uit hetzelfde boekingsmodel:
 * - XAF 4.0.3 (standaard): https://odb.belastingdienst.nl/documentatie/xml-auditfile-financieel-xaf-4-0-3/
 *   Vanaf 1 januari 2027 accepteert de Belastingdienst alleen nog 4.0.
 * - XAF 3.2: alleen nog voor boekjaren vóór 2027.
 * Beide gevalideerd tegen de XSD (zie test/belastingdienst-xsd.ts).
 */
export type XafVersie = "4.0" | "3.2";
export const XAF_STANDAARD: XafVersie = "4.0";
/** 3.2 mag alleen voor oudere periodes; vanaf boekjaar 2027 alleen 4.0. */
export const XAF32_TOT_JAAR = 2027;
export const xafVersieToegestaan = (versie: XafVersie, jaar: number) => versie === "4.0" || jaar < XAF32_TOT_JAAR;

const NS: Record<XafVersie, string> = {
  "4.0": "http://www.odb.belastingdienst.nl/Belastingdienst/BCPP/1.1/structures/XmlauditfileXAF_4.0",
  "3.2": "http://www.auditfiles.nl/XAF/3.2",
};

const x = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const g = (n: number) => (Math.round(n * 100) / 100 || 0).toFixed(2);
/** Afkappen op de maximale lengte uit de XSD (String50, IdentificationString35, …). */
const max = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
/** Optioneel element: weglaten als er geen waarde is. */
const opt = (tag: string, v: unknown, n = 999) => (max(v, n) ? `<${tag}>${x(max(v, n))}</${tag}>` : "");
/** ISO 3166-1 alpha-2, zoals de XSD vereist; onbekend of leeg → weglaten. */
const land = (v: string | null | undefined) => (v && /^[A-Z]{2}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : "");
/** Kalenderdatum van de laatste dag van een maand (maand 1-12), zonder Date-tijdzonegedoe. */
const laatsteDag = (jaar: number, maand: number) => new Date(Date.UTC(jaar, maand, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, "0");

/** RGS-codes herkennen (B… balans, W… winst-en-verlies), zodat een eigen grootboeknummer niet als RGS wordt opgegeven. */
const isRgs = (code: string) => /^[BW][A-Z][a-z]{2}[A-Za-z]*$/.test(code);
/** XAF 3.2: RGS via ledgerAccount/taxonomy (nadere specificatie 2017), niet in leadCode/leadReference. */
const RGS_TAXOREF = "https://www.referentiegrootboekschema.nl RGS 3";

type Regel = { nr: number; recID: string; datum: Date; omschrijving: string; accID: string; debet: number; credit: number; btwCode: string; btwBedrag: number; custSupID?: string; factuur?: string; jrn: string };

export type XafBron = {
  onderneming: { id: string; naam: string; kvk: string | null; btwId: string | null; btwNummer: string | null; adres: string | null; plaats: string | null; postcode: string | null; land?: string | null };
  transacties: { id: string; datum: Date; bedrag: number; tegenpartij: string; omschrijving: string; categorie: string | null; btwCode: string | null; btwBedrag: number | null; priveDeel: number }[];
  facturen: { nummer: string; datum: Date; klantId: string; klant: { naam: string }; btwVerlegd: boolean; subtotaal: number; btw: number; totaal: number }[];
  memoriaal: { id: string; datum: Date; omschrijving: string; grootboek: string | null; categorie: string | null; btwCode: string; btwBedrag: number; bedrag: number; soort: string }[];
  klanten: { id: string; naam: string; email?: string | null; kvk?: string | null; btwNummer: string | null; adres: string | null; plaats: string | null; postcode: string | null; land: string }[];
  leveranciers: { leverancier: string | null; leverancierBtw: string | null }[];
};

type Relatie = { id: string; naam: string; tp: "C" | "S"; email?: string | null; kvk?: string | null; land?: string; btw?: string | null; adres?: string | null; plaats?: string | null; postcode?: string | null };

function rgsVan(cat: string | null | undefined) {
  if (cat && cat in CATEGORIE_INFO) return CATEGORIE_INFO[cat as Categorie].rgs;
  return "WBedOvpOvp";
}

const BTW_PERC: Record<string, string> = { "21": "21.000", "9": "9.000" };
const BANK = "BLimBanRba", DEB = "BVorDebHad", BTW_AF = "BSchBepBtw", BTW_VOOR = "BVorVbkTvo", KRUIS = "BLimKruKru";
const JOURNALEN = [
  { id: "BNK", desc: "Bankboek", type: "B" },
  { id: "VRK", desc: "Verkoopboek", type: "S" },
  { id: "MEM", desc: "Memoriaal", type: "M" },
];

/** Boekingsmodel dat beide formaten delen: journaalregels, gebruikte rekeningen, btw-codes en relaties. */
function boekingen(bron: XafBron) {
  const gebruikteRek = new Set<string>([BANK, DEB, BTW_AF, BTW_VOOR, KRUIS]);
  const regels: Regel[] = [];
  let nr = 0;

  // Bankjournaal. Bank krijgt het volle bedrag; het privédeel gaat naar privé, de rest naar kosten/omzet en btw.
  // Afronden per regel, zodat elke boeking op de cent sluit.
  for (const t of bron.transacties) {
    nr++;
    const rek = rgsVan(t.categorie);
    gebruikteRek.add(rek);
    const totaal = rond(Math.abs(t.bedrag));
    const incl = rond(totaal * (1 - t.priveDeel));
    const btw = rond((t.btwBedrag ?? btwUitInclusief(Math.abs(t.bedrag), t.btwCode)) * (1 - t.priveDeel));
    const ex = rond(incl - btw);
    const pr = rond(totaal - incl);
    const d = { recID: t.id.slice(-10), datum: t.datum, omschrijving: `${t.tegenpartij} ${t.omschrijving}`.trim().slice(0, 200), btwCode: t.btwCode ?? "geen", jrn: "BNK" };
    if (t.bedrag > 0) {
      regels.push({ nr, ...d, accID: BANK, debet: totaal, credit: 0, btwBedrag: 0 });
      regels.push({ nr, ...d, accID: rek, debet: 0, credit: ex, btwBedrag: btw });
      if (btw > 0) regels.push({ nr, ...d, accID: BTW_AF, debet: 0, credit: btw, btwBedrag: 0 });
    } else {
      regels.push({ nr, ...d, accID: rek, debet: ex, credit: 0, btwBedrag: btw });
      if (btw > 0) regels.push({ nr, ...d, accID: BTW_VOOR, debet: btw, credit: 0, btwBedrag: 0 });
      regels.push({ nr, ...d, accID: BANK, debet: 0, credit: totaal, btwBedrag: 0 });
    }
    if (pr > 0) {
      gebruikteRek.add("BEivKapPro");
      regels.push({ nr, ...d, accID: "BEivKapPro", debet: t.bedrag < 0 ? pr : 0, credit: t.bedrag > 0 ? pr : 0, btwBedrag: 0 });
    }
  }
  // Verkoopjournaal
  for (const f of bron.facturen) {
    nr++;
    const rek = f.btwVerlegd ? "WOmzNopOlb" : "WOmzNopOlv";
    gebruikteRek.add(rek);
    const d = { recID: f.nummer, factuur: f.nummer, datum: f.datum, omschrijving: `Factuur ${f.nummer} ${f.klant.naam}`, btwCode: f.btwVerlegd ? "verlegd" : "21", jrn: "VRK", custSupID: f.klantId.slice(-10) };
    regels.push({ nr, ...d, accID: DEB, debet: rond(f.totaal), credit: 0, btwBedrag: 0 });
    regels.push({ nr, ...d, accID: rek, debet: 0, credit: rond(f.subtotaal), btwBedrag: rond(f.btw) });
    if (f.btw) regels.push({ nr, ...d, accID: BTW_AF, debet: 0, credit: rond(f.btw), btwBedrag: 0 });
  }
  // Memoriaal
  for (const m of bron.memoriaal) {
    nr++;
    const rek = m.grootboek ?? rgsVan(m.categorie);
    gebruikteRek.add(rek);
    const d = { recID: m.id.slice(-10), datum: m.datum, omschrijving: m.omschrijving.replace(/^AFS:[^|]*\| /, ""), btwCode: m.btwCode || "geen", jrn: "MEM" };
    const bedrag = rond(Math.abs(m.bedrag));
    const tegen = m.soort === "afschrijving" ? "BMvaBeiVvp" : m.soort === "prive_gebruik" ? "BEivKapPro" : KRUIS;
    gebruikteRek.add(tegen);
    regels.push({ nr, ...d, accID: rek, debet: m.bedrag < 0 ? bedrag : 0, credit: m.bedrag >= 0 ? bedrag : 0, btwBedrag: m.btwBedrag });
    regels.push({ nr, ...d, accID: tegen, debet: m.bedrag >= 0 ? bedrag : 0, credit: m.bedrag < 0 ? bedrag : 0, btwBedrag: 0 });
  }

  // Btw-codes: elke vatID in een trLine moet in vatCodes staan.
  const btwCodes = new Set(["21", "9", "0", "vrijgesteld", "geen", "verlegd", "eu_dienst", "eu_goed", "buiten_eu"]);
  for (const r of regels) if (r.btwBedrag) btwCodes.add(max(r.btwCode, 35));

  // Relaties: custSupID is uniek en max. 35 tekens.
  const relaties: Relatie[] = [];
  const ids = new Set<string>();
  for (const k of bron.klanten) {
    const id = max(k.id.slice(-10), 35);
    if (ids.has(id)) continue;
    ids.add(id);
    relaties.push({ id, naam: k.naam, tp: "C", email: k.email, kvk: k.kvk, land: land(k.land), btw: k.btwNummer, adres: k.adres, plaats: k.plaats, postcode: k.postcode });
  }
  for (const l of bron.leveranciers) {
    if (!l.leverancier) continue;
    const id = max(`L-${l.leverancier}`, 35);
    if (ids.has(id)) continue;
    ids.add(id);
    relaties.push({ id, naam: l.leverancier, tp: "S", btw: l.leverancierBtw });
  }

  return {
    regels,
    rekeningen: [...gebruikteRek].sort(),
    btwCodes: [...btwCodes],
    relaties,
    totDeb: rond(regels.reduce((s, r) => s + r.debet, 0)),
    totCred: rond(regels.reduce((s, r) => s + r.credit, 0)),
  };
}

const adresXml = (a: { adres?: string | null; plaats?: string | null; postcode?: string | null; land?: string }, straatMax: number) => {
  const inhoud = [opt("streetname", a.adres, straatMax), opt("city", a.plaats, 50), opt("postalCode", a.postcode, 10), a.land ? `<country>${a.land}</country>` : ""].join("");
  return inhoud ? `<streetAddress>${inhoud}</streetAddress>` : "";
};

/** Genereer de auditfile in het gekozen formaat (standaard XAF 4.0). */
export function xafXml(bron: XafBron, jaar: number, opties: { versie?: XafVersie; aangemaakt?: Date } = {}): string {
  const versie = opties.versie ?? XAF_STANDAARD;
  const v4 = versie === "4.0";
  const aangemaakt = opties.aangemaakt ?? new Date();
  const o = bron.onderneming;
  const b = boekingen(bron);
  const bedrijfsland = land(o.land) || "NL";

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<auditfile xmlns="${NS[versie]}">`);
  // RGSVersion (4.0) laten we weg: de RGS-versie van de codes in categorieen.ts is niet vastgelegd.
  out.push(`<header><fiscalYear>${jaar}</fiscalYear><startDate>${jaar}-01-01</startDate><endDate>${jaar}-12-31</endDate><curCode>EUR</curCode><dateCreated>${isoDatum(aangemaakt)}</dateCreated><softwareDesc>${x(max(MERK, 50))}</softwareDesc><softwareVersion>1.0</softwareVersion></header>`);
  out.push(v4
    ? `<company>${opt("Commercenr", o.kvk, 100)}<companyName>${x(max(o.naam, 255))}</companyName>`
    : `<company>${opt("companyIdent", o.kvk ?? o.id, 35)}<companyName>${x(max(o.naam, 999))}</companyName>`);
  out.push(`<taxRegistrationCountry>${bedrijfsland}</taxRegistrationCountry><taxRegIdent>${x(max(o.btwId ?? o.btwNummer ?? "", 30))}</taxRegIdent>`);
  out.push(adresXml({ ...o, land: bedrijfsland }, v4 ? 100 : 999));

  if (b.relaties.length) {
    out.push(`<customersSuppliers>`);
    for (const r of b.relaties) {
      const land = r.land ? `<taxRegistrationCountry>${r.land}</taxRegistrationCountry>` : "";
      const kern = v4
        ? `${opt("custSupName", r.naam, 50)}${opt("eMail", r.email, 255)}${opt("commerceNr", r.kvk, 100)}${land}${opt("taxRegIdent", r.btw, 30)}<custSupTp>${r.tp}</custSupTp>`
        : `${opt("custSupName", r.naam, 50)}${opt("eMail", r.email, 255)}${opt("commerceNr", r.kvk, 999)}${land}${opt("taxRegIdent", r.btw, 30)}<custSupTp>${r.tp}</custSupTp>`;
      out.push(`<customerSupplier><custSupID>${x(r.id)}</custSupID>${kern}${adresXml(r, v4 ? 100 : 999)}</customerSupplier>`);
    }
    out.push(`</customersSuppliers>`);
  }

  out.push(`<generalLedger>`);
  for (const r of b.rekeningen) {
    const omschrijving = x(max(RGS_OMSCHRIJVING[r] ?? r, v4 ? 255 : 999));
    const type = r.startsWith("B") ? "B" : "P";
    const rgs = isRgs(r)
      ? v4 ? `<RGScode>${x(r)}</RGScode>` : `<taxonomy><taxoRef>${x(RGS_TAXOREF)}</taxoRef><entryPoint><entryPointRef>RGS</entryPointRef><conceptRef>${x(r)}</conceptRef></entryPoint></taxonomy>`
      : "";
    out.push(`<ledgerAccount><accID>${x(max(r, 35))}</accID><accDesc>${omschrijving}</accDesc><accTp>${type}</accTp>${rgs}</ledgerAccount>`);
  }
  out.push(`</generalLedger>`);

  out.push(`<vatCodes>${b.btwCodes.map((c) => `<vatCode><vatID>${x(c)}</vatID><vatDesc>${x(max(`btw ${c}`, 100))}</vatDesc><vatToPayAccID>${BTW_AF}</vatToPayAccID><vatToClaimAccID>${BTW_VOOR}</vatToClaimAccID></vatCode>`).join("")}</vatCodes>`);
  out.push(`<periods>${Array.from({ length: 12 }, (_, i) => {
    const m = pad(i + 1);
    return `<period><periodNumber>${i + 1}</periodNumber>${v4 ? "" : `<periodDesc>${jaar}-${m}</periodDesc>`}<startDatePeriod>${jaar}-${m}-01</startDatePeriod><endDatePeriod>${jaar}-${m}-${pad(laatsteDag(jaar, i + 1))}</endDatePeriod></period>`;
  }).join("")}</periods>`);
  out.push(`<openingBalance>${v4 ? "" : `<opBalDate>${jaar}-01-01</opBalDate>`}<linesCount>0</linesCount><totalDebit>0.00</totalDebit><totalCredit>0.00</totalCredit></openingBalance>`);

  // transactions hoort binnen company (beide versies).
  out.push(`<transactions><linesCount>${b.regels.length}</linesCount><totalDebit>${g(b.totDeb)}</totalDebit><totalCredit>${g(b.totCred)}</totalCredit>`);
  for (const j of JOURNALEN) {
    const eigen = b.regels.filter((r) => r.jrn === j.id);
    if (eigen.length === 0) continue;
    out.push(`<journal><jrnID>${j.id}</jrnID><desc>${j.desc}</desc><jrnTp>${j.type}</jrnTp>`);
    const perNr = new Map<number, Regel[]>();
    for (const r of eigen) perNr.set(r.nr, [...(perNr.get(r.nr) ?? []), r]);
    for (const [n, rs] of perNr) {
      const eerste = rs[0];
      const kop = `<transaction><nr>${n}</nr><desc>${x(eerste.omschrijving)}</desc><periodNumber>${maandNl(eerste.datum)}</periodNumber><trDt>${isoDatum(eerste.datum)}</trDt>`;
      // 4.0 kent geen bedrag op transactieniveau; wel Source (de applicatie).
      out.push(v4 ? `${kop}<Source>${x(max(MERK, 999))}</Source>` : `${kop}<amnt>${g(rs.reduce((s, r) => s + r.debet, 0))}</amnt><amntTp>D</amntTp>`);
      let ln = 0;
      for (const r of rs) {
        ln++;
        const vat = r.btwBedrag
          ? `<vat><vatID>${x(max(r.btwCode, 35))}</vatID><vatPerc>${BTW_PERC[r.btwCode] ?? "0.000"}</vatPerc><vatAmnt>${g(Math.abs(r.btwBedrag))}</vatAmnt><vatAmntTp>${r.debet ? "D" : "C"}</vatAmntTp></vat>`
          : "";
        out.push(`<trLine><nr>${ln}</nr><accID>${x(max(r.accID, 35))}</accID><docRef>${x(max(r.recID, v4 ? 255 : 999))}</docRef><effDate>${isoDatum(r.datum)}</effDate><desc>${x(r.omschrijving)}</desc><amnt>${g(r.debet || r.credit)}</amnt><amntTp>${r.debet ? "D" : "C"}</amntTp>${r.custSupID ? `<custSupID>${x(max(r.custSupID, 35))}</custSupID>` : ""}${opt("invRef", r.factuur, 255)}${vat}</trLine>`);
      }
      out.push(`</transaction>`);
    }
    out.push(`</journal>`);
  }
  out.push(`</transactions>`);
  out.push(`</company>`);
  out.push(`</auditfile>`);
  return out.join("\n");
}

export async function xafExport(ondernemingId: string, jaar: number, versie: XafVersie = XAF_STANDAARD): Promise<string> {
  if (!xafVersieToegestaan(versie, jaar)) throw new Error(`XAF ${versie} is niet meer toegestaan voor boekjaar ${jaar}; gebruik XAF 4.0.`);
  // Ruim ophalen en daarna op de Nederlandse kalenderdatum filteren, zodat de jaargrens niet van de servertijdzone afhangt.
  const start = new Date(Date.UTC(jaar - 1, 11, 31));
  const eind = new Date(Date.UTC(jaar + 1, 0, 2));
  const inJaar = <T extends { datum: Date }>(rijen: T[]) => rijen.filter((r) => isoDatum(r.datum).startsWith(`${jaar}-`));
  const [onderneming, transactiesRuim, facturenRuim, memoriaalRuim, klanten, bonnen] = await Promise.all([
    db.onderneming.findUniqueOrThrow({ where: { id: ondernemingId } }),
    db.transactie.findMany({ where: { ondernemingId, datum: { gte: start, lt: eind }, zakelijk: true }, orderBy: { datum: "asc" } }),
    db.factuur.findMany({ where: { ondernemingId, datum: { gte: start, lt: eind }, status: { not: "concept" } }, orderBy: { datum: "asc" }, include: { klant: true } }),
    db.memoriaalboeking.findMany({ where: { ondernemingId, datum: { gte: start, lt: eind } }, orderBy: { datum: "asc" } }),
    db.klant.findMany({ where: { ondernemingId } }),
    db.bon.findMany({ where: { ondernemingId, status: { in: ["gekoppeld", "uitgelezen"] } }, select: { leverancier: true, leverancierBtw: true } }),
  ]);
  const [transacties, facturen, memoriaal] = [inJaar(transactiesRuim), inJaar(facturenRuim), inJaar(memoriaalRuim)];
  const leveranciers = [...new Map(bonnen.filter((b) => b.leverancier).map((b) => [b.leverancier!, b])).values()];
  return xafXml({ onderneming, transacties, facturen, memoriaal, klanten, leveranciers }, jaar, { versie });
}
