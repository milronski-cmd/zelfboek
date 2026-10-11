/**
 * Genereert een voorbeeld-btw-aangifte (SBR/XBRL, NT20) en voorbeeld-auditfiles (XAF 4.0 en 3.2) zonder database
 * en valideert ze tegen de officiële schema's, als de validators beschikbaar zijn.
 *
 *   npx tsx test/belastingdienst-xsd.ts
 *
 * Externe validatie (optioneel, anders alleen de interne controles):
 *   XSD_PYTHON     Python met lxml, voor XAF tegen de XSD (test/xsd-valideer.py, gedraaid met -I)
 *   XAF40_XSD      pad naar XmlAuditfileFinancieel4.0.xsd (officieel pakket XAF 4.0.3:
 *                  https://odb.belastingdienst.nl/documentatie/xml-auditfile-financieel-xaf-4-0-3/)
 *   XAF32_XSD      pad naar XmlAuditfileFinancieel3.2.xsd
 *   ARELLE_PYTHON  Python met arelle-release, voor XBRL tegen de Nederlandse Taxonomie
 *   ARELLE_CACHE   (optioneel) Arelle-cachemap; met ARELLE_OFFLINE=1 wordt niets gedownload
 *
 * Voorbeeld (PowerShell), met downloads in een eigen map buiten de repo:
 *   python -I -m venv C:\sbr\venv; C:\sbr\venv\Scripts\python -I -m pip install arelle-release lxml
 *   $env:ARELLE_PYTHON="C:\sbr\venv\Scripts\python.exe"; $env:ARELLE_CACHE="C:\sbr\cache"
 *   $env:XSD_PYTHON=$env:ARELLE_PYTHON; $env:XAF32_XSD="C:\sbr\xaf32\XmlAuditfileFinancieel3.2.xsd"
 *   $env:XAF40_XSD="C:\sbr\xaf40\XmlAuditfileFinancieel4.0.xsd"
 *   npx tsx test/belastingdienst-xsd.ts
 * Datums: draai ook met $env:TZ="UTC" en $env:TZ="Europe/Amsterdam"; de uitkomst moet gelijk zijn.
 * Het NT20-entrypoint haalt Arelle zelf op van www.nltaxonomie.nl (schemaRef in de instance).
 */
import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { sbrBtwAangifte, obTaxonomie } from "../src/lib/exports/sbr";
import { XAF_STANDAARD, xafVersieToegestaan, xafXml, type XafBron, type XafVersie } from "../src/lib/exports/xaf";
import { btwAangifte, datumNl, isoDatum, maandNl } from "../src/lib/btw";

function check(naam: string, cond: boolean, info?: unknown) {
  if (!cond) { console.error("FOUT:", naam, info ?? ""); process.exit(1); }
  console.log("ok  ", naam);
}

mkdirSync("test/uit", { recursive: true });
const vast = new Date(Date.UTC(2026, 9, 1, 10, 0)); // 12:00 Nederlandse zomertijd

// ───────────── SBR btw-aangifte ─────────────
const a = btwAangifte([
  { bedrag: 1210.4, btwCode: "21", btwBedrag: null, zakelijk: true, categorie: "omzet" },
  { bedrag: 109, btwCode: "9", btwBedrag: null, zakelijk: true, categorie: "omzet" },
  { bedrag: -24.2, btwCode: "eu_dienst", btwBedrag: null, zakelijk: true, categorie: "software" },
  { bedrag: -100, btwCode: "buiten_eu", btwBedrag: null, zakelijk: true, categorie: "software" },
  { bedrag: -121, btwCode: "21", btwBedrag: null, zakelijk: true, categorie: "kantoorkosten", priveDeel: 0.5 },
  { bedrag: 500, btwCode: "eu_dienst", btwBedrag: null, zakelijk: true, categorie: "omzet_eu" },
  { bedrag: 300, btwCode: "buiten_eu", btwBedrag: null, zakelijk: true, categorie: "omzet_buiten_eu" },
]);
const xbrl = sbrBtwAangifte({ aangifte: a, btwId: "NL123456789B01", naam: "Jan de Vries", jaar: 2026, tijdvak: "kwartaal", periode: 3, contact: { naam: "Jan de Vries", telefoon: "06-12345678" }, aangemaakt: vast });
const xbrlPad = resolve("test/uit/btw-aangifte-2026-K3.xbrl");
writeFileSync(xbrlPad, xbrl);
check("SBR welgevormd", XMLValidator.validate(xbrl) === true);
const p = new XMLParser({ ignoreAttributes: false }).parse(xbrl)["xbrli:xbrl"];
const tax = obTaxonomie(2026);
check("SBR schemaRef = NT20 entrypoint", p["link:schemaRef"]["@_xlink:href"] === "http://www.nltaxonomie.nl/nt20/bd/20251210/entrypoints/bd-rpt-ob-aangifte-2026.xsd");
check("SBR bd-i namespace", p["@_xmlns:bd-i"] === tax.dataNamespace);
const v = (c: string) => Number(p[`bd-i:${c}`]["#text"]);
const som = ["ValueAddedTaxSuppliesServicesGeneralTariff", "ValueAddedTaxSuppliesServicesReducedTariff", "ValueAddedTaxSuppliesServicesOtherRates", "ValueAddedTaxPrivateUse", "ValueAddedTaxSuppliesServicesByWhichVATTaxationIsTransferred", "ValueAddedTaxOnSuppliesFromCountriesOutsideTheEC", "ValueAddedTaxOnSuppliesFromCountriesWithinTheEC"].reduce((s, c) => s + v(c), 0);
check("SBR 5a = som rubrieken", v("ValueAddedTaxOwed") === som, { som, owed: v("ValueAddedTaxOwed") });
check("SBR 5g = 5a - 5b", v("ValueAddedTaxOwedToBePaidBack") === v("ValueAddedTaxOwed") - v("ValueAddedTaxOnInput"));
check("SBR 1d privégebruik-concept", "bd-i:TaxedTurnoverPrivateUse" in p);
check("SBR berichtkenmerk ≤ 20", String(p["bd-i:MessageReferenceSupplierVAT"]["#text"]).length <= 20);
check("SBR aanmaaktijd JJJJMMDDuumm", /^\d{12}$/.test(String(p["bd-i:DateTimeCreation"]["#text"])) && String(p["bd-i:DateTimeCreation"]["#text"]) === "202610011200");
let fout = "";
try { sbrBtwAangifte({ aangifte: a, btwId: "NL123", naam: "x", jaar: 2026, tijdvak: "maand", periode: 1 }); } catch (e) { fout = String(e); }
check("SBR weigert ongeldig nummer", fout.includes("Ongeldig"));

// ───────────── Datums (draai deze test met TZ=Europe/Amsterdam én TZ=UTC) ─────────────
check("isoDatum lokale middernacht 1-1", isoDatum(new Date(2026, 0, 1)) === "2026-01-01", isoDatum(new Date(2026, 0, 1)));
check("isoDatum UTC-middernacht 1-1", isoDatum(new Date("2026-01-01")) === "2026-01-01");
check("isoDatum lokale middernacht 31-12", isoDatum(new Date(2026, 11, 31)) === "2026-12-31");
check("isoDatum zomertijdwissel", isoDatum(new Date(2026, 2, 29)) === "2026-03-29" && isoDatum(new Date("2026-03-29")) === "2026-03-29");
check("isoDatum 23:30 UTC = volgende dag in NL", isoDatum(new Date(Date.UTC(2026, 5, 30, 22, 30))) === "2026-07-01");
check("maandNl", maandNl(new Date(2026, 0, 1)) === 1 && maandNl(new Date("2026-12-31")) === 12);
check("datumNl", datumNl(new Date(2026, 0, 1)) === "01-01-2026", datumNl(new Date(2026, 0, 1)));

// ───────────── XAF 4.0 (standaard) en 3.2 ─────────────
const bron: XafBron = {
  onderneming: { id: "ond1", naam: "Jan de Vries & Zn", kvk: "12345678", btwId: "NL123456789B01", btwNummer: null, adres: "Dorpsstraat 1", plaats: "Utrecht", postcode: "3511AA", land: "NL" },
  transacties: [
    { id: "trans000000000001", datum: new Date(2026, 0, 1), bedrag: 1210, tegenpartij: "Klant NL", omschrijving: "Factuur 1", categorie: "omzet", btwCode: "21", btwBedrag: 210, priveDeel: 0 },
    { id: "trans000000000002", datum: new Date(2026, 2, 5), bedrag: -121, tegenpartij: "Coolblue", omschrijving: "Muis <draadloos>", categorie: "kantoorkosten", btwCode: "21", btwBedrag: null, priveDeel: 0.5 },
    { id: "trans000000000003", datum: new Date("2026-04-02"), bedrag: -24.2, tegenpartij: "Vercel", omschrijving: "Pro", categorie: "software", btwCode: "eu_dienst", btwBedrag: 0, priveDeel: 0 },
    { id: "trans000000000004", datum: new Date(2026, 11, 31), bedrag: -33.33, tegenpartij: "Lunchroom", omschrijving: "lunch", categorie: "representatie", btwCode: "9", btwBedrag: null, priveDeel: 0 },
  ],
  facturen: [
    { nummer: "2026-0001", datum: new Date(2026, 5, 1), klantId: "klant00000000000001", klant: { naam: "Klant GmbH" }, btwVerlegd: true, subtotaal: 1000, btw: 0, totaal: 1000 },
  ],
  memoriaal: [
    { id: "memo00000000000001", datum: new Date(2026, 11, 31), omschrijving: "AFS:a1| Afschrijving laptop", grootboek: "WAfsAfsMva", categorie: null, btwCode: "", btwBedrag: 0, bedrag: -480, soort: "afschrijving" },
  ],
  klanten: [
    { id: "klant00000000000001", naam: "Klant GmbH met een hele lange naam die langer is dan vijftig tekens", email: "boekhouding@klant.de", kvk: null, btwNummer: "DE123456789", adres: null, plaats: "Berlin", postcode: null, land: "DE" },
  ],
  leveranciers: [{ leverancier: "Coolblue B.V.", leverancierBtw: "NL810433941B01" }, { leverancier: "Coolblue B.V. Belgie", leverancierBtw: null }],
};
check("XAF standaard is 4.0", XAF_STANDAARD === "4.0" && xafXml(bron, 2026, { aangemaakt: vast }).includes("XmlauditfileXAF_4.0"));
check("XAF 3.2 niet meer vanaf 2027", !xafVersieToegestaan("3.2", 2027) && xafVersieToegestaan("3.2", 2026) && xafVersieToegestaan("4.0", 2027));

const xafPaden: Record<XafVersie, string> = { "4.0": resolve("test/uit/voorbeeld-4.0.xaf"), "3.2": resolve("test/uit/voorbeeld-3.2.xaf") };
const xafInhoud = {} as Record<XafVersie, string>;
for (const versie of ["4.0", "3.2"] as XafVersie[]) {
  const xaf = xafXml(bron, 2026, { versie, aangemaakt: vast });
  xafInhoud[versie] = xaf;
  writeFileSync(xafPaden[versie], xaf);
  check(`XAF ${versie} welgevormd`, XMLValidator.validate(xaf) === true);
  const q = new XMLParser({ parseTagValue: false, isArray: (n) => ["journal", "transaction", "trLine", "ledgerAccount", "period"].includes(n) }).parse(xaf).auditfile;
  check(`XAF ${versie} startDate 1 januari`, q.header.startDate === "2026-01-01", q.header.startDate);
  check(`XAF ${versie} transactions binnen company`, q.company.transactions !== undefined && q.transactions === undefined);
  const tr = q.company.transactions;
  const lijnen = tr.journal.flatMap((j: { transaction: { trLine: { amnt: string; amntTp: string }[] }[] }) => j.transaction.flatMap((t) => t.trLine));
  const som = (tp: string) => Math.round(lijnen.filter((l: { amntTp: string }) => l.amntTp === tp).reduce((s: number, l: { amnt: string }) => s + Number(l.amnt) * 100, 0));
  // Consistentieregels XAF 4.0 [0007]-[0009] en [0010] (gelden ook zinvol voor 3.2).
  check(`XAF ${versie} totaal debet = som regels [0007]`, Math.round(Number(tr.totalDebit) * 100) === som("D"), { tr: tr.totalDebit, som: som("D") });
  check(`XAF ${versie} totaal credit = som regels [0008]`, Math.round(Number(tr.totalCredit) * 100) === som("C"));
  check(`XAF ${versie} debet = credit [0009]`, tr.totalDebit === tr.totalCredit, tr);
  const scheef = tr.journal.flatMap((j: { transaction: { nr: string; trLine: { amnt: string; amntTp: string }[] }[] }) => j.transaction).filter((t: { trLine: { amnt: string; amntTp: string }[] }) => Math.round(t.trLine.reduce((s, l) => s + (l.amntTp === "D" ? 1 : -1) * Number(l.amnt) * 100, 0)) !== 0);
  check(`XAF ${versie} elke boeking sluit [0010]`, scheef.length === 0, scheef);
  check(`XAF ${versie} lineCount`, Number(tr.linesCount) === lijnen.length);
  check(`XAF ${versie} periode april`, tr.journal[0].transaction[2].periodNumber === "4", tr.journal[0].transaction[2]);
  if (versie === "4.0") {
    const rgs = q.company.generalLedger.ledgerAccount.map((l: { RGScode?: string }) => l.RGScode).filter(Boolean);
    check("XAF 4.0 RGScode uniek [0003]", new Set(rgs).size === rgs.length && rgs.length > 0);
  }
}

// ───────────── Externe validatie ─────────────
function draai(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: resolve("test"), env: { ...process.env, PYTHONSAFEPATH: "1" } });
  return { code: r.status, uit: `${r.stdout ?? ""}${r.stderr ?? ""}`, fout: r.error };
}

const { XSD_PYTHON, XAF32_XSD, ARELLE_PYTHON, ARELLE_CACHE, ARELLE_OFFLINE } = process.env;
const xsd: Record<XafVersie, string | undefined> = { "4.0": process.env.XAF40_XSD, "3.2": XAF32_XSD };
for (const versie of ["4.0", "3.2"] as XafVersie[]) {
  const schema = xsd[versie];
  if (!XSD_PYTHON || !schema) { console.log(`--   XAF ${versie}-XSD-validatie overgeslagen (zet XSD_PYTHON en XAF${versie.replace(".", "")}_XSD)`); continue; }
  const r = draai(XSD_PYTHON, ["-I", resolve("test/xsd-valideer.py"), schema, xafPaden[versie]]);
  check(`XAF ${versie} geldig volgens XSD`, r.code === 0, r.uit || r.fout);
  const kapot = resolve(`test/uit/kapot-${versie}.xaf`);
  writeFileSync(kapot, xafInhoud[versie].replace("<accTp>B</accTp>", "<accTp>X</accTp>"));
  const kapotCode = draai(XSD_PYTHON, ["-I", resolve("test/xsd-valideer.py"), schema, kapot]).code;
  unlinkSync(kapot);
  check(`XSD-validator ${versie} vangt fouten (controle)`, kapotCode === 1);
}

if (ARELLE_PYTHON) {
  const args = ["-I", "-m", "arelle.CntlrCmdLine", "--file", xbrlPad, "--validate", "--httpsRedirectCache", "--logLevel", "warning"];
  if (ARELLE_CACHE) args.push("--cacheDirectory", ARELLE_CACHE);
  args.push("--internetConnectivity", ARELLE_OFFLINE === "1" ? "offline" : "online");
  const r = draai(ARELLE_PYTHON, args);
  const meldingen = r.uit.split("\n").filter((l) => /^\[(?!info\]|\]).+\]/.test(l.trim()) && !/Formula xpath2 grammar/.test(l));
  check("SBR geldig volgens NT20 (Arelle)", r.code === 0 && meldingen.length === 0, r.uit || r.fout);
} else {
  console.log("--   XBRL-taxonomievalidatie overgeslagen (zet ARELLE_PYTHON)");
}

console.log("BELASTINGDIENST-VALIDATIE OK");
