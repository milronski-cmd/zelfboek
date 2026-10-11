/**
 * WooCommerce REST API v3, orders.
 * Fixture naar het voorbeeld bij https://woocommerce.github.io/woocommerce-rest-api-docs/#list-all-orders (ingekort tot de gebruikte velden;
 * *_gmt-datums zonder tijdzone, bedragen als strings) en de paginering met X-WP-Total / X-WP-TotalPages
 * (https://woocommerce.github.io/woocommerce-rest-api-docs/#pagination). Fout: https://woocommerce.github.io/woocommerce-rest-api-docs/#errors
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { gmtDatum, haalWooRegels, type WooOrder } from "../../src/lib/kanalen/woocommerce";

const order = (id: number, total: string, total_tax: string, land: string, paid: string | null, extra: Partial<WooOrder> = {}): WooOrder => ({
  id, number: String(id), status: "completed", currency: "EUR",
  date_created_gmt: "2026-09-02T09:15:00", date_paid_gmt: paid, date_completed_gmt: "2026-09-04T10:00:00",
  total, total_tax, payment_method_title: "iDEAL",
  billing: { first_name: "Jan", last_name: "Jansen", company: "", country: land },
  ...extra,
});

draai("woocommerce", async () => {
  gelijk(gmtDatum("2026-09-02T23:30:00").toISOString(), "2026-09-02T23:30:00.000Z", "*_gmt zonder Z wordt als UTC gelezen");
  const auth = `Basic ${Buffer.from("ck_abc:cs_def").toString("base64")}`;
  zetRoutes([
    { pad: /^https:\/\/winkel\.nl\/wp-json\/wc\/v3\/orders\?/, antwoord: (v) => {
      const page = v.url.searchParams.get("page");
      const kop = { "X-WP-Total": "4", "X-WP-TotalPages": "2" };
      if (page === "1") return { headers: kop, json: [order(727, "121.00", "21.00", "NL", "2026-09-02T09:20:00"), order(728, "109.00", "9.00", "NL", "2026-09-03T11:00:00", { billing: { company: "Boekhandel BV", country: "NL" } })] };
      return { headers: kop, json: [order(729, "50.00", "0.00", "DE", "2026-09-05T08:00:00"), order(730, "0.00", "0.00", "NL", null)] };
    } },
  ]);
  const regels = await haalWooRegels({ url: "https://winkel.nl/", consumerKey: "ck_abc", consumerSecret: "cs_def" }, new Date("2026-09-01T00:00:00.000Z"));
  gelijk(regels.map((r) => [r.externId, r.bedrag, r.btwCode, r.tegenpartij, r.datum.toISOString()]), [
    ["727", 121, "21", "Jan Jansen", "2026-09-02T09:20:00.000Z"],
    ["728", 109, "9", "Boekhandel BV", "2026-09-03T11:00:00.000Z"],
    ["729", 50, "0", "Jan Jansen", "2026-09-05T08:00:00.000Z"],
  ], "bestellingen met btw-tarief uit total_tax; nulbedrag overgeslagen");
  gelijk(verzoeken.length, 2, "precies X-WP-TotalPages pagina's opgehaald");
  const q = verzoeken[0].url.searchParams;
  gelijk([q.get("status"), q.get("after"), q.get("dates_are_gmt"), q.get("per_page")], ["completed,processing", "2026-09-01T00:00:00Z", "true", "100"], "filters volgens de docs");
  waar(verzoeken.every((v) => v.headers.get("authorization") === auth), "Basic-authenticatie met consumer key/secret");

  await faalt(() => haalWooRegels({ url: "http://winkel.nl", consumerKey: "a", consumerSecret: "b" }, new Date()), /https/, "http-adres geweigerd (Basic alleen over HTTPS)");

  zetRoutes([{ pad: /orders/, antwoord: { status: 401, json: { code: "woocommerce_rest_authentication_error", message: "Ongeldige handtekening - opgegeven handtekening komt niet overeen.", data: { status: 401 } } } }]);
  await faalt(() => haalWooRegels({ url: "https://winkel.nl", consumerKey: "a", consumerSecret: "b" }, new Date()), /sleutel ongeldig.*401.*handtekening/, "401 met WooCommerce-melding");
});
