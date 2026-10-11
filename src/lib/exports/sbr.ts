import { MERK } from "@/lib/merk";
import type { Aangifte } from "@/lib/btw";

const x = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Taxonomie per aangiftejaar: de Belastingdienst publiceert het entrypoint voor de omzetbelastingaangifte
 * van jaar J in de NT-release van december J-1. Namespace en schemaRef bevatten de releasedatum, niet 1 januari.
 * Bron: https://www.nltaxonomie.nl/nt20/bd/20251210/entrypoints/bd-rpt-ob-aangifte-2026.xsd
 *       https://www.nltaxonomie.nl/nt19/bd/20241211/entrypoints/bd-rpt-ob-aangifte-2025.xsd
 */
export const OB_TAXONOMIE: Record<number, { nt: string; versie: string }> = {
  2025: { nt: "nt19", versie: "20241211" },
  2026: { nt: "nt20", versie: "20251210" },
};

export function obTaxonomie(jaar: number) {
  const t = OB_TAXONOMIE[jaar];
  if (!t) throw new Error(`Geen Nederlandse Taxonomie bekend voor de btw-aangifte over ${jaar}. Voeg het entrypoint toe aan OB_TAXONOMIE.`);
  const basis = `http://www.nltaxonomie.nl/${t.nt}/bd/${t.versie}`;
  return {
    ...t,
    dataNamespace: `${basis}/dictionary/bd-data`,
    entrypoint: `${basis}/entrypoints/bd-rpt-ob-aangifte-${jaar}.xsd`,
  };
}

/** Lokale datum-tijd als JJJJMMDDuumm (bd-types:dateTimeItemType), in Nederlandse tijd. */
function aanmaakTijdstip(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}`;
}

/** Splits "Jan de Vries" in voorletters, tussenvoegsel en achternaam voor de contactgegevens. */
export function splitsNaam(naam: string) {
  const delen = naam.trim().split(/\s+/).filter(Boolean);
  if (delen.length === 0) return { voorletters: "X", tussenvoegsel: "", achternaam: "Onbekend" };
  const tussen = new Set(["van", "de", "der", "den", "het", "ter", "ten", "te", "in", "'t", "op", "la", "le", "du", "d'", "von"]);
  let i = delen.findIndex((d, n) => n > 0 && n < delen.length - 1 && tussen.has(d.toLowerCase()));
  if (i === -1) i = Math.max(delen.length - 1, 0);
  const voornamen = delen.length > 1 ? delen.slice(0, i) : [];
  let j = voornamen.length;
  while (j < delen.length - 1 && tussen.has(delen[j].toLowerCase())) j++;
  const achternaam = delen.slice(j).join(" ");
  return {
    voorletters: (voornamen.map((v) => v[0].toUpperCase() + ".").join("") || achternaam[0].toUpperCase()).slice(0, 10),
    tussenvoegsel: delen.slice(voornamen.length, j).join(" ").slice(0, 10),
    achternaam: achternaam.slice(0, 200),
  };
}

/**
 * XBRL-instance voor de btw-aangifte (Nederlandse Taxonomie, entrypoint bd-rpt-ob-aangifte-<jaar>).
 * Concepten uit de bd-i (bd-data) namespace, in hele euro's met decimals="INF" zoals de taxonomie vereist
 * (bd-types:monetaryNoDecimals…). Rubrieken 1a t/m 5g volgens de presentatielinkbase bd-ob-aangifte-pre.xml.
 * Gevalideerd tegen het NT20-entrypoint met Arelle (zie test/belastingdienst-xsd.ts).
 * Indienen loopt via Digipoort (eigen PKIoverheid-certificaat of een hub-leverancier); dat doet deze functie niet.
 */
export function sbrBtwAangifte(i: {
  aangifte: Aangifte;
  /** Omzetbelastingnummer (NL…B..), het nummer waarmee je aangifte doet; bij een eenmanszaak niet je btw-id. */
  btwId: string;
  naam: string;
  jaar: number;
  tijdvak: "maand" | "kwartaal" | "jaar";
  periode: number;
  contact?: { naam: string; telefoon?: string };
  /** Relatienummer softwareontwikkelaar bij de Belastingdienst (8 tekens). */
  softwareRelatienummer?: string;
  aangemaakt?: Date;
}): string {
  const tax = obTaxonomie(i.jaar);
  const a = i.aangifte;
  // Hele euro's. 5a en 5g rekenen we uit de afgeronde rubrieken, zodat de aangifte intern sluit.
  const h = (n: number) => Math.round(n) || 0;
  let start: Date;
  let eind: Date;
  if (i.tijdvak === "maand") { start = new Date(i.jaar, i.periode - 1, 1); eind = new Date(i.jaar, i.periode, 0); }
  else if (i.tijdvak === "jaar") { start = new Date(i.jaar, 0, 1); eind = new Date(i.jaar, 11, 31); }
  else { start = new Date(i.jaar, (i.periode - 1) * 3, 1); eind = new Date(i.jaar, i.periode * 3, 0); }
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const identifier = i.btwId.replace(/[^A-Z0-9]/gi, "").toUpperCase();
  if (!/^NL\d{9}B\d{2}$/.test(identifier)) throw new Error(`Ongeldig omzetbelastingnummer: ${i.btwId}`);
  const ctx = "c1";

  const btw = {
    "1a": h(a["1a_btw"]), "1b": h(a["1b_btw"]), "1c": h(a["1c_btw"]), "1d": 0,
    "2a": h(a["2a_btw"]), "4a": h(a["4a_btw"]), "4b": h(a["4b_btw"]),
  };
  const verschuldigd = Object.values(btw).reduce((s, v) => s + v, 0); // 5a
  const voorbelasting = h(a["5b_voorbelasting"]); // 5b

  const feiten: [string, string, number][] = [
    ["1a", "TaxedTurnoverSuppliesServicesGeneralTariff", h(a["1a_omzet"])],
    ["1a", "ValueAddedTaxSuppliesServicesGeneralTariff", btw["1a"]],
    ["1b", "TaxedTurnoverSuppliesServicesReducedTariff", h(a["1b_omzet"])],
    ["1b", "ValueAddedTaxSuppliesServicesReducedTariff", btw["1b"]],
    ["1c", "TaxedTurnoverSuppliesServicesOtherRates", h(a["1c_omzet"])],
    ["1c", "ValueAddedTaxSuppliesServicesOtherRates", btw["1c"]],
    ["1d", "TaxedTurnoverPrivateUse", 0],
    ["1d", "ValueAddedTaxPrivateUse", btw["1d"]],
    ["1e", "SuppliesServicesNotTaxed", h(a["1e_omzet"])],
    ["2a", "TurnoverSuppliesServicesByWhichVATTaxationIsTransferred", h(a["2a_omzet"])],
    ["2a", "ValueAddedTaxSuppliesServicesByWhichVATTaxationIsTransferred", btw["2a"]],
    ["3a", "SuppliesToCountriesOutsideTheEC", h(a["3a_omzet"])],
    ["3b", "SuppliesToCountriesWithinTheEC", h(a["3b_omzet"])],
    ["3c", "InstallationDistanceSalesWithinTheEC", 0],
    ["4a", "TurnoverFromTaxedSuppliesFromCountriesOutsideTheEC", h(a["4a_omzet"])],
    ["4a", "ValueAddedTaxOnSuppliesFromCountriesOutsideTheEC", btw["4a"]],
    ["4b", "TurnoverFromTaxedSuppliesFromCountriesWithinTheEC", h(a["4b_omzet"])],
    ["4b", "ValueAddedTaxOnSuppliesFromCountriesWithinTheEC", btw["4b"]],
    ["5a", "ValueAddedTaxOwed", verschuldigd],
    ["5b", "ValueAddedTaxOnInput", voorbelasting],
    ["5g", "ValueAddedTaxOwedToBePaidBack", verschuldigd - voorbelasting],
  ];

  const contact = splitsNaam(i.contact?.naam ?? i.naam);
  // Berichtkenmerk: max. 20 tekens (bd-types:anstring20VItemType).
  const kenmerk = `${identifier.slice(2, 11)}-${i.jaar}${i.tijdvak === "maand" ? "M" : i.tijdvak === "jaar" ? "J" : "K"}${i.periode}`.slice(0, 20);
  const telefoon = i.contact?.telefoon?.replace(/[^\d+]/g, "").slice(0, 14);

  const out: string[] = [];
  out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  out.push(`<xbrli:xbrl xml:lang="nl" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:bd-i="${tax.dataNamespace}">`);
  out.push(`<link:schemaRef xlink:type="simple" xlink:href="${tax.entrypoint}"/>`);
  out.push(`<xbrli:context id="${ctx}"><xbrli:entity><xbrli:identifier scheme="www.belastingdienst.nl/omzetbelastingnummer">${x(identifier)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${iso(start)}</xbrli:startDate><xbrli:endDate>${iso(eind)}</xbrli:endDate></xbrli:period></xbrli:context>`);
  out.push(`<xbrli:unit id="EUR"><xbrli:measure>iso4217:EUR</xbrli:measure></xbrli:unit>`);
  out.push(`<bd-i:ContactInitials contextRef="${ctx}">${x(contact.voorletters)}</bd-i:ContactInitials>`);
  if (contact.tussenvoegsel) out.push(`<bd-i:ContactPrefix contextRef="${ctx}">${x(contact.tussenvoegsel)}</bd-i:ContactPrefix>`);
  out.push(`<bd-i:ContactSurname contextRef="${ctx}">${x(contact.achternaam)}</bd-i:ContactSurname>`);
  if (telefoon) out.push(`<bd-i:ContactTelephoneNumber contextRef="${ctx}">${x(telefoon)}</bd-i:ContactTelephoneNumber>`);
  out.push(`<bd-i:ContactType contextRef="${ctx}">BPL</bd-i:ContactType>`);
  out.push(`<bd-i:DateTimeCreation contextRef="${ctx}">${aanmaakTijdstip(i.aangemaakt ?? new Date())}</bd-i:DateTimeCreation>`);
  out.push(`<bd-i:MessageReferenceSupplierVAT contextRef="${ctx}">${x(kenmerk)}</bd-i:MessageReferenceSupplierVAT>`);
  out.push(`<bd-i:SoftwarePackageName contextRef="${ctx}">${x(MERK.slice(0, 30))}</bd-i:SoftwarePackageName>`);
  out.push(`<bd-i:SoftwarePackageVersion contextRef="${ctx}">1.0</bd-i:SoftwarePackageVersion>`);
  out.push(`<bd-i:SoftwareVendorAccountNumber contextRef="${ctx}">${x((i.softwareRelatienummer ?? "SWO00000").padEnd(8, "0").slice(0, 8))}</bd-i:SoftwareVendorAccountNumber>`);
  for (const [, concept, waarde] of feiten) {
    out.push(`<bd-i:${concept} contextRef="${ctx}" unitRef="EUR" decimals="INF">${waarde}</bd-i:${concept}>`);
  }
  out.push(`</xbrli:xbrl>`);
  return out.join("\n");
}
