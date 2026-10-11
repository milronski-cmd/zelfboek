/**
 * PayPal Transaction Search v1.
 * Fixtures naar het schema https://developer.paypal.com/api/transaction-search/v1/schema.json (search_response, transaction_info, payer_info,
 * money { currency_code, value }) en OAuth https://developer.paypal.com/api/rest/authentication/ (POST /v1/oauth2/token).
 * Fout: error_400 { name, message, debug_id, details[] }.
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { haalPaypalRegels, type PpTx } from "../../src/lib/kanalen/paypal";

const tx = (id: string, code: string, status: string, value: string, fee?: string, naam = "Jan Jansen"): PpTx & Record<string, unknown> => ({
  transaction_info: {
    paypal_account_id: "6STWC2LSUYYYE", transaction_id: id, transaction_event_code: code, transaction_initiation_date: "2026-09-10T08:12:52+0000", transaction_updated_date: "2026-09-10T08:12:52+0000",
    transaction_amount: { currency_code: "EUR", value }, ...(fee ? { fee_amount: { currency_code: "EUR", value: fee } } : {}),
    transaction_status: status, transaction_subject: "Logo-ontwerp", protection_eligibility: "01",
  } as PpTx["transaction_info"],
  payer_info: { account_id: "6STWC2LSUYYYE", email_address: "jan@example.com", address_status: "Y", payer_status: "Y", payer_name: { given_name: "Jan", surname: "Jansen", alternate_full_name: naam }, country_code: "NL" } as PpTx["payer_info"],
});

draai("paypal", async () => {
  zetRoutes([
    { methode: "POST", pad: "https://api-m.sandbox.paypal.com/v1/oauth2/token", antwoord: (v) => {
      gelijk(v.body, "grant_type=client_credentials", "client credentials");
      return { json: { scope: "https://uri.paypal.com/services/reporting/search/read", access_token: "A21AAFEpH4PsADK7qSS7pSRsgzfENtu", token_type: "Bearer", app_id: "APP-80W284485P519543T", expires_in: 31668, nonce: "2026-10-11T12:00:00Z" } };
    } },
    { pad: /^https:\/\/api-m\.sandbox\.paypal\.com\/v1\/reporting\/transactions\?/, antwoord: (v) => {
      const page = Number(v.url.searchParams.get("page"));
      const begin = v.url.searchParams.get("start_date");
      if (begin !== "2026-09-01T00:00:00Z") return { json: { transaction_details: [], account_number: "XZXSPECPDZHZU", start_date: begin, end_date: v.url.searchParams.get("end_date"), page: 1, total_items: 0, total_pages: 0, links: [] } };
      const details = page === 1
        ? [tx("5TY05013RG002845M", "T0006", "S", "121.00", "-4.48"), tx("8MC585209K746392H", "T0400", "S", "-500.00"), tx("1FN09943JY662130R", "T0006", "P", "50.00", "-1.99")]
        : [tx("2KX9845N5H8763910", "T1107", "S", "-25.00", "0.35"), tx("9GS80322F53803514", "T0106", "S", "-15.00", undefined, "PayPal")];
      return { json: { transaction_details: details, account_number: "XZXSPECPDZHZU", start_date: begin, end_date: v.url.searchParams.get("end_date"), last_refreshed_datetime: "2026-10-11T07:59:59+0000", page, total_items: 5, total_pages: 2, links: [] } };
    } },
  ]);
  const regels = await haalPaypalRegels({ clientId: "cid", clientSecret: "geheim", sandbox: "true" }, new Date("2026-09-01T00:00:00Z"), new Date("2026-10-15T00:00:00Z"));
  gelijk(regels.map((r) => [r.externId, r.bedrag, r.categorie, r.btwCode]), [
    ["5TY05013RG002845M", 121, "omzet", "21"],
    ["5TY05013RG002845M-fee", -4.48, "betaalprovider", "eu_dienst"],
    ["2KX9845N5H8763910", -25, "klant_terugbetaling", "21"],
    ["2KX9845N5H8763910-fee", -0.35, "betaalprovider", "eu_dienst"],
    ["9GS80322F53803514", -15, "betaalprovider", "eu_dienst"],
  ], "betalingen, terugbetaling, losse kosten (T01); bankopname (T04) en pending overgeslagen");
  const zoek = verzoeken.filter((v) => v.url.pathname === "/v1/reporting/transactions");
  gelijk(zoek.map((v) => [v.url.searchParams.get("start_date"), v.url.searchParams.get("end_date"), v.url.searchParams.get("page")]), [
    ["2026-09-01T00:00:00Z", "2026-10-01T23:59:59Z", "1"],
    ["2026-09-01T00:00:00Z", "2026-10-01T23:59:59Z", "2"],
    ["2026-10-02T00:00:00Z", "2026-10-15T00:00:00Z", "1"],
  ], "vensters van maximaal 31 dagen, RFC 3339 met seconden, total_pages gevolgd");
  waar(zoek.every((v) => v.headers.get("authorization") === "Bearer A21AAFEpH4PsADK7qSS7pSRsgzfENtu" && v.url.searchParams.get("page_size") === "500"), "Bearer-token en page_size 500");

  zetRoutes([
    { methode: "POST", pad: "https://api-m.paypal.com/v1/oauth2/token", antwoord: { json: { access_token: "t", expires_in: 100 } } },
    { pad: /reporting\/transactions/, antwoord: { status: 400, json: { name: "INVALID_REQUEST", message: "Request is not well-formed, syntactically incorrect, or violates schema.", debug_id: "f1d6f4dc2a7e4", details: [{ field: "end_date", value: "x", location: "query", issue: "Date range is greater than 31 days" }] } } },
  ]);
  await faalt(() => haalPaypalRegels({ clientId: "a", clientSecret: "b" }, new Date("2026-10-01"), new Date("2026-10-02")), /PayPal 400: Request is not well-formed/, "400 met PayPal-melding");
  zetRoutes([{ methode: "POST", pad: "https://api-m.paypal.com/v1/oauth2/token", antwoord: { status: 401, json: { error: "invalid_client", error_description: "Client Authentication failed" } } }]);
  await faalt(() => haalPaypalRegels({ clientId: "a", clientSecret: "b" }, new Date()), /client-id of secret ongeldig \(401\)/, "401 bij token");
});
