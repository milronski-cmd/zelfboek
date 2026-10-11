import { XMLParser, XMLValidator } from "fast-xml-parser";
import { berekenIb, kiaBerekening, box1Belasting, arbeidskorting, algemeneHeffingskorting } from "../src/lib/fiscaal/ib";
import { afschrijvingsschema, boekwaarde, afschrijvingInJaar, boekresultaatVerkoop } from "../src/lib/fiscaal/afschrijving";
import { sbrBtwAangifte } from "../src/lib/exports/sbr";
import { btwAangifte } from "../src/lib/btw";
import { korCheck } from "../src/lib/fiscaal/kor";

function check(naam: string, cond: boolean, info?: unknown) {
  if (!cond) { console.error("FOUT:", naam, info ?? ""); process.exit(1); }
  console.log("ok  ", naam);
}

// KIA
check("KIA onder drempel", kiaBerekening(2500) === 0);
check("KIA 28%", kiaBerekening(10000) === 2800);
check("KIA vast", kiaBerekening(100000) === 20072);
check("KIA afbouw", kiaBerekening(200000) === Math.round((20072 - (200000 - 132746) * 0.0756) * 100) / 100);
check("KIA nul", kiaBerekening(400000) === 0);

// Box 1
check("box1 30k", box1Belasting(30000) === 10725);
check("box1 50k", Math.abs(box1Belasting(50000) - (38883 * 0.3575 + (50000 - 38883) * 0.3756)) < 0.01);
check("AHK max", algemeneHeffingskorting(20000) === 3115);
check("AHK afbouw", algemeneHeffingskorting(50000) === Math.round((3115 - (50000 - 29736) * 0.06398) * 100) / 100);
check("AK max-ish", arbeidskorting(40000) === Math.round((5300 + (40000 - 25845) * 0.0195) * 100) / 100);
check("AK nul", arbeidskorting(140000) === 0);

// IB voorbeeld: winst 40.000, urencriterium gehaald, starter, investering 5.000
const ib = berekenIb({ fiscaleWinst: 40000, uren: 1300, starter: true, investeringen: 5000, kilometerVergoeding: 460 });
console.log("IB voorbeeld 40k:", { belastbareWinst: ib.belastbareWinst, belasting: ib.belasting, zvw: ib.zvw, teBetalen: ib.teBetalen, ahk: ib.algemeneHeffingskorting, ak: ib.arbeidskorting, kia: ib.kia });
// winst 40000 - 460 km - 1400 KIA = 38140; - 1200 - 2123 = 34817; mkb 12.7% = 4421.76 → belastbaar 30395.24
check("IB belastbare winst", Math.abs(ib.belastbareWinst - 30395.24) < 0.01, ib.belastbareWinst);
check("IB zvw", Math.abs(ib.zvw - 30395.24 * 0.0485) < 0.01, ib.zvw);
check("IB positief en plausibel", ib.teBetalen > 3000 && ib.teBetalen < 9000, ib.teBetalen);
const ibGeenUren = berekenIb({ fiscaleWinst: 40000, uren: 500, starter: true, investeringen: 0, kilometerVergoeding: 0 });
check("zonder urencriterium geen zelfstandigenaftrek", ibGeenUren.ondernemersaftrek === 0);
check("hogere winst → meer belasting", berekenIb({ fiscaleWinst: 90000, uren: 1300, starter: false, investeringen: 0, kilometerVergoeding: 0 }).teBetalen > ib.teBetalen);

// Afschrijving: laptop 2400 ex, rest 0, 5 jaar, gekocht 15-03-2026 → 40/maand, 2026: 10 maanden = 400
const laptop = { id: "a1", naam: "Laptop", aanschafDatum: new Date(2026, 2, 15), aanschafBedrag: 2400, restwaarde: 0, looptijdJaren: 5, priveDeel: 0, verkochtOp: null, verkoopBedrag: null };
check("afschrijving 2026", afschrijvingInJaar(laptop, 2026) === 400, afschrijvingInJaar(laptop, 2026));
check("afschrijving 2027", afschrijvingInJaar(laptop, 2027) === 480);
check("boekwaarde eind 2026", boekwaarde(laptop, new Date(2026, 11, 31)).boekwaarde === 2000);
const schema = afschrijvingsschema(laptop);
check("schema som = aanschaf", Math.abs(schema.reduce((s, r) => s + r.afschrijving, 0) - 2400) < 0.01, schema);
check("laatste boekwaarde 0", schema[schema.length - 1].boekwaardeEind === 0, schema);
const verkocht = { ...laptop, verkochtOp: new Date(2027, 5, 30), verkoopBedrag: 1500 };
check("boekresultaat verkoop", boekresultaatVerkoop(verkocht) === 1500 - (2400 - 40 * 16), boekresultaatVerkoop(verkocht));
const prive = { ...laptop, priveDeel: 0.25 };
check("privédeel", boekwaarde(prive, new Date(2026, 11, 31)).aanschafZakelijk === 1800);

// Btw + SBR
const a = btwAangifte([
  { bedrag: 1210, btwCode: "21", btwBedrag: null, zakelijk: true, categorie: "omzet" },
  { bedrag: -24.2, btwCode: "eu_dienst", btwBedrag: null, zakelijk: true, categorie: "software" },
  { bedrag: -121, btwCode: "21", btwBedrag: null, zakelijk: true, categorie: "kantoorkosten", priveDeel: 0.5 },
  { bedrag: 500, btwCode: "eu_dienst", btwBedrag: null, zakelijk: true, categorie: "omzet_eu" },
]);
check("btw 1a", a["1a_omzet"] === 1000 && a["1a_btw"] === 210, a);
check("btw 4b", a["4b_omzet"] === 24.2 && a["4b_btw"] === 5.08, a);
check("btw 3b", a["3b_omzet"] === 500, a);
check("btw privédeel", Math.abs(a["5b_voorbelasting"] - (5.08 + 10.5)) < 0.01, a);
const xml = sbrBtwAangifte({ aangifte: a, btwId: "NL123456789B01", naam: "Test BV", jaar: 2026, tijdvak: "kwartaal", periode: 3 });
check("SBR geldig XML", XMLValidator.validate(xml) === true, XMLValidator.validate(xml));
const p = new XMLParser({ ignoreAttributes: false }).parse(xml);
check("SBR concept 1a", String(p["xbrli:xbrl"]["bd-i:ValueAddedTaxSuppliesServicesGeneralTariff"]["#text"]) === "210");
// 5g = 5a - 5b uit de afgeronde rubrieken (hele euro's), zodat de aangifte intern sluit.
const sbrV = (c: string) => Number(p["xbrli:xbrl"][`bd-i:${c}`]["#text"]);
check("SBR 5g = 5a - 5b", sbrV("ValueAddedTaxOwedToBePaidBack") === sbrV("ValueAddedTaxOwed") - sbrV("ValueAddedTaxOnInput"));
check("SBR 5g ≈ saldo", Math.abs(sbrV("ValueAddedTaxOwedToBePaidBack") - a["5c_te_betalen"]) <= 2);
check("SBR periode", p["xbrli:xbrl"]["xbrli:context"]["xbrli:period"]["xbrli:startDate"] === "2026-07-01");

// KOR
const kor = korCheck({ omzetJaar: 9000, maandenVerstreken: 9, deelnemer: false, btwSaldoJaar: 1500, voorbelasting: 200 });
check("KOR in aanmerking", kor.komtInAanmerking && kor.omzetVerwacht === 12000, kor);
check("KOR boven grens", !korCheck({ omzetJaar: 18000, maandenVerstreken: 6, deelnemer: false, btwSaldoJaar: 0, voorbelasting: 0 }).komtInAanmerking);

console.log("FISCAAL TESTS OK");
