import Papa from "papaparse";
import { db } from "@/lib/db";
import { datum, getal, maakHash } from "@/lib/bank/csv";
import { CATEGORIEEN } from "@/lib/categorieen";

/**
 * Overstappen vanuit Jortt via de CSV-exports (Instellingen → Exporteren):
 * - klanten.csv (Naam, E-mail, Adres, Postcode, Plaats, Land, KvK, Btw-nummer)
 * - boekingen.csv / transacties.csv (Datum, Omschrijving, Bedrag, Categorie/Grootboek, Btw)
 * Het type wordt aan de kolommen herkend. Jortt publiceert geen vast CSV-formaat; de kolomherkenning is daarom ruim.
 * (Jortt heeft ook een REST API met OAuth2, https://developer.jortt.nl/; die gebruiken we nog niet.)
 */
export type JorttKlant = { naam: string; email: string | null; adres: string | null; postcode: string | null; plaats: string | null; land: string; kvk: string | null; btwNummer: string | null };
export type JorttRegel = { datum: Date; bedrag: number; tegenpartij: string; omschrijving: string; categorie: string | null; btwCode: string | null };

/** CSV lezen zonder database: klanten of boekingsregels. */
export function leesJorttCsv(tekst: string): { soort: "klanten"; klanten: JorttKlant[] } | { soort: "regels"; regels: JorttRegel[] } | { soort: "leeg" } {
  const { data } = Papa.parse<Record<string, string>>(tekst.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  if (data.length === 0) return { soort: "leeg" };
  const kolommen = Object.keys(data[0]);
  const k = (r: Record<string, string>, re: RegExp) => { const key = kolommen.find((x) => re.test(x.trim())); return key ? (r[key] ?? "").trim() : ""; };

  if (kolommen.some((x) => /^(naam|bedrijfsnaam|klantnaam)$/i.test(x.trim())) && !kolommen.some((x) => /bedrag/i.test(x))) {
    const klanten: JorttKlant[] = [];
    for (const r of data) {
      const naam = k(r, /^(naam|bedrijfsnaam|klantnaam)$/i);
      if (!naam) continue;
      klanten.push({ naam, email: k(r, /e-?mail/i) || null, adres: k(r, /^(adres|straat)/i) || null, postcode: k(r, /postcode/i) || null, plaats: k(r, /^(plaats|woonplaats|stad)$/i) || null, land: k(r, /^land$/i) || "NL", kvk: k(r, /kvk/i) || null, btwNummer: k(r, /btw/i) || null });
    }
    return { soort: "klanten", klanten };
  }

  const regels: JorttRegel[] = [];
  for (const r of data) {
    const d = datum(k(r, /datum|date/i));
    const bedrag = getal(k(r, /^bedrag( incl.*)?$|totaal/i));
    if (isNaN(d.getTime()) || !bedrag) continue;
    const oms = k(r, /omschrijving|beschrijving|description/i);
    const tegen = k(r, /relatie|klant|leverancier|tegenpartij|naam/i) || oms.slice(0, 40);
    const catRuw = k(r, /categorie|grootboek|rubriek/i).toLowerCase();
    const categorie = CATEGORIEEN.find((c) => catRuw.includes(c)) ?? (/omzet|verkoop/i.test(catRuw) ? "omzet" : /priv/i.test(catRuw) ? "prive" : null);
    const btwRuw = k(r, /btw.?(tarief|percentage|%)|^btw$/i);
    const btwCode = /21/.test(btwRuw) ? "21" : /9/.test(btwRuw) ? "9" : /verlegd/i.test(btwRuw) ? "verlegd" : /0|geen|vrij/i.test(btwRuw) ? "geen" : null;
    regels.push({ datum: d, bedrag, tegenpartij: tegen, omschrijving: oms, categorie, btwCode });
  }
  return { soort: "regels", regels };
}

export async function importeerJorttCsv(ondernemingId: string, tekst: string): Promise<{ klanten: number; regels: number; fouten: string[] }> {
  const uit = { klanten: 0, regels: 0, fouten: [] as string[] };
  const gelezen = leesJorttCsv(tekst);
  if (gelezen.soort === "leeg") return { ...uit, fouten: ["Leeg of onleesbaar CSV-bestand."] };

  if (gelezen.soort === "klanten") {
    for (const kl of gelezen.klanten) {
      const bestaat = await db.klant.findFirst({ where: { ondernemingId, naam: kl.naam } });
      if (bestaat) continue;
      await db.klant.create({ data: { ...kl, ondernemingId, externId: `jortt:${kl.naam}` } });
      uit.klanten++;
    }
    return uit;
  }

  for (const r of gelezen.regels) {
    const res = await db.transactie.createMany({
      data: [{
        ondernemingId, datum: r.datum, bedrag: r.bedrag, tegenpartij: r.tegenpartij || "Onbekend", omschrijving: r.omschrijving, hash: maakHash(r.datum, r.bedrag, r.tegenpartij, r.omschrijving, "jortt"), bron: "import",
        categorie: r.categorie, btwCode: r.btwCode, zakelijk: r.categorie ? r.categorie !== "prive" : null, bevestigd: !!r.categorie, zekerheid: r.categorie ? 1 : null, uitleg: r.categorie ? "Overgenomen uit Jortt" : null,
      }],
    }).catch(() => ({ count: 0 }));
    uit.regels += res.count;
  }
  return uit;
}
