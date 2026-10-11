# Koppelingen testen

Er zijn twee soorten tests voor de API-koppelingen.

1. **Contracttests** (`npx tsx test/koppelingen.ts`). Ze draaien zonder netwerk, zonder sleutels en zonder database. Elke adapter krijgt een nep-`fetch` met antwoorden in exact de vorm uit de officiële documentatie, inclusief paginering en minstens één foutgeval. Boven elk testbestand in `test/koppelingen/` staat op welke doc-URL de fixtures gebaseerd zijn.
2. **Live sandbox-tests** (`npx tsx test/koppelingen-live.ts`). Deze praten met de echte API's, maar alleen met testsleutels. Een dienst draait alleen als zijn env-variabele gezet is; de rest wordt overgeslagen. Live-sleutels worden geweigerd en er wordt niets in de database geschreven.

Alleen één dienst testen: `npx tsx test/koppelingen-live.ts stripe` (of `mollie`, `paypal`, `bol`, `enablebanking`, `shopify`, `woocommerce`, `moneybird`, `eboekhouden`).

Zet de sleutels alleen in je terminalsessie, niet in `.env` en niet in git:

```powershell
# PowerShell
$env:STRIPE_TEST_SECRET_KEY = "sk_test_..."
npx tsx test/koppelingen-live.ts stripe
```

```bash
# bash
STRIPE_TEST_SECRET_KEY=sk_test_... npx tsx test/koppelingen-live.ts stripe
```

## Gratis sandboxen zonder betaalgegevens

### Stripe (testmodus)
- **Aanmaken:** een gratis account op dashboard.stripe.com. Je hoeft je bedrijf niet te activeren en geen bankrekening op te geven. Zet de schakelaar op *Testmodus* (of maak een sandbox), ga naar *Ontwikkelaars → API-sleutels* en kopieer de **Secret key** (`sk_test_...`). Een restricted key (`rk_test_...`) met leesrecht op *Payouts* en *Balance* kan ook.
- **Variabele:** `STRIPE_TEST_SECRET_KEY`
- **Commando:** `npx tsx test/koppelingen-live.ts stripe`
- **Wat het doet:** het haalt payouts en balance transactions van de afgelopen 90 dagen op. In testmodus zijn er vaak geen payouts; "0 regels" betekent dan dat de authenticatie en de aanroepen kloppen.

### Mollie (testmodus)
- **Aanmaken:** een gratis account op my.mollie.com. Voor de testmodus is geen KvK-controle of betaalgegeven nodig. Kopieer bij *Ontwikkelaars → API-sleutels* de **Test API-sleutel** (`test_...`).
- **Variabele:** `MOLLIE_TEST_API_KEY`
- **Commando:** `npx tsx test/koppelingen-live.ts mollie`
- **Wat het doet:** het maakt een testbetaling van € 1,00 (er gaat geen geld om), haalt die weer op en toont de checkout-URL. Die kun je in de browser openen om de status op betaald te zetten.
- **Optioneel:** `MOLLIE_ACCESS_TOKEN` (organisatie-toegangstoken `access_...` met `settlements.read`, bij *Ontwikkelaars → Organisatie-toegangstokens*). Daarmee worden ook de uitbetalingen getest. Let op: uitbetalingen bestaan alleen voor een geactiveerd live-account, en dit leest echte gegevens (alleen lezen).

### PayPal (sandbox)
- **Aanmaken:** log in op developer.paypal.com met een gratis PayPal-account (er wordt niets afgeschreven). Ga naar *Apps & Credentials*, kies **Sandbox** en maak een app aan (type *Merchant*). Vink bij de app-instellingen **Transaction search** aan. Kopieer de **Client ID** en de **Secret**.
- **Variabelen:** `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET`
- **Commando:** `npx tsx test/koppelingen-live.ts paypal`
- **Let op:** nieuwe sandboxtransacties verschijnen pas na maximaal 3 uur in Transaction Search. Krijg je een 403, dan staat Transaction search nog niet aan voor de app.

### Enable Banking (sandbox)
- **Aanmaken:** een gratis account op enablebanking.com. Maak bij *Control Panel → API applications* een applicatie aan met omgeving **Sandbox**. Laat de browser de sleutel genereren en bewaar het `.pem`-bestand met de private key. Zet als *Allowed redirect URL* bijvoorbeeld `https://zelfboek.nl/api/koppelingen/enablebanking/callback` (je kopieert de code straks uit de adresbalk, de pagina zelf hoeft niet te werken). Noteer het **applicatie-id**.
- **Variabelen:** `ENABLE_BANKING_SANDBOX_APP_ID` en `ENABLE_BANKING_SANDBOX_KEY_PATH` (pad naar het `.pem`-bestand). Optioneel `ENABLE_BANKING_REDIRECT_URL` (moet exact overeenkomen met de ingestelde redirect) en `ENABLE_BANKING_SANDBOX_LAND` (standaard `NL`).
- **Commando, in twee stappen:**
  1. `npx tsx test/koppelingen-live.ts enablebanking` toont de banken en een autorisatie-URL voor de *Mock ASPSP*. Open die URL en rond de toestemming af; daar zijn geen inloggegevens voor nodig.
  2. Kopieer de `code=` uit de URL waarop je terugkomt, zet die in `ENABLE_BANKING_SANDBOX_CODE` en draai het commando opnieuw. Het maakt dan een sessie aan en haalt per rekening de transacties en het saldo op.
- De code is maar kort geldig en kan één keer gebruikt worden; begin bij een fout opnieuw bij stap 1.

### Moneybird (sandbox-administratie)
- **Aanmaken:** een gratis Moneybird-account. Maak daarna een **sandbox-administratie** aan (zie developer.moneybird.com, "sandbox"). Daarvoor heb je geen abonnement nodig; facturen krijgen een watermerk. Maak in die administratie bij *Instellingen → Ontwikkelaars → API-tokens* een persoonlijk token aan met leesrechten (scopes `sales_invoices`, `documents`, `bank`, `settings`).
- **Variabelen:** `MONEYBIRD_SANDBOX_TOKEN`, optioneel `MONEYBIRD_ADMINISTRATION_ID`
- **Commando:** `npx tsx test/koppelingen-live.ts moneybird`

## Niet gratis zonder bedrijfsgegevens

- **bol (demo-omgeving):** `https://api.bol.com/retailer-demo` is gratis en geeft vaste voorbeeldfacturen terug, maar je hebt wel een Client ID en Client Secret van een **bol-verkopersaccount** nodig (*Partnerplatform → Instellingen → API-instellingen*). Heeft Ronnie dat: zet `BOL_CLIENT_ID` en `BOL_CLIENT_SECRET` en draai `npx tsx test/koppelingen-live.ts bol`. De demo leest geen echte gegevens.
- **Shopify:** met een gratis Shopify Partner-account maak je in het **Dev Dashboard** een development store en een app met scope `read_shopify_payments_payouts`. Zet `SHOPIFY_DEV_SHOP` (bijv. `testwinkel.myshopify.com`) plus `SHOPIFY_CLIENT_ID` en `SHOPIFY_CLIENT_SECRET` en draai `npx tsx test/koppelingen-live.ts shopify`. Een development store heeft meestal geen echte Shopify Payments-uitbetalingen; je test dan alleen de authenticatie, of krijgt de melding dat er geen Payments-account is.
- **WooCommerce:** er is geen centrale sandbox. Gebruik een eigen (lokale) WordPress met WooCommerce over https: `WOO_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET`.
- **e-Boekhouden:** geen sandbox. Een proefaccount (30 dagen) werkt: maak bij *Beheer → Instellingen → Koppelingen → API* een token aan en zet `EBOEKHOUDEN_TEST_TOKEN`.

## Welke sleutels Ronnie minimaal aanmaakt

| Dienst | Waar | Variabele(n) |
|---|---|---|
| Stripe | dashboard.stripe.com, testmodus, API-sleutels | `STRIPE_TEST_SECRET_KEY` |
| Mollie | my.mollie.com, Ontwikkelaars, Test API-sleutel | `MOLLIE_TEST_API_KEY` |
| PayPal | developer.paypal.com, Sandbox-app met Transaction search | `PAYPAL_SANDBOX_CLIENT_ID`, `PAYPAL_SANDBOX_CLIENT_SECRET` |
| Enable Banking | enablebanking.com, Sandbox-applicatie | `ENABLE_BANKING_SANDBOX_APP_ID`, `ENABLE_BANKING_SANDBOX_KEY_PATH` |
| Moneybird | sandbox-administratie, API-token | `MONEYBIRD_SANDBOX_TOKEN` |

Daarna één commando voor alles: `npx tsx test/koppelingen-live.ts`
