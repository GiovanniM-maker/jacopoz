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

## Terza tornata (chiusura backlog)

- ✅ **`onboarding`/`settings` error-check**: `saveOnboarding` propaga l'errore su
  `onboarded_at` (niente più loop di onboarding); `settings` mostra un errore e
  fa `signOut` solo se la cancellazione account è andata a buon fine; il salva
  profilo non resta più bloccato in loading.
- ✅ **Ripristino posizione di lettura**: il lettore ora popola le dimensioni da
  `onLayout`/`onContentSizeChange` (non solo dallo scroll), così all'apertura
  riprende dal punto giusto e mostra "Riprendi dal segnalibro".
- ✅ **Banner offline** globale (web) quando la connessione cade.
- ✅ **Safe-area inferiore**: la tab bar si estende sotto l'home indicator (niente
  più etichette coperte in PWA su iPhone).
- ✅ **Accessibilità** (ulteriore): label sull'azione destra dell'header,
  `numberOfLines` sui nomi nelle liste connessioni.

Resta come **decisione del prodotto** (non un bug): `public/algoritmo.html` è un
documento cifrato servito pubblicamente — se contiene qualcosa di sensibile,
usare una passphrase ad alta entropia o toglierlo dal build pubblico. Minori
rimasti: sweep a11y esaustivo, safe-area del composer commenti.

## Aree verificate e pulite

- **Nessun secret** nel repo, nella history git, né nel bundle web (private key
  VAPID, dispatch secret, service role: solo server-side). La anon key è pubblica
  per design.
- **XSS:** nessun `dangerouslySetInnerHTML`/`eval`/`WebView`; `shareCard` fa
  escaping e usa solo text-content SVG; `RichText` usa `<Text>` RN.
- **SSRF:** edge functions usano host fissi e id numerici.
- **RLS** attiva su tutte le tabelle; funzioni `DEFINER` con `search_path` fissato.
- **Storage locale:** solo sessione, tema, flag PWA.

## Quarta tornata — velocità (la causa vera dei "libri non trovati")

La segnalazione "i miei amici hanno cercato Georges Simenon e Kira Shell e non
li hanno trovati" **non era un problema di catalogo**: entrambi gli autori erano
già presenti. Era la ricerca che non arrivava mai a rispondere.

- 🔴 **`search_books` regredito da ~80 ms a 2 000–20 000 ms** con
  l'introduzione di una riga per opera (migrazione 0042). Il ruolo
  `authenticated` ha `statement_timeout = 8s` e `anon` ne ha **3s**: oltre quella
  soglia Postgres annulla la query e il lettore vede "nessun risultato". Non un
  errore visibile — un catalogo apparentemente vuoto.
  Tre cause, tutte nella forma della query (i predicati selezionano 8–39 righe):
  `select b.*` trascinava l'embedding a 512 dimensioni in ogni ordinamento; la
  disgiunzione `term = '' OR tsv @@ … OR unaccent(title) % …` impediva l'uso di
  entrambi gli indici (seq scan con `immutable_unaccent(title)` ricalcolato su
  67 583 righe); la finestra `row_number()` girava su quell'insieme illimitato
  prima del `LIMIT`. **Corretto in 0046** — misurato 27–83 ms, e verificato che
  rientra anche nei 3s di `anon`.
- 🟠 **Soglia trigram**: al valore di default 0.3 il recheck del bitmap heap
  ricalcolava l'unaccent su ~1 700 blocchi. Portata a 0.4 a livello di funzione:
  'amore' da 621 ms a 22 ms, con il refuso ("a ciascuno il sur") che continua a
  trovare i suoi 7 risultati.
- 🟠 **`search_authors`** faceva seq scan (unnest prima del filtro): ~500 ms →
  10–16 ms con un indice trigram sull'array appiattito (0046).
- 🟠 **Indice ANN più grande della memoria**: `shared_buffers` è 224 MB,
  `books_embedding_hnsw` da solo 176 MB più 51 MB di tabella — si sfrattavano a
  vicenda, da cui i consigli a 260 ms a caldo ma 830–1 660 ms a freddo. Passato
  a `halfvec` (0047): stesso grafo, metà spazio.
- 🔴 **`GOOGLE_BOOKS_API_KEY` mancante**: verificato che Google Books risponde
  **429** senza chiave, quindi ogni import passava dal solo fallback Open
  Library. Il segreto va messo lato Supabase (Edge secrets), non su Vercel.
- 🟡 **Una sola chiamata provider per ricerca**: `expandCatalog` partiva a ogni
  query oltre all'import, raddoppiando le invocazioni Edge. Ora l'espansione è
  dentro l'unica chiamata, e la scheda **Autori** importa anch'essa (prima non lo
  faceva: cercare un autore assente non produceva nulla).
- 🟡 Rimosse dal `app_config` le righe `_dbg_*` che avevo usato per registrare le
  misurazioni.

## Quinta tornata — ricerca inesatta

Su 29 query realistiche (refusi, titoli parziali, autore+titolo, ordine
sbagliato) la ricerca ne risolveva **17**. Le cause erano due, entrambe
strutturali:

- il full-text pretende **tutte** le parole, quindi "murgia accabadora" o
  "edipo re" davano zero risultati;
- il ramo trigram confronta la query con il titolo **intero**, quindi una
  lettera sbagliata dentro un titolo lungo scende sotto qualsiasi soglia utile
  (`similarity('gatsbi','il grande gatsby')` = 0,28).

`word_similarity` misura la query contro il **miglior tratto di parole** del
titolo — 0,71 sullo stesso caso — ed è indicizzabile con l'operatore `<%` sugli
stessi indici GIN. Costa però 20–228 ms a ramo, troppo per ogni battuta.

Da qui il disegno a **due passaggi** (0049): prima quello preciso ed economico
(full-text AND, full-text a prefisso per la digitazione, trigram sul titolo);
poi una domanda concreta al risultato — *qualche candidato contiene davvero
ogni parola significativa della query?* — e solo in caso negativo il passaggio
rilassato con `word_similarity` su titolo e autori più il full-text in OR.

**26/29 risolte**, con latenza 18–117 ms (misurata a catalogo fermo). Le tre
che restano non sono difetti di ricerca: "il grande gatsbi" non ha
un'edizione italiana in catalogo, "marques" è genuinamente ambiguo (esistono
libri francesi intitolati proprio "marques") e "machbet" è più vicino per
trigram a "Machiavelli" che a "Macbeth".

Due bug trovati misurando, non leggendo:

- 🔴 **`immutable_unaccent` non abbassa il case.** Gli operatori trigram e
  full-text lo fanno internamente, quindi non se n'era mai accorto nessuno; ma
  il controllo di pertinenza usa `position()`, che è case-sensitive. Cercava
  "dune" dentro "Dune Messiah", non lo trovava, dichiarava ogni query senza
  risposta e lanciava il passaggio costoso **su tutte**: 'dune' misurava
  1 451 ms. Con `lower()`, 65 ms.
- 🟠 **`ts_rank` non era subordinato a un match.** Da solo pesa la
  sovrapposizione parziale di lessemi: siccome "il" e "grande" compaiono in
  migliaia di titoli, tutti tornavano a 0,99 e seppellivano la risposta giusta.
  Ora conta solo quando la query fa match davvero, e il match completo vale un
  punto pieno in più.
- 🟠 **"Continua a leggere" apriva un lettore vuoto.** Il lettore in-app è
  indirizzato per id Gutenberg (la scheda libro lo passa correttamente), mentre
  la home passava l'uuid del libro: `Number(uuid)` è NaN e la query del testo
  restava disabilitata. Corretto in 0050.

## Sesta tornata — layout (dalle foto dello schermo)

- 🔴 **La riga dei filtri lingua si mangiava tutto lo schermo.** In
  react-native-web *ogni* `ScrollView` nasce con `flexGrow: 1`, comprese quelle
  orizzontali (`commonStyle` in `exports/ScrollView`). Stando dentro la colonna
  flex della schermata, la striscia si prendeva tutta l'altezza avanzata: a
  ricerca vuota i quattro chip riempivano il display. Risolto con
  `flexGrow: 0, flexShrink: 0` esplicito.
- 🔴 **Le griglie erano larghe più del loro contenitore.** `BookCard` portava
  `marginRight: spacing.sm`, ma ogni griglia calcola le colonne con
  `gridCardWidth()` e le distanzia con `gap`: quel margine è larghezza che il
  layout non aveva previsto. Su un telefono da 390pt tre schede facevano 381pt
  dentro 358 e la terza andava a capo — **è questa la segnalazione "nel profilo
  vedo due colonne"**, che il ritocco a `gridCardWidth` non aveva risolto perché
  la causa era altrove. Margine tolto, `gap` esplicito nelle righe orizzontali
  che ci contavano (`BookRow`). Verificato a 320 / 360 / 375 / 390 / 414 / 430 /
  744 / 820 / 852 / 932 / 1440 pt: nessuna riga sfora.
- 🟠 **Tre colonne anche in orizzontale.** Ruotando il telefono la larghezza
  utile raddoppia e le stesse tre colonne gonfiavano ogni copertina a ~256pt.
  Ora il numero di colonne segue la finestra (3 in verticale, 4-5 in
  orizzontale e su tablet), puntando a una scheda da ~150pt.
- 🟠 **Il primo tocco su un risultato non apriva niente**: senza
  `keyboardShouldPersistTaps` la lista consuma il tocco per chiudere la
  tastiera. Aggiunto, insieme a `keyboardDismissMode="on-drag"`.
- 🟠 **Schermata di ricerca vuota e muta** prima di digitare: nessun testo,
  nessun suggerimento. Ora c'è un invito breve.
- 🟡 **La ricerca sporcava il catalogo.** L'espansione (~30 libri attorno ai
  risultati) partiva a ogni import: cercare "meet" ha lasciato in catalogo Meet
  Addy, Meet Kirsten e Meet Samantha per sempre. Ora l'espansione parte solo se
  la query è specifica (più di una parola, o almeno sei caratteri); l'import
  diretto resta.

Nota di metodo: queste sono state verificate leggendo il sorgente di
react-native-web e ricalcolando la larghezza delle griglie a ogni breakpoint,
non con uno screenshot — il browser headless non arriva a Supabase da questo
ambiente, quindi la schermata autenticata non è riproducibile qui.

---

## Note operative (a carico del founder, pre-lancio)

- 🔴 **Rotazione chiavi** esposte in chat (OpenRouter, Supabase, PAT).
- 🟠 **Upgrade compute Supabase** (fix radice velocità) + verifica backup/PITR.
- 🟠 **Monitoring**: raccolta errori client (es. Sentry) e allerta su cron falliti.
- 🟡 **Email di contatto** reale nelle pagine legali; CI (GitHub Action) per typecheck+build.
