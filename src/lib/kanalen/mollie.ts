import { bedragUit, bewaarKanaalRegels, centen, haalJson, kanaalConfig, voerKanaalUit, type KanaalRegel, type KanaalUitkomst } from "./basis";

/**
 * Mollie: uitbetalingen (settlements) als omzet, de ingehouden kosten als betaalprovider (Mollie B.V., btw 21).
 * Docs: https://docs.mollie.com/reference/list-settlements
 * De Settlements API accepteert alleen een organisatie-toegangstoken (access_..., scope settlements.read) of OAuth,
 * geen API-sleutel (live_/test_). Config: { apiKey: "live_..." (betaallinks), accessToken?: "access_..." (uitbetalingen) }.
 * Bedragen zijn decimale strings ({ currency, value: "10.00" }); paginering via _links.next.href (limit max 250).
 */
type Geld = { currency?: string; value: string };
type Post = { description: string; method?: string | null; count?: number; amountNet?: Geld; amountVat?: Geld | null; amountGross: Geld };
export type MollieSettlement = {
  id: string;
  reference?: string | null;
  createdAt: string;
  settledAt?: string | null;
  status: "open" | "pending" | "processing" | "processing-at-bank" | "paidout" | "failed" | string;
  amount: Geld;
  periods?: Record<string, Record<string, { costs?: Post[]; revenue?: Post[]; invoiceId?: string | null; invoiceReference?: string | null }>>;
};

export async function haalMollieRegels(token: string, vanaf: Date): Promise<KanaalRegel[]> {
  if (/^(live|test)_/.test(token)) throw new Error("Mollie: voor uitbetalingen is een organisatie-toegangstoken (begint met access_) met settlements.read nodig, geen API-sleutel.");
  const headers = { Authorization: `Bearer ${token}` };
  const regels: KanaalRegel[] = [];
  let url: string | null = "https://api.mollie.com/v2/settlements?limit=250";
  while (url) {
    const r: { _embedded?: { settlements: MollieSettlement[] }; _links?: { next?: { href: string } | null } } = await haalJson(url, { headers }, "Mollie");
    let klaar = false;
    for (const s of r._embedded?.settlements ?? []) {
      // De lijst loopt van nieuw naar oud: stoppen zodra de uitbetaling vóór 'vanaf' is aangemaakt
      if (new Date(s.createdAt) < vanaf) { klaar = true; break; }
      if (s.status !== "paidout") continue;
      const d = new Date(s.settledAt ?? s.createdAt);
      let kosten = 0;
      for (const jaar of Object.values(s.periods ?? {})) for (const maand of Object.values(jaar)) for (const c of maand.costs ?? []) kosten += bedragUit(c.amountGross.value);
      kosten = centen(kosten);
      const netto = bedragUit(s.amount.value);
      const ref = s.reference ?? s.id;
      regels.push({ datum: d, bedrag: centen(netto + kosten), tegenpartij: "Mollie", omschrijving: `Uitbetaling ${ref}`, externId: s.id, categorie: "omzet", btwCode: "21" });
      if (kosten > 0) regels.push({ datum: d, bedrag: -kosten, tegenpartij: "Mollie", omschrijving: `Transactiekosten ${ref}`, externId: `${s.id}-kosten`, categorie: "betaalprovider", btwCode: "21" });
    }
    url = klaar ? null : (r._links?.next?.href ?? null);
  }
  return regels;
}

export async function haalTransacties(ondernemingId: string, vanaf: Date): Promise<KanaalUitkomst> {
  return voerKanaalUit(ondernemingId, "mollie", async () => {
    const cfg = await kanaalConfig<{ apiKey: string; accessToken: string }>(ondernemingId, "mollie", [], "Mollie");
    const token = cfg.accessToken || cfg.apiKey;
    if (!token) throw new Error("Mollie: vul een organisatie-toegangstoken in bij Koppelingen.");
    return bewaarKanaalRegels(ondernemingId, "mollie", await haalMollieRegels(token, vanaf));
  });
}

/** Betaling ophalen (voor de webhook). Docs: https://docs.mollie.com/reference/get-payment */
export async function haalBetaling(apiKey: string, paymentId: string) {
  return haalJson<{ id: string; status: string; amount: { value: string; currency: string }; metadata?: { factuurId?: string } | null; paidAt?: string }>(
    `https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${apiKey}` } }, "Mollie",
  );
}
