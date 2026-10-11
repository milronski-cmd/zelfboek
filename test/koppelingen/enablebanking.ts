/**
 * Enable Banking API (PSD2).
 * Fixtures naar https://enablebanking.com/docs/api/reference/ : JWT-eisen (RS256, kid, iss, aud, max 86400 s),
 * GET /aspsps → { aspsps: [...] }, POST /auth → { url, authorization_id, psu_id_hash }, POST /sessions → { session_id, accounts, aspsp, psu_type, access },
 * GET /sessions/{id} → { status, ... }, GET /accounts/{uid}/transactions → { transactions, continuation_key },
 * GET /accounts/{uid}/balances → { balances }, ErrorResponse { message, code, error, detail }.
 */
import { generateKeyPairSync, createVerify } from "crypto";
import { draai, faalt, gelijk, verzoeken, waar, zetRoutes } from "./nep-fetch";
import { autorisatieVerzoek, ebApi, ebJwt, EnableBankingFout, haalAspsps, haalEbSaldo, haalEbTransacties, kiesAspsp, sessieStatus, type EbSessie, type EbTx } from "../../src/lib/bank/enablebanking";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const cfg = { appId: "6c1d8e2a-1234-4e5f-9a7b-0123456789ab", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };

const aspsps = { aspsps: [
  { name: "ABN AMRO", country: "NL", logo: "https://enablebanking.com/brands/NL/ABN_AMRO/", psu_types: ["personal", "business"], auth_methods: [], maximum_consent_validity: 15552000, sandbox: null, beta: false, bic: "ABNANL2A", required_psu_headers: [], payments: [] },
  { name: "ING", country: "NL", logo: "https://enablebanking.com/brands/NL/ING/", psu_types: ["personal", "business"], auth_methods: [], maximum_consent_validity: 7776000, beta: false, bic: "INGBNL2A", required_psu_headers: [], payments: [] },
  { name: "bunq", country: "NL", logo: "https://enablebanking.com/brands/NL/bunq/", psu_types: ["personal"], auth_methods: [], maximum_consent_validity: 7776000, beta: false, bic: "BUNQNL2A", required_psu_headers: [], payments: [] },
] };

const tx = (ref: string, bedrag: string, cd: "CRDT" | "DBIT", status: string, naam: string, iban: string, info: string[]): EbTx & Record<string, unknown> => ({
  entry_reference: ref, merchant_category_code: null, transaction_amount: { currency: "EUR", amount: bedrag },
  creditor: cd === "DBIT" ? { name: naam } : { name: "Studio Milronski" }, creditor_account: cd === "DBIT" ? { iban } : { iban: "NL02ABNA0123456789" },
  debtor: cd === "CRDT" ? { name: naam } : { name: "Studio Milronski" }, debtor_account: cd === "CRDT" ? { iban } : { iban: "NL02ABNA0123456789" },
  bank_transaction_code: { description: "SEPA Credit Transfer", code: "RCDT", sub_code: null }, credit_debit_indicator: cd, status,
  booking_date: "2026-10-05", value_date: "2026-10-05", transaction_date: null, balance_after_transaction: null, reference_number: null, remittance_information: info,
});

draai("enablebanking", async () => {
  // JWT volgens de eisen
  const nu = 1760000000;
  const jwt = ebJwt(cfg.appId, cfg.privateKey, nu);
  const [kop, body, handtekening] = jwt.split(".");
  gelijk(JSON.parse(Buffer.from(kop, "base64url").toString()), { typ: "JWT", alg: "RS256", kid: cfg.appId }, "JWT-kop");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  gelijk(claims, { iss: "enablebanking.com", aud: "api.enablebanking.com", iat: nu, exp: nu + 3600 }, "JWT-claims");
  waar(claims.exp - claims.iat <= 86400, "JWT korter geldig dan 86400 s");
  waar(createVerify("RSA-SHA256").update(`${kop}.${body}`).verify(publicKey, handtekening, "base64url"), "JWT-handtekening klopt met de publieke sleutel");

  zetRoutes([
    { pad: "https://api.enablebanking.com/aspsps", antwoord: { json: aspsps } },
    { methode: "POST", pad: "https://api.enablebanking.com/auth", antwoord: { json: { url: "https://tilisy.enablebanking.com/welcome?sessionid=73100c65-c54d-46a1-87d1-aa3effde435a", authorization_id: "73100c65-c54d-46a1-87d1-aa3effde435a", psu_id_hash: "02a7" } } },
    { methode: "POST", pad: "https://api.enablebanking.com/sessions", antwoord: { json: {
      session_id: "4f5e4b1a-0d3b-4f6c-a2b5-6d3c2b1a0f9e",
      accounts: [{ account_id: { iban: "NL02ABNA0123456789" }, all_account_ids: [], account_servicer: null, name: "Studio Milronski", details: null, usage: "ORGA", cash_account_type: "CACC", product: "Zakelijke Rekening", currency: "EUR", psu_status: null, credit_limit: null, legal_age: null, postal_address: null, uid: "07cc67f4-45d6-494b-adac-09b5cbc7e2b5", identification_hash: "WwpbCiJhY2NvdW50Il0=", identification_hashes: [] }],
      aspsp: { name: "ABN AMRO", country: "NL" }, psu_type: "business", access: { valid_until: "2027-04-09T10:00:00.000000+00:00" },
    } } },
    { pad: "https://api.enablebanking.com/sessions/4f5e4b1a-0d3b-4f6c-a2b5-6d3c2b1a0f9e", antwoord: { json: { status: "AUTHORIZED", accounts: ["07cc67f4-45d6-494b-adac-09b5cbc7e2b5"], accounts_data: [], aspsp: { name: "ABN AMRO", country: "NL" }, psu_type: "business", psu_id_hash: "02a7", access: { valid_until: "2027-04-09T10:00:00.000000+00:00" }, created: "2026-10-11T10:00:00.000000+00:00", authorized: "2026-10-11T10:01:00.000000+00:00", closed: null } } },
    { pad: "https://api.enablebanking.com/accounts/07cc67f4-45d6-494b-adac-09b5cbc7e2b5/transactions", antwoord: (v) => (v.url.searchParams.get("continuation_key")
      ? { json: { transactions: [tx("REF3", "24.20", "DBIT", "BOOK", "Vercel Inc", "IE29AIBK93115212345678", ["Vercel Pro"])], continuation_key: null } }
      : { json: { transactions: [tx("REF1", "1210.00", "CRDT", "BOOK", "Klant BV", "NL91RABO0315273637", ["Factuur 2026-0001", "Dank"]), tx("REF2", "99.00", "DBIT", "PDNG", "Bol", "NL1", ["pending"])], continuation_key: "eyJwYWdlIjoyfQ" } }) },
    { pad: "https://api.enablebanking.com/accounts/07cc67f4-45d6-494b-adac-09b5cbc7e2b5/balances", antwoord: { json: { balances: [
      { name: "Booked", balance_amount: { currency: "EUR", amount: "5012.33" }, balance_type: "XPCD", last_change_date_time: null, reference_date: "2026-10-11", last_committed_transaction: null },
      { name: "Closing", balance_amount: { currency: "EUR", amount: "4988.13" }, balance_type: "CLBD", last_change_date_time: null, reference_date: "2026-10-11", last_committed_transaction: null },
    ] } } },
  ]);

  const lijst = await haalAspsps(cfg);
  gelijk(lijst.map((a) => a.name), ["ABN AMRO", "ING", "bunq"], "ASPSP's uit { aspsps: [...] }");
  gelijk(verzoeken[0].url.search, "?country=NL&service=AIS", "filter op land en AIS");
  waar(verzoeken[0].headers.get("authorization")?.startsWith("Bearer ey"), "JWT als Bearer");
  gelijk(kiesAspsp(lijst, "abn amro")?.name, "ABN AMRO", "banknaam ongevoelig voor hoofdletters en spaties");

  const verzoek = autorisatieVerzoek(kiesAspsp(lijst, "ABN AMRO")!, "ond_1", "https://zelfboek.nl/api/koppelingen/enablebanking/callback", Date.parse("2026-10-11T10:00:00Z"));
  gelijk(verzoek.access.valid_until, "2027-04-09T09:00:00.000Z", "toestemming 180 dagen min marge (bank staat 180 toe)");
  gelijk(verzoek.psu_type, "business", "zakelijk als de bank het ondersteunt");
  gelijk(autorisatieVerzoek(kiesAspsp(lijst, "bunq")!, "o", "u", Date.parse("2026-10-11T10:00:00Z")).psu_type, "personal", "particulier als de bank geen zakelijk kent");
  gelijk(autorisatieVerzoek(kiesAspsp(lijst, "ING")!, "o", "u", Date.parse("2026-10-11T10:00:00Z")).access.valid_until, "2027-01-09T09:00:00.000Z", "toestemming begrensd op maximum_consent_validity (90 dagen)");
  const auth = await ebApi<{ url: string }>(cfg, "/auth", { method: "POST", body: JSON.stringify(verzoek) });
  waar(auth.url.startsWith("https://tilisy.enablebanking.com/"), "autorisatie-url ontvangen");

  const s = await ebApi<EbSessie>(cfg, "/sessions", { method: "POST", body: JSON.stringify({ code: "4b5e1e2c" }) });
  gelijk([s.session_id, s.accounts[0].uid, s.accounts[0].account_id?.iban], ["4f5e4b1a-0d3b-4f6c-a2b5-6d3c2b1a0f9e", "07cc67f4-45d6-494b-adac-09b5cbc7e2b5", "NL02ABNA0123456789"], "sessie met rekening-uid en IBAN");
  gelijk((await sessieStatus(cfg, s.session_id)).status, "AUTHORIZED", "sessiestatus");

  const regels = await haalEbTransacties(cfg, s.accounts[0].uid, "2026-07-13", "NL02ABNA0123456789");
  gelijk(regels.map((r) => [r.bedrag, r.tegenpartij, r.tegenIban, r.omschrijving, r.datum.toISOString().slice(0, 10)]), [
    [1210, "Klant BV", "NL91RABO0315273637", "Factuur 2026-0001 Dank", "2026-10-05"],
    [-24.2, "Vercel Inc", "IE29AIBK93115212345678", "Vercel Pro", "2026-10-05"],
  ], "transacties: teken uit credit_debit_indicator, pending overgeslagen, continuation_key gevolgd");
  const txVerzoeken = verzoeken.filter((v) => v.url.pathname.endsWith("/transactions"));
  gelijk(txVerzoeken.map((v) => v.url.search), ["?date_from=2026-07-13", "?date_from=2026-07-13&continuation_key=eyJwYWdlIjoyfQ"], "paginering met continuation_key");
  gelijk(await haalEbSaldo(cfg, s.accounts[0].uid), 4988.13, "saldo: CLBD gaat voor XPCD");

  // Foutgeval: verlopen sessie
  zetRoutes([{ pad: /transactions/, antwoord: { status: 401, json: { code: 401, message: "Session expired", error: "EXPIRED_SESSION", detail: null } } }]);
  try {
    await haalEbTransacties(cfg, "07cc67f4", "2026-10-01");
    throw new Error("had moeten falen");
  } catch (e) {
    waar(e instanceof EnableBankingFout && e.code === "EXPIRED_SESSION" && e.sessieVoorbij && /koppel opnieuw/.test(e.message), "EXPIRED_SESSION herkend als verlopen toestemming");
  }
  zetRoutes([{ pad: /transactions/, antwoord: { status: 429, json: { code: 429, message: "ASPSP rate limit exceeded", error: "ASPSP_RATE_LIMIT_EXCEEDED" } } }]);
  await faalt(() => haalEbTransacties(cfg, "07cc67f4", "2026-10-01"), /vandaag geen nieuwe opvraging/, "dagelijkse banklimiet (4 per dag) als duidelijke fout");
});
