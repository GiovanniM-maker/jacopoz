# Audit Tomo — Risultati

Audit eseguito su backend (query dirette su Postgres), API/logica client,
sicurezza client ed edge functions, UX/PWA/accessibilità. Legenda:
✅ risolto in questa tornata · ⏳ backlog (con stima). Severità: 🔴 critico ·
🟠 importante · 🟡 miglioria.

---

## 🔴 Critici

- ✅ **Privilege escalation → admin.** Qualsiasi utente autenticato poteva
  `PATCH profiles {role:"admin"}` (la policy UPDATE non limitava le colonne) e
  diventare moderatore: cancellare/modificare recensioni e commenti altrui,
  leggere le segnalazioni, scrivere `app_config`. **Fix (0034):** revocato
  UPDATE sulla tabella, concesse solo le colonne di presentazione. *Testato dal
  vivo con un utente reale: `role=admin` → 403, modifica nome → 200.*

- ✅ **Spinner infinito + contenuto perso** su errore in scrittura recensione
  (`compose-review`) e invio commento (`review/[id]`): mancava `try/catch/finally`
  → il bottone restava in loading per sempre. **Fix:** gestione errore + messaggio,
  `finally` che sblocca.

## 🟠 Importanti

- ✅ **Contatori denormalizzati in drift** (like, rating, follower). Causa
  radice: i 7 trigger dei contatori erano `SECURITY INVOKER`, quindi la RLS li
  bloccava nell'aggiornare righe di altri utenti/libri. **Fix (0034):**
  convertiti a `SECURITY DEFINER` + riconciliazione one-shot. *Testato: un follow
  reale ora incrementa il contatore del seguito (2→3→2); drift azzerato.*

- ✅ **Funzioni interne esposte alla anon key.** `internal_embed_*` /
  `internal_enrich_*` erano chiamabili con la chiave pubblica → un attaccante
  poteva bruciare la chiave OpenRouter a pagamento. **Fix (0034):** revocate.
  *Testato: 403.*

- ✅ **Cache dell'utente non svuotata al logout.** Utente B nello stesso tab
  vedeva feed/consigli/notifiche di A entro 5 min. **Fix:** `queryClient.clear()`
  in `signOut`.

- ✅ **`finished_at` sovrascritto a ogni interazione.** Un like/voto su un libro
  finito a gennaio ne riscriveva la data di lettura a oggi. **Fix:** si stampa
  solo alla prima transizione a "letto".

- ✅ **Errori Supabase ingoiati** in `reviews.upsertReview` (sync voto),
  `shelves.setShelf` (delete + sync recensione), `push.enablePush` (ritornava
  "granted" anche se il salvataggio falliva). **Fix:** controllo `error` e stato
  corretto.

- ✅ **Invalidazioni cache mancanti** dopo pubblicazione recensione
  (`user-book`, `my-review`, `user-reviews`, `stats`) e dopo risposta a un
  commento (`replies`). **Fix:** aggiunte.

- ✅ **Cache poisoning del service worker → schermata bianca permanente.** Dopo
  un deploy atomico, un asset con hash vecchio torna `200 text/html` (rewrite
  SPA) e finiva in cache sotto una URL `.js` → eseguito come JS. **Fix:** si
  cachea solo `res.ok` non-HTML; navigazione solo su 2xx.

- ✅ **Testi in inglese** nelle schermate di accesso/registrazione (la prima
  cosa che si vede), più `"now"`, `"Unknown"`, date en-US. **Fix:** tradotti +
  errori auth mappati in italiano + date `it-IT`.

- ✅ **Contrasto insufficiente.** Testo bianco su ottone (2.6:1) su *tutti* i
  CTA principali, illeggibile al sole; `textFaint` troppo chiaro. **Fix:** testo
  scuro su ottone (mantenendo l'ottone che avevi scelto) + `textFaint` più scuro.

- ✅ **`KeyboardAvoidingView` mancante** in scrittura recensione: su iPhone la
  tastiera copriva il bottone "Pubblica". **Fix:** aggiunto + scroll.

- ⏳ **Edge function `read`: ramo di scrittura senza auth + CORS `*`.** Chiunque
  può forzare il match Gutenberg e riscrivere l'autore canonico di un libro.
  Non è SSRF (host fissi, id numerici). **TODO:** `verify_jwt=true` in
  `config.toml` per `read`, `verify_jwt=false` esplicito per `send-push`, CORS
  ristretto. **~S**

- ⏳ **Errori interni restituiti al client** (`String(err)`) da `read` e
  `ingest-book` → mappatura schema DB. **TODO:** log lato server, `{error:"internal error"}`. **~S**

- ⏳ **Schermate bianche in caricamento/errore.** `book/[id]`, `profile`,
  `user`, `list` fanno `if (!data) return <ScreenContainer/>` → vuoto totale (e
  permanente se la risorsa non esiste, senza tasto indietro). Anche la Home non
  ha stato di errore. **TODO:** loader + stato d'errore con "Riprova", header
  sempre montato. **~M**

- ⏳ **`auth.loadProfile` ignora l'errore** → profilo `null` → profilo bianco
  permanente se il fetch fallisce subito dopo la registrazione. **TODO:** retry/
  stato d'errore invece di degradare a null. **~S** (tocca il gate: cautela)

- ⏳ **Doppio tap non protetto** su follow (`user/[username]`), bookmark e shelf:
  `useMutation`/optimistic mancanti → violazione unique non gestita, contatori
  che "tornano indietro". `FollowButton` è già fatto bene: replicare quel
  modello. **TODO:** `useMutation` + disable in-flight, o RPC atomiche. **~M**

- ⏳ **Aggiornamento del service worker.** `CACHE` hardcoded e `sw.js` non cambia
  mai byte → chi tiene la PWA aperta non riceve i deploy nuovi. **TODO:** iniettare
  il commit SHA nel nome cache in `inject-pwa.mjs` + `registration.update()` su
  `visibilitychange` + banner "nuova versione". **~M**

- ⏳ **`onboarding.saveOnboarding` e `settings` ignorano errori** → loop di
  onboarding / "account cancellato" falso. **TODO:** check `error` + `signOut`
  solo su successo. **~S**

- ⏳ **`read/[id]`: la posizione di lettura non si ripristina mai** (i ref di
  altezza sono 0 all'apertura). **TODO:** usare `onContentSizeChange`/`onLayout`. **~S**

- ⏳ **`search`: `importFromProviders` chiamata a ogni ricerca** (condizione
  sempre vera per `data` undefined al cambio query) + ricerca libri con termine
  vuoto mostra 30 libri a caso. **TODO:** soglia `>=2` + deps corrette. **~S**

- ⏳ **Accessibilità.** `accessibilityLabel` mancante su cuore/segnala/stelle/
  azione header; alcuni touch target < 40px; safe-area inferiore mai applicata
  (home indicator sovrapposto a tab bar/composer). **TODO:** label + hitSlop 12 +
  `edges` bottom. **~M**

## 🟡 Migliorie

- ✅ **FK senza indice** (`notifications.*`, `reco_impressions`, ecc.) → indici aggiunti (0034).
- ✅ **Orfani polimorfici** (like/bookmark su recensioni/commenti cancellati): pulizia one-shot + trigger di prevenzione (0034).
- ⏳ **`wrap()` del formattatore usa una selezione stantia su web** — mitigato (fallback a fine testo), ma la soluzione robusta è leggere la selezione dal nodo DOM al tap. **~S**
- ⏳ **`community`: `["feed-readers"]` duplica `["feed","for_you"]`** (doppia RPC a ogni mount). **TODO:** riusare la stessa chiave. **~S**
- ⏳ **Nessuna gestione offline** globale (banner online/offline). **~S**
- ⏳ **`numberOfLines` mancanti** su titoli/nomi lunghi (scheda libro, connessioni, ricerca). **~S**
- ⏳ **`algoritmo.html`** cifrato ma servito pubblicamente: password brute-forzabile offline. **TODO:** passphrase ad alta entropia o dietro auth. **~S**

---

## Seconda tornata di fix (robustezza & PWA)

Risolti dal backlog ⏳:

- ✅ **Schermate bianche** → nuovo componente `ScreenState` (loading + errore con
  "Riprova", header sempre montato) applicato a `book/[id]`, `user/[username]`,
  `list/[id]`, `profile`. Niente più pagine vuote da cui non si esce.
- ✅ **`auth.loadProfile`** ora ritenta (gestisce la race post-registrazione) e
  usa `maybeSingle` invece di degradare a profilo nullo.
- ✅ **Doppio tap**: follow (`user/[username]`) via `useMutation` ottimistica con
  `isPending` + invalidazione `stats`; bookmark idempotente (unique-violation
  ignorata); shelf serializzato (guard in-flight) così rating/like non "tornano".
- ✅ **Aggiornamento service worker**: nome cache versionato per build
  (`inject-pwa` stampa un build id) + `registration.update()` al ritorno in
  focus → le PWA installate ricevono i deploy nuovi (niente auto-reload, per
  evitare loop su iOS).
- ✅ **Ricerca**: niente più import ad ogni tasto (parte solo quando i risultati
  locali sono davvero pochi *dopo* il fetch) + niente 30 libri a caso con
  termine vuoto (soglia ≥ 2).
- ✅ **`community`**: la striscia "Lettori attivi" riusa la cache di "Per te"
  (niente RPC duplicata, si aggiorna con le stesse invalidazioni).
- ✅ **Accessibilità (parziale)**: `accessibilityLabel` su like/segnala/stelle,
  touch target portati a 44px; `numberOfLines` sul titolo libro.

Restano nel backlog: `onboarding`/`settings` error-check, ripristino posizione
lettura, safe-area inferiore, sweep a11y completo, banner offline, `algoritmo.html`.

## Aree verificate e pulite

- **Nessun secret** nel repo, nella history git, né nel bundle web (private key
  VAPID, dispatch secret, service role: solo server-side). La anon key è pubblica
  per design.
- **XSS:** nessun `dangerouslySetInnerHTML`/`eval`/`WebView`; `shareCard` fa
  escaping e usa solo text-content SVG; `RichText` usa `<Text>` RN.
- **SSRF:** edge functions usano host fissi e id numerici.
- **RLS** attiva su tutte le tabelle; funzioni `DEFINER` con `search_path` fissato.
- **Storage locale:** solo sessione, tema, flag PWA.

---

## Note operative (a carico del founder, pre-lancio)

- 🔴 **Rotazione chiavi** esposte in chat (OpenRouter, Supabase, PAT).
- 🟠 **Upgrade compute Supabase** (fix radice velocità) + verifica backup/PITR.
- 🟠 **Monitoring**: raccolta errori client (es. Sentry) e allerta su cron falliti.
- 🟡 **Email di contatto** reale nelle pagine legali; CI (GitHub Action) per typecheck+build.
