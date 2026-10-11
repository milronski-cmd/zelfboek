import { MERK } from "@/lib/merk";
import { db } from "@/lib/db";
import { btwUitInclusief, rond } from "@/lib/btw";
import { CATEGORIE_INFO, RGS_OMSCHRIJVING, type Categorie } from "@/lib/categorieen";

const x = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const g = (n: number) => (Math.round(n * 100) / 100 || 0).toFixed(2);
/** Kalenderdatum in lokale tijd (toISOString zou 1 januari 00:00 in NL naar 31 december verschuiven). */
const dag = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Afkappen op de maximale lengte uit de XSD (String50, IdentificationString35, …). */
const max = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
/** Optioneel element: weglaten als er geen waarde is. */
const opt = (tag: string, v: unknown, n = 999) => (max(v, n) ? `<${tag}>${x(max(v, n))}</${tag}>` : "");

/** ISO 3166-1 alpha-2, zoals de XAF-XSD vereist; onbekend of leeg → weglaten. */
const land = (v: string | null | undefined) => (v && /^[A-Z]{2}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : "");

/**
 * RGS-koppeling volgens de XAF 3.2-specificatie (nadere specificatie 2017): niet in leadCode/leadReference,
 * maar in ledgerAccount/taxonomy (taxoRef) met entryPoint/conceptRef = de RGS-code.
 */
const RGS_TAXOREF = "https://www.referentiegrootboekschema.nl RGS 3";

type Regel = { nr: number; recID: string; datum: Date; omschrijving: string; accID: string; debet: number; credit: number; btwCode: string; btwBedrag: number; custSupID?: string; jrn: string };

export type XafBron = {
  onderneming: { id: string; naam: string; kvk: string | null; btwId: string | null; btwNummer: string | null; adres: string | null; plaats: string | null; postcode: string | null; land?: string | null };
  transacties: { id: string; datum: Date; bedrag: number; tegenpartij: string; omschrijving: string; categorie: string | null; btwCode: string | null; btwBedrag: number | null; priveDeel: number }[];
  facturen: { nummer: string; datum: Date; klantId: string; klant: { naam: string }; btwVerlegd: boolean; subtotaal: number; btw: number; totaal: number }[];
  memoriaal: { id: string; datum: Date; omschrijving: string; grootboek: string | null; categorie: string | null; btwCode: string; btwBedrag: number; bedrag: number; soort: string }[];
  klanten: { id: string; naam: string; btwNummer: string | null; adres: string | null; plaats: string | null; postcode: string | null; land: string }[];
  leveranciers: { leverancier: string | null; leverancierBtw: string | null }[];
};

function rgsVan(cat: string | null | undefined) {
  if (cat && cat in CATEGORIE_INFO) return CATEGORIE_INFO[cat as Categorie].rgs;
  return "WBedOvpOvp";
}

const BTW_PERC: Record<string, string> = { "21": "21.000", "9": "9.000" };

/**
 * XML Auditfile Financieel 3.2 (namespace http://www.auditfiles.nl/XAF/3.2). Journaal: bank (per transactie bank
 * tegen kosten/omzet en btw), verkoop (facturen tegen debiteuren), memoriaal. Grootboek met RGS-codes.
 * Gevalideerd tegen XmlAuditfileFinancieel3.2.xsd (zie test/belastingdienst-xsd.ts).
 * Let op: de Belastingdienst accepteert vanaf 1 januari 2027 alleen nog XAF 4.0.
 */
export function xafXml(bron: XafBron, jaar: number, aangemaakt = new Date()): string {
  const { onderneming: o, transacties, facturen, memoriaal, klanten } = bron;
  const start = new Date(jaar, 0, 1);

  const BANK = "BLimBanRba", DEB = "BVorDebHad", BTW_AF = "BSchBepBtw", BTW_VOOR = "BVorVbkTvo", KRUIS = "BLimKruKru";
  const gebruikteRek = new Set<string>([BANK, DEB, BTW_AF, BTW_VOOR, KRUIS]);
  const regels: Regel[] = [];
  let nr = 0;

  // Bankjournaal
  for (const t of transacties) {
    nr++;
    const rek = rgsVan(t.categorie);
    gebruikteRek.add(rek);
    // Bank krijgt het volle bedrag; het privédeel gaat naar privé, de rest naar kosten/omzet en btw.
    // Afronden per regel, zodat elke boeking op de cent sluit.
    const totaal = rond(Math.abs(t.bedrag));
    const incl = rond(totaal * (1 - t.priveDeel));
    const btw = rond((t.btwBedrag ?? btwUitInclusief(Math.abs(t.bedrag), t.btwCode)) * (1 - t.priveDeel));
    const ex = rond(incl - btw);
    const pr = rond(totaal - incl);
    const recID = t.id.slice(-10);
    const d = { recID, datum: t.datum, omschrijving: `${t.tegenpartij} ${t.omschrijving}`.trim().slice(0, 200), btwCode: t.btwCode ?? "geen", jrn: "BNK" };
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
  for (const f of facturen) {
    nr++;
    const rek = f.btwVerlegd ? "WOmzNopOlb" : "WOmzNopOlv";
    gebruikteRek.add(rek);
    const d = { recID: f.nummer, datum: f.datum, omschrijving: `Factuur ${f.nummer} ${f.klant.naam}`, btwCode: f.btwVerlegd ? "verlegd" : "21", jrn: "VRK", custSupID: f.klantId.slice(-10) };
    regels.push({ nr, ...d, accID: DEB, debet: f.totaal, credit: 0, btwBedrag: 0 });
    regels.push({ nr, ...d, accID: rek, debet: 0, credit: f.subtotaal, btwBedrag: f.btw });
    if (f.btw) regels.push({ nr, ...d, accID: BTW_AF, debet: 0, credit: f.btw, btwBedrag: 0 });
  }
  // Memoriaal
  for (const m of memoriaal) {
    nr++;
    const rek = m.grootboek ?? rgsVan(m.categorie);
    gebruikteRek.add(rek);
    const d = { recID: m.id.slice(-10), datum: m.datum, omschrijving: m.omschrijving.replace(/^AFS:[^|]*\| /, ""), btwCode: m.btwCode || "geen", jrn: "MEM" };
    const bedrag = Math.abs(m.bedrag);
    const tegen = m.soort === "afschrijving" ? "BMvaBeiVvp" : m.soort === "prive_gebruik" ? "BEivKapPro" : KRUIS;
    gebruikteRek.add(tegen);
    regels.push({ nr, ...d, accID: rek, debet: m.bedrag < 0 ? bedrag : 0, credit: m.bedrag >= 0 ? bedrag : 0, btwBedrag: m.btwBedrag });
    regels.push({ nr, ...d, accID: tegen, debet: m.bedrag >= 0 ? bedrag : 0, credit: m.bedrag < 0 ? bedrag : 0, btwBedrag: 0 });
  }

  const totDeb = rond(regels.reduce((s, r) => s + rond(r.debet), 0));
  const totCred = rond(regels.reduce((s, r) => s + rond(r.credit), 0));
  const journalen = [
    { id: "BNK", desc: "Bankboek", type: "B" },
    { id: "VRK", desc: "Verkoopboek", type: "S" },
    { id: "MEM", desc: "Memoriaal", type: "M" },
  ];

  // Btw-codes: elke vatID in een trLine moet in vatCodes staan (keyref ctTrLineVatIDRef).
  const btwCodes = new Set(["21", "9", "0", "vrijgesteld", "geen", "verlegd", "eu_dienst", "eu_goed", "buiten_eu"]);
  for (const r of regels) if (r.btwBedrag) btwCodes.add(max(r.btwCode, 35));

  // Relaties: custSupID is een sleutel (customerSupplierIDKey), dus uniek en max. 35 tekens.
  const relaties: string[] = [];
  const ids = new Set<string>();
  for (const k of klanten) {
    const id = max(k.id.slice(-10), 35);
    if (ids.has(id)) continue;
    ids.add(id);
    const adres = [opt("streetname", k.adres), opt("city", k.plaats, 50), opt("postalCode", k.postcode, 10), land(k.land) ? `<country>${land(k.land)}</country>` : ""].join("");
    relaties.push(`<customerSupplier><custSupID>${x(id)}</custSupID>${opt("custSupName", k.naam, 50)}${land(k.land) ? `<taxRegistrationCountry>${land(k.land)}</taxRegistrationCountry>` : ""}${opt("taxRegIdent", k.btwNummer, 30)}<custSupTp>C</custSupTp>${adres ? `<streetAddress>${adres}</streetAddress>` : ""}</customerSupplier>`);
  }
  for (const l of bron.leveranciers) {
    if (!l.leverancier) continue;
    const id = max(`L-${l.leverancier}`, 35);
    if (ids.has(id)) continue;
    ids.add(id);
    relaties.push(`<customerSupplier><custSupID>${x(id)}</custSupID>${opt("custSupName", l.leverancier, 50)}${opt("taxRegIdent", l.leverancierBtw, 30)}<custSupTp>S</custSupTp></customerSupplier>`);
  }

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<auditfile xmlns="http://www.auditfiles.nl/XAF/3.2">`);
  out.push(`<header><fiscalYear>${jaar}</fiscalYear><startDate>${dag(start)}</startDate><endDate>${jaar}-12-31</endDate><curCode>EUR</curCode><dateCreated>${dag(aangemaakt)}</dateCreated><softwareDesc>${x(max(MERK, 50))}</softwareDesc><softwareVersion>1.0</softwareVersion></header>`);
  out.push(`<company>${opt("companyIdent", o.kvk ?? o.id, 35)}<companyName>${x(max(o.naam, 999))}</companyName><taxRegistrationCountry>${land(o.land) || "NL"}</taxRegistrationCountry><taxRegIdent>${x(max(o.btwId ?? o.btwNummer ?? "", 30))}</taxRegIdent>`);
  const bedrijfsadres = [opt("streetname", o.adres), opt("city", o.plaats, 50), opt("postalCode", o.postcode, 10), `<country>${land(o.land) || "NL"}</country>`].join("");
  out.push(`<streetAddress>${bedrijfsadres}</streetAddress>`);
  if (relaties.length) out.push(`<customersSuppliers>${relaties.join("\n")}</customersSuppliers>`);
  out.push(`<generalLedger>`);
  for (const r of [...gebruikteRek].sort()) {
    const type = r.startsWith("B") ? "B" : "P";
    out.push(`<ledgerAccount><accID>${x(max(r, 35))}</accID><accDesc>${x(RGS_OMSCHRIJVING[r] ?? r)}</accDesc><accTp>${type}</accTp><taxonomy><taxoRef>${x(RGS_TAXOREF)}</taxoRef><entryPoint><entryPointRef>RGS</entryPointRef><conceptRef>${x(r)}</conceptRef></entryPoint></taxonomy></ledgerAccount>`);
  }
  out.push(`</generalLedger>`);
  out.push(`<vatCodes>${[...btwCodes].map((c) => `<vatCode><vatID>${x(c)}</vatID><vatDesc>btw ${x(c)}</vatDesc><vatToPayAccID>${BTW_AF}</vatToPayAccID><vatToClaimAccID>${BTW_VOOR}</vatToClaimAccID></vatCode>`).join("")}</vatCodes>`);
  out.push(`<periods>${Array.from({ length: 12 }, (_, i) => `<period><periodNumber>${i + 1}</periodNumber><periodDesc>${jaar}-${String(i + 1).padStart(2, "0")}</periodDesc><startDatePeriod>${dag(new Date(jaar, i, 1))}</startDatePeriod><endDatePeriod>${dag(new Date(jaar, i + 1, 0))}</endDatePeriod></period>`).join("")}</periods>`);
  out.push(`<openingBalance><opBalDate>${dag(start)}</opBalDate><linesCount>0</linesCount><totalDebit>0.00</totalDebit><totalCredit>0.00</totalCredit></openingBalance>`);
  // transactions hoort binnen company (XSD 3.2).
  out.push(`<transactions><linesCount>${regels.length}</linesCount><totalDebit>${g(totDeb)}</totalDebit><totalCredit>${g(totCred)}</totalCredit>`);
  for (const j of journalen) {
    const eigen = regels.filter((r) => r.jrn === j.id);
    if (eigen.length === 0) continue;
    out.push(`<journal><jrnID>${j.id}</jrnID><desc>${j.desc}</desc><jrnTp>${j.type}</jrnTp>`);
    const perNr = new Map<number, Regel[]>();
    for (const r of eigen) perNr.set(r.nr, [...(perNr.get(r.nr) ?? []), r]);
    for (const [n, rs] of perNr) {
      const eerste = rs[0];
      out.push(`<transaction><nr>${n}</nr><desc>${x(eerste.omschrijving)}</desc><periodNumber>${eerste.datum.getMonth() + 1}</periodNumber><trDt>${dag(eerste.datum)}</trDt><amnt>${g(rs.reduce((s, r) => s + rond(r.debet), 0))}</amnt><amntTp>D</amntTp>`);
      let ln = 0;
      for (const r of rs) {
        ln++;
        const bedrag = r.debet || r.credit;
        const vat = r.btwBedrag
          ? `<vat><vatID>${x(max(r.btwCode, 35))}</vatID><vatPerc>${BTW_PERC[r.btwCode] ?? "0.000"}</vatPerc><vatAmnt>${g(Math.abs(r.btwBedrag))}</vatAmnt><vatAmntTp>${r.debet ? "D" : "C"}</vatAmntTp></vat>`
          : "";
        out.push(`<trLine><nr>${ln}</nr><accID>${x(max(r.accID, 35))}</accID><docRef>${x(max(r.recID, 999))}</docRef><effDate>${dag(r.datum)}</effDate><desc>${x(r.omschrijving)}</desc><amnt>${g(bedrag)}</amnt><amntTp>${r.debet ? "D" : "C"}</amntTp>${r.custSupID ? `<custSupID>${x(max(r.custSupID, 35))}</custSupID>` : ""}${vat}</trLine>`);
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

export async function xafExport(ondernemingId: string, jaar: number): Promise<string> {
  const start = new Date(jaar, 0, 1);
  const eind = new Date(jaar + 1, 0, 1);
  const [onderneming, transacties, facturen, memoriaal, klanten, bonnen] = await Promise.all([
    db.onderneming.findUniqueOrThrow({ where: { id: ondernemingId } }),
    db.transactie.findMany({ where: { ondernemingId, datum: { gte: start, lt: eind }, zakelijk: true }, orderBy: { datum: "asc" } }),
    db.factuur.findMany({ where: { ondernemingId, datum: { gte: start, lt: eind }, status: { not: "concept" } }, orderBy: { datum: "asc" }, include: { klant: true } }),
    db.memoriaalboeking.findMany({ where: { ondernemingId, datum: { gte: start, lt: eind } }, orderBy: { datum: "asc" } }),
    db.klant.findMany({ where: { ondernemingId } }),
    db.bon.findMany({ where: { ondernemingId, status: { in: ["gekoppeld", "uitgelezen"] } }, select: { leverancier: true, leverancierBtw: true } }),
  ]);
  const leveranciers = [...new Map(bonnen.filter((b) => b.leverancier).map((b) => [b.leverancier!, b])).values()];
  return xafXml({ onderneming, transacties, facturen, memoriaal, klanten, leveranciers }, jaar);
}
