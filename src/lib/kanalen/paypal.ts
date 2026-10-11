import Papa from "papaparse";
import { bewaarKanaalRegels, haalJson, kanaalConfig, voerKanaalUit, type KanaalRegel, type KanaalUitkomst } from "./basis";
import { datum, getal } from "@/lib/bank/csv";

/**
 * PayPal: ontvangen betalingen als omzet, PayPal-kosten als betaalprovider (PayPal Europe, Luxemburg: eu_dienst).
 * Via de REST API (config { clientId, clientSecret, sandbox? }) of via het CSV-activiteitenrapport (importeerPaypalCsv).
 * Docs: https://developer.paypal.com/api/transaction-search/v1/ (schema: .../v1/schema.json), OAuth: https://developer.paypal.com/api/rest/authentication/
 * - start_date/end_date in RFC 3339 met seconden, maximaal 31 dagen per verzoek; page_size max 500; total_pages in het antwoord;
 * - bedragen zijn decimale strings, fee_amount is negatief; transaction_status S = voltooid;
 * - nieuwe transacties verschijnen pas na maximaal 3 uur.
 * Eventcodes (https://developer.paypal.com/docs/transaction-search/transaction-event-codes/): T00 betalingen, T01 losse kosten,
 * T02 valutawissel, T03/T04 bank in/uit, T05-T07 kaart, T11 terugboekingen, T15-T22 blokkades, reserves en interne verplaatsingen.
 */
const OVERSLAAN = /^T0[2-7]|^T1[5-9]|^T2[0-2]/;

export type PaypalConfig = { clientId: string; clientSecret: string; sandbox?: string };
export const paypalBasis = (cfg: Pick<PaypalConfig, "sandbox">) => (cfg.sandbox === "true" ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com");

export async function paypalToken(cfg: PaypalConfig) {
  const r = await fetch(`${paypalBasis(cfg)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`PayPal: client-id of secret ongeldig (${r.status}).`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export type PpTx = {
  transaction_info: { transaction_id: string; transaction_initiation_date: string; transaction_amount: { currency_code?: string; value: string }; fee_amount?: { currency_code?: string; value: string }; transaction_event_code: string; transaction_status: string; transaction_subject?: string; transaction_note?: string };
  payer_info?: { payer_name?: { given_name?: string; surname?: string; alternate_full_name?: string }; email_address?: string };
};

const rfc3339 = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

export async function haalPaypalRegels(cfg: PaypalConfig, vanaf: Date, nu = new Date()): Promise<KanaalRegel[]> {
  const t = await paypalToken(cfg);
  const regels: KanaalRegel[] = [];
  let start = new Date(vanaf);
  while (start < nu) {
    const eind = new Date(Math.min(start.getTime() + 31 * 864e5 - 1000, nu.getTime()));
    for (let page = 1; page <= 100; page++) {
      const q = new URLSearchParams({ start_date: rfc3339(start), end_date: rfc3339(eind), fields: "transaction_info,payer_info", page_size: "500", page: String(page) });
      const r = await haalJson<{ transaction_details?: PpTx[]; total_pages?: number }>(
        `${paypalBasis(cfg)}/v1/reporting/transactions?${q}`, { headers: { Authorization: `Bearer ${t}`, Accept: "application/json" } }, "PayPal",
      );
      for (const x of r.transaction_details ?? []) regels.push(...paypalNaarRegels(x));
      if (page >= (r.total_pages ?? 1)) break;
    }
    start = new Date(eind.getTime() + 1000);
  }
  return regels;
}

export async function haalTransacties(ondernemingId: string, vanaf: Date): Promise<KanaalUitkomst> {
  return voerKanaalUit(ondernemingId, "paypal", async () => {
    const cfg = await kanaalConfig<PaypalConfig>(ondernemingId, "paypal", ["clientId", "clientSecret"], "PayPal");
    return bewaarKanaalRegels(ondernemingId, "paypal", await haalPaypalRegels(cfg, vanaf));
  });
}

export function paypalNaarRegels(x: PpTx): KanaalRegel[] {
  const i = x.transaction_info;
  if (i.transaction_status !== "S") return [];
  const code = i.transaction_event_code ?? "";
  if (OVERSLAAN.test(code)) return [];
  const bedrag = parseFloat(i.transaction_amount.value) || 0;
  const fee = Math.abs(parseFloat(i.fee_amount?.value ?? "0") || 0);
  const d = new Date(i.transaction_initiation_date);
  if (/^T01/.test(code)) {
    // Losse PayPal-kosten (bijv. chargeback- of valutakosten) zijn geen omzet
    return bedrag ? [{ datum: d, bedrag: -Math.abs(bedrag), tegenpartij: "PayPal (Europe)", omschrijving: i.transaction_subject || `PayPal-kosten ${i.transaction_id}`, externId: i.transaction_id, categorie: "betaalprovider", btwCode: "eu_dienst" }] : [];
  }
  const pn = x.payer_info?.payer_name;
  const naam = pn?.alternate_full_name || [pn?.given_name, pn?.surname].filter(Boolean).join(" ") || x.payer_info?.email_address || "PayPal";
  const oms = i.transaction_subject || i.transaction_note || `PayPal ${i.transaction_id}`;
  const uit: KanaalRegel[] = [];
  if (bedrag) uit.push({ datum: d, bedrag, tegenpartij: naam, omschrijving: oms, externId: i.transaction_id, categorie: bedrag > 0 ? "omzet" : "klant_terugbetaling", btwCode: "21" });
  if (fee > 0) uit.push({ datum: d, bedrag: -fee, tegenpartij: "PayPal (Europe)", omschrijving: `PayPal-kosten ${i.transaction_id}`, externId: `${i.transaction_id}-fee`, categorie: "betaalprovider", btwCode: "eu_dienst" });
  return uit;
}

/** CSV-activiteitenrapport van PayPal (Rapporten → Activiteiten downloaden, alle kolommen). */
export async function importeerPaypalCsv(ondernemingId: string, tekst: string): Promise<KanaalUitkomst> {
  const { data } = Papa.parse<Record<string, string>>(tekst.replace(/^﻿/, ""), { header: true, skipEmptyLines: true });
  const regels: KanaalRegel[] = [];
  for (const r of data) {
    const k = (re: RegExp) => { const key = Object.keys(r).find((x) => re.test(x.trim())); return key ? (r[key] ?? "").trim() : ""; };
    const status = k(/^Status$/i);
    if (status && !/^(Completed|Voltooid)$/i.test(status)) continue;
    const bruto = getal(k(/^(Gross|Bruto)$/i));
    const fee = Math.abs(getal(k(/^(Fee|Kosten)$/i)));
    const id = k(/^(Transaction ID|Transactiereferentie)$/i);
    const type = k(/^(Type)$/i);
    if (!bruto || !id || /overboeking|withdrawal|bank|opname/i.test(type)) continue;
    const d = datum(k(/^(Date|Datum)$/i));
    const naam = k(/^(Name|Naam)$/i) || k(/^(From Email Address|E-mailadres afzender)$/i) || "PayPal";
    const oms = k(/^(Item Title|Artikelnaam|Subject|Onderwerp)$/i) || `${type} ${id}`;
    regels.push({ datum: d, bedrag: bruto, tegenpartij: naam, omschrijving: oms, externId: id, categorie: bruto > 0 ? "omzet" : "klant_terugbetaling", btwCode: "21" });
    if (fee > 0) regels.push({ datum: d, bedrag: -fee, tegenpartij: "PayPal (Europe)", omschrijving: `PayPal-kosten ${id}`, externId: `${id}-fee`, categorie: "betaalprovider", btwCode: "eu_dienst" });
  }
  if (regels.length === 0) return { nieuw: 0, fouten: ["Geen PayPal-regels herkend. Gebruik het activiteitenrapport (CSV, alle kolommen)."] };
  return { nieuw: await bewaarKanaalRegels(ondernemingId, "paypal", regels), fouten: [] };
}
