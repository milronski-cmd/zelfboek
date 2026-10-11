/**
 * Mollie: Settlements API en Payments API.
 * Fixtures naar https://docs.mollie.com/reference/list-settlements (HAL-lijst met count, _embedded.settlements, _links.next;
 * periods per jaar en maand met revenue[] en costs[]) en https://docs.mollie.com/reference/create-payment (201 met _links.checkout).
 * Foutvorm: https://docs.mollie.com/reference/handling-errors (application/hal+json met status, title, detail).
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { haalMollieRegels, haalBetaling, type MollieSettlement } from "../../src/lib/kanalen/mollie";
import { bereikbareWebhook, maakMollieBetaling } from "../../src/lib/facturen/mollie";

const geld = (value: string) => ({ currency: "EUR", value });
const settlement = (id: string, createdAt: string, settledAt: string | null, status: string, netto: string, kostenBruto: string[]): MollieSettlement & Record<string, unknown> => ({
  resource: "settlement", id, reference: `1234567.${id.slice(-4)}.01`, createdAt, settledAt, status, amount: geld(netto), balanceId: "bal_gVMhHKqSSRYJyPsuoPNFH",
  invoiceId: null,
  periods: {
    "2026": {
      "09": {
        revenue: [{ description: "iDEAL", method: "ideal", count: 6, amountNet: geld("86.1000"), amountVat: null, amountGross: geld("86.1000") }],
        costs: kostenBruto.map((g) => ({ description: "iDEAL", method: "ideal", count: 6, rate: { fixed: geld("0.29"), percentage: null }, amountNet: geld((parseFloat(g) / 1.21).toFixed(4)), amountVat: geld((parseFloat(g) - parseFloat(g) / 1.21).toFixed(4)), amountGross: geld(g) })),
        invoiceId: "inv_FrvewDA3Pr",
        invoiceReference: "2026.10000",
      },
    },
  },
  _links: { self: { href: `https://api.mollie.com/v2/settlements/${id}`, type: "application/hal+json" } },
});

draai("mollie", async () => {
  const pagina1 = {
    count: 2,
    _embedded: { settlements: [
      settlement("stl_jDk30akdN1", "2026-10-02T09:00:00+00:00", null, "open", "12.00", []),
      settlement("stl_jDk30akdN2", "2026-10-01T09:00:00+00:00", "2026-10-02T06:00:00+00:00", "paidout", "84.36", ["1.74"]),
    ] },
    _links: { self: { href: "https://api.mollie.com/v2/settlements?limit=250", type: "application/hal+json" }, previous: null, next: { href: "https://api.mollie.com/v2/settlements?from=stl_jDk30akdN3&limit=250", type: "application/hal+json" }, documentation: { href: "https://docs.mollie.com/reference/list-settlements", type: "text/html" } },
  };
  const pagina2 = {
    count: 2,
    _embedded: { settlements: [
      settlement("stl_jDk30akdN3", "2026-09-20T09:00:00+00:00", "2026-09-21T06:00:00+00:00", "paidout", "50.00", ["0.87", "0.50"]),
      settlement("stl_jDk30akdN4", "2026-08-01T09:00:00+00:00", "2026-08-02T06:00:00+00:00", "paidout", "999.00", []),
    ] },
    _links: { self: { href: "x", type: "application/hal+json" }, previous: null, next: { href: "https://api.mollie.com/v2/settlements?from=stl_NIETOPHALEN&limit=250", type: "application/hal+json" } },
  };
  zetRoutes([
    { pad: /^https:\/\/api\.mollie\.com\/v2\/settlements\?limit=250$/, antwoord: { json: pagina1 } },
    { pad: /settlements\?from=stl_jDk30akdN3/, antwoord: { json: pagina2 } },
  ]);
  const regels = await haalMollieRegels("access_Wwvu7egPcJLLJ9Kb7J632x8wJ2zMeJ", new Date("2026-09-01"));
  gelijk(regels.map((r) => [r.externId, r.bedrag, r.categorie, r.btwCode, r.datum.toISOString().slice(0, 10)]), [
    ["stl_jDk30akdN2", 86.1, "omzet", "21", "2026-10-02"],
    ["stl_jDk30akdN2-kosten", -1.74, "betaalprovider", "21", "2026-10-02"],
    ["stl_jDk30akdN3", 51.37, "omzet", "21", "2026-09-21"],
    ["stl_jDk30akdN3-kosten", -1.37, "betaalprovider", "21", "2026-09-21"],
  ], "alleen uitbetaalde settlements, bruto = netto + kosten, paginering stopt vóór 'vanaf'");
  waar(verzoeken.every((v) => v.headers.get("authorization") === "Bearer access_Wwvu7egPcJLLJ9Kb7J632x8wJ2zMeJ"), "Bearer-token");
  gelijk(verzoeken.length, 2, "geen derde pagina opgehaald");

  await faalt(() => haalMollieRegels("live_abc", new Date()), /organisatie-toegangstoken/, "API-sleutel voor settlements wordt geweigerd met uitleg");

  zetRoutes([{ pad: /settlements/, antwoord: { status: 401, json: { status: 401, title: "Unauthorized Request", detail: "Missing authentication, or failed to authenticate", _links: { documentation: { href: "https://docs.mollie.com/overview/authentication", type: "text/html" } } } } }]);
  await faalt(() => haalMollieRegels("access_fout", new Date()), /sleutel ongeldig.*\(401\).*failed to authenticate/, "401 met Mollie-foutdetail");

  // Betaling aanmaken (betaallink voor een factuur)
  zetRoutes([
    { methode: "POST", pad: "https://api.mollie.com/v2/payments", antwoord: (v) => {
      const b = JSON.parse(v.body);
      gelijk(b.amount, { currency: "EUR", value: "1264.50" }, "bedrag als string met twee decimalen");
      waar(!("webhookUrl" in b), "localhost-webhook weggelaten");
      return { status: 201, json: { resource: "payment", id: "tr_7UhSN1zuXS", mode: "test", status: "open", amount: b.amount, description: b.description, metadata: b.metadata, _links: { checkout: { href: "https://www.mollie.com/checkout/select-method/7UhSN1zuXS", type: "text/html" } } } };
    } },
    { pad: "https://api.mollie.com/v2/payments/tr_7UhSN1zuXS", antwoord: { json: { resource: "payment", id: "tr_7UhSN1zuXS", status: "paid", amount: geld("1264.50"), paidAt: "2026-10-11T10:00:00+00:00", metadata: { factuurId: "f1" } } } },
  ]);
  const b = await maakMollieBetaling("test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM", { bedrag: 1264.5, valuta: "EUR", omschrijving: "Factuur 2026-0001", redirectUrl: "http://localhost:3000/betaald", webhookUrl: "http://localhost:3000/api/webhooks/mollie", metadata: { factuurId: "f1" } });
  gelijk(b, { id: "tr_7UhSN1zuXS", status: "open", checkoutUrl: "https://www.mollie.com/checkout/select-method/7UhSN1zuXS" }, "betaling aangemaakt met checkout-url");
  const p = await haalBetaling("test_dHar4XY7LxsDOtmnkVtjNVWXLSlXsM", "tr_7UhSN1zuXS");
  gelijk([p.status, p.metadata?.factuurId], ["paid", "f1"], "betaling ophalen voor de webhook");
  gelijk(bereikbareWebhook("https://zelfboek.nl/api/webhooks/mollie"), "https://zelfboek.nl/api/webhooks/mollie", "publieke webhook blijft staan");

  zetRoutes([{ methode: "POST", pad: "https://api.mollie.com/v2/payments", antwoord: { status: 422, json: { status: 422, title: "Unprocessable Entity", detail: "The amount is lower than the minimum", field: "amount" } } }]);
  await faalt(() => maakMollieBetaling("test_x", { bedrag: 0.001, valuta: "EUR", omschrijving: "x", redirectUrl: "https://zelfboek.nl" }), /422.*lower than the minimum/, "422 met veldfout");
});
