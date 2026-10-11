import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { huidigeSessie } from "@/lib/auth";
import { btwAangifte, btwDeadline, kwartaalVan, periodeBereik } from "@/lib/btw";
import { excelExport } from "@/lib/exports/excel";
import { XAF_STANDAARD, xafExport, xafVersieToegestaan, type XafVersie } from "@/lib/exports/xaf";
import { OB_TAXONOMIE, sbrBtwAangifte } from "@/lib/exports/sbr";
import { icpCsv, icpOpgaaf } from "@/lib/exports/icp";
import { btwOverzichtPdf, jaarrekeningPdf } from "@/lib/exports/pdf-rapport";
import { jaarrekening } from "@/lib/fiscaal/jaarrekening";

export async function GET(req: Request, { params }: { params: Promise<{ soort: string }> }) {
  const sessie = await huidigeSessie();
  if (!sessie?.actieveOndernemingId) return NextResponse.json({ fout: "Niet ingelogd" }, { status: 401 });
  const lid = await db.lidmaatschap.findUnique({
    where: { gebruikerId_ondernemingId: { gebruikerId: sessie.gebruikerId, ondernemingId: sessie.actieveOndernemingId } },
    include: { onderneming: true },
  });
  if (!lid) return NextResponse.json({ fout: "Geen toegang" }, { status: 403 });
  const o = lid.onderneming;
  const { soort } = await params;
  const url = new URL(req.url);
  const nu = new Date();
  const jaar = Number(url.searchParams.get("jaar")) || nu.getFullYear();
  const tijdvak = o.btwTijdvak as "maand" | "kwartaal" | "jaar";
  const standaardPeriode = tijdvak === "maand" ? nu.getMonth() + 1 : tijdvak === "jaar" ? 0 : kwartaalVan(nu).kwartaal;
  const periode = url.searchParams.has("periode") ? Number(url.searchParams.get("periode")) : standaardPeriode;
  const naam = o.naam.replace(/[^\w-]+/g, "_");

  const bestand = (inhoud: Buffer | string, bestandsnaam: string, type: string) =>
    new NextResponse(typeof inhoud === "string" ? inhoud : new Uint8Array(inhoud), {
      headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${bestandsnaam}"` },
    });

  try {
    switch (soort) {
      case "excel":
        return bestand(await excelExport(o.id, jaar), `${naam}-${jaar}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      case "xaf": {
        // Standaard XAF 4.0; 3.2 alleen op verzoek en alleen voor boekjaren vóór 2027.
        const versie: XafVersie = url.searchParams.get("versie") === "3.2" ? "3.2" : XAF_STANDAARD;
        if (!xafVersieToegestaan(versie, jaar)) return NextResponse.json({ fout: `XAF ${versie} wordt vanaf boekjaar 2027 niet meer geaccepteerd. Gebruik XAF 4.0.` }, { status: 400 });
        return bestand(await xafExport(o.id, jaar, versie), `${naam}-${jaar}-xaf${versie.replace(".", "")}.xaf`, "application/xml");
      }
      case "jaarrekening-pdf":
        return bestand(await jaarrekeningPdf(o, await jaarrekening(o.id, jaar)), `jaarrekening-${naam}-${jaar}.pdf`, "application/pdf");
      case "sbr":
      case "btw-pdf": {
        const { start, eind } = periodeBereik(tijdvak, jaar, periode);
        const regels = await db.transactie.findMany({ where: { ondernemingId: o.id, datum: { gte: start, lt: eind } }, select: { bedrag: true, btwCode: true, btwBedrag: true, zakelijk: true, categorie: true, priveDeel: true } });
        const aangifte = btwAangifte(regels);
        if (soort === "sbr") {
          // Aangifte gaat op het omzetbelastingnummer; bij een eenmanszaak verschilt dat van het btw-id op facturen.
          const btwId = o.btwNummer ?? o.btwId ?? "";
          if (!btwId) return NextResponse.json({ fout: "Vul eerst je omzetbelastingnummer in bij Instellingen." }, { status: 400 });
          if (!OB_TAXONOMIE[jaar]) return NextResponse.json({ fout: `SBR-aangifte over ${jaar} wordt nog niet ondersteund.` }, { status: 400 });
          return bestand(sbrBtwAangifte({ aangifte, btwId, naam: o.naam, jaar, tijdvak, periode, contact: { naam: o.naam, telefoon: o.telefoon ?? undefined } }), `btw-${jaar}-${periode}.xbrl`, "application/xml");
        }
        return bestand(await btwOverzichtPdf(o, { jaar, tijdvak, periode, aangifte, deadline: btwDeadline(eind) }), `btw-${jaar}-${periode}.pdf`, "application/pdf");
      }
      case "icp":
        return bestand(icpCsv(await icpOpgaaf(o.id, tijdvak, jaar, periode)), `icp-${jaar}-${periode}.csv`, "text/csv; charset=utf-8");
      default:
        return NextResponse.json({ fout: "Onbekende export" }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json({ fout: e instanceof Error ? e.message : "Export mislukt" }, { status: 500 });
  }
}
