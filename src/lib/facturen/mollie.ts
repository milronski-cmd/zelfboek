import { db } from "@/lib/db";
import { leesKoppeling } from "@/lib/koppelingen";
import { foutTekst } from "@/lib/kanalen/basis";

/**
 * Betaallink via de Mollie Payments API (https://docs.mollie.com/reference/create-payment).
 * Metadata { factuurId } zodat de webhook (module A) de factuur kan afboeken.
 * Geeft null terug als er geen Mollie-koppeling is.
 */
export type MollieBetaalVerzoek = {
  bedrag: number;
  valuta: string;
  omschrijving: string;
  redirectUrl: string;
  webhookUrl?: string;
  metadata?: Record<string, string>;
};

/**
 * Mollie weigert een webhookUrl die het niet kan bereiken (localhost, privé-adressen).
 * Lokaal laten we hem daarom weg; de status komt dan bij het openen van de factuur alsnog via de API.
 */
export function bereikbareWebhook(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const h = new URL(url).hostname;
    if (h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|\[?::1\]?$)/.test(h) || !h.includes(".")) return undefined;
    return url;
  } catch { return undefined; }
}

/** Eén betaling aanmaken; raakt de database niet. Bedragen gaan als string met precies twee decimalen. */
export async function maakMollieBetaling(apiKey: string, v: MollieBetaalVerzoek): Promise<{ id: string; checkoutUrl: string | null; status: string }> {
  if (!/^(live|test)_/.test(apiKey)) throw new Error("Mollie: gebruik voor betaallinks de API-sleutel (live_... of test_...), niet het organisatie-toegangstoken.");
  const webhookUrl = bereikbareWebhook(v.webhookUrl);
  const res = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: { currency: v.valuta, value: v.bedrag.toFixed(2) },
      description: v.omschrijving.slice(0, 255),
      redirectUrl: v.redirectUrl,
      ...(webhookUrl ? { webhookUrl } : {}),
      locale: "nl_NL",
      metadata: v.metadata ?? null,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Mollie weigerde de betaallink (${res.status}): ${foutTekst(t).slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string; status: string; _links: { checkout?: { href: string } | null } };
  return { id: data.id, status: data.status, checkoutUrl: data._links.checkout?.href ?? null };
}

export async function maakBetaallink(factuurId: string, ondernemingId: string): Promise<string | null> {
  const cfg = await leesKoppeling<{ apiKey: string }>(ondernemingId, "mollie");
  if (!cfg?.apiKey) return null;
  const f = await db.factuur.findFirstOrThrow({ where: { id: factuurId, ondernemingId }, include: { onderneming: true } });
  if (f.betaalLinkUrl) return f.betaalLinkUrl;
  const openstaand = Math.max(0, f.totaal - f.betaaldBedrag);
  if (openstaand <= 0) return null;
  const basis = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const b = await maakMollieBetaling(cfg.apiKey, {
    bedrag: openstaand,
    valuta: f.valuta,
    omschrijving: `Factuur ${f.nummer} ${f.onderneming.naam}`,
    redirectUrl: `${basis}/betaald?f=${encodeURIComponent(f.nummer)}`,
    webhookUrl: `${basis}/api/webhooks/mollie?o=${encodeURIComponent(ondernemingId)}`,
    metadata: { factuurId: f.id, ondernemingId },
  });
  await db.factuur.update({ where: { id: f.id }, data: { betaalLinkId: b.id, betaalLinkUrl: b.checkoutUrl } });
  return b.checkoutUrl;
}
