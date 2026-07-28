# Audit Tomo — Linee guida

Cosa va verificato, e come, per un'app come Tomo: un **social di lettura**
(contenuti generati dagli utenti, grafo follow, notifiche push) costruito come
**PWA Expo/React Native** su **Supabase** (Postgres + RLS + Edge Functions),
deployata su Vercel. Questo documento è la checklist di riferimento: ogni audit
la percorre area per area e produce findings con severità
(🔴 critico · 🟠 importante · 🟡 miglioria · 🔵 nota).

---

## 1. Sicurezza backend (la più importante: i dati stanno tutti qui)

Il client è pubblico per costruzione (anon key nel bundle): **tutta** la
sicurezza vive in Postgres. Verificare:

- **RLS attiva su ogni tabella** di `public` — una tabella senza RLS è leggibile/scrivibile da chiunque con la anon key.
- **Ogni tabella con RLS ha policy coerenti**: RLS attiva senza policy = tabella morta (ok solo se scrive solo il service role); policy di UPDATE senza `WITH CHECK` esplicito usano l'`USING` (verificare che basti).
- **Scritture client limitate al proprietario** (`auth.uid()`), niente policy `using (true)` su INSERT/UPDATE/DELETE.
- **Funzioni SECURITY DEFINER**: devono avere `SET search_path` fissato (altrimenti hijacking dello schema) e non devono fare da "scala di privilegio" (input validati, niente SQL dinamico su input utente).
- **`GRANT EXECUTE` minimi**: le funzioni `internal_*` revocate a `anon`/`authenticated`.
- **Secrets**: mai nel repo né nel bundle; solo Vault (DB) e secret delle Edge Functions. Grep del repo per pattern (`sbp_`, `service_role`, chiavi JWT lunghe, `sk-`).
- **Edge Functions**: quelle senza JWT devono avere un proprio gate (shared secret); CORS non `*` dove non serve; niente echo di errori interni.
- **Auth**: email confirmation, password policy, rate limit sui tentativi (gestiti da Supabase Auth — verificare la config), flusso reset password non hijackabile.

## 2. Sicurezza client

- **XSS / injection nei contenuti utente**: recensioni, commenti, bio, username vengono renderizzati — su RN `<Text>` è sicuro, ma verificare ogni punto che tocca `dangerouslySetInnerHTML`, `innerHTML`, `eval`, deep link, o costruisce URL da input utente.
- **Storage locale**: cosa finisce in localStorage/AsyncStorage (sessione: ok; mai token di terzi o dati di altri utenti).
- **Deep link / router**: parametri di rotta usati in query — sempre passati come parametri (PostgREST li parametrizza), mai concatenati in SQL.
- **Contenuti esterni**: URL di copertine/avatar arrivano dal DB — verificare che immagini rotte/malevole non eseguano nulla (solo `<img>`), e che il proxy `read` non permetta SSRF (fetch solo verso host fidati).

## 3. Integrità dati

Il modello usa **contatori denormalizzati** (books.rating_sum, likes_count,
profiles.followers_count…) mantenuti da trigger, e **riferimenti polimorfici**
(likes/bookmarks su review|comment) che non possono avere FK. Verificare:

- **Drift dei contatori**: per ogni contatore, confronto col conteggio reale (query di riconciliazione). I trigger coprono INSERT/UPDATE/DELETE? E le cancellazioni a cascata (utente eliminato → i suoi like decrementano i contatori altrui)?
- **Orfani polimorfici**: likes/bookmarks/notifications che puntano a review/comment cancellate. Serve pulizia (trigger di cascade manuale o job periodico).
- **Vincoli**: unicità dove la logica la assume (1 recensione per utente+libro, 1 rating per utente+libro, 1 like per utente+target); CHECK sui range (rating 1–5).
- **Race**: doppio tap su like/follow → il vincolo unico deve rendere l'operazione idempotente, non un errore visibile all'utente.
- **Cancellazione account**: `delete_my_account` rimuove davvero tutto (GDPR) e i contatori restano coerenti dopo.

## 4. Correttezza logica applicativa

- **API layer client**: ogni chiamata gestisce l'errore o lo lascia esplodere in modo controllato? Promise non attese (`void x()` intenzionale vs dimenticato)?
- **Cache TanStack Query**: chiavi coerenti (stessa risorsa = stessa chiave), invalidazioni complete dopo ogni mutazione, optimistic update con rollback.
- **Stati vuoti/di caricamento** su ogni schermata; nessun accesso a `data!` prima del load.
- **Fusi orari e date**, paginazione/limiti (le liste crescono), testo lungo (recensioni 5000 char) che non rompe il layout.
- **Doppia sottomissione**: bottoni disabilitati durante il submit.

## 5. Performance

- **Query calde** (home, feed, ricerca, scheda libro): EXPLAIN ANALYZE sotto i ~100ms warm; indici su ogni colonna filtrata/ordinata e su ogni FK usata nei join.
- **N+1 client**: schermate che fanno una chiamata per elemento invece di una per lista.
- **Bundle web**: dimensione, import pesanti inutili, immagini ottimizzate.
- **Cold start noto**: istanza piccola → cache evict (mitigato dal cron warm-vectors; fix vero = upgrade compute).

## 6. PWA & Push

- **Cache del service worker**: gli utenti ricevono i deploy nuovi? (network-first sull'HTML: ok; verificare che il SW stesso si aggiorni — `updatefound`/skipWaiting).
- **Offline**: la shell si apre; le azioni falliscono con messaggio chiaro, non silenziosamente.
- **Push lifecycle**: endpoint scaduti pruned (404/410); revoca permesso → riga rimossa; niente push a utenti che si sono disconnessi; contenuto push non contiene dati sensibili.
- **iOS specifics**: installazione da Safari, permesso richiesto da gesto utente, icone corrette.

## 7. UX & Accessibilità

- **accessibilityLabel** su ogni controllo icon-only; contrasto testo/sfondo nei 3 temi; touch target ≥ 40px.
- **Errori umani**: mai stack trace o silenzio; sempre "cosa è successo + cosa fare".
- **Localizzazione**: lingua coerente (tutto in italiano), date relative localizzate.

## 8. Legale & Compliance

- **GDPR**: privacy policy raggiungibile, cancellazione account self-service, export dati (nice-to-have), niente tracking di terzi non dichiarato.
- **Copyright**: solo streaming di opere di pubblico dominio (Gutenberg) + link d'acquisto; niente hosting/download di opere protette.
- **UGC**: ToS con regole sui contenuti, segnalazione + moderazione funzionanti (obblighi DSA per piattaforme UGC), blocco utenti.
- **Contatti**: email di contatto reale nelle pagine legali (pendente, a carico del founder).

## 9. Operazioni

- **Backup**: PITR/backup automatici attivi sul progetto Supabase; testato un restore?
- **Monitoring**: log delle Edge Functions consultati? Errori client raccolti da qualche parte (Sentry o simili)? Cron falliti: chi se ne accorge?
- **Chiavi**: rotazione programmata delle chiavi esposte in chat (pendente, bloccante per il lancio); PAT di management mai nel repo.
- **CI**: typecheck + build su ogni push (oggi manuale in sessione; GitHub Action = miglioria).

## 10. Scalabilità & Costi

- **Colli di bottiglia al crescere**: feed community (scan recensioni recenti), cosine similarity live per ogni utente (mitigata da cache/cron), pg_net per ogni notifica (batch se volume alto).
- **Limiti free tier**: Edge Function invocations, DB size (67k libri + embeddings), bandwidth immagini (copertine servite da Gutenberg/OpenLibrary: ok, non nostro storage).
- **Stima costi** al primo migliaio di utenti attivi.

---

## Metodo

1. Percorrere le aree nell'ordine (1→10): prima ciò che può far male agli utenti, poi ciò che fa male al prodotto.
2. Per il DB: query di verifica dirette (RLS, drift, orfani, indici) via management API.
3. Per il client: lettura mirata del codice per area, non a campione.
4. Ogni finding: **severità, dove, cosa succede, fix proposto**. Niente finding senza scenario di fallimento concreto.
5. I fix piccoli si applicano subito; i grandi diventano voci di checklist con stima.
