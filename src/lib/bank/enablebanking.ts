import { createSign } from "crypto";
import { db } from "@/lib/db";
import { bewaarKoppeling, koppelingStatus, leesKoppeling } from "@/lib/koppelingen";
import { maakRegel, type BankRegel } from "./csv";
import { importeerRegels } from "./importeer";

/**
 * PSD2-bankkoppeling via Enable Banking (enablebanking.com). Docs: https://enablebanking.com/docs/api/reference/
 * Config in koppeling "enablebanking": { appId, privateKey (PEM), sessionId?, accounts?: [{uid, iban, naam}], validUntil? }.
 * Zonder appId/privateKey (ook niet in env) geeft elke functie een duidelijke Nederlandse fout.
 *
 * - Authenticatie: per verzoek een JWT (RS256, kid = applicatie-id, iss enablebanking.com, aud api.enablebanking.com, maximaal 86400 s geldig).
 * - Sandbox en productie gebruiken dezelfde URL; de omgeving hoort bij de applicatie (aangemaakt in het Control Panel).
 * - Verloop: GET /aspsps → POST /auth (url voor de klant) → callback ?code= → POST /sessions → GET /accounts/{uid}/transactions.
 * - Toestemming kan niet langer dan maximum_consent_validity van de bank (in seconden, meestal 90 of 180 dagen).
 * - Een verlopen of ingetrokken sessie geeft fout EXPIRED_SESSION, REVOKED_SESSION of CLOSED_SESSION; dan moet de klant opnieuw koppelen.
 */
const API = "https://api.enablebanking.com";
const MAX_TOESTEMMING_DAGEN = 180;

export type EbConfig = { appId?: string; privateKey?: string; sessionId?: string; validUntil?: string; accounts?: { uid: string; iban: string; naam: string }[] };

export class EnableBankingFout extends Error {
  constructor(public status: number, public code: string | undefined, bericht: string) { super(bericht); }
  get sessieVoorbij() { return ["EXPIRED_SESSION", "REVOKED_SESSION", "CLOSED_SESSION", "SESSION_DOES_NOT_EXIST", "ACCOUNT_DOES_NOT_EXIST"].includes(this.code ?? ""); }
}

async function config(ondernemingId: string): Promise<EbConfig> {
  const k = await leesKoppeling<EbConfig>(ondernemingId, "enablebanking");
  const appId = k?.appId || process.env.ENABLE_BANKING_APP_ID;
  const privateKey = k?.privateKey || process.env.ENABLE_BANKING_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!appId || !privateKey) throw new Error("Enable Banking is niet ingesteld: vul het applicatie-id en de private key in bij Koppelingen.");
  return { ...(k ?? {}), appId, privateKey };
}

export function ebJwt(appId: string, privateKey: string, nu = Math.floor(Date.now() / 1000)) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const kop = b64({ typ: "JWT", alg: "RS256", kid: appId });
  const body = b64({ iss: "enablebanking.com", aud: "api.enablebanking.com", iat: nu, exp: nu + 3600 });
  const signer = createSign("RSA-SHA256");
  signer.update(`${kop}.${body}`);
  return `${kop}.${body}.${signer.sign(privateKey, "base64url")}`;
}

/** Eén API-verzoek. Fouten volgen ErrorResponse { code, message, error, detail }. 429 (ASPSP_RATE_LIMIT_EXCEEDED) wordt niet herhaald: banken staan 4 opvragingen per dag toe. */
export async function ebApi<T>(cfg: EbConfig, pad: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${pad}`, {
    ...init,
    headers: { Authorization: `Bearer ${ebJwt(cfg.appId!, cfg.privateKey!)}`, "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    let code: string | undefined;
    let bericht = t.slice(0, 200) || r.statusText;
    try {
      const j = JSON.parse(t) as { message?: string; error?: string; detail?: unknown };
      code = j.error;
      bericht = [j.message, typeof j.detail === "string" ? j.detail : undefined].filter(Boolean).join(": ") || bericht;
    } catch { /* geen JSON */ }
    const nl = code === "ASPSP_RATE_LIMIT_EXCEEDED" ? "de bank staat vandaag geen nieuwe opvraging meer toe, morgen gaat het weer"
      : code === "EXPIRED_SESSION" || code === "REVOKED_SESSION" || code === "CLOSED_SESSION" ? "de toestemming bij de bank is verlopen of ingetrokken; koppel opnieuw"
      : code === "UNAUTHORIZED_ACCESS" || r.status === 401 ? "applicatie-id of private key klopt niet"
      : undefined;
    throw new EnableBankingFout(r.status, code, `Enable Banking ${r.status}${code ? ` ${code}` : ""}: ${nl ?? bericht}`);
  }
  return (await r.json()) as T;
}

export type Aspsp = { name: string; country: string; logo?: string; bic?: string; maximum_consent_validity?: number; psu_types?: string[]; beta?: boolean };

/** GET /aspsps geeft { aspsps: [...] } (geen losse lijst). */
export async function haalAspsps(cfg: EbConfig, land = "NL"): Promise<Aspsp[]> {
  const r = await ebApi<{ aspsps: Aspsp[] }>(cfg, `/aspsps?country=${encodeURIComponent(land)}&service=AIS`);
  return r.aspsps ?? [];
}

export async function beschikbareBanken(ondernemingId: string, land = "NL") {
  return haalAspsps(await config(ondernemingId), land);
}

/** Banknaam uit onze keuzelijst ("ABN AMRO", "ING") koppelen aan de exacte ASPSP-naam van Enable Banking. */
export function kiesAspsp(lijst: Aspsp[], naam: string): Aspsp | undefined {
  const plat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = plat(naam);
  return lijst.find((a) => plat(a.name) === n) ?? lijst.find((a) => plat(a.name).startsWith(n) || n.startsWith(plat(a.name)));
}

/** Body voor POST /auth: geldigheid begrensd op wat de bank toestaat, zakelijk als de bank dat ondersteunt. */
export function autorisatieVerzoek(aspsp: Aspsp, ondernemingId: string, redirectUrl: string, nu = Date.now()) {
  const maxSec = aspsp.maximum_consent_validity ?? 90 * 86400;
  const sec = Math.min(maxSec, MAX_TOESTEMMING_DAGEN * 86400) - 3600; // een uur marge
  const psuType = !aspsp.psu_types || aspsp.psu_types.includes("business") ? "business" : "personal";
  return {
    access: { valid_until: new Date(nu + sec * 1000).toISOString() },
    aspsp: { name: aspsp.name, country: aspsp.country },
    state: ondernemingId,
    redirect_url: redirectUrl,
    psu_type: psuType,
    language: "nl",
  };
}

/** Stap 1: autorisatie-url voor de klant om bij zijn bank toestemming te geven. */
export async function startAutorisatie(ondernemingId: string, bankNaam: string, redirectUrl: string, land = "NL") {
  const cfg = await config(ondernemingId);
  const lijst = await haalAspsps(cfg, land);
  const aspsp = kiesAspsp(lijst, bankNaam);
  if (!aspsp) throw new Error(`Enable Banking kent de bank "${bankNaam}" niet (${land}). Beschikbaar: ${lijst.map((a) => a.name).slice(0, 15).join(", ")}.`);
  const r = await ebApi<{ url: string; authorization_id: string }>(cfg, "/auth", { method: "POST", body: JSON.stringify(autorisatieVerzoek(aspsp, ondernemingId, redirectUrl)) });
  return r.url;
}

export type EbSessie = {
  session_id: string;
  access: { valid_until: string };
  aspsp?: { name: string; country: string };
  psu_type?: string;
  accounts: { uid: string; account_id?: { iban?: string; other?: { identification?: string } }; name?: string; product?: string; currency?: string; cash_account_type?: string }[];
};

/** Stap 2: callback met ?code= → sessie en rekeningen opslaan. */
export async function rondAutorisatieAf(ondernemingId: string, code: string) {
  const cfg = await config(ondernemingId);
  const s = await ebApi<EbSessie>(cfg, "/sessions", { method: "POST", body: JSON.stringify({ code }) });
  const accounts = (s.accounts ?? []).map((a) => ({ uid: a.uid, iban: (a.account_id?.iban ?? "").replace(/\s/g, ""), naam: a.name ?? a.product ?? "Rekening" }));
  const k = await leesKoppeling<EbConfig>(ondernemingId, "enablebanking");
  await bewaarKoppeling(ondernemingId, "enablebanking", {
    appId: k?.appId ?? "", privateKey: k?.privateKey ?? "",
    sessionId: s.session_id, validUntil: s.access.valid_until, accounts,
  }, "Enable Banking");
  for (const a of accounts) {
    if (!a.iban) continue;
    await db.bankrekening.upsert({
      where: { ondernemingId_iban: { ondernemingId, iban: a.iban } },
      update: { bron: "psd2", psd2SessieId: s.session_id, psd2AccountId: a.uid, psd2Verloopt: new Date(s.access.valid_until) },
      create: { ondernemingId, iban: a.iban, naam: a.naam, bron: "psd2", psd2SessieId: s.session_id, psd2AccountId: a.uid, psd2Verloopt: new Date(s.access.valid_until) },
    });
  }
  return accounts.length;
}

/** Sessiestatus: AUTHORIZED is bruikbaar; EXPIRED, REVOKED, CLOSED, CANCELLED, INVALID betekent opnieuw koppelen. */
export async function sessieStatus(cfg: EbConfig, sessionId: string): Promise<{ status: string; validUntil?: string }> {
  const s = await ebApi<{ status: string; access?: { valid_until?: string } }>(cfg, `/sessions/${encodeURIComponent(sessionId)}`);
  return { status: s.status, validUntil: s.access?.valid_until };
}

export type EbTx = {
  entry_reference?: string | null; transaction_id?: string | null;
  booking_date?: string | null; value_date?: string | null; transaction_date?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status?: "BOOK" | "PDNG" | "CNCL" | "HOLD" | "OTHR" | "RJCT" | "SCHD" | string;
  creditor?: { name?: string } | null; debtor?: { name?: string } | null;
  creditor_account?: { iban?: string } | null; debtor_account?: { iban?: string } | null;
  remittance_information?: string[] | null;
};

/** Eén transactie naar een bankregel. Alleen geboekte transacties (status BOOK); het teken komt uit credit_debit_indicator. */
export function ebNaarRegel(t: EbTx, eigenIban?: string): BankRegel | null {
  if (t.status && t.status !== "BOOK") return null;
  const bedrag = Math.abs(parseFloat(t.transaction_amount.amount)) * (t.credit_debit_indicator === "DBIT" ? -1 : 1);
  const bij = t.credit_debit_indicator === "CRDT";
  const tegen = (bij ? t.debtor?.name : t.creditor?.name) ?? "";
  const iban = bij ? t.debtor_account?.iban : t.creditor_account?.iban;
  const d = new Date(t.booking_date ?? t.value_date ?? t.transaction_date ?? "");
  return maakRegel(d, bedrag, tegen, (t.remittance_information ?? []).join(" "), iban ?? undefined, eigenIban, t.entry_reference ?? t.transaction_id ?? "");
}

/** Alle transacties van één rekening vanaf een datum, met paginering via continuation_key. */
export async function haalEbTransacties(cfg: EbConfig, accountUid: string, vanaf: string, eigenIban?: string): Promise<BankRegel[]> {
  const regels: BankRegel[] = [];
  let continuation: string | undefined;
  let rondes = 0;
  do {
    const q = new URLSearchParams({ date_from: vanaf });
    if (continuation) q.set("continuation_key", continuation);
    const r = await ebApi<{ transactions: EbTx[]; continuation_key?: string | null }>(cfg, `/accounts/${encodeURIComponent(accountUid)}/transactions?${q}`);
    for (const t of r.transactions ?? []) {
      const reg = ebNaarRegel(t, eigenIban);
      if (reg) regels.push(reg);
    }
    continuation = r.continuation_key ?? undefined;
  } while (continuation && ++rondes < 500);
  return regels;
}

/** Saldo: bij voorkeur de geboekte eindstand (CLBD), anders beschikbaar (ITAV/CLAV) of verwacht (XPCD). */
export async function haalEbSaldo(cfg: EbConfig, accountUid: string): Promise<number | null> {
  const r = await ebApi<{ balances: { balance_amount: { amount: string; currency: string }; balance_type: string }[] }>(cfg, `/accounts/${encodeURIComponent(accountUid)}/balances`);
  const voorkeur = ["CLBD", "ITBD", "ITAV", "CLAV", "XPCD", "OPBD"];
  const rang = (t: string) => (voorkeur.includes(t) ? voorkeur.indexOf(t) : voorkeur.length);
  const b = [...(r.balances ?? [])].sort((x, y) => rang(x.balance_type) - rang(y.balance_type))[0];
  return b ? parseFloat(b.balance_amount.amount) : null;
}

/** Transacties van alle PSD2-rekeningen ophalen en importeren. */
export async function syncPsd2(ondernemingId: string, vanaf?: Date): Promise<{ nieuw: number; fouten: string[] }> {
  const fouten: string[] = [];
  let nieuw = 0;
  let cfg: EbConfig;
  try { cfg = await config(ondernemingId); } catch (e) { return { nieuw: 0, fouten: [e instanceof Error ? e.message : String(e)] }; }
  if (!cfg.sessionId) return { nieuw: 0, fouten: ["Geen bank gekoppeld via PSD2."] };
  const verlopen = async () => {
    await koppelingStatus(ondernemingId, "enablebanking", "verlopen", "Toestemming bij de bank is verlopen; koppel opnieuw.");
    return { nieuw: 0, fouten: ["Toestemming bij de bank is verlopen; koppel opnieuw."] };
  };
  if (cfg.validUntil && new Date(cfg.validUntil) < new Date()) return verlopen();
  try {
    const s = await sessieStatus(cfg, cfg.sessionId);
    if (s.status !== "AUTHORIZED") return verlopen();
  } catch (e) {
    if (e instanceof EnableBankingFout && e.sessieVoorbij) return verlopen();
    // anders: gewoon doorgaan, de transactie-opvraging geeft zelf een fout
  }
  const rekeningen = await db.bankrekening.findMany({ where: { ondernemingId, bron: "psd2", psd2AccountId: { not: null } } });
  for (const rek of rekeningen) {
    try {
      const start = (vanaf ?? rek.laatsteSync ?? new Date(Date.now() - 90 * 864e5)).toISOString().slice(0, 10);
      const regels = await haalEbTransacties(cfg, rek.psd2AccountId!, start, rek.iban);
      try {
        const saldo = await haalEbSaldo(cfg, rek.psd2AccountId!);
        if (saldo !== null) await db.bankrekening.update({ where: { id: rek.id }, data: { saldo } });
      } catch { /* saldo is optioneel */ }
      const uit = await importeerRegels(ondernemingId, regels, { bron: "psd2", bankrekeningId: rek.id, eigenIban: rek.iban });
      nieuw += uit.nieuw;
      if (uit.aiFout) fouten.push(uit.aiFout);
    } catch (e) {
      if (e instanceof EnableBankingFout && e.sessieVoorbij) return verlopen();
      fouten.push(`${rek.naam}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await koppelingStatus(ondernemingId, "enablebanking", fouten.length ? "fout" : "actief", fouten[0]);
  return { nieuw, fouten };
}
