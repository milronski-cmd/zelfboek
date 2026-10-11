/**
 * Nep-fetch voor de koppelingstests: elke route geeft een gedocumenteerd antwoord terug,
 * elk verzoek wordt vastgelegd, en een verzoek zonder route laat de test falen (zo zie je meteen een verkeerde URL).
 */
process.env.KOPPELING_MAX_WACHT_MS = "0";

export type Verzoek = { methode: string; url: URL; headers: Headers; body: string };
export type Antwoord = { status?: number; json?: unknown; tekst?: string; headers?: Record<string, string> };
type Route = { methode?: string; pad: string | RegExp; antwoord: Antwoord | ((v: Verzoek) => Antwoord) };

export const verzoeken: Verzoek[] = [];
let routes: Route[] = [];

export function zetRoutes(r: Route[]) {
  routes = r;
  verzoeken.length = 0;
}

const origineel = globalThis.fetch;
globalThis.fetch = (async (invoer: string | URL | Request, init?: RequestInit) => {
  const req = invoer instanceof Request ? invoer : undefined;
  const url = new URL(req ? req.url : String(invoer));
  const methode = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const headers = new Headers(init?.headers ?? req?.headers);
  const body = typeof init?.body === "string" ? init.body : init?.body instanceof URLSearchParams ? init.body.toString() : req ? await req.text() : init?.body ? String(init.body) : "";
  const v: Verzoek = { methode, url, headers, body };
  verzoeken.push(v);
  const doel = `${url.origin}${url.pathname}`;
  const route = routes.find((r) => (!r.methode || r.methode === methode) && (typeof r.pad === "string" ? r.pad === doel : r.pad.test(doel + url.search)));
  if (!route) throw new Error(`Onverwacht verzoek in test: ${methode} ${url.href}`);
  const a = typeof route.antwoord === "function" ? route.antwoord(v) : route.antwoord;
  const tekst = a.tekst ?? (a.json === undefined ? "" : JSON.stringify(a.json));
  return new Response(tekst, { status: a.status ?? 200, headers: { "Content-Type": "application/json", ...(a.headers ?? {}) } });
}) as typeof fetch;

export function herstelFetch() { globalThis.fetch = origineel; }

export function gelijk<T>(echt: T, verwacht: T, wat: string) {
  const a = JSON.stringify(echt);
  const b = JSON.stringify(verwacht);
  if (a !== b) throw new Error(`${wat}: verwacht ${b}, kreeg ${a}`);
  console.log(`ok  ${wat}`);
}

export function waar(v: unknown, wat: string) {
  if (!v) throw new Error(`${wat}: niet waar`);
  console.log(`ok  ${wat}`);
}

export async function faalt(f: () => Promise<unknown>, patroon: RegExp, wat: string) {
  try { await f(); } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!patroon.test(m)) throw new Error(`${wat}: foutmelding "${m}" past niet bij ${patroon}`);
    console.log(`ok  ${wat} (${m.slice(0, 90)})`);
    return;
  }
  throw new Error(`${wat}: had moeten falen`);
}

export function draai(naam: string, f: () => Promise<void>) {
  f().then(() => { console.log(`${naam}: ALLES OK`); process.exit(0); }).catch((e) => { console.error(`${naam}: FOUT`, e); process.exit(1); });
}
