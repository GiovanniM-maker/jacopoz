# Tomo — build native per App Store & Play Store

Il codice è già nativo (React Native / Expo): non va riscritto nulla. La
config di build è pronta (`app/eas.json`, `app/app.json`). Restano gli
account e qualche comando. Tutto gira nel cloud di Expo (EAS) — non serve
un Mac per la build iOS.

## Prerequisiti (una tantum)

| Cosa | Costo | Dove |
|---|---|---|
| Account Expo (EAS) | gratis | https://expo.dev/signup |
| Apple Developer Program | 99 $/anno | https://developer.apple.com/programs |
| Google Play Console | 25 $ una tantum | https://play.google.com/console |

Poi, dalla cartella `app/`:

```bash
npx eas-cli login          # accedi all'account Expo
npx eas-cli init           # crea il progetto EAS, scrive extra.eas.projectId in app.json
```

## Build

```bash
# APK Android sideloadabile (per provarla al volo su un telefono)
npx eas-cli build --platform android --profile preview

# Build di produzione per gli store (iOS + Android insieme)
npx eas-cli build --platform all --profile production
```

EAS gestisce da solo le firme: al primo build iOS crea/gestisce i
certificati Apple (basta fare login con l'Apple ID quando lo chiede), e per
Android genera il keystore. `appVersionSource: remote` + `autoIncrement`
incrementano da soli build number e versionCode a ogni build di produzione.

## Pubblicazione

```bash
npx eas-cli submit --platform ios      --profile production  # → App Store Connect / TestFlight
npx eas-cli submit --platform android  --profile production  # → Play Console (internal testing)
```

Poi dalle rispettive console: compili la scheda (nome, descrizione,
categoria, privacy policy URL → https://jacopoz.vercel.app + le pagine
/legal), carichi gli screenshot, e invii per la revisione (Apple ~1-3
giorni, Google poche ore).

### Screenshot store
Riusabili quelli che generiamo dai temi (Playwright, 1290×2796 per iPhone
6.7"). Chiedi e li produco nel formato richiesto dagli store.

## Note

- **Nessun permesso speciale**: l'app non usa camera/notifiche/geo, quindi
  non servono stringhe di autorizzazione. `ITSAppUsesNonExemptEncryption:
  false` è già impostato → niente domande sull'export di crittografia.
- **Bundle id**: `app.tomo.beta` (iOS e Android). Una volta pubblicato NON
  si può cambiare: se vuoi `app.tomo` "pulito" per la produzione, cambialo
  in `app.json` **prima** del primo submit.
- **Config Supabase**: le costanti sono già "cotte" nel codice
  (`src/lib/supabase.ts`), quindi la build nativa funziona senza variabili
  d'ambiente. Ricorda solo la rotazione delle chiavi prima del lancio.
- **Aggiornamenti senza revisione (consigliato dopo)**: aggiungendo
  `expo-updates` + `eas update` puoi spingere modifiche solo-JS ai
  dispositivi senza ripassare dagli store — comodissimo in beta. È il
  naturale passo successivo quando vorrai iterare veloce sul nativo.

## La mia raccomandazione

Lancia la beta come **PWA** (già pronta, €0, zero attese di revisione),
raccogli i primi utenti, e passa agli store con questa config quando il
prodotto è stabile. Non spendere tempo/soldi in revisioni store su un'app
che sta ancora cambiando ogni giorno.
