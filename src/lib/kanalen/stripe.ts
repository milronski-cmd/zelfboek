import Stripe from "stripe";
import { bewaarKanaalRegels, centen, kanaalConfig, voerKanaalUit, type KanaalRegel, type KanaalUitkomst } from "./basis";

/**
 * Stripe als verkoopkanaal: payouts als omzet (bruto), Stripe-kosten als betaalprovider.
 * Stripe Payments Europe (Ierland) factureert zonder btw: eu_dienst (verlegd).
 * Docs: https://docs.stripe.com/api/payouts/list en https://docs.stripe.com/api/balance_transactions/list
 * Bedragen zijn gehele centen (EUR is geen zero-decimal-valuta). Het filter payout= werkt alleen voor automatische payouts;
 * bij handmatige payouts valt de code terug op het payoutbedrag.
 * Config: { secretKey: "sk_live_..." } (of een restricted key rk_ met leesrecht op Payouts en Balance).
 */
const OVERSLAAN = new Set(["payout", "payout_cancel", "payout_failure", "payout_minimum_balance_hold", "payout_minimum_balance_release"]);
const KOSTEN = new Set(["stripe_fee", "tax_fee", "network_cost"]);

export function stripeClient(secretKey: string) {
  // fetch-client: werkt in elke runtime en is in tests te vervangen door een nep-fetch
  return new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient((...a: Parameters<typeof fetch>) => fetch(...a)), maxNetworkRetries: 2 });
}

export async function haalStripeRegels(secretKey: string, vanaf: Date): Promise<KanaalRegel[]> {
  const stripe = stripeClient(secretKey);
  const regels: KanaalRegel[] = [];
  const payouts = stripe.payouts.list({ status: "paid", arrival_date: { gte: Math.floor(vanaf.getTime() / 1000) }, limit: 100 });
  for await (const p of payouts) {
    const d = new Date(p.arrival_date * 1000);
    let bruto = 0;
    let kosten = 0;
    let gevonden = false;
    if (p.automatic) {
      for await (const t of stripe.balanceTransactions.list({ payout: p.id, limit: 100 })) {
        if (OVERSLAAN.has(t.type)) continue;
        gevonden = true;
        if (KOSTEN.has(t.type)) { kosten += -t.amount / 100; continue; }  // losse Stripe-kosten (Radar, Billing) zijn negatief
        bruto += t.amount / 100;
        kosten += t.fee / 100;
      }
    }
    bruto = centen(bruto);
    kosten = centen(kosten);
    if (!gevonden) { bruto = p.amount / 100; kosten = 0; }
    if (!bruto && !kosten) continue;
    regels.push({ datum: d, bedrag: bruto, tegenpartij: "Stripe", omschrijving: `Uitbetaling ${p.id}`, externId: p.id, categorie: "omzet", btwCode: "21" });
    if (kosten > 0) regels.push({ datum: d, bedrag: -kosten, tegenpartij: "Stripe Payments Europe", omschrijving: `Stripe-kosten ${p.id}`, externId: `${p.id}-fee`, categorie: "betaalprovider", btwCode: "eu_dienst" });
  }
  return regels;
}

export async function haalTransacties(ondernemingId: string, vanaf: Date): Promise<KanaalUitkomst> {
  return voerKanaalUit(ondernemingId, "stripe", async () => {
    const cfg = await kanaalConfig<{ secretKey: string }>(ondernemingId, "stripe", ["secretKey"], "Stripe");
    return bewaarKanaalRegels(ondernemingId, "stripe", await haalStripeRegels(cfg.secretKey, vanaf));
  });
}
