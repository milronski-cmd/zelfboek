/**
 * Genereert een voorbeeld-btw-aangifte (SBR/XBRL, NT20) en een voorbeeld-auditfile (XAF 3.2) zonder database
 * en valideert ze tegen de officiële schema's, als de validators beschikbaar zijn.
 *
 *   npx tsx test/belastingdienst-xsd.ts
 *
 * Externe validatie (optioneel, anders alleen de interne controles):
 *   XSD_PYTHON     Python met lxml, voor XAF tegen de XSD (test/xsd-valideer.py, gedraaid met -I)
 *   XAF32_XSD      pad naar XmlAuditfileFinancieel3.2.xsd
 *   ARELLE_PYTHON  Python met arelle-release, voor XBRL tegen de Nederlandse Taxonomie
 *   ARELLE_CACHE   (optioneel) Arelle-cachemap; met ARELLE_OFFLINE=1 wordt niets gedownload
 *
 * Voorbeeld (PowerShell), met downloads in een eigen map buiten de repo:
 *   python -I -m venv C:\sbr\venv; C:\sbr\venv\Scripts\python -I -m pip install arelle-release lxml
 *   $env:ARELLE_PYTHON="C:\sbr\venv\Scripts\python.exe"; $env:ARELLE_CACHE="C:\sbr\cache"
 *   $env:XSD_PYTHON=$env:ARELLE_PYTHON; $env:XAF32_XSD="C:\sbr\xaf32\XmlAuditfileFinancieel3.2.xsd"
 *   npx tsx test/belastingdienst-xsd.ts
 * Het NT20-entrypoint haalt Arelle zelf op van www.nltaxonomie.nl (schemaRef in de instance).
 */
import { mkdirSync, unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";
import { spawnSync } from "child_process";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { sbrBtwAangifte, obTaxonomie } from "../src/lib/exports/sbr";
import { xafXml, type XafBron } from "../src/lib/exports/xaf";
import { btwAangifte } from "../src/lib/btw";

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

// ───────────── XAF 3.2 ─────────────
const bron: XafBron = {
  onderneming: { id: "ond1", naam: "Jan de Vries & Zn", kvk: "12345678", btwId: "NL123456789B01", btwNummer: null, adres: "Dorpsstraat 1", plaats: "Utrecht", postcode: "3511AA", land: "NL" },
  transacties: [
    { id: "trans000000000001", datum: new Date(2026, 0, 1), bedrag: 1210, tegenpartij: "Klant NL", omschrijving: "Factuur 1", categorie: "omzet", btwCode: "21", btwBedrag: 210, priveDeel: 0 },
    { id: "trans000000000002", datum: new Date(2026, 2, 5), bedrag: -121, tegenpartij: "Coolblue", omschrijving: "Muis <draadloos>", categorie: "kantoorkosten", btwCode: "21", btwBedrag: null, priveDeel: 0.5 },
    { id: "trans000000000003", datum: new Date(2026, 3, 2), bedrag: -24.2, tegenpartij: "Vercel", omschrijving: "Pro", categorie: "software", btwCode: "eu_dienst", btwBedrag: 0, priveDeel: 0 },
    { id: "trans000000000004", datum: new Date(2026, 11, 31), bedrag: -33.33, tegenpartij: "Lunchroom", omschrijving: "lunch", categorie: "representatie", btwCode: "9", btwBedrag: null, priveDeel: 0 },
  ],
  facturen: [
    { nummer: "2026-0001", datum: new Date(2026, 5, 1), klantId: "klant00000000000001", klant: { naam: "Klant GmbH" }, btwVerlegd: true, subtotaal: 1000, btw: 0, totaal: 1000 },
  ],
  memoriaal: [
    { id: "memo00000000000001", datum: new Date(2026, 11, 31), omschrijving: "AFS:a1| Afschrijving laptop", grootboek: "WAfsAfsMva", categorie: null, btwCode: "", btwBedrag: 0, bedrag: -480, soort: "afschrijving" },
  ],
  klanten: [
    { id: "klant00000000000001", naam: "Klant GmbH met een hele lange naam die langer is dan vijftig tekens", btwNummer: "DE123456789", adres: null, plaats: "Berlin", postcode: null, land: "DE" },
  ],
  leveranciers: [{ leverancier: "Coolblue B.V.", leverancierBtw: "NL810433941B01" }, { leverancier: "Coolblue B.V. Belgie", leverancierBtw: null }],
};
const xaf = xafXml(bron, 2026, vast);
const xafPad = resolve("test/uit/voorbeeld-3.2.xaf");
writeFileSync(xafPad, xaf);
check("XAF welgevormd", XMLValidator.validate(xaf) === true);
const q = new XMLParser({ parseTagValue: false }).parse(xaf).auditfile;
check("XAF startDate lokaal 1 januari", q.header.startDate === "2026-01-01", q.header.startDate);
check("XAF transactions binnen company", q.company.transactions !== undefined && q.transactions === undefined);
check("XAF debet = credit", q.company.transactions.totalDebit === q.company.transactions.totalCredit, q.company.transactions);

// ───────────── Externe validatie ─────────────
function draai(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: resolve("test"), env: { ...process.env, PYTHONSAFEPATH: "1" } });
  return { code: r.status, uit: `${r.stdout ?? ""}${r.stderr ?? ""}`, fout: r.error };
}

const { XSD_PYTHON, XAF32_XSD, ARELLE_PYTHON, ARELLE_CACHE, ARELLE_OFFLINE } = process.env;
if (XSD_PYTHON && XAF32_XSD) {
  const r = draai(XSD_PYTHON, ["-I", resolve("test/xsd-valideer.py"), XAF32_XSD, xafPad]);
  check("XAF geldig volgens XSD 3.2", r.code === 0, r.uit || r.fout);
  const kapot = resolve("test/uit/kapot.xaf");
  writeFileSync(kapot, xaf.replace("<curCode>EUR</curCode>", "<curCode>EURO</curCode>"));
  const kapotCode = draai(XSD_PYTHON, ["-I", resolve("test/xsd-valideer.py"), XAF32_XSD, kapot]).code;
  unlinkSync(kapot);
  check("XSD-validator vangt fouten (controle)", kapotCode === 1);
} else {
  console.log("--   XAF-XSD-validatie overgeslagen (zet XSD_PYTHON en XAF32_XSD)");
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
