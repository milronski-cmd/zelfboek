import { XMLValidator, XMLParser } from "fast-xml-parser";
import { mkdirSync, writeFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { xafExport } from "../src/lib/exports/xaf";
import { excelExport } from "../src/lib/exports/excel";
import { jaarrekening } from "../src/lib/fiscaal/jaarrekening";
import { winstVerlies } from "../src/lib/fiscaal/winst";
import { boekAfschrijvingen } from "../src/lib/fiscaal/afschrijving";
import { jaarrekeningPdf, btwOverzichtPdf } from "../src/lib/exports/pdf-rapport";
import { btwAangifte, btwDeadline } from "../src/lib/btw";

const db = new PrismaClient();
mkdirSync("test/uit", { recursive: true });

async function main() {
  const o = await db.onderneming.create({ data: { naam: "Test Export BV", kvk: "12345678", btwId: "NL123456789B01" } });
  try {
    const rek = await db.bankrekening.create({ data: { ondernemingId: o.id, naam: "Zakelijk", iban: "NL01TEST0000000001" } });
    const klant = await db.klant.create({ data: { ondernemingId: o.id, naam: "Klant GmbH", land: "DE", btwNummer: "DE123456789" } });
    await db.transactie.createMany({
      data: [
        { ondernemingId: o.id, bankrekeningId: rek.id, datum: new Date(2026, 1, 10), bedrag: 1210, tegenpartij: "Klant NL", omschrijving: "Factuur 1", hash: "h1", categorie: "omzet", btwCode: "21", btwBedrag: 210, zakelijk: true, bevestigd: true },
        { ondernemingId: o.id, bankrekeningId: rek.id, datum: new Date(2026, 2, 5), bedrag: -121, tegenpartij: "Coolblue", omschrijving: "Muis", hash: "h2", categorie: "kantoorkosten", btwCode: "21", btwBedrag: 21, zakelijk: true, bevestigd: true },
        { ondernemingId: o.id, bankrekeningId: rek.id, datum: new Date(2026, 3, 1), bedrag: -50, tegenpartij: "AH", omschrijving: "boodschappen", hash: "h3", categorie: "prive", btwCode: "geen", btwBedrag: 0, zakelijk: false, bevestigd: true },
        { ondernemingId: o.id, bankrekeningId: rek.id, datum: new Date(2026, 3, 2), bedrag: -24.2, tegenpartij: "Vercel", omschrijving: "Pro", hash: "h4", categorie: "software", btwCode: "eu_dienst", btwBedrag: 0, zakelijk: true, bevestigd: true },
        { ondernemingId: o.id, bankrekeningId: rek.id, datum: new Date(2026, 4, 2), bedrag: -60, tegenpartij: "Restaurant", omschrijving: "lunch klant", hash: "h5", categorie: "representatie", btwCode: "geen", btwBedrag: 0, zakelijk: true, bevestigd: true, priveDeel: 0 },
      ],
    });
    await db.factuur.create({ data: { ondernemingId: o.id, klantId: klant.id, nummer: "2026-0001", datum: new Date(2026, 5, 1), vervaldatum: new Date(2026, 5, 15), regels: JSON.stringify([{ omschrijving: "Advies", aantal: 10, prijs: 100, btw: 0 }]), subtotaal: 1000, btw: 0, totaal: 1000, btwVerlegd: true, status: "verzonden" } });
    await db.activum.create({ data: { ondernemingId: o.id, naam: "Laptop", aanschafDatum: new Date(2026, 0, 15), aanschafBedrag: 2400, looptijdJaren: 5, kiaToegepast: true } });
    const afs = await boekAfschrijvingen(o.id, new Date(2026, 11, 31));
    console.log("afschrijvingen geboekt:", afs.aangemaakt);
    const afs2 = await boekAfschrijvingen(o.id, new Date(2026, 11, 31));
    if (afs2.aangemaakt !== 0) throw new Error("afschrijving niet idempotent");

    const wv = await winstVerlies(o.id, new Date(2026, 0, 1), new Date(2027, 0, 1));
    console.log("W&V:", { omzet: wv.omzet, kosten: wv.kosten, aftrekbaar: wv.kostenAftrekbaar, afschrijving: wv.afschrijving, winst: wv.winst, fiscaal: wv.fiscaleWinst });
    // omzet 1000 bank; kosten: 100 + 24.2 + 60 + 480 afschrijving = 664.2; aftrekbaar: representatie 80% → 652.2
    if (wv.omzet !== 1000) throw new Error("omzet " + wv.omzet);
    if (Math.abs(wv.kosten - 664.2) > 0.01) throw new Error("kosten " + wv.kosten);
    if (Math.abs(wv.fiscaleWinst - (1000 - 652.2)) > 0.01) throw new Error("fiscaal " + wv.fiscaleWinst);

    const jr = await jaarrekening(o.id, 2026);
    console.log("balans:", jr.activa, jr.passiva, jr.totaalActiva, jr.totaalPassiva);
    if (Math.abs(jr.totaalActiva - jr.totaalPassiva) > 0.01) throw new Error("balans in onbalans");

    const xaf = await xafExport(o.id, 2026);
    writeFileSync("test/uit/test.xaf", xaf);
    if (XMLValidator.validate(xaf) !== true) throw new Error("XAF ongeldig: " + JSON.stringify(XMLValidator.validate(xaf)));
    const p = new XMLParser().parse(xaf);
    const tr = p.auditfile.company.transactions; // XAF: transactions staat binnen company
    console.log("XAF regels:", tr.linesCount, "debet", tr.totalDebit, "credit", tr.totalCredit);
    if (tr.totalDebit !== tr.totalCredit) throw new Error("XAF debet != credit");

    const xlsx = await excelExport(o.id, 2026);
    writeFileSync("test/uit/test.xlsx", xlsx);
    console.log("xlsx bytes:", xlsx.length);
    if (xlsx.length < 5000) throw new Error("xlsx te klein");

    const pdf = await jaarrekeningPdf(o, jr);
    writeFileSync("test/uit/jaarrekening.pdf", pdf);
    const regels = await db.transactie.findMany({ where: { ondernemingId: o.id } });
    const pdf2 = await btwOverzichtPdf(o, { jaar: 2026, tijdvak: "kwartaal", periode: 1, aangifte: btwAangifte(regels), deadline: btwDeadline(new Date(2026, 3, 1)) });
    writeFileSync("test/uit/btw.pdf", pdf2);
    console.log("pdf bytes:", pdf.length, pdf2.length);
    if (pdf.length < 1000 || pdf2.length < 1000) throw new Error("pdf te klein");
    console.log("EXPORT-DB TESTS OK");
  } finally {
    await db.onderneming.delete({ where: { id: o.id } });
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
