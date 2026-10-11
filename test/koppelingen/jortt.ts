/**
 * Jortt: geen API-koppeling, alleen de CSV-exports (Instellingen → Exporteren), dus geen fetch.
 * Jortt documenteert het CSV-formaat niet publiek (https://developer.jortt.nl/ beschrijft alleen de REST API);
 * de kolomkoppen in deze fixtures zijn daarom een aanname (puntkomma, komma als decimaalteken); de herkenning is bewust ruim.
 */
import { draai, gelijk } from "./nep-fetch";
import { leesJorttCsv } from "../../src/lib/import/jortt";

// datum() uit bank/csv geeft lokale middernacht terug
const lokaal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

draai("jortt", async () => {
  const klanten = leesJorttCsv(`Naam;E-mail;Adres;Postcode;Plaats;Land;KvK;Btw-nummer
Klant BV;jan@klant.nl;Kade 9;5678 CD;Rotterdam;NL;12345678;NL009876543B01
;leeg@x.nl;;;;;;`);
  gelijk(klanten.soort === "klanten" ? klanten.klanten.map((k) => [k.naam, k.email, k.kvk, k.btwNummer]) : klanten.soort, [["Klant BV", "jan@klant.nl", "12345678", "NL009876543B01"]], "klantenexport herkend, lege naam overgeslagen");

  const regels = leesJorttCsv(`Datum;Omschrijving;Relatie;Bedrag incl. btw;Categorie;Btw-tarief
15-09-2026;Factuur 2026-0001;Klant BV;1.210,00;Omzet;21%
16-09-2026;Vercel Pro;Vercel Inc;-24,20;Software;Verlegd
17-09-2026;Leeg;;0,00;;`);
  gelijk(regels.soort === "regels" ? regels.regels.map((r) => [lokaal(r.datum), r.bedrag, r.tegenpartij, r.categorie, r.btwCode]) : regels.soort, [
    ["2026-09-15", 1210, "Klant BV", "omzet", "21"],
    ["2026-09-16", -24.2, "Vercel Inc", "software", "verlegd"],
  ], "boekingen met bedrag, categorie en btw; nulregel overgeslagen");
  // Dezelfde invoer als test/importeer.ts (die een Postgres-database nodig heeft)
  const k2 = leesJorttCsv(`Naam,E-mail,Plaats\nJansen BV,j@j.nl,Utrecht`);
  const r2 = leesJorttCsv(`Datum;Omschrijving;Relatie;Bedrag;Categorie;Btw-tarief\n2026-02-01;Advies;Jansen BV;605,00;Omzet;21%`);
  gelijk([k2.soort === "klanten" ? k2.klanten.length : 0, r2.soort === "regels" ? r2.regels.map((r) => [r.bedrag, r.categorie]) : []], [1, [[605, "omzet"]]], "invoer uit test/importeer.ts");
  gelijk(leesJorttCsv("").soort, "leeg", "leeg bestand (foutgeval)");
});
