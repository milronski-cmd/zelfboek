/**
 * Stripe: payouts en balance transactions via de officiële stripe-node SDK met fetch-client.
 * Fixtures naar https://docs.stripe.com/api/payouts/object, https://docs.stripe.com/api/balance_transactions/object
 * en de lijstvorm https://docs.stripe.com/api/pagination ({ object: "list", data, has_more, url }; volgende pagina met starting_after).
 * Bedragen in centen. Fout: https://docs.stripe.com/api/errors ({ error: { type, code, message } }).
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { haalStripeRegels } from "../../src/lib/kanalen/stripe";

const payout = (id: string, amount: number, arrival: string, automatic = true) => ({
  id, object: "payout", amount, arrival_date: Math.floor(new Date(arrival).getTime() / 1000), automatic, balance_transaction: `txn_${id}`, created: 1759000000,
  currency: "eur", description: "STRIPE PAYOUT", destination: "ba_1Mvtfo2eZvKYlo2CyQpPqMsZ", livemode: false, metadata: {}, method: "standard", source_type: "card", statement_descriptor: null, status: "paid", type: "bank_account",
});
const btx = (id: string, type: string, amount: number, fee: number) => ({
  id, object: "balance_transaction", amount, available_on: 1759000000, created: 1758900000, currency: "eur", description: null, exchange_rate: null,
  fee, fee_details: fee ? [{ amount: fee, application: null, currency: "eur", description: "Stripe processing fees", type: "stripe_fee" }] : [], net: amount - fee,
  reporting_category: type === "charge" ? "charge" : type, source: `src_${id}`, status: "available", type,
});
const lijst = (url: string, data: unknown[], has_more: boolean) => ({ object: "list", data, has_more, url });

draai("stripe", async () => {
  zetRoutes([
    { pad: /^https:\/\/api\.stripe\.com\/v1\/payouts\?/, antwoord: (v) => (v.url.searchParams.get("starting_after") === "po_2"
      ? { json: lijst("/v1/payouts", [payout("po_3", 5000, "2026-09-10", false)], false) }
      : { json: lijst("/v1/payouts", [payout("po_1", 8920, "2026-10-01"), payout("po_2", 1210, "2026-09-20")], true) }) },
    { pad: /^https:\/\/api\.stripe\.com\/v1\/balance_transactions\?/, antwoord: (v) => {
      const p = v.url.searchParams.get("payout");
      if (p === "po_1" && !v.url.searchParams.get("starting_after")) return { json: lijst("/v1/balance_transactions", [btx("txn_a", "charge", 10000, 315), btx("txn_b", "refund", -500, 0)], true) };
      if (p === "po_1") return { json: lijst("/v1/balance_transactions", [btx("txn_c", "stripe_fee", -265, 0), btx("txn_d", "payout", -8920, 0)], false) };
      return { json: lijst("/v1/balance_transactions", [], false) };
    } },
  ]);
  const regels = await haalStripeRegels("sk_test_51NepSleutel", new Date("2026-09-01T00:00:00Z"));
  gelijk(regels.map((r) => [r.externId, r.bedrag, r.categorie, r.btwCode]), [
    ["po_1", 95, "omzet", "21"],
    ["po_1-fee", -5.8, "betaalprovider", "eu_dienst"],
    ["po_2", 12.1, "omzet", "21"],
    ["po_3", 50, "omzet", "21"],
  ], "bruto = charges + refunds, kosten = fees + losse stripe_fee, handmatige payout op payoutbedrag");
  const eerste = verzoeken[0];
  gelijk([eerste.url.searchParams.get("status"), eerste.url.searchParams.get("arrival_date[gte]"), eerste.url.searchParams.get("limit")], ["paid", String(Date.parse("2026-09-01T00:00:00Z") / 1000), "100"], "payouts gefilterd op status en arrival_date");
  waar(verzoeken.every((v) => v.headers.get("authorization") === "Bearer sk_test_51NepSleutel"), "secret key als Bearer");
  waar(!verzoeken.some((v) => v.url.searchParams.get("payout") === "po_3"), "geen payout-filter voor handmatige payout");

  zetRoutes([{ pad: /payouts/, antwoord: { status: 401, json: { error: { type: "invalid_request_error", message: "Invalid API Key provided: sk_test_****leut" } } } }]);
  await faalt(() => haalStripeRegels("sk_test_fout", new Date()), /Invalid API Key/, "401 van Stripe wordt doorgegeven");
});
