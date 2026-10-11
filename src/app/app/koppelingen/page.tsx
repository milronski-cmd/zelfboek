import { db, huidigeOnderneming } from "@/lib/db";
import { datumNl } from "@/lib/btw";
import { koppelingOpslaan, koppelingVerwijderen, startPsd2, syncNu, syncNuFormulier } from "@/lib/acties-bank";
import { Kaart, Kop, Melding, Pil, knopLicht, veld } from "@/components/ui";
import { ResultaatFormulier, type Veld } from "./Formulier";

export const instant = false;

type Dienst = { soort: string; naam: string; uitleg: string; waar: string; velden: Veld[]; sync: boolean };

const DIENSTEN: Dienst[] = [
  { soort: "mollie", naam: "Mollie", uitleg: "Uitbetalingen worden omzet, transactiekosten worden kosten met 21% btw.", waar: "Mollie Dashboard, Ontwikkelaars: de Live API-sleutel (live_...) voor betaallinks, en voor uitbetalingen een organisatie-toegangstoken (access_...) met settlements.read.", velden: [{ naam: "apiKey", label: "Live API-sleutel (betaallinks)", type: "password" }, { naam: "accessToken", label: "Organisatie-toegangstoken (uitbetalingen)", type: "password" }], sync: true },
  { soort: "stripe", naam: "Stripe", uitleg: "Payouts worden omzet, Stripe-kosten worden kosten met verlegde btw (Ierland).", waar: "Stripe Dashboard, Developers, API keys, Secret key (begint met sk_live_).", velden: [{ naam: "secretKey", label: "Secret key", type: "password" }], sync: true },
  { soort: "shopify", naam: "Shopify Payments", uitleg: "Uitbetalingen worden omzet, kosten worden kosten.", waar: "Shopify Dev Dashboard: maak een app met scope read_shopify_payments_payouts, installeer hem in je winkel en kopieer client-id en client-secret. Heb je nog een oude custom app uit de admin, vul dan alleen de Admin API access token in.", velden: [{ naam: "shop", label: "Winkeldomein", hint: "bijvoorbeeld mijnwinkel.myshopify.com" }, { naam: "clientId", label: "Client-id" }, { naam: "clientSecret", label: "Client-secret", type: "password" }, { naam: "accessToken", label: "Of: Admin API access token (oude custom app)", type: "password" }], sync: true },
  { soort: "bol", naam: "bol.com", uitleg: "Uit de factuurspecificaties: uitbetalingen worden omzet, commissie wordt kosten.", waar: "bol.com Partnerplatform, Instellingen, API-instellingen: Client ID en Client Secret.", velden: [{ naam: "clientId", label: "Client ID" }, { naam: "clientSecret", label: "Client Secret", type: "password" }], sync: true },
  { soort: "woocommerce", naam: "WooCommerce", uitleg: "Afgeronde bestellingen worden omzet. Niet combineren met Mollie of Stripe, anders telt alles dubbel.", waar: "WordPress, WooCommerce, Instellingen, Geavanceerd, REST API: maak een sleutel met leesrechten.", velden: [{ naam: "url", label: "Webshopadres", hint: "https://winkel.nl" }, { naam: "consumerKey", label: "Consumer key" }, { naam: "consumerSecret", label: "Consumer secret", type: "password" }], sync: true },
  { soort: "paypal", naam: "PayPal", uitleg: "Ontvangsten worden omzet, PayPal-kosten worden kosten met verlegde btw (Luxemburg). Lukt de koppeling niet, upload dan het CSV-rapport bij Overstappen.", waar: "developer.paypal.com, My Apps, Live app: Client ID en Secret, met Transaction Search ingeschakeld.", velden: [{ naam: "clientId", label: "Client ID" }, { naam: "clientSecret", label: "Secret", type: "password" }], sync: true },
  { soort: "moneybird", naam: "Moneybird", uitleg: "Voor het overstappen: haalt klanten, facturen, bankmutaties en inkoopfacturen op. De import zelf start je bij Overstappen.", waar: "Moneybird, Instellingen, Ontwikkelaars, API-tokens: nieuw token met leesrechten.", velden: [{ naam: "token", label: "API-token", type: "password" }, { naam: "administrationId", label: "Administratie-id (niet verplicht)" }], sync: false },
  { soort: "eboekhouden", naam: "e-Boekhouden", uitleg: "Voor het overstappen: haalt relaties en mutaties op. De import zelf start je bij Overstappen.", waar: "e-Boekhouden, Beheer, Instellingen, Koppelingen, API: token aanmaken.", velden: [{ naam: "token", label: "API-token", type: "password" }], sync: false },
];

const BANKEN = ["ING", "Rabobank", "ABN AMRO", "bunq", "Knab", "SNS", "ASN Bank", "RegioBank", "Triodos Bank", "Revolut", "N26", "Van Lanschot"];

export default async function Koppelingen({ searchParams }: { searchParams: Promise<{ m?: string; fout?: string }> }) {
  const sp = await searchParams;
  const o = await huidigeOnderneming();
  const koppelingen = await db.koppeling.findMany({ where: { ondernemingId: o.id } });
  const per = new Map(koppelingen.map((k) => [k.soort, k]));
  const psd2 = per.get("enablebanking");
  const rekeningen = await db.bankrekening.count({ where: { ondernemingId: o.id, bron: "psd2" } });
  const basisUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const status = (soort: string) => {
    const k = per.get(soort);
    if (!k) return <Pil kleur="grijs">niet gekoppeld</Pil>;
    const kleur = k.status === "actief" ? "groen" : k.status === "uitgeschakeld" ? "grijs" : "rood";
    const tekst = k.status === "actief" ? "gekoppeld" : k.status === "uitgeschakeld" ? "uitgeschakeld" : k.status === "verlopen" ? "verlopen" : "fout";
    return <span title={k.laatsteFout ?? undefined}><Pil kleur={kleur}>{tekst}{k.laatsteSync ? `, ${datumNl(k.laatsteSync)}` : ""}</Pil></span>;
  };

  return (
    <>
      <Kop titel="Koppelingen" sub="Bank en verkoopkanalen halen we elke nacht zelf op. Sleutels slaan we versleuteld op.">
        <form action={syncNuFormulier}><input type="hidden" name="soort" value="alles" /><button className={knopLicht}>Alles nu ophalen</button></form>
      </Kop>
      {sp.m && <div className="mb-5"><Melding r={{ ok: true, melding: sp.m }} /></div>}
      {sp.fout && <div className="mb-5"><Melding r={{ ok: false, fout: sp.fout }} /></div>}

      <Kaart titel="Bankkoppeling" actie={status("enablebanking")} className="mb-6">
        <div className="p-5">
          <p className="max-w-2xl text-sm text-tekst-2">
            Werkt met alle Nederlandse banken via Enable Banking. Je geeft je bank 90 dagen toestemming; daarna halen we elke nacht je transacties en saldo op.
            {rekeningen > 0 && ` Op dit moment ${rekeningen === 1 ? "is 1 rekening" : `zijn ${rekeningen} rekeningen`} gekoppeld.`}
          </p>
          {psd2?.laatsteFout && <p className="mt-2 text-sm text-rood-tekst">{psd2.laatsteFout}</p>}
          <div className="mt-5 grid gap-8 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium">1. Toegang van Enable Banking</p>
              <p className="mb-3 mt-1 text-[14px] text-tekst-3">enablebanking.com, Control Panel, Applications: de applicatie-id en de private key (PEM). Staan ze al op de server, dan kun je dit overslaan.</p>
              <ResultaatFormulier
                actie={koppelingOpslaan}
                verborgen={{ soort: "enablebanking" }}
                velden={[{ naam: "appId", label: "Applicatie-id" }, { naam: "privateKey", label: "Private key (PEM)", type: "textarea" }]}
                knopTekst="Opslaan"
                licht
              />
            </div>
            <div>
              <p className="text-sm font-medium">2. Je bank kiezen en toestemming geven</p>
              <form action={startPsd2} className="mt-3 space-y-3">
                <div>
                  <label className="lbl" htmlFor="bank">Bank</label>
                  <select id="bank" name="bank" className={veld} defaultValue="">
                    <option value="" disabled>Kies je bank</option>
                    {BANKEN.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <button className="knop knop-groen">Naar mijn bank</button>
              </form>
              {psd2 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={syncNuFormulier}><input type="hidden" name="soort" value="enablebanking" /><button className="knop-licht knop-klein">Nu ophalen</button></form>
                  <form action={koppelingVerwijderen}><input type="hidden" name="soort" value="enablebanking" /><button className="knop-tekst knop-klein text-rood-tekst">Koppeling verwijderen</button></form>
                </div>
              )}
            </div>
          </div>
        </div>
      </Kaart>

      <div className="grid gap-6 md:grid-cols-2">
        {DIENSTEN.map((d) => {
          const k = per.get(d.soort);
          return (
            <Kaart key={d.soort} titel={d.naam} actie={status(d.soort)}>
              <div className="p-5">
                <p className="text-sm text-tekst-2">{d.uitleg}</p>
                <p className="mt-2 text-[14px] text-tekst-3">Waar vind je dit? {d.waar}</p>
                {k?.laatsteFout && <p className="mt-2 text-sm text-rood-tekst">{k.laatsteFout}</p>}
                <div className="mt-4">
                  <ResultaatFormulier actie={koppelingOpslaan} verborgen={{ soort: d.soort }} velden={d.velden} knopTekst={k ? "Sleutels vervangen" : "Koppelen"} licht={Boolean(k)} />
                </div>
                {k && (
                  <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-lijn pt-4">
                    {d.sync && <ResultaatFormulier actie={syncNu} verborgen={{ soort: d.soort }} knopTekst="Nu ophalen" bezigTekst="Ophalen" licht />}
                    <form action={koppelingVerwijderen}><input type="hidden" name="soort" value={d.soort} /><button className="knop-tekst knop-klein text-rood-tekst">Verwijderen</button></form>
                  </div>
                )}
              </div>
            </Kaart>
          );
        })}
      </div>

      <Kaart titel="Webhooks" className="mt-6">
        <div className="space-y-2 p-5 text-sm text-tekst-2">
          <p>Mollie-betaallinks van facturen melden zich op <code className="rounded bg-papier px-1.5 py-0.5 text-tekst">{basisUrl}/api/webhooks/mollie</code>. Dit adres geven we automatisch mee bij elke betaallink.</p>
          <p>Stripe-payouts melden zich op <code className="rounded bg-papier px-1.5 py-0.5 text-tekst">{basisUrl}/api/webhooks/stripe-kanaal</code>, event payout.paid, met het geheim in STRIPE_KANAAL_WEBHOOK_SECRET.</p>
        </div>
      </Kaart>
    </>
  );
}
