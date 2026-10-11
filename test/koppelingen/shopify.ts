/**
 * Shopify Payments via GraphQL Admin API 2026-10.
 * Fixtures naar https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsPayout,
 * .../ShopifyPaymentsPayoutSummary (MoneyV2 { amount: Decimal-string, currencyCode }), cursorpaginering met pageInfo,
 * throttling https://shopify.dev/docs/api/usage/limits#rate-limits (200 met errors[].extensions.code = THROTTLED)
 * en de client credentials grant https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant.
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { haalShopifyRegels, shopDomein, type ShopifyPayout } from "../../src/lib/kanalen/shopify";

const m = (amount: string) => ({ amount, currencyCode: "EUR" });
const nul = m("0.0");
const payout = (n: number, issuedAt: string, net: string, chargesFee: string, extra: Partial<ShopifyPayout> = {}): ShopifyPayout => ({
  id: `gid://shopify/ShopifyPaymentsPayout/${n}`, legacyResourceId: String(n), issuedAt, status: "PAID", transactionType: "DEPOSIT", net: m(net),
  summary: { adjustmentsFee: nul, advanceFees: nul, chargesFee: m(chargesFee), refundsFee: m("0.25"), reservedFundsFee: nul, retriedPayoutsFee: nul },
  ...extra,
});
const antwoord = (nodes: ShopifyPayout[], hasNextPage: boolean, endCursor: string | null) => ({
  data: { shopifyPaymentsAccount: { payouts: { nodes, pageInfo: { hasNextPage, endCursor } } } },
  extensions: { cost: { requestedQueryCost: 52, actualQueryCost: 12, throttleStatus: { maximumAvailable: 2000.0, currentlyAvailable: 1988, restoreRate: 100.0 } } },
});

draai("shopify", async () => {
  gelijk(shopDomein("https://mijnwinkel.myshopify.com/admin"), "mijnwinkel.myshopify.com", "winkeldomein opgeschoond");
  gelijk(shopDomein("mijnwinkel"), "mijnwinkel.myshopify.com", "winkelnaam aangevuld");

  let gql = 0;
  zetRoutes([
    { methode: "POST", pad: "https://mijnwinkel.myshopify.com/admin/oauth/access_token", antwoord: (v) => {
      const p = new URLSearchParams(v.body);
      gelijk([p.get("grant_type"), p.get("client_id"), v.headers.get("content-type")], ["client_credentials", "cid", "application/x-www-form-urlencoded"], "client credentials grant als formulier");
      return { json: { access_token: "shpat_tijdelijk", scope: "read_shopify_payments_payouts", expires_in: 86399 } };
    } },
    { methode: "POST", pad: "https://mijnwinkel.myshopify.com/admin/api/2026-10/graphql.json", antwoord: (v) => {
      gql++;
      const { variables } = JSON.parse(v.body);
      if (gql === 1) return { json: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED", documentation: "https://shopify.dev/api/usage/limits" } }] } };
      if (!variables.after) return { json: antwoord([payout(1001, "2026-10-03T08:00:00Z", "245.30", "7.45"), payout(1002, "2026-10-02T08:00:00Z", "10.00", "0.0", { status: "IN_TRANSIT" })], true, "eyJsYXN0X2lkIjoxMDAyfQ==") };
      return { json: antwoord([payout(1003, "2026-09-15T08:00:00Z", "-20.00", "0.0", { transactionType: "WITHDRAWAL" }), payout(1004, "2026-09-10T08:00:00Z", "99.00", "1.00")], false, null) };
    } },
  ]);
  const regels = await haalShopifyRegels({ shop: "mijnwinkel.myshopify.com", clientId: "cid", clientSecret: "geheim" }, new Date("2026-09-01"));
  gelijk(regels.map((r) => [r.externId, r.bedrag, r.categorie, r.btwCode]), [
    ["1001", 253, "omzet", "21"],
    ["1001-fee", -7.7, "betaalprovider", "eu_dienst"],
    ["1004", 100.25, "omzet", "21"],
    ["1004-fee", -1.25, "betaalprovider", "eu_dienst"],
  ], "alleen betaalde stortingen; bruto = net + fees; REST-id (legacyResourceId) blijft externId");
  const posts = verzoeken.filter((v) => v.url.pathname.endsWith("graphql.json"));
  gelijk(posts.length, 3, "throttled verzoek herhaald, daarna 2 pagina's");
  waar(posts.every((v) => v.headers.get("x-shopify-access-token") === "shpat_tijdelijk"), "token in X-Shopify-Access-Token");
  gelijk(JSON.parse(posts[2].body).variables, { first: 100, after: "eyJsYXN0X2lkIjoxMDAyfQ==", query: "issued_at:>=2026-09-01" }, "cursor en filter op issued_at");

  zetRoutes([{ methode: "POST", pad: /graphql\.json$/, antwoord: { json: { errors: [{ message: "Access denied for shopifyPaymentsAccount field. Required access: `read_shopify_payments_accounts` access scope.", extensions: { code: "ACCESS_DENIED" } }] } } }]);
  await faalt(() => haalShopifyRegels({ shop: "mijnwinkel", accessToken: "shpat_oud" }, new Date()), /mist de scope/, "ontbrekende scope geeft heldere fout");

  zetRoutes([{ methode: "POST", pad: /graphql\.json$/, antwoord: { status: 401, json: { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" } } }]);
  await faalt(() => haalShopifyRegels({ shop: "mijnwinkel", accessToken: "shpat_fout" }, new Date()), /sleutel ongeldig.*401.*Invalid API key/, "401 met Shopify-melding");
});
