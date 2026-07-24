# Tomo — Checklist di implementazione

Checklist viva delle cose da fare, in ordine di priorità. Aggiornata a fine
sessione "qualità dati + temi + velocità". Le voci ✅ sono già in produzione.

Legenda effort: **S** = poche ore · **M** = 1–2 giorni · **L** = settimana+.

---

## ✅ Fatto

**Lettura & catalogo**
- [x] Lettore in-app per libri di pubblico dominio (scroll, progresso salvato, 90% → "letto")
- [x] Link Amazon su **ogni** libro; badge "Leggi gratis" / "Non disponibile gratuitamente"
- [x] Nomi autori normalizzati (cirillico → latino, patronimico rimosso) su tutte le fonti
- [x] Filtro spazzatura (atti di convegni/seminari, guide di studio)
- [x] Import automatico su ricerca a vuoto (Gutenberg + Google + Open Library)
- [x] Embedding **sincrono** all'import → libro cercato subito raccomandabile
- [x] Espansione catalogo guidata dalla ricerca (autore + soggetto correlati)
- [x] **Seed massivo Project Gutenberg curato**: catalogo 35k → **67k libri**, gratis leggibili ~1.1k → **33k**

**Scoperta & profilazione**
- [x] Onboarding a 2 step: generi + **sottogeneri** (36) e "libri che hai letto" + voti (semina il vettore di gusto)
- [x] Righe home "Gratis, consigliati per te" e "Nuove scoperte · a pagamento"
- [x] Tag categoria cliccabili → pagina Sezione; **sottogeneri navigabili** (chip + ricerca per nome)
- [x] **Scaffali stile Goodreads**: Voglio leggere / Sto leggendo / Letto / **Non finito (DNF)**, controllo a segmenti sul libro + sezione "Scaffali" nel profilo
- [x] Fix ricerca onboarding (locale-first, import in background, niente blocco)

**Qualità dati & lettura**
- [x] **Copertine**: 94% dei libri (backfill Gutenberg + fallback poster su immagini rotte)
- [x] **Sinossi**: pipeline arricchimento riempie la descrizione (Open Library + Wikipedia), su apertura + notturno
- [x] **Segnalibro** deliberato nel lettore (pulsante flottante + marcatore + "riprendi dal segnalibro")

**Piattaforma & UI**
- [x] PWA installabile: banner al login + voce in Impostazioni + istruzioni iOS
- [x] Nuova **icona app** (lettermark "T" vermiglio)
- [x] Documento algoritmo su `/algoritmo` (protetto da password, AES-256)
- [x] **Temi ridotti a 3** (Rivista default, Rivista Notte, Notturno); secondario **verde → ottone**
- [x] **Responsive tablet/desktop** (colonna centrata max 820px, card ridimensionate)
- [x] **Velocità**: cron "warm vectors" — reco da ~1s (freddo) a ~3-60ms (caldo); ricerca 80ms, feed 76ms già ok

---

## 🚦 Bloccante velocità (paghi tu, ma è IL fix)

- [ ] **Upgrade compute Supabase** (istanza più grande, più RAM) — **~10-25€/mese** — **S (in dashboard)**
      → l'indice vettoriale (138 MB) starebbe stabilmente in RAM: consigli/"simili" sempre ~3ms,
      niente più cache fredda. È la causa radice della lentezza percepita. Il cron "warm vectors"
      è solo un cerotto.

---

## 🚦 Bloccanti pre-lancio pubblico (responsabilità tua)

- [ ] **Ruotare tutte le chiavi API** incollate in chat (OpenRouter, Supabase anon/secret/publishable, PAT) — **M**
      → nuove chiavi solo in Supabase (Vault + Edge secrets), **mai** su Vercel
- [ ] Aggiungere **email di contatto** nelle pagine legali (privacy + termini) — **S**
- [ ] Verifica finale RLS su tutte le tabelle (nessuna scrittura anonima) — **S**

---

## 🎯 Da implementare ora (pre-trazione, costo ~zero)

Cose economiche che migliorano il prodotto prima di cercare utenti.

- [ ] **Standard Ebooks** come seconda fonte pubblico dominio (impaginazione migliore dei classici) — **M**
- [ ] **Tag affiliazione Amazon** (Associates) sui libri più letti, non su tutti — **S**
- [ ] Migliorare il match Gutenberg cross-lingua (ora l'edizione IT non trova il testo EN) — **M**
- [ ] **Segnalibri multipli** per lo stesso libro (ora è uno solo) — **S**
- [ ] Empty-state curati su feed/ricerca/profilo quando è tutto vuoto — **S**
- [ ] Tagging dei libri a livello di **sottogenere** (oggi i libri hanno solo il genere madre) — **M**
- [ ] Chiave **API Google Books** per sinossi/copertine complete (la abiliti tu) — **S**

---

## 📣 Crescita & Social — "deve essere un social, non un catalogo"

Il nord del progetto: portare persone e farle **interagire** (à la Instagram),
non solo consultare libri. In ordine di leva (vedi analisi in chat).

**Il ciclo virale (fai per primo)**
- [x] **Condivisione bella all'esterno**: card magazine-cover auto-generata di un libro
      (`shareBookCard`, SVG→PNG, Web Share API) da postare su IG/WhatsApp
- [x] **Inviti + trova amici**: schermata "Trova lettori" (`find-friends`) con invito via
      share sheet (`inviteFriend`) + lettori suggeriti con follow inline
- [x] **Notifiche di ritorno in-app**: like/commento/follow → riga notifica (trigger DB
      `0032`, campanella con badge non-letti, inbox `/notifications`)
- [x] **Push PWA vero (VAPID)**: `0033` push_subscriptions + trigger `dispatch_push` →
      Edge Function `send-push` (npm:web-push, firma VAPID + cifratura payload) →
      service worker mostra la notifica e apre la schermata giusta. Pulsante "Attiva le
      notifiche" nell'inbox; re-sync silenzioso al login. Pipeline server testata end-to-end
      (`{"sent":0}` senza device registrati). Chiavi: pubblica nel client, privata +
      dispatch secret nei secret Edge/Vault (mai nel repo).
      · **Su iPhone il push funziona solo se l'app è aggiunta alla schermata Home** (iOS 16.4+)

**Il feed come prodotto principale (non le liste)**
- [x] **Striscia "Lettori attivi"** (storie stile IG) in cima al tab **Feed**: avatar dei
      lettori → tocchi → entri nel profilo. Sopra "Per te / Seguiti", scorrono insieme.
      (Deciso: si tiene l'estetica del Feed attuale; l'anteprima `feed-home` separata è
      stata rimossa, se ne è preso solo il pezzo delle storie.)
- [ ] Il **Feed** diventa la home reale: recensioni degli amici + attività, non solo scaffali — **M**
- [ ] Azioni social a un tap sotto ogni post: like, commento, "anch'io lo voglio leggere" — **S**
- [ ] Profili pubblici forti: identità di lettore (generi, statistiche, scaffali in vetrina) — **M**
- [ ] **Formati brevi**: micro-recensione / "shelfie" / citazione con sfondo — il TikTok dei libri — **M**

**Portare i primi utenti (go-to-market)**
- [ ] Nicchia di partenza: **BookTok/Bookstagram IT** (dark romance, romantasy) — community calde — **—**
- [ ] Seed di contenuti veri (recensioni reali) perché il feed non sia vuoto al lancio — **M**
- [ ] Creator/micro-influencer del libro come primi ambasciatori — **—**

---

## 🌱 Da implementare dopo (quando l'app comincia a funzionare)

Hanno senso solo con traffico reale — non prima.

- [ ] **Layer "gratis ora"**: monitorare le promo a tempo (es. Kindle gratis oggi) e mostrare
      "Gratis ora su [fonte] ↗" durante la finestra, poi tornare al link d'acquisto — **L**
      → è **monitoraggio di disponibilità + link**, mai download/hosting del file
- [ ] **Indie gratis legali** (reader-magnet: sito autore / BookFunnel / promo KDP) come link-out — **M**
- [ ] Submission agli store nativi (EAS build → App Store / Play Store) — **L**
- [ ] Recensioni esterne su più libri (pipeline enrichment già presente, allargare copertura) — **M**
- [ ] StoryGraph-style: tag mood/ritmo per raffinare i consigli — **M**

---

## 🧠 Algoritmo (miglioramenti offerti, opzionali)

- [ ] Cache dei consigli per-utente (tabella precalcolata) invece di cosine live ad ogni home — **M**
- [ ] Ricerca semantica ibrida (testo + vettore) invece di sola FTS — **M**
- [ ] Slot di esplorazione tarati sui dati reali una volta raccolti i primi segnali — **S**

---

## 📈 Scaling — accendere SOLO quando scatta il segnale

Lo stack attuale (Supabase + Vercel + OpenRouter) regge decine di migliaia di
utenti. Non investire prima che uno di questi numeri si muova.

- [ ] Catalogo > 500k libri o ricerca lenta → motore di ricerca dedicato (Meilisearch/Typesense) — **L**
- [ ] Molti utenti simultanei / reco lente sotto carico → read replica + cache — **L**
- [ ] Tanti import contemporanei → coda di job + **API key Google Books** (a pagamento) — **M**
- [ ] Migliaia di lettori simultanei → CDN per il testo dei libri — **M**

---

## 📌 Principi da non dimenticare

- Il **file del libro non si salva mai** nel DB: pubblico dominio → streaming alla lettura;
  tutto il resto → link alla fonte legale. (No Z-Library, no copie a scadenza.)
- I **metadati** restano per sempre (scopribilità + raccomandazione), il file no.
- Prima il **product-market fit**, poi l'infrastruttura.
