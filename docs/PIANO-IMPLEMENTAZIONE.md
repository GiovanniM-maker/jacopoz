# Tomo — piano di implementazione, allineato al repo

Riscrittura del prompt generato dal Meta-Prompt Optimizer (13/08/2026),
allineata a ciò che esiste davvero in `giovannim-maker/jacopoz`. Il documento
originale è buono ma è stato prodotto senza vedere il codice: chiedeva di
costruire cose già in produzione e metteva in coda quella che i numeri dicono
essere la prima.

Le cifre qui sotto sono misurate, non stimate. Data: 13/08/2026.

---

## Fase 0 — ricognizione: **già fatta, non rifarla**

| | |
|---|---|
| frontend | React Native / Expo SDK 52 + expo-router 4, export web → Vercel (PWA) |
| backend | Supabase Edge Functions (Deno/TypeScript) |
| database | Supabase Postgres 17 — piano **Pro**, compute **Micro** (1 GB, 60 conn.) |
| vettori | `pgvector` nello stesso Postgres: 512 dimensioni, HNSW su `halfvec` (88 MB) |
| stato | TanStack Query v5, cache persistita su `localStorage` per utente |
| auth | Supabase Auth; RLS attiva su tutte le tabelle utente |
| AI | OpenRouter — embedding `openai/text-embedding-3-small`, arricchimento LLM |
| migration | SQL numerate in `supabase/migrations/`, **0057** l'ultima applicata |
| test | `scripts/spec-test.py`, 39 controlli contro `docs/SPECIFICA.md` |
| cron | `pg_cron`: embedding, arricchimento, categorie, cluster, warm-up |

**Fase 0 per l'agente, versione corta:** leggi `docs/SPECIFICA.md`, esegui
`python3 scripts/spec-test.py`, riporta i fallimenti. Trenta secondi invece di
una riscoperta.

---

## Lo stato reale, in numeri

```
libri in catalogo             68.817
  con una sinossi (≥80 car.)     699     1%
  con ISBN-13                 31.560    46%
  in italiano                  8.296    12%
  in italiano e dal 2000       2.948     4%
  da Gutenberg                33.416    49%
recensioni                        14     da 6 utenti
eventi analytics                 995
```

Due conseguenze che ribaltano l'ordine del documento originale.

### 1. Gli embedding girano quasi a vuoto

L'input di ogni embedding è `book_embedding_text()`:

```
titolo — autori. categorie. descrizione        (troncato a 1500 caratteri)
```

Con 699 descrizioni su 68.817, per il 99% dei libri la descrizione è vuota.
Misurato su un campione del 3%: **lunghezza mediana dell'input 66 caratteri**,
il **56% sotto i 70**. L'input tipico è:

```
Le notti bianche — Fëdor Dostoevskij. literary, romance.
```

Su 66 caratteri il segnale dominante non è il contenuto del libro: è **il nome
dell'autore e l'ortografia della lingua**. Tutto ciò che poggia sugli embedding
poggia su questo — l'indice HNSW, i 200 filoni, i "libri simili", i consigli, e
persino la deduzione delle categorie (che infatti è stata misurata al 92% di
accordo *contro categorie a loro volta dedotte così*).

Verifica a posteriori sui filoni prodotti: il cluster 186 è **interamente David
Foster Wallace**, il 72 è **interamente in spagnolo**. Non sono filoni tematici
travestiti bene: sono raggruppamenti per autore e per lingua.

**Non vanno buttati, vanno ricalcolati dopo le sinossi.** Il costo del
ricalcolo è irrisorio: 68.817 × ~375 token = 25,8 M token ≈ **0,52 $**. Il
lavoro vero è la CPU del k-means (~10 min per iterazione su Micro), non l'API.

### 2. La banda di similarità non è calibrabile adesso

W4 propone di scegliere i complementari nella banda 0,35–0,55 di distanza
coseno. Su embedding costruiti da metadati, quella banda misura **quanto sono
diversi due titoli e due nomi propri**, non quanto sono diversi due libri.
Calibrarla ora vorrebbe dire tarare uno strumento su un segnale sbagliato e poi
doverlo ritarare da capo. W4 va **dopo** il ricalcolo.

---

## Ordine di esecuzione

```
W2  sinossi          →  RE-EMB  ricalcolo embedding  →  RE-CLU  ricalcolo filoni  →  W4  complementari
                     ↘  W1b  opera/edizione (indipendente, ma prima che le recensioni crescano)
```

W5–W9 sono indipendenti e possono correre in parallelo in qualsiasi momento.

---

## Workstream

### W2 — Sinossi  ⭐ **priorità massima**  · da fare

Politica a tre livelli invariata rispetto al documento originale: ufficiale
licenziata → generata e **dichiarata** → stato vuoto onesto. Vincoli sulla
generazione (60–90 parole, terza persona, niente spoiler oltre il primo terzo,
niente formule da quarta di copertina, tracciamento di modello/prompt/data)
invariati: sono scritti bene.

**Aggiunta necessaria — l'ordine di generazione.** 68.000 sinossi non si fanno
in un batch. La coda si ordina così:

1. **on-demand al primo click** su un libro senza sinossi (blocca nulla: la
   scheda si apre, la sinossi arriva);
2. **backfill per priorità**, in quest'ordine di merito:
   - libri con eventi in `analytics_events` (995 eventi oggi: pochi ma sono il
     segnale più onesto che abbiamo);
   - libri presenti nelle sezioni della Home e nei risultati di ricerca più
     frequenti;
   - libri dei filoni più popolati e con copertina;
   - il resto, a esaurimento.

Con 68.817 libri e 6 utenti attivi, la coda on-demand da sola copre quello che
qualcuno guarda davvero. La percentuale percepita passa da 1% a «quasi tutto»
molto prima che il backfill finisca.

**Criterio di uscita:** ogni libro raggiungibile dalla UI ha una sinossi entro
3 secondi dall'apertura della scheda, licenziata o generata e etichettata.

### RE-EMB — Ricalcolo degli embedding  · da fare, dopo W2

- Ricalcolare solo i libri la cui `book_embedding_text()` è cambiata in modo
  sostanziale (lunghezza cresciuta oltre una soglia), non tutti.
- Costo API trascurabile (~0,52 $ per l'intero catalogo).
- **Prima di ricalcolare, decidere se cambiare modello.** `text-embedding-3-small`
  è la scelta attuale e non è stata benchmarkata sull'italiano. Il documento
  originale ha ragione: benchmark su 200 libri italiani reali e 50 coppie
  annotate a mano, confronto con almeno Gemini Embedding 2, Voyage, Jina v4,
  BGE-M3, multilingual-E5. **Ma il benchmark ha senso solo dopo W2**: oggi
  confronterebbe modelli su 66 caratteri di metadati, dove vincono tutti e non
  significa niente.
- Cambiare modello significa cambiare dimensioni → ricostruire l'indice HNSW
  (misurato: ~4 minuti, e va fatto via `pg_cron` perché supera il timeout
  dell'API di gestione).

### RE-CLU — Ricalcolo dei filoni  · da fare, dopo RE-EMB

La macchina esiste ed è già stata eseguita una volta (`0055`, `0057`):
seeding farthest-point, k-means, etichette da genere e autore sovra-rappresentato.
Va rilanciata sugli embedding nuovi, e **rifatte le etichette**, che oggi hanno
quattro difetti noti e misurati:

- la **lingua** non entra nel nome, e su questi embedding è il tratto dominante
  («Saggistica · attorno a José Daniel Rodrigues da Costa» per 2.728 libri in
  portoghese);
- passano **autori che non sono persone** («Economia · attorno a Germany»);
- i **marcatori di ruolo** finiscono nel nome («Dick [Illustrator] Francis»);
- **14 filoni su 200 condividono l'etichetta** con un altro.

### W1b — OPERA vs EDIZIONE  · parziale, da completare

Il punto tecnico migliore del documento originale, e ha ragione.

**Esiste:** `books.work_key` popolato su 67.023 libri, `get_book_editions()`,
ricerca che restituisce una riga per opera, merge lato client.

**Manca:** le recensioni si agganciano a `reviews.book_id`, cioè **all'edizione**.
Due edizioni dello stesso romanzo dividono le recensioni. Con 14 recensioni non
si vede; a 14.000 è una migrazione dolorosa. Va fatto ora, proprio perché costa
poco ora.

### W1a — Ingest on-demand ed espansione  · **fatto e verificato**

Non rifarlo. Verificato end-to-end (`R-7`, `R-7b` in `spec-test.py`): un libro
assente viene importato alla ricerca e porta con sé i vicini — ultima misura
7 diretti + 28 simili, autore da 0 a 15 libri.

Fonti a cascata: Gutendex → Google Books (con chiave, `langRestrict`,
`printType=books`, retry con `country`) → Open Library. Espansione via
`inauthor:` con ripiego sul testo libero e `subject:` sulle categorie grezze.
Dedup per ISBN-13 e per titolo+autore normalizzati. Errori dell'espansione
riportati in `expand_error` invece che ingoiati.

**Correzione al criterio di accettazione originale.** «L'ingest non blocca la UI
oltre 300 ms» è irrealistico: gli import misurano **10–24 secondi**. Il criterio
giusto è: *la UI risponde entro 300 ms, l'import prosegue in background con
stato visibile e la lista si aggiorna da sola quando arriva.* È già così.

### W3 — Clusterizzazione  · **asse A fatto, asse B da tenere spento**

**Asse A oggettivo.** Esiste: 200 filoni, mediana 230 libri, uno solo sopra
2.000. Da ricalcolare (vedi RE-CLU).

Sul **THEMA**: il documento propone di rifondare la tassonomia su THEMA. Giusto
per i **generi dichiarati** — oggi sono 19 slug inventati, e THEMA è lo standard
della filiera italiana. Ma i **filoni sono un asse diverso** e convivono: i
generi dicono *cos'è* un libro, i filoni *con cosa sta*. Non sostituire i
secondi con i primi.

**Asse B comportamentale.** Le soglie del documento (500 utenti con ≥5
recensioni, 3.000 recensioni) contro **14 recensioni da 6 utenti**: scrivere il
codice ora è prematuro. Tenerlo spento non è nemmeno una decisione difficile.

### W4 — Complementari in banda  · da fare, per ultimo

Il pezzo più intelligente del documento: distanza in **banda**, non massima;
lontani sull'asse di superficie e vicini su quello latente; filtri rigidi
(fascia d'età — il caso «giallo → Geronimo Stilton» —, divario di complessità,
blacklist, contenuti sensibili); MMR per diversificare; **una riga di
spiegazione per ogni consiglio**; «non fa per me» su ogni card.

Da implementare come scritto, **dopo** RE-EMB, per la ragione detta sopra.

### W5–W8 — Prodotto e UI  · misto

| | stato |
|---|---|
| W5 card di sollecito alla recensione | **da fare**. Con 14 recensioni è la leva più diretta sul cuore del prodotto |
| W6 onboarding, abitudini di lettura | **da fare**. L'onboarding esiste ma non chiede quanti libri all'anno |
| W7 sostituire «Top 10 su Tomo oggi» | **da fare**. La sezione esiste con quel nome esatto (`index.tsx:200`) e con 6 utenti «oggi» è vuoto per costruzione |
| W8 titoli lunghi | **da fare** come componente riusabile. Le griglie sono già responsive (3 colonne in verticale, 4–5 in orizzontale) |

### W9 — Condivisione social  · da fare

Architettura del documento corretta: **URL scheme `instagram-stories://share`**,
non la Graph API. Esiste già `src/lib/shareCard.ts` (generazione SVG lato
client) e `src/lib/invite.ts`: partire da lì.

---

## Fonti dati

**Google Books — verificato alla fonte, ed è bloccante per gli abbonamenti.**
I ToS dell'API dicono testualmente:

> *"You may not charge users any fee for the use of your application, unless you
> have entered into a separate agreement with Google or obtained Google's
> written permission."*

Oggi Google Books è la fonte principale, con chiave attiva. **Non cambiare
niente adesso**, ma l'accesso deve restare dietro un adapter con **un solo
punto di sostituzione**, e la fonte va cambiata *prima* di attivare
abbonamenti o acquisti in-app.

**Informazioni Editoriali (Alice, e-kitāb)** resta la risposta giusta al buco
vero: le edizioni italiane recenti. Il catalogo è italiano solo al 12%, e
italiano-e-recente al 4%. È B2B a pagamento: da valutare con una stima di costo.

**Livello aperto:** Wikidata, Open Library, OPAC SBN — già integrata Open
Library.

**Scraping: fuori.** Le API coprono il fabbisogno, e il buco che resta — le
edizioni italiane recenti — non lo chiude uno scraper, lo chiude IE.

---

## Criteri di accettazione, corretti

- [ ] Ogni libro raggiungibile dalla UI ha una sinossi, licenziata o generata e dichiarata
- [ ] Nessun campo con testo di terzi è raggiungibile da un'API pubblica
- [ ] **La UI risponde entro 300 ms al click**; l'import prosegue in background con stato visibile
- [ ] Gli embedding sono ricalcolati **dopo** le sinossi, e i filoni **dopo** gli embedding
- [ ] Nessuna etichetta di filone contiene un non-nome, un marcatore di ruolo o un duplicato
- [ ] I complementari rispettano banda e filtri rigidi, con una riga di spiegazione ciascuno
- [ ] Il caso «giallo → Geronimo Stilton» è impossibile per costruzione
- [ ] Le recensioni si agganciano all'OPERA, non all'edizione
- [ ] La condivisione funziona su iOS e Android senza account business
- [ ] Profilo privato di default, opt-in esplicito e granulare
- [ ] Nessuna chiave API nel bundle client (verificato da `spec-test.py`, S-4)
- [ ] Esiste un tetto di spesa giornaliero che si applica da solo
- [ ] `python3 scripts/spec-test.py` resta verde

---

## Cose che il documento originale dava per assenti e che ci sono

Da non rifare: ingest on-demand con espansione; ricerca tollerante a refusi
(26 casi su 29 su un banco di prova di errori reali); filtro di lingua netto;
ricerca per genere con sinonimi italiani; una riga per opera con selettore
edizioni; tag GRATIS su fonti legittime; notifiche push VAPID; 39 controlli
automatici contro una specifica scritta.
