/**
 * Live sandbox-tests tegen de echte API's. Elke dienst draait alleen als de sleutel in een env-variabele staat;
 * anders wordt hij overgeslagen. Alleen testsleutels: live-sleutels worden geweigerd. Er wordt niets in de database geschreven.
 * Uitleg per dienst (welke sleutel, waar aanmaken): docs/koppelingen-testen.md
 *
 *   npx tsx test/koppelingen-live.ts                 alle diensten waarvoor een sleutel is gezet
 *   npx tsx test/koppelingen-live.ts stripe paypal   alleen deze
 */
import { readFileSync } from "fs";
import { haalStripeRegels } from "../src/lib/kanalen/stripe";
import { maakMollieBetaling } from "../src/lib/facturen/mollie";
import { haalBetaling, haalMollieRegels } from "../src/lib/kanalen/mollie";
import { haalPaypalRegels } from "../src/lib/kanalen/paypal";
import { haalBolRegels } from "../src/lib/kanalen/bol";
import { haalShopifyRegels } from "../src/lib/kanalen/shopify";
import { haalWooRegels } from "../src/lib/kanalen/woocommerce";
import { haalMoneybirdData } from "../src/lib/import/moneybird";
import { haalEboekhoudenData } from "../src/lib/import/eboekhouden";
import { autorisatieVerzoek, ebApi, haalAspsps, haalEbSaldo, haalEbTransacties, type EbSessie } from "../src/lib/bank/enablebanking";

const env = (n: string) => process.env[n]?.trim() || undefined;
const dagenTerug = (n: number) => new Date(Date.now() - n * 864e5);
const gekozen = process.argv.slice(2);

type Test = { naam: string; nodig: string[]; draai: () => Promise<string> };
const tests: Test[] = [
  {
    naam: "stripe", nodig: ["STRIPE_TEST_SECRET_KEY"],
    draai: async () => {
      const k = env("STRIPE_TEST_SECRET_KEY")!;
      if (!/^(sk|rk)_test_/.test(k)) throw new Error("gebruik een testsleutel (sk_test_... of rk_test_...)");
      const r = await haalStripeRegels(k, dagenTerug(90));
      return `${r.length} regels uit payouts van de afgelopen 90 dagen (testmodus heeft vaak geen payouts; 0 is dan goed)`;
    },
  },
  {
    naam: "mollie", nodig: ["MOLLIE_TEST_API_KEY"],
    draai: async () => {
      const k = env("MOLLIE_TEST_API_KEY")!;
      if (!k.startsWith("test_")) throw new Error("gebruik de Test API-sleutel (test_...)");
      const b = await maakMollieBetaling(k, { bedrag: 1, valuta: "EUR", omschrijving: "Zelfboek koppelingstest", redirectUrl: "https://zelfboek.nl/betaald", metadata: { test: "koppelingen-live" } });
      const p = await haalBetaling(k, b.id);
      let extra = "";
      const org = env("MOLLIE_ACCESS_TOKEN");
      if (org) extra = `; settlements: ${(await haalMollieRegels(org, dagenTerug(90))).length} regels`;
      return `testbetaling ${b.id} status ${p.status}, checkout ${b.checkoutUrl}${extra}`;
    },
  },
  {
    naam: "paypal", nodig: ["PAYPAL_SANDBOX_CLIENT_ID", "PAYPAL_SANDBOX_CLIENT_SECRET"],
    draai: async () => {
      const r = await haalPaypalRegels({ clientId: env("PAYPAL_SANDBOX_CLIENT_ID")!, clientSecret: env("PAYPAL_SANDBOX_CLIENT_SECRET")!, sandbox: "true" }, dagenTerug(60));
      return `${r.length} regels uit de sandbox (laatste 60 dagen)`;
    },
  },
  {
    naam: "bol", nodig: ["BOL_CLIENT_ID", "BOL_CLIENT_SECRET"],
    draai: async () => {
      // De demo-omgeving geeft vaste voorbeeldfacturen (periode april-mei 2018) en raakt geen echte gegevens.
      const r = await haalBolRegels({ clientId: env("BOL_CLIENT_ID")!, clientSecret: env("BOL_CLIENT_SECRET")!, demo: "true" }, new Date("2018-04-12"), new Date("2018-05-09"));
      return `${r.length} regels uit de demo-omgeving: ${r.map((x) => `${x.categorie} ${x.bedrag}`).join(", ")}`;
    },
  },
  {
    naam: "enablebanking", nodig: ["ENABLE_BANKING_SANDBOX_APP_ID"],
    draai: async () => {
      const pem = env("ENABLE_BANKING_SANDBOX_KEY_PATH") ? readFileSync(env("ENABLE_BANKING_SANDBOX_KEY_PATH")!, "utf8") : env("ENABLE_BANKING_SANDBOX_PRIVATE_KEY")?.replace(/\\n/g, "\n");
      if (!pem) throw new Error("zet ook ENABLE_BANKING_SANDBOX_KEY_PATH (pad naar het .pem-bestand)");
      const cfg = { appId: env("ENABLE_BANKING_SANDBOX_APP_ID")!, privateKey: pem };
      const land = env("ENABLE_BANKING_SANDBOX_LAND") ?? "NL";
      const banken = await haalAspsps(cfg, land);
      const mock = banken.find((b) => /mock/i.test(b.name)) ?? banken[0];
      if (!mock) return `geen banken voor ${land}`;
      const code = env("ENABLE_BANKING_SANDBOX_CODE");
      if (!code) {
        const redirect = env("ENABLE_BANKING_REDIRECT_URL") ?? "https://zelfboek.nl/api/koppelingen/enablebanking/callback";
        const a = await ebApi<{ url: string }>(cfg, "/auth", { method: "POST", body: JSON.stringify(autorisatieVerzoek(mock, "live-test", redirect)) });
        return `${banken.length} banken in ${land}. Stap 2: open ${a.url} , rond de toestemming af bij "${mock.name}" en zet de code uit de terugkeer-URL (?code=...) in ENABLE_BANKING_SANDBOX_CODE`;
      }
      const s = await ebApi<EbSessie>(cfg, "/sessions", { method: "POST", body: JSON.stringify({ code }) });
      const uit: string[] = [];
      for (const acc of s.accounts) {
        const regels = await haalEbTransacties(cfg, acc.uid, dagenTerug(30).toISOString().slice(0, 10), acc.account_id?.iban);
        uit.push(`${acc.account_id?.iban ?? acc.uid}: ${regels.length} transacties, saldo ${await haalEbSaldo(cfg, acc.uid).catch(() => "?")}`);
      }
      return `sessie ${s.session_id} geldig tot ${s.access.valid_until}; ${uit.join("; ")}`;
    },
  },
  {
    naam: "shopify", nodig: ["SHOPIFY_DEV_SHOP"],
    draai: async () => {
      const r = await haalShopifyRegels({ shop: env("SHOPIFY_DEV_SHOP")!, accessToken: env("SHOPIFY_ACCESS_TOKEN"), clientId: env("SHOPIFY_CLIENT_ID"), clientSecret: env("SHOPIFY_CLIENT_SECRET") }, dagenTerug(90));
      return `${r.length} regels uit payouts`;
    },
  },
  {
    naam: "woocommerce", nodig: ["WOO_URL", "WOO_CONSUMER_KEY", "WOO_CONSUMER_SECRET"],
    draai: async () => `${(await haalWooRegels({ url: env("WOO_URL")!, consumerKey: env("WOO_CONSUMER_KEY")!, consumerSecret: env("WOO_CONSUMER_SECRET")! }, dagenTerug(90))).length} bestellingen`,
  },
  {
    naam: "moneybird", nodig: ["MONEYBIRD_SANDBOX_TOKEN"],
    draai: async () => {
      const d = await haalMoneybirdData({ token: env("MONEYBIRD_SANDBOX_TOKEN")!, administrationId: env("MONEYBIRD_ADMINISTRATION_ID") });
      return `administratie ${d.administrationId}: ${d.contacten.length} contacten, ${d.facturen.length} facturen, ${d.mutaties.length} mutaties, ${d.inkoop.length} inkoopfacturen`;
    },
  },
  {
    naam: "eboekhouden", nodig: ["EBOEKHOUDEN_TEST_TOKEN"],
    draai: async () => {
      const d = await haalEboekhoudenData(env("EBOEKHOUDEN_TEST_TOKEN")!);
      return `${d.relaties.length} relaties, ${d.mutaties.length} mutaties`;
    },
  },
];

(async () => {
  let fout = 0, gedraaid = 0;
  for (const t of tests) {
    if (gekozen.length && !gekozen.includes(t.naam)) continue;
    const mist = t.nodig.filter((n) => !env(n));
    if (mist.length) { console.log(`--  ${t.naam}: overgeslagen (zet ${mist.join(", ")})`); continue; }
    gedraaid++;
    try { console.log(`ok  ${t.naam}: ${await t.draai()}`); } catch (e) { fout++; console.log(`FOUT ${t.naam}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  console.log(`\n${gedraaid} live-test(s) gedraaid, ${fout} fout.`);
  process.exit(fout ? 1 : 0);
})();
