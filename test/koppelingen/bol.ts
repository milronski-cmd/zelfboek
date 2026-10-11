/**
 * bol Retailer API v10, Invoices.
 * Fixtures exact naar de demo-antwoorden op https://api.bol.com/retailer/public/Retailer-API/demo/v10-INVOICES.html
 * (GET /retailer-demo/invoices en /retailer-demo/invoices/4500022543921/specification), ingekort tot de gebruikte velden
 * plus één tweede pagina. Token: https://api.bol.com/retailer/public/Retailer-API/authentication.html
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { bolDatum, haalBolRegels, telSpecificatie, type BolSpecRegel } from "../../src/lib/kanalen/bol";

const spec = (id: string, naam: string, excl: number, btw: number, omschrijving: string): BolSpecRegel => ({
  id, invoiceLineRef: `4500022543921#${naam}`,
  item: { Name: { value: naam }, Description: [{ value: omschrijving }] },
  lineExtensionAmount: { currencyID: "EUR", value: excl },
  taxTotal: { TaxAmount: { currencyID: "EUR", value: btw } },
});

const lijst = {
  invoiceListItems: [{
    invoiceId: "4500022543921",
    invoiceMediaTypes: { availableMediaTypes: ["application/vnd.retailer.v10+json", "application/vnd.retailer.v10+pdf"] },
    invoicePeriod: { endDate: 1556575200000, startDate: 1554069600000 },
    invoiceType: "ALL_IN_ONE",
    issueDate: 1525125600,
    legalMonetaryTotal: {
      lineExtensionAmount: { amount: -1336.3, currencyID: "EUR" },
      payableAmount: { amount: -1336.3, currencyID: "EUR" },
      taxExclusiveAmount: { amount: -1290.66, currencyID: "EUR" },
      taxInclusiveAmount: { amount: -1290.66, currencyID: "EUR" },
    },
    specificationMediaTypes: { availableMediaTypes: ["application/vnd.retailer.v10+json", "application/vnd.retailer.v10+openxmlformats-officedocument.spreadsheetml.sheet"] },
  }, {
    invoiceId: "4500099999999", invoiceType: "ADVERTISING_VIA_BOL", issueDate: 1525125600,
    legalMonetaryTotal: { taxInclusiveAmount: { amount: 121, currencyID: "EUR" } },
  }],
  period: "2018-04-12T00:00:00+02:00/2018-05-09T00:00:00+02:00",
};

const pagina1 = [
  spec("7616222250#1021103894#TURNOVER", "TURNOVER", 104.94, 0, "Verkoopprijs artikel(en), ontvangen van kopers en door bol.com door te storten"),
  spec("7616222250#1021092231#COMMISSION", "COMMISSION", 15.495868, 3.254132, "Bemiddelingsbijdrage"),
  spec("7616222700#1021103894#TURNOVER", "TURNOVER", -24.5, 0, "Verkoopprijs artikel(en), ontvangen van kopers en door bol.com door te storten"),
  spec("7616247328#1159250#SHIPMENT_LABEL", "SHIPMENT_LABEL", 3.99, 0.8279, "Bijdrage aan pakketzegel(s)"),
];

draai("bol", async () => {
  gelijk(bolDatum(1525125600).toISOString(), "2018-04-30T22:00:00.000Z", "issueDate in seconden");
  gelijk(bolDatum(1556575200000).toISOString(), "2019-04-29T22:00:00.000Z", "periode in milliseconden");
  gelijk(telSpecificatie(pagina1), { omzet: 80.44, kostenBtw: 23.57, kostenZonder: 0 }, "specificatie: omzet en kosten incl. btw");

  // 25.000 regels op pagina 1 betekent: pagina 2 ophalen
  const vol = Array.from({ length: 25000 }, (_, i) => (i < 4 ? pagina1[i] : spec(`x${i}#TURNOVER`, "TURNOVER", 0, 0, "leeg")));
  zetRoutes([
    { methode: "POST", pad: "https://login.bol.com/token", antwoord: (v) => {
      waar(v.headers.get("authorization") === `Basic ${Buffer.from("cid:geheim").toString("base64")}` && v.url.searchParams.get("grant_type") === "client_credentials", "token met Basic en grant_type");
      return { json: { access_token: "eyJ.bol", token_type: "Bearer", expires_in: 299, scope: "RETAILER" } };
    } },
    { pad: /^https:\/\/api\.bol\.com\/retailer-demo\/invoices\?/, antwoord: (v) => (v.url.searchParams.get("period-start-date") === "2026-09-01" ? { json: lijst } : { json: { invoiceListItems: [], period: "" } }) },
    { pad: /retailer-demo\/invoices\/4500022543921\/specification\?page=1$/, antwoord: { json: { invoiceSpecification: vol } } },
    { pad: /retailer-demo\/invoices\/4500022543921\/specification\?page=2$/, antwoord: { json: { invoiceSpecification: [spec("7616222250#STOCK", "STOCK", 1.0, 0, "Opslagkosten")] } } },
  ]);
  const regels = await haalBolRegels({ clientId: "cid", clientSecret: "geheim", demo: "true" }, new Date("2026-09-01"), new Date("2026-11-15T12:00:00Z"));
  const lijstVerzoeken = verzoeken.filter((v) => v.url.pathname === "/retailer-demo/invoices");
  gelijk(lijstVerzoeken.map((v) => `${v.url.searchParams.get("period-start-date")}..${v.url.searchParams.get("period-end-date")}`), ["2026-09-01..2026-10-01", "2026-10-02..2026-11-01", "2026-11-02..2026-11-15"], "perioden van maximaal 31 dagen");
  waar(verzoeken.filter((v) => v.url.hostname === "api.bol.com").every((v) => v.headers.get("accept") === "application/vnd.retailer.v10+json" && v.headers.get("authorization") === "Bearer eyJ.bol"), "Accept v10 en Bearer-token op elk verzoek");
  gelijk(verzoeken.filter((v) => v.url.pathname.endsWith("/specification")).length, 2, "specificatie gepagineerd (2 pagina's)");
  gelijk(regels.map((r) => [r.categorie, r.bedrag, r.btwCode, r.externId]), [
    ["omzet", 80.44, "21", "4500022543921"],
    ["betaalprovider", -23.57, "21", "4500022543921-commissie"],
    ["betaalprovider", -1, "geen", "4500022543921-kosten0"],
  ], "regels: omzet, commissie met btw, kosten zonder btw; advertentiefactuur overgeslagen");

  // Foutgeval: ongeldige sleutels
  zetRoutes([{ methode: "POST", pad: "https://login.bol.com/token", antwoord: { status: 401, json: { error: "invalid_client", error_description: "Bad client credentials" } } }]);
  await faalt(() => haalBolRegels({ clientId: "x", clientSecret: "y" }, new Date("2026-10-01")), /client-id of client-secret ongeldig \(401\)/, "401 bij token geeft Nederlandse fout");

  // Foutgeval: rate limit eerst 429 met Retry-After, daarna 200
  let keer = 0;
  zetRoutes([
    { methode: "POST", pad: "https://login.bol.com/token", antwoord: { json: { access_token: "t", expires_in: 299 } } },
    { pad: /retailer\/invoices\?/, antwoord: () => (keer++ === 0 ? { status: 429, headers: { "Retry-After": "0" }, json: { type: "https://api.bol.com/problems", title: "Too Many Requests", status: 429 } } : { json: {} }) },
  ]);
  gelijk(await haalBolRegels({ clientId: "x", clientSecret: "y" }, new Date("2026-10-01"), new Date("2026-10-10")), [], "429 wordt na Retry-After opnieuw geprobeerd");
});
