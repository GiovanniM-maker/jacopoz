# Piano prestazioni e affidabilità — misurato il 15 agosto 2026

Questo documento nasce da un'analisi del codice cercando tre cose: bug,
lentezze del caricamento, e debolezze dell'infrastruttura. **Ogni voce ha un
numero misurato accanto**, perché su questo progetto ho già sbagliato due
diagnosi ragionando per ipotesi (il `length()` che avrebbe decompresso, il
`limit` parametrico che avrebbe impedito il top-N: entrambe misurate, entrambe
false).

L'ordine è per danno al lettore, non per fatica.

---

## Il numero che spiega quasi tutto

La stessa query, due volte di fila:

```
get_reco_by_availability(gratis)   4994 ms     ← tabella non in memoria
get_reco_by_availability(gratis)     68 ms     ← tabella in memoria
```

Un fattore **73**. Il motivo:

| | dimensione |
|---|---|
| tabella `books` | 79 MB |
| indici su `books` | **191 MB** |
| `shared_buffers` (Micro, 1 GB di RAM) | **224 MB** |

Il set di lavoro non ci sta. Quindi la latenza dell'app non dipende dal codice
ma da **cosa è stato sfrattato dalla cache un istante prima**. È anche il motivo
per cui `search_books` misura 74 ms una volta e 685 ms quella dopo.

La conclusione operativa non è «serve più RAM». È: **smettere di leggere
33.526 righe per restituirne 15.** Una query che usa un indice per prendere i
primi 15 non le importa se la tabella è residente.

---

## A. Lentezze misurate sul percorso del lettore

### A-1 · La carta «libri gratis» della Home non arriva agli anonimi
**Impatto: alto. Costo: mezz'ora.**

```
get_reco_by_availability(true, 15)   4994 ms a freddo
```

Il piano: `Seq Scan on books` di 33.526 righe (1.465 ms solo di lettura da
disco), poi ordinamento, poi `limit 15`.

Ma `anon` ha `statement_timeout = 3s`. **Per un visitatore non autenticato
quella carta non arriva mai** — e non arriva come lista vuota, senza errore.
È lo stesso modo di rompersi che ci ha fatto perdere tre giorni sulla ricerca.

C'è un indice `books_free_read_idx` che dovrebbe servire proprio a questo:
**zero utilizzi**. Non combacia, perché l'ordinamento è su un'espressione di
popolarità che l'indice non contiene, e perché ha una condizione in più
(`cover_url is not null`) che la query non chiede.

**Da fare:** indici sull'espressione di popolarità, parziali sui due rami:

```sql
create index books_free_pop_idx on public.books
  ((reads_count*3 + saves_count*2 + likes_count*2 + reviews_count) desc)
  where free_read_url is not null;

create index books_paid_pop_idx on public.books
  ((reads_count*3 + saves_count*2 + likes_count*2 + reviews_count) desc)
  where gutenberg_id is null;

drop index books_free_read_idx;        -- 2 MB, mai usato
drop index books_external_rating_idx;  -- 40 kB, mai usato
```

Atteso: da 4994 ms a decine di ms, e senza dipendere dalla residenza.

**Da verificare dopo, non da assumere:** l'ordinamento della funzione ha il
vettore di gusto come *prima* chiave. Con un lettore che ha già uno scaffale,
l'indice sulla popolarità non basta e il piano cambia. Il numero dei 4994 ms
l'ho misurato **senza utente** (`auth.uid()` nullo), quindi vale per il
visitatore anonimo — che è il caso peggiore e quello che oggi non funziona. Per
il lettore autenticato va misurato a parte.

### A-2 · La RPC principale della Home sta fra 1 e 3 secondi
**Impatto: alto. Costo: da indagare, mezza giornata.**

```
get_home_sections(42, 5)   1050 ms  … 3165 ms
get_recommendations        774 ms
```

`get_home_sections` è 8.980 caratteri di plpgsql con una ricerca vettoriale.
Non l'ho ancora aperta: **prima va strumentata**, perché è la funzione che
decide il primo schermo e non so quale dei suoi pezzi costa. Da fare con
`auto_explain` o spezzandola e misurando i rami separatamente.

Non propongo una correzione che non ho misurato.

### A-3 · Le scansioni sequenziali su `books`
**Impatto: medio (era alto). Costo: già in parte pagato.**

```
books   66.036 scansioni sequenziali, 30.388 righe in media
```

Cumulate dal 30 giugno. Venivano dai cron che facevano una scansione completa
della tabella ogni pochi minuti: prima di ieri erano ~1.000 scansioni complete
al giorno. La riduzione di 0074 le ha già tagliate. Resta da dare un indice
alle code (`internal_blurb_queue`, `internal_synopsis_queue`), che per
costruzione ordinano tutto il catalogo per priorità.

*(`analytics_events` con 223.747 scansioni e zero usi di indice **non** è un
problema aperto: viene dal piano nested-loop corretto ieri con l'ANALYZE, dove
una singola query rieseguiva la scansione per ogni riga esterna.)*

---

## B. Caricamento dell'app

### B-1 · La cache persistita è in gran parte sprecata
**Impatto: medio-alto. Costo: una riga.**

```
queryClient   gcTime: 5 * 60_000        (5 minuti)
queryPersist  MAX_AGE_MS: 24 ore
```

React Query butta via una query inattiva dopo `gcTime`. Quindi il lavoro fatto
per conservare la cache 24 ore serve solo a ciò che viene rimontato **entro
cinque minuti**: la Home sì, tutto il resto no. E navigare via da una schermata
e tornarci dopo cinque minuti rifà tutte le richieste.

**Da fare:** `gcTime: 24 * 60 * 60_000`, allineato al persister. Da misurare
dopo: quante richieste fa una sessione di navigazione tipica, prima e dopo.

### B-2 · Il bundle è un file unico da 485 KB
**Impatto: medio. Costo: mezza giornata, con incertezza.**

```
entry-…js   1,8 MB crudo   485 KB gzip
```

Tutto in un file: la schermata di accesso paga il lettore Gutenberg, la
ricerca, la composizione delle recensioni. L'`asyncRoutes` era già stato
provato e **non divideva niente** con `web.output: "single"` — l'avevo
verificato svuotando la cache di Metro e l'ho rimosso invece di lasciarlo lì a
sembrare funzionante.

La strada vera è `web.output: "static"` (una pagina per rotta, con divisione
del codice), ma cambia il modello di deploy e le riscritture su Vercel. **Non è
una riga**: va provato su un'anteprima e misurato con Lighthouse prima e dopo.
Se non porta almeno il 30% in meno sul primo caricamento, non vale la
complicazione.

### B-3 · Ogni copertina si ridisegna a ogni risoluzione di lotto
**Impatto: basso. Costo: venti minuti.**

`freeBooks.ts` risolve gli id in un solo giro di rete — quel pezzo è fatto bene
— ma `notify()` chiama **tutti** gli iscritti: con cento copertine a schermo,
cento ridisegni per ogni lotto risolto. Su un telefono di fascia media durante
lo scorrimento si vede.

**Da fare:** iscrizione per id invece di una lista globale.

---

## C. Errori che si presentano come successi

### C-1 · Dieci letture del client leggono `data` e ignorano `error`
**Impatto: medio, ma è il difetto che mi ha ingannato tre volte. Costo: un'ora.**

```
lists.ts:115   bookmarks.ts:38,70,87   reading.ts:46
reviews.ts:109   social.ts:48   comments.ts:69
```

Se una di queste va in errore, il lettore vede **una lista vuota**: «non hai
salvataggi» invece di «qualcosa non ha funzionato». Ieri lo stesso schema in
`blurbs`/`synopsis` ha fatto sembrare finito un backfill che era stato
cancellato per timeout, e stamattina durante il guasto le stesse funzioni —
corrette — hanno restituito 503 con il motivo. La differenza fra le due giornate
è tutta lì.

**Da fare:** propagare l'errore e distinguere a schermo «vuoto» da «non ha
funzionato». Aggiungere un controllo alla suite che vieti il ritorno silenzioso
di lista vuota su una lettura fallita.

---

## D. Infrastruttura

### D-1 · Nessuno si accorge se l'app è giù
**Impatto: il più alto di tutti. Costo: un'ora.**

Stamattina il database è stato irraggiungibile per circa due ore. L'ho scoperto
**per caso**, perché mi ero programmato una sveglia per un'altra cosa. Se non
avessi avuto quella sveglia, l'avresti scoperto tu quando qualcuno ti scriveva.

**Da fare:** un controllo esterno che chiami l'API pubblica ogni cinque minuti e
mandi una notifica quando fallisce due volte di fila. Non serve niente di
sofisticato: l'endpoint di salute di Supabase più un servizio gratuito di
monitoraggio, oppure una funzione pianificata che scriva su una tabella e un
allarme se smette.

### D-2 · I 42 controlli girano solo se li lancio io
**Impatto: alto sul medio periodo. Costo: due ore.**

Non c'è `.github/workflows`. `typecheck`, `lint` e `spec-test.py` esistono e
funzionano, ma nessuno li esegue automaticamente. Le tre regressioni di ieri
(colonna rinominata, funzione esposta, import rotto) sarebbero state prese da
una CI al momento del push invece che ore dopo.

**Da fare:** un workflow su push che esegue typecheck + lint, e uno pianificato
che esegue la suite contro produzione. La chiave anon serve come segreto del
repository, non nel codice.

### D-3 · Fino a 24 ore di dati a rischio
**Impatto: medio ora, alto dopo il lancio. Costo: soldi.**

`pitr_enabled: false`. Ci sono backup fisici giornalieri (l'ultimo alle 06:27),
quindi un guasto grave costa fino a un giorno di recensioni e scaffali. Con sei
lettori è accettabile; con dei lettori veri no. Il ripristino puntuale è un
componente a pagamento: **decisione tua**, non tecnica.

### D-4 · Le chiavi incollate in chat sono ancora attive
**Impatto: alto al momento dell'apertura al pubblico. Costo: mezz'ora, tua.**

OpenRouter, Supabase (segreta e pubblicabile), il token di gestione, Google
Books. Vanno ruotate **prima** che l'app sia raggiungibile da estranei, e la
chiave Google va limitata alla sola Books API.

---

## Ordine che propongo

| # | cosa | perché prima | costo |
|---|---|---|---|
| 1 | **A-1** indici per le carte della Home | una carta oggi non arriva agli anonimi, ed è misurato | mezz'ora |
| 2 | **B-1** `gcTime` allineato al persister | una riga, effetto su ogni navigazione | 5 minuti |
| 3 | **D-1** allarme se l'app è giù | senza, il prossimo guasto lo scopri dagli amici | un'ora |
| 4 | **C-1** errori che non diventano liste vuote | è il difetto che ho ripetuto tre volte | un'ora |
| 5 | **D-2** CI su typecheck, lint, suite | avrebbe preso le tre regressioni di ieri | due ore |
| 6 | **A-2** strumentare `get_home_sections` | è il primo schermo, ma prima va misurato | mezza giornata |
| 7 | **A-3** indici per le code | il carico è già ridotto, questo lo chiude | un'ora |
| 8 | **B-3** iscrizione per id nelle copertine | piccolo, visibile solo su telefoni lenti | venti minuti |
| 9 | **B-2** divisione del bundle | incerto: da provare e misurare, non da assumere | mezza giornata |

I punti **D-3** (ripristino puntuale) e **D-4** (rotazione chiavi) non sono
lavoro mio: sono decisioni e azioni tue.

---

## Cose che ho verificato e che **non** sono problemi

Le scrivo perché un piano che elenca solo i difetti fa sembrare tutto rotto.

- **RLS**: `blurb_quota`, `book_cooccurrence`, `embed_batches`, `enrich_jobs`,
  `user_taste_clusters` hanno RLS attiva con zero policy — cioè negano tutto.
  Corretto per tabelle interne, non è una dimenticanza.
- **Le copertine non fanno N+1**: `freeBooks.ts` raccoglie gli id di un tick e
  li risolve in una chiamata sola, con cache di sessione. È scritto bene.
- **Un indice HNSW parziale non conviene**: pensavo di poterlo ridurre
  limitandolo ai libri con copertina, ma **65.090 su 69.020 ce l'hanno** —
  risparmierebbe il 6%. Scartato dopo la misura, non proposto.
- **La Home è già a due stadi**: quattro query prima del primo disegno, le
  altre cinque dietro `primoDisegno`. La struttura è giusta.
- **Le intestazioni di cache su Vercel sono giuste**: `immutable` per un anno
  sugli asset statici, `must-revalidate` sul service worker.
