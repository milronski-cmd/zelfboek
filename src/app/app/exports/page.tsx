import { connection } from "next/server";
import { huidigeOnderneming } from "@/lib/db";
import { kwartaalVan } from "@/lib/btw";
import { Kop, knopLicht } from "@/components/ui";
import { XAF32_TOT_JAAR } from "@/lib/exports/xaf";

export const instant = false;

export default async function Exports({ searchParams }: { searchParams: Promise<{ j?: string }> }) {
  await connection();
  const sp = await searchParams;
  const o = await huidigeOnderneming();
  const nu = new Date();
  const jaar = Number(sp.j) || nu.getFullYear();
  const { kwartaal } = kwartaalVan(nu);
  const periode = o.btwTijdvak === "maand" ? nu.getMonth() + 1 : o.btwTijdvak === "jaar" ? 0 : kwartaal;
  const tijdvakNaam = o.btwTijdvak === "maand" ? "deze maand" : o.btwTijdvak === "jaar" ? "dit jaar" : `het ${kwartaal}e kwartaal`;

  const groepen: { kop: string; items: { titel: string; tekst: string; href: string; knop: string; extra?: { href: string; knop: string } }[] }[] = [
    {
      kop: "Hele administratie",
      items: [
        { titel: "Excel-werkboek", tekst: "Transacties, facturen, winst-en-verlies, balans, btw per kwartaal, bonnen, uren en kilometers in tabbladen. Voor je boekhouder of voor jezelf.", href: `/api/exports/excel?jaar=${jaar}`, knop: "Download Excel" },
        {
          titel: "Auditfile voor de Belastingdienst",
          tekst: "Het standaardformaat (XAF 4.0) bij een controle of als je overstapt naar een ander pakket. Grootboek op RGS-codes.",
          href: `/api/exports/xaf?jaar=${jaar}`,
          knop: "Download auditfile",
          // XAF 3.2 alleen nog voor oudere boekjaren; vanaf 2027 accepteert de Belastingdienst alleen 4.0.
          extra: jaar < XAF32_TOT_JAAR ? { href: `/api/exports/xaf?jaar=${jaar}&versie=3.2`, knop: "Oud formaat (XAF 3.2)" } : undefined,
        },
        { titel: "Jaarrekening", tekst: "Winst-en-verliesrekening, balans en kengetallen op een paar pagina's. Handig bij een hypotheek of financiering.", href: `/api/exports/jaarrekening-pdf?jaar=${jaar}`, knop: "Download PDF" },
      ],
    },
    {
      kop: `Btw, ${tijdvakNaam}`,
      items: [
        { titel: "SBR-bestand voor Digipoort", tekst: "De aangifte als XBRL volgens de Nederlandse Taxonomie. In te dienen via Digipoort met een PKIoverheid-certificaat of via een hub-leverancier.", href: `/api/exports/sbr?jaar=${jaar}&periode=${periode}`, knop: "Download SBR" },
        { titel: "Btw-overzicht", tekst: "Alle rubrieken op één A4, om over te nemen bij de Belastingdienst.", href: `/api/exports/btw-pdf?jaar=${jaar}&periode=${periode}`, knop: "Download PDF" },
        { titel: "ICP-opgaaf", tekst: "Per EU-klant met btw-nummer de omzet, in het uploadformaat van de Belastingdienst.", href: `/api/exports/icp?jaar=${jaar}&periode=${periode}`, knop: "Download CSV" },
      ],
    },
  ];

  return (
    <>
      <Kop titel="Exporteren" sub={`Boekjaar ${jaar}. Je gegevens zijn van jou en altijd te downloaden in open formaten.`}>
        <a href={`/app/exports?j=${jaar - 1}`} className={knopLicht}>{jaar - 1}</a>
        <a href={`/app/exports?j=${jaar + 1}`} className={knopLicht}>{jaar + 1}</a>
      </Kop>
      <div className="space-y-8">
        {groepen.map((g) => (
          <section key={g.kop}>
            <h2 className="mb-3 text-[17px] font-semibold">{g.kop}</h2>
            <div className="kaart divide-y divide-lijn">
              {g.items.map((k) => (
                <div key={k.titel} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div className="min-w-0 max-w-xl">
                    <h3 className="font-medium">{k.titel}</h3>
                    <p className="mt-0.5 text-sm text-tekst-2">{k.tekst}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {k.extra && <a href={k.extra.href} className="text-sm text-tekst-2 underline underline-offset-2">{k.extra.knop}</a>}
                    <a href={k.href} className={knopLicht}>{k.knop}</a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
