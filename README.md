# netatmo-control

Malá PWA, která zatopí na **5 / 10 / 15 minut** jedním klepnutím.

Statická stránka bez backendu — mluví přímo s [Netatmo Connect API](https://dev.netatmo.com/),
běží na GitHub Pages a dá se přidat na plochu telefonu.

## Nastavení

Netatmo od října 2022 **nepovoluje přihlášení e-mailem a heslem z aplikace** — jediný
podporovaný způsob je OAuth2 authorization code. Heslo tedy zadáváš na přihlašovací
stránce Netatmo, aplikace ho nikdy nevidí. Proto je potřeba jednorázově založit
vlastní Netatmo aplikaci:

1. Na [dev.netatmo.com/apps/createanapp](https://dev.netatmo.com/apps/createanapp) vytvoř aplikaci.
2. Do pole **redirect URI** dej přesně adresu, kde aplikace běží, např.
   `https://zbycz.github.io/netatmo-control/` (aplikace ti ji sama ukáže na úvodní obrazovce).
3. Zkopíruj **client ID** a **client secret** do aplikace a dej *Přihlásit se přes Netatmo*.
4. Přihlásíš se svým Netatmo účtem a potvrdíš přístup.

Client ID, secret i tokeny zůstávají v `localStorage` daného prohlížeče. V repu nejsou
a nikam jinam se neposílají.

## Deploy

Push do `main` → workflow [`deploy.yml`](.github/workflows/deploy.yml) pustí testy
a nasadí obsah `public/` na GitHub Pages.

Jednorázově je potřeba v *Settings → Pages* přepnout **Source** na **GitHub Actions**.

## Vývoj

```sh
npx serve public      # nebo python3 -m http.server -d public
node --test           # testy
```

Service worker se registruje jen v secure contextu (`https://` nebo `localhost`).

## Jak to funguje

| Krok | Netatmo endpoint |
| --- | --- |
| přihlášení | `GET /oauth2/authorize`, `POST /oauth2/token` |
| seznam místností | `POST /api/homesdata` |
| teploty a stav | `POST /api/homestatus` |
| zatopit / zrušit | `POST /api/setroomthermpoint` |

Tlačítko nastaví ve vybraných místnostech `mode=manual` na zvolenou teplotu
(výchozí 24 °C, mění se v nastavení) s `endtime` za 5/10/15 minut. Po vypršení se
termostat sám vrátí k programu; *Zpět na program* (`mode=home`) ho vrátí hned.
