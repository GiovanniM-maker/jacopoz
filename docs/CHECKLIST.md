# Tomo — Checklist di implementazione

Checklist viva delle cose da fare, in ordine di priorità. Aggiornata a fine
sessione "catalogo + scaffali + icona". Le voci ✅ sono già in produzione.

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

**Piattaforma**
- [x] PWA installabile: banner al login + voce in Impostazioni + istruzioni iOS
- [x] Nuova **icona app** (lettermark "T" vermiglio, stile pulp)
- [x] Documento algoritmo su `/algoritmo` (protetto da password, AES-256)

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
- [ ] Segnalibro/più posizioni di lettura per lo stesso libro — **S**
- [ ] Empty-state curati su feed/ricerca/profilo quando è tutto vuoto — **S**
- [ ] Tagging dei libri a livello di **sottogenere** (oggi i libri hanno solo il genere madre) — **M**

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

- [ ] Two-stage funnel per `get_recommendations` (oggi ~327ms su 35k libri; serve a volume) — **M**
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
