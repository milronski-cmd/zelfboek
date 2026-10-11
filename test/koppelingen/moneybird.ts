/**
 * Moneybird API v2.
 * Fixtures naar https://developer.moneybird.com/api/contacts/, /api/sales_invoices/ (velden incl. tax_totals, géén total_tax),
 * /api/financial_mutations/ (synchronization: GET → [{ id, version }], POST { ids } → max 100 records),
 * /api/documents_purchase_invoices/ en /api/tax_rates/. Rate limit: 150 verzoeken per 5 minuten, 429 + Retry-After.
 */
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { haalMoneybirdData, mbFactuurNaarData, type MbContact, type MbVerkoopFactuur } from "../../src/lib/import/moneybird";

const A = "123456789012345678";
const B = `https://moneybird.com/api/v2/${A}`;
const contact = (i: number): MbContact & Record<string, unknown> => ({ id: (BigInt("400000000000000000") + BigInt(i)).toString(), administration_id: A, company_name: `Klant ${i} BV`, firstname: "", lastname: "", address1: "Kade 9", zipcode: "5678 CD", city: "Rotterdam", country: "NL", phone: "", email: `klant${i}@example.com`, chamber_of_commerce: "12345678", tax_number: "NL009876543B01", version: 1760000000 });
const tarief21 = { id: "411111111111111111", administration_id: A, name: "21% btw", percentage: "21.0", tax_rate_type: "sales_invoice", show_tax: true, active: true, country: null, created_at: "2026-01-01T10:00:00.000Z", updated_at: "2026-01-01T10:00:00.000Z" };
const tarief9 = { ...tarief21, id: "422222222222222222", name: "9% btw", percentage: "9.0" };
const factuur: MbVerkoopFactuur & Record<string, unknown> = {
  id: "455555555555555555", administration_id: A, contact_id: "400000000000000001", invoice_id: "2026-0042", state: "open", invoice_date: "2026-10-09", due_date: "2026-10-23",
  reference: "PO-77", currency: "EUR", prices_are_incl_tax: false, paid_at: null, total_paid: "0.0", total_unpaid: "1264.5", total_unpaid_base: "1264.5",
  total_price_excl_tax: "1050.0", total_price_excl_tax_base: "1050.0", total_price_incl_tax: "1264.5", total_price_incl_tax_base: "1264.5", total_discount: "0.0",
  details: [
    { id: "466666666666666661", administration_id: A, tax_rate_id: tarief21.id, ledger_account_id: "1", amount: "1 x", amount_decimal: "1.0", description: "Websiteontwerp", price: "1000.0", period: null, row_order: 1, total_price_excl_tax_with_discount: "1000.0", total_price_excl_tax_with_discount_base: "1000.0" },
    { id: "466666666666666662", administration_id: A, tax_rate_id: tarief9.id, ledger_account_id: "1", amount: "2 x", amount_decimal: "2.0", description: "Boeken", price: "25.0", period: null, row_order: 2, total_price_excl_tax_with_discount: "50.0", total_price_excl_tax_with_discount_base: "50.0" },
  ].map((r) => r as unknown as MbVerkoopFactuur["details"][number]),
  tax_totals: [{ tax_rate_id: tarief21.id, taxable_amount: "1000.0", taxable_amount_base: "1000.0", tax_amount: "210.0", tax_amount_base: "210.0" }, { tax_rate_id: tarief9.id, taxable_amount: "50.0", taxable_amount_base: "50.0", tax_amount: "4.5", tax_amount_base: "4.5" }],
};
const mutatie = (i: number) => ({ id: (BigInt("500000000000000000") + BigInt(i)).toString(), administration_id: A, amount: i % 2 ? "-24.2" : "1210.0", code: null, date: "2026-10-05", message: `Omschrijving ${i}`, contra_account_name: "Klant BV", contra_account_number: "NL91RABO0315273637", state: "unprocessed", amount_open: "0.0", financial_account_id: "477777777777777777", currency: "EUR", version: 1760000000 + i });
const inkoop = { id: "488888888888888888", administration_id: A, contact_id: "400000000000000002", contact: { id: "400000000000000002", company_name: "Coolblue BV", firstname: null, lastname: null }, reference: "INK-1", date: "2026-10-01", due_date: "2026-10-15", state: "open", currency: "EUR", prices_are_incl_tax: true, total_price_excl_tax: "100.0", total_price_excl_tax_base: "100.0", total_price_incl_tax: "121.0", total_price_incl_tax_base: "121.0", details: [] };

draai("moneybird", async () => {
  let teller429 = 0;
  zetRoutes([
    { pad: "https://moneybird.com/api/v2/administrations.json", antwoord: { json: [{ id: A, name: "Studio Milronski", language: "nl", currency: "EUR", country: "NL", time_zone: "Europe/Amsterdam" }] } },
    { pad: `${B}/contacts.json`, antwoord: (v) => (v.url.searchParams.get("page") === "1"
      ? (teller429++ === 0 ? { status: 429, headers: { "Retry-After": "0", "RateLimit-Limit": "150", "RateLimit-Remaining": "0", "RateLimit-Reset": "1760000300" }, json: { error: "Too many requests" } } : { json: Array.from({ length: 100 }, (_, i) => contact(i)) })
      : { json: [contact(100)] }) },
    { pad: `${B}/tax_rates.json`, antwoord: { json: [tarief21, tarief9] } },
    { methode: "GET", pad: `${B}/sales_invoices/synchronization.json`, antwoord: { json: [{ id: factuur.id, version: 1 }] } },
    { methode: "POST", pad: `${B}/sales_invoices/synchronization.json`, antwoord: { json: [factuur] } },
    { methode: "GET", pad: `${B}/financial_mutations/synchronization.json`, antwoord: { json: Array.from({ length: 150 }, (_, i) => ({ id: (BigInt("500000000000000000") + BigInt(i)).toString(), version: 1760000000 + i })) } },
    { methode: "POST", pad: `${B}/financial_mutations/synchronization.json`, antwoord: (v) => ({ json: (JSON.parse(v.body).ids as string[]).map((id) => mutatie(Number(BigInt(id) - BigInt("500000000000000000")))) }) },
    { methode: "GET", pad: `${B}/documents/purchase_invoices/synchronization.json`, antwoord: { json: [{ id: inkoop.id, version: 3 }] } },
    { methode: "POST", pad: `${B}/documents/purchase_invoices/synchronization.json`, antwoord: { json: [inkoop] } },
  ]);
  const d = await haalMoneybirdData({ token: "mb_token" }, new Date("2020-01-01"), new Date("2026-10-11"));
  gelijk(new Set(d.mutaties.map((m) => m.id)).size, 150, "150 unieke mutatie-ids (ids als string, groter dan 2^53)");
  gelijk([d.administrationId, d.contacten.length, d.facturen.length, d.mutaties.length, d.inkoop.length], [A, 101, 1, 150, 1], "alles opgehaald: 2 pagina's contacten, 150 mutaties via synchronization");
  waar(verzoeken.every((v) => v.headers.get("authorization") === "Bearer mb_token"), "Bearer-token");
  gelijk(verzoeken.filter((v) => v.methode === "POST" && v.url.pathname.includes("financial_mutations")).map((v) => JSON.parse(v.body).ids.length), [100, 50], "POST in blokken van 100 ids");
  gelijk(verzoeken.find((v) => v.url.pathname.endsWith("financial_mutations/synchronization.json"))?.url.searchParams.get("filter"), "state:all,period:20200101..20261011", "expliciete periode (anders alleen dit jaar)");
  gelijk(verzoeken.filter((v) => v.url.pathname.endsWith("contacts.json")).length, 3, "429 met Retry-After opnieuw geprobeerd");

  const f = mbFactuurNaarData(d.facturen[0], d.btwTarieven)!;
  gelijk([f.nummer, f.subtotaal, f.btw, f.totaal, f.status, f.betaaldBedrag], ["2026-0042", 1050, 214.5, 1264.5, "verzonden", 0], "factuur: btw = incl − excl (geen total_tax)");
  gelijk(f.regels, [{ omschrijving: "Websiteontwerp", aantal: 1, prijs: 1000, btw: 21 }, { omschrijving: "Boeken", aantal: 2, prijs: 25, btw: 9 }], "regels met aantal uit amount_decimal en btw uit tax_rates");
  const incl = mbFactuurNaarData({ ...factuur, prices_are_incl_tax: true, details: [{ ...factuur.details[0], price: "1210.0" }] }, d.btwTarieven)!;
  gelijk(incl.regels[0].prijs, 1000, "prijzen inclusief btw omgerekend naar exclusief");
  gelijk(mbFactuurNaarData({ ...factuur, state: "draft", invoice_id: null }, []), null, "concept overgeslagen");

  zetRoutes([{ pad: "https://moneybird.com/api/v2/administrations.json", antwoord: { status: 401, json: { error: "Token is invalid", symbolic: { token: "invalid" } } } }]);
  await faalt(() => haalMoneybirdData({ token: "fout" }), /sleutel ongeldig.*401.*Token is invalid/, "401 met Moneybird-melding");
});
