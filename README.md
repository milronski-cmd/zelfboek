# Zelfboek

Volledig AI-boekhoudpakket voor zzp'ers (eenmanszaak zonder personeel). Eén prijs: € 50 per maand.

## Functies

**Account**
- Inloggen met e-mailcode, geen wachtwoord. Meerdere ondernemingen per gebruiker, teamleden met rol.
- Abonnement via Stripe Checkout met proefperiode, klantportaal, webhook voor actief/achterstallig/gestopt.

**Bank en verkoopkanalen**
- PSD2-koppeling via Enable Banking (dagelijkse sync, saldo, toestemming verlengen).
- Import van CSV (ING, Rabobank, ABN AMRO, bunq, Knab, SNS/ASN/RegioBank, Triodos, Revolut, N26, generiek), MT940 en CAMT.053. Autodetectie op inhoud.
- Uitbetalingen en kosten van Mollie, Stripe, Shopify, bol.com, WooCommerce en PayPal (API of rapport).
- Claude Opus boekt elke regel: zakelijk/privé, categorie met RGS-code, btw-code (21, 9, 0, vrijgesteld, verlegd, EU-dienst, EU-goed, buiten EU), zekerheid en uitleg. Leert van je eerdere correcties. Onder 85% zekerheid komt de regel op "twijfel". Gemengde kosten splitsen met privédeel.

**Bonnen**
- Foto (camera op mobiel) of PDF, meerdere tegelijk. AI leest leverancier, btw-nummer, factuurnummer, datum, regels en btw uit.
- Automatisch koppelen aan de bankregel op bedrag en datum, anders op leveranciersnaam. Handmatig corrigeren en koppelen.

**Facturen, offertes, klanten**
- Facturen met automatische nummering, producten, btw verlegd bij EU-klanten, KOR, creditfacturen, deelbetalingen, afletteren met bankregels.
- PDF met logo en huisstijl, UBL 2.1 e-factuur (Peppol BIS 3 / NLCIUS), verzenden per e-mail, iDEAL-betaallink via Mollie met webhook.
- Automatische herinneringen in drie trappen (7, 21, 35 dagen) met wettelijke rente en incassokosten volgens de WIK-staffel.
- Terugkerende facturen (week, maand, kwartaal, jaar) met automatisch verzenden.
- Offertes met publieke accepteerpagina, omzetten naar factuur. Uren naar factuur.

**Fiscaal**
- Urenregistratie met voortgang op het urencriterium (1.225). Kilometerregistratie (€ 0,23).
- Activa met lineaire afschrijving, restwaarde, privédeel, verkoop en boekresultaat, KIA-staffel 2026.
- Btw-aangifte per maand, kwartaal of jaar: alle rubrieken 1a tot 5c, ICP-opgaaf, status ingediend/betaald, historie, deadlines.
- IB-indicatie 2026: zelfstandigenaftrek, startersaftrek, MKB-winstvrijstelling, KIA, box-1 schijven, heffingskortingen, Zvw, reserveringsadvies per maand. KOR-advies.
- Jaarrekening: winst-en-verliesrekening, balans, kengetallen, PDF.
- Exports: Excel (9 tabbladen), XML Auditfile XAF 4.0 (standaard; 3.2 nog voor boekjaren vóór 2027), SBR/XBRL voor de btw-aangifte, ICP-CSV.

**Niets meer hoeven doen**
- Dagelijkse vragenmail: elke twijfelregel met twee knoppen (Zakelijk / Privé). De ondertekende link boekt zonder inloggen via `/antwoord`.
- Bonnen per e-mail: doorsturen naar `bonnen+<ondernemingId>@jouwdomein.nl`; inbound-webhook op `/api/inbound/bon?secret=INBOUND_SECRET` (Resend, Postmark, Mailgun of multipart).
- Eerste-stappen-checklist voor nieuwe gebruikers op het overzicht.

**AI-assistent en meldingen**
- Chat met tools over je eigen cijfers: transacties zoeken, omzet en kosten per periode, open facturen, btw-stand, bonnen, uren, taken aanmaken en boekingen aanpassen na bevestiging.
- Meldingen bij btw-deadlines, te late facturen, bonnen zonder bankregel, proefperiode, urencriterium. Wekelijkse e-mail op maandag.
- Cron (dagelijks 06:00 via vercel.json of elke andere scheduler): banksync, terugkerende facturen, herinneringen, deadlines.

**Overstappen**
- Import uit Moneybird (API), e-Boekhouden (API), Jortt (export) en Excel (sjabloon te downloaden).

## Starten

```bash
npm install
copy env.voorbeeld.txt .env     # vul minimaal APP_SECRET en ANTHROPIC_API_KEY in
npx prisma db push
npm run dev
```

Open http://localhost:3000. Zonder SMTP-instellingen komt de inlogcode in `uploads/outbox.log` en in de melding op het scherm (alleen buiten productie).

Tests: `npx tsx test/parsers.ts`, `test/importeer.ts`, `test/facturen.ts`, `test/fiscaal.ts`, `test/exports-db.ts`, `test/d-moduleD.ts`, `test/belastingdienst-xsd.ts` (genereert een voorbeeld-btw-aangifte en auditfiles in XAF 4.0 en 3.2 en valideert ze tegen NT20 en de XSD's; draai ook met `TZ=UTC` en `TZ=Europe/Amsterdam`; zie de kop van dat bestand voor de validators).

## Stack

Next.js 16 (App Router, server actions, proxy), Prisma 6 op SQLite (voor productie: Postgres, alleen de datasource wijzigen), Tailwind 4, `@anthropic-ai/sdk` met structured outputs en tool use (`claude-opus-5-5`), Stripe, pdfkit, exceljs, fast-xml-parser, nodemailer.

## Wat jij moet regelen voor livegang

| Onderdeel | Wat nodig is |
|---|---|
| AI | API-sleutel van console.anthropic.com |
| E-mail | SMTP-gegevens (Resend, Postmark, Mailgun) en een verzenddomein |
| Abonnement | Stripe-account, product van € 50 per maand, webhook naar `/api/stripe/webhook` |
| Bankkoppeling | Contract met Enable Banking (applicatie-id en private key); zonder contract werkt CSV, MT940 en CAMT |
| Betaallinks | Mollie-account per klant (die vult zelf zijn sleutel in bij Koppelingen) |
| Indienen | Wij zetten de SBR-XBRL klaar; indienen via Digipoort vereist een PKIoverheid-certificaat of een hub-partij. De klant kan de rubrieken ook zelf overnemen in Mijn Belastingdienst Zakelijk |
| Hosting | Vercel of eigen server met Postgres, `uploads/` naar S3-achtige opslag verplaatsen |
| Juridisch | Nooit "accountant" noemen. Zodra je zelf indient of adviseert: beroepsaansprakelijkheidsverzekering en Wwft-procedures (BFT) |

## Nog te valideren vóór echt gebruik

- SBR-XBRL is gevalideerd met Arelle tegen het officiële NT20-entrypoint `bd-rpt-ob-aangifte-2026` (nltaxonomie.nl, versie 20251210); de bedrijfsregels van de Belastingdienst buiten de taxonomie en het indienen via Digipoort zijn niet getest.
- XAF 4.0 is gevalideerd tegen de officiële `XmlAuditfileFinancieel4.0.xsd` uit het ODB-pakket XAF 4.0.3, inclusief de consistentieregels [0003] en [0007]-[0010]. `RGSVersion` wordt nog niet meegegeven, omdat de RGS-versie van de codes niet is vastgelegd.
- XAF 3.2 is gevalideerd tegen `XmlAuditfileFinancieel3.2.xsd`. De Belastingdienst publiceert die XSD niet meer (auditfiles.nl is offline); gebruikt is een kopie die in twee onafhankelijke repositories byte-gelijk is. Vanaf 1 januari 2027 accepteert de Belastingdienst alleen nog XAF 4.0.
- Fiscale constanten 2026 staan met bron-URL (Belastingdienst, gecontroleerd 11-10-2026) in `src/lib/fiscaal/constanten-2026.ts`; controleer ze bij elke jaarwisseling.
- API-adapters (Enable Banking, Mollie, Stripe, Shopify, bol, WooCommerce, PayPal, Moneybird, e-Boekhouden) zijn volledig geschreven maar niet live getest met echte sleutels.
