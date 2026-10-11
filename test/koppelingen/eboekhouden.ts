/**
 * e-Boekhouden REST API v1.
 * Fixtures naar de OpenAPI-spec https://api.e-boekhouden.nl/openapi/v1.json :
 * POST /v1/session → { token, expiresIn }; GET /v1/relation en /v1/mutation → { items, count } (limit max 2000, offset);
 * de voorbeelden in de spec staan in PascalCase ("Items", "Id", "Type": 2), de schema's in camelCase: beide worden geaccepteerd.
 * GET /v1/mutation/{id} met rows[], vat[] en inExVat. Fout: { type, title, code, message, status, traceId }.
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { camel, ebSoort, ebTotalen, haalEboekhoudenData, type EbMutatie } from "../../src/lib/import/eboekhouden";

const API = "https://api.e-boekhouden.nl/v1";
const relatie = (Id: number) => ({ Id, Type: "B", Code: `R${String(Id).padStart(4, "0")}`, Name: `Relatie ${Id} BV`, Contact: "Jan Jansen", Address: "Kade 9", PostalCode: "5678 CD", City: "Rotterdam", Country: "NL", PhoneNumber: "010-1234567", EmailAddress: `r${Id}@example.com`, VatNumber: "NL009876543B01", CompanyRegistrationNumber: "12345678", Iban: null });
const kort = (id: number, type: number, amount: number) => ({ id, type, date: "2026-10-11", invoiceNumber: type <= 4 ? `F${id}` : null, ledgerId: 40444521, amount, entryNumber: `ENTR${id}` });

draai("eboekhouden", async () => {
  gelijk(camel({ Items: [{ Id: 1, Rows: [{ VatAmount: 2 }] }], Count: 1 }), { items: [{ id: 1, rows: [{ vatAmount: 2 }] }], count: 1 }, "PascalCase naar camelCase");
  gelijk([ebSoort(1).teken, ebSoort("2").teken, ebSoort(3).doel, ebSoort(6).teken, ebSoort(7).doel], [-1, 1, "bank", -1, "boeking"], "mutatietypes 1-7 (getal of string)");
  const ex: EbMutatie = { id: 12, type: 2, date: "2026-10-11", inExVat: "EX", rows: [{ amount: 10, vatAmount: 2.1 }], vat: [{ vatCode: "HOOG_VERK_21", amount: 2.1 }] };
  gelijk(ebTotalen(ex), { incl: 12.1, btw: 2.1 }, "EX: regels plus btw");
  gelijk(ebTotalen({ ...ex, inExVat: "IN", rows: [{ amount: 12.1 }] }), { incl: 12.1, btw: 2.1 }, "IN: regels zijn al inclusief");

  const relaties = Array.from({ length: 2001 }, (_, i) => relatie(i + 1));
  zetRoutes([
    { methode: "POST", pad: `${API}/session`, antwoord: (v) => {
      gelijk(JSON.parse(v.body), { accessToken: "eb-api-token", source: "Zelfboek" }, "sessie met accessToken en source (max 10 tekens)");
      return { json: { token: "SESSIE-123", expiresIn: 3600 } };
    } },
    { pad: `${API}/relation`, antwoord: (v) => {
      const offset = Number(v.url.searchParams.get("offset"));
      return { json: { Items: relaties.slice(offset, offset + 2000), Count: relaties.length } };
    } },
    { pad: `${API}/mutation`, antwoord: { json: { items: [kort(12, 2, 12.1), kort(13, 5, 50), kort(14, 6, 24.2)], count: 3 } } },
    { pad: /\/v1\/mutation\/\d+$/, antwoord: (v) => {
      const id = Number(v.url.pathname.split("/").pop());
      const detail: Record<number, unknown> = {
        12: { Id: 12, Type: 2, Date: "2026-10-11", Description: "Factuur F12", TermOfPayment: 14, LedgerId: 40444521, RelationId: 1, InExVat: "EX", InvoiceNumber: "F12", EntryNumber: "ENTR12", Rows: [{ LedgerId: 8000, VatCode: "HOOG_VERK_21", VatAmount: 2.1, Amount: 10, Description: "Advies" }], Vat: [{ VatCode: "HOOG_VERK_21", Amount: 2.1 }] },
        13: { Id: 13, Type: 5, Date: "2026-10-11", Description: "Ontvangst", RelationId: 2, InExVat: "IN", Rows: [{ LedgerId: 8000, VatCode: "GEEN", Amount: 50 }], Vat: [] },
        14: { Id: 14, Type: 6, Date: "2026-10-11", Description: "Vercel Pro", InExVat: "IN", Rows: [{ LedgerId: 4500, VatCode: "VERL_INK", Amount: 24.2 }], Vat: [] },
      };
      return { json: detail[id] };
    } },
  ]);
  const d = await haalEboekhoudenData("eb-api-token");
  gelijk(d.relaties.length, 2001, "relaties over 2 pagina's (limit 2000)");
  gelijk([d.relaties[0].name, d.relaties[0].emailAddress, d.relaties[0].companyRegistrationNumber, d.relaties[0].phoneNumber], ["Relatie 1 BV", "r1@example.com", "12345678", "010-1234567"], "relatievelden volgens de spec");
  gelijk(verzoeken.filter((v) => v.url.pathname === "/v1/relation").map((v) => v.url.search), ["?limit=2000&offset=0", "?limit=2000&offset=2000"], "limit/offset-paginering");
  waar(verzoeken.filter((v) => v.methode === "GET").every((v) => v.headers.get("authorization") === "SESSIE-123"), "sessietoken als Authorization-header zonder Bearer");
  gelijk(d.mutaties.map((m) => [m.id, Number(m.type), m.description, ebTotalen(m).incl, ebSoort(m.type).teken]), [[12, 2, "Factuur F12", 12.1, 1], [13, 5, "Ontvangst", 50, 1], [14, 6, "Vercel Pro", 24.2, -1]], "mutaties met details uit /mutation/{id}");

  zetRoutes([{ methode: "POST", pad: `${API}/session`, antwoord: { status: 400, json: { type: "validation", title: "Access token has expired.", code: "API_SESSION_004", status: 400, traceId: "ABCDEF-123456." } } }]);
  await faalt(() => haalEboekhoudenData("verlopen"), /400: Access token has expired/, "verlopen API-token met e-Boekhouden-melding");
});
