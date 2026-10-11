import { bewaarKanaalRegels, haalJsonMetKoppen, kanaalConfig, voerKanaalUit, type KanaalRegel, type KanaalUitkomst } from "./basis";

/**
 * WooCommerce REST API v3: afgeronde en lopende bestellingen als omzet (per bestelling, betaalmethode in de omschrijving).
 * Docs: https://woocommerce.github.io/woocommerce-rest-api-docs/#list-all-orders
 * Config: { url: "https://winkel.nl", consumerKey: "ck_...", consumerSecret: "cs_..." }.
 * - Authenticatie: HTTP Basic met consumer key/secret (alleen over HTTPS);
 * - paginering: per_page (max 100) en page, het totaal staat in de header X-WP-TotalPages;
 * - bedragen zijn decimale strings ("12.10"); *_gmt-datums hebben géén tijdzone-aanduiding (UTC).
 * Let op: betaal je klanten via Mollie of Stripe, koppel dan dat kanaal en niet WooCommerce (anders dubbel).
 */
export type WooOrder = { id: number; number?: string; status: string; currency?: string; date_paid_gmt?: string | null; date_completed_gmt?: string | null; date_created_gmt: string; total: string; total_tax: string; payment_method_title?: string; billing?: { first_name?: string; last_name?: string; company?: string; country?: string } };

export type WooConfig = { url: string; consumerKey: string; consumerSecret: string };

/** "2026-09-01T10:00:00" uit een *_gmt-veld is UTC; zonder Z zou JavaScript het als lokale tijd lezen. */
export const gmtDatum = (s: string) => new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);

export function wooBtwCode(o: WooOrder): KanaalRegel["btwCode"] {
  const totaal = parseFloat(o.total);
  const btw = parseFloat(o.total_tax || "0");
  const buitenNl = !!o.billing?.country && o.billing.country !== "NL";
  if (!btw) return buitenNl ? "0" : "geen";
  return Math.abs(btw / (totaal - btw) - 0.09) < 0.005 ? "9" : "21";
}

export async function haalWooRegels(cfg: WooConfig, vanaf: Date): Promise<KanaalRegel[]> {
  const basis = cfg.url.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(basis)) throw new Error("WooCommerce: gebruik een https-adres; de sleutels gaan anders onversleuteld over het internet.");
  const auth = `Basic ${Buffer.from(`${cfg.consumerKey}:${cfg.consumerSecret}`).toString("base64")}`;
  const regels: KanaalRegel[] = [];
  let totaalPaginas = 1;
  for (let page = 1; page <= Math.min(totaalPaginas, 200); page++) {
    const q = new URLSearchParams({ status: "completed,processing", after: vanaf.toISOString().replace(/\.\d{3}Z$/, "Z"), dates_are_gmt: "true", per_page: "100", page: String(page), orderby: "date", order: "asc" });
    const { data: orders, headers } = await haalJsonMetKoppen<WooOrder[]>(`${basis}/wp-json/wc/v3/orders?${q}`, { headers: { Authorization: auth, Accept: "application/json" } }, "WooCommerce");
    totaalPaginas = Number(headers.get("x-wp-totalpages") ?? (orders.length === 100 ? page + 1 : page));
    for (const o of orders) {
      const totaal = parseFloat(o.total);
      if (!totaal) continue;
      const klant = o.billing?.company || [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" ") || "Klant";
      regels.push({
        datum: gmtDatum(o.date_paid_gmt ?? o.date_completed_gmt ?? o.date_created_gmt),
        bedrag: totaal,
        tegenpartij: klant,
        omschrijving: `Bestelling #${o.number ?? o.id} via ${o.payment_method_title || "webshop"}`,
        externId: String(o.id),
        categorie: "omzet",
        btwCode: wooBtwCode(o),
      });
    }
  }
  return regels;
}

export async function haalTransacties(ondernemingId: string, vanaf: Date): Promise<KanaalUitkomst> {
  return voerKanaalUit(ondernemingId, "woocommerce", async () => {
    const cfg = await kanaalConfig<WooConfig>(ondernemingId, "woocommerce", ["url", "consumerKey", "consumerSecret"], "WooCommerce");
    return bewaarKanaalRegels(ondernemingId, "woocommerce", await haalWooRegels(cfg, vanaf));
  });
}
