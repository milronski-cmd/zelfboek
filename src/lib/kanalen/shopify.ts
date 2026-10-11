import { bedragUit, bewaarKanaalRegels, centen, haalJson, isoDag, kanaalConfig, voerKanaalUit, type KanaalRegel, type KanaalUitkomst } from "./basis";

/**
 * Shopify Payments via de GraphQL Admin API (de REST Admin API is sinds 2024 "legacy").
 * Docs: https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsAccount (payouts-connectie)
 *       https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsPayout
 *       https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsPayoutSummary
 * Uitbetaling (net) + alle fees uit de samenvatting = bruto omzet; de fees zijn kosten (Shopify International, Ierland: eu_dienst).
 *
 * Config: { shop: "mijnwinkel.myshopify.com", accessToken?: "shpat_..." } (bestaande custom app uit de admin)
 *    of   { shop, clientId, clientSecret } (app uit het Dev Dashboard, sinds 1 januari 2026 de enige manier om een nieuwe app te maken;
 *          token via de client credentials grant, 24 uur geldig). Scopes: read_shopify_payments_payouts (en read_shopify_payments_accounts).
 */
export const SHOPIFY_VERSIE = "2026-10";

export type ShopifyConfig = { shop: string; accessToken?: string; clientId?: string; clientSecret?: string };
type Geld = { amount: string; currencyCode?: string };
export type ShopifyPayout = {
  id: string;
  legacyResourceId?: string;
  issuedAt: string;
  status: "SCHEDULED" | "IN_TRANSIT" | "PAID" | "FAILED" | "CANCELED" | string;
  transactionType?: "DEPOSIT" | "WITHDRAWAL" | string;
  net: Geld;
  summary?: Record<string, Geld | undefined>;
};

const FEES = ["adjustmentsFee", "advanceFees", "chargesFee", "refundsFee", "reservedFundsFee", "retriedPayoutsFee"] as const;

const QUERY = `query Uitbetalingen($first: Int!, $after: String, $query: String) {
  shopifyPaymentsAccount {
    payouts(first: $first, after: $after, query: $query, sortKey: ISSUED_AT) {
      nodes {
        id legacyResourceId issuedAt status transactionType
        net { amount currencyCode }
        summary { ${FEES.map((f) => `${f} { amount }`).join(" ")} }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export const shopDomein = (shop: string) => {
  const s = shop.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return s.includes(".") ? s : `${s}.myshopify.com`;
};

export async function shopifyToken(cfg: ShopifyConfig): Promise<string> {
  if (cfg.accessToken) return cfg.accessToken;
  if (!cfg.clientId || !cfg.clientSecret) throw new Error("Shopify: vul een Admin API access token in, of de client-id en client-secret van je app.");
  const r = await haalJson<{ access_token: string }>(`https://${shopDomein(cfg.shop)}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId, client_secret: cfg.clientSecret }).toString(),
  }, "Shopify");
  return r.access_token;
}

type GqlAntwoord = {
  data?: { shopifyPaymentsAccount: { payouts: { nodes: ShopifyPayout[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | null };
  errors?: { message: string; extensions?: { code?: string } }[];
};

export async function haalShopifyRegels(cfg: ShopifyConfig, vanaf: Date): Promise<KanaalRegel[]> {
  const token = await shopifyToken(cfg);
  const url = `https://${shopDomein(cfg.shop)}/admin/api/${SHOPIFY_VERSIE}/graphql.json`;
  const regels: KanaalRegel[] = [];
  let after: string | null = null;
  for (let pagina = 0; pagina < 100; pagina++) {
    let r: GqlAntwoord | undefined;
    for (let poging = 0; poging < 4; poging++) {
      r = await haalJson<GqlAntwoord>(url, {
        method: "POST",
        headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { first: 100, after, query: `issued_at:>=${isoDag(vanaf)}` } }),
      }, "Shopify");
      // GraphQL-throttling komt als 200 met errors[].extensions.code = THROTTLED
      if (!r.errors?.some((e) => e.extensions?.code === "THROTTLED") || poging === 3) break;
      await new Promise((ok) => setTimeout(ok, Math.min(2000 * (poging + 1), Number(process.env.KOPPELING_MAX_WACHT_MS ?? 30000))));
    }
    if (r?.errors?.length) {
      const m = r.errors[0].message;
      if (/access denied|scope/i.test(m)) throw new Error(`Shopify: de app mist de scope read_shopify_payments_payouts of read_shopify_payments_accounts (${m}).`);
      throw new Error(`Shopify: ${m}`);
    }
    const account = r?.data?.shopifyPaymentsAccount;
    if (!account) throw new Error("Shopify: deze winkel heeft geen actief Shopify Payments-account.");
    for (const p of account.payouts.nodes) {
      if (p.status !== "PAID" || (p.transactionType && p.transactionType !== "DEPOSIT")) continue;
      const d = new Date(p.issuedAt);
      if (d < vanaf) continue;
      const id = p.legacyResourceId ?? p.id.split("/").pop() ?? p.id;
      const netto = bedragUit(p.net.amount);
      const kosten = centen(FEES.reduce((s, f) => s + bedragUit(p.summary?.[f]?.amount), 0));
      regels.push({ datum: d, bedrag: centen(netto + kosten), tegenpartij: "Shopify Payments", omschrijving: `Uitbetaling ${id}`, externId: String(id), categorie: "omzet", btwCode: "21" });
      if (kosten > 0) regels.push({ datum: d, bedrag: -kosten, tegenpartij: "Shopify International", omschrijving: `Kosten uitbetaling ${id}`, externId: `${id}-fee`, categorie: "betaalprovider", btwCode: "eu_dienst" });
    }
    if (!account.payouts.pageInfo.hasNextPage) break;
    after = account.payouts.pageInfo.endCursor;
  }
  return regels;
}

export async function haalTransacties(ondernemingId: string, vanaf: Date): Promise<KanaalUitkomst> {
  return voerKanaalUit(ondernemingId, "shopify", async () => {
    const cfg = await kanaalConfig<{ shop: string; accessToken: string; clientId: string; clientSecret: string }>(ondernemingId, "shopify", ["shop"], "Shopify");
    return bewaarKanaalRegels(ondernemingId, "shopify", await haalShopifyRegels(cfg, vanaf));
  });
}
