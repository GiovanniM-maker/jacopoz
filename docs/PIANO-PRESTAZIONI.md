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

> **Aggiornamento del 17 agosto, e va letto con cautela.** Strumentata mentre
> facevo il filtro italiano (0082–0083), con `explain analyze` dentro una
> transazione col ruolo `authenticated`, tre giri, su lettori veri:
>
> ```
> get_home_sections        63 – 74 ms      (era 1.050 – 3.165)
> get_recommendations     240 – 263 ms     (era 774)
> get_reco_by_availability 23 –  27 ms
> get_trending_seeded       4 –   5 ms
> ```
>
> **Non concludo che A-2 è risolta**, per due motivi. Il primo è che i numeri
> vecchi erano tempi HTTP dall'esterno e questi sono tempi lato server: non sono
> la stessa grandezza, e confrontarli sarebbe l'errore di 0081 rifatto. Il
> secondo è che il primo giro di ogni misura sta fra 1 e 6 secondi, sempre — a
> freddo il divario è quello, e il primo lettore della giornata paga il giro a
> freddo. Quello che è misurato è che **a caldo il costo non sta più qui**.
>
> Il resto di A-2 è quindi: perché il giro a freddo costa 1–6 s, che è una
> domanda su 224 MB di `shared_buffers` contro un set di lavoro di 270 MB, non
> su questa funzione.

### A-4 · Questa istanza non regge un'aggregazione su tutto il catalogo mentre serve i lettori

**Impatto: alto, ed è la cosa che ho imparato peggio. Costo: già pagato, due volte.**

Il 18 agosto, lavorando alle etichette dei filoni, ho fermato la base dati due
volte in venti minuti. Non «rallentato»: **fermato**. Il sito continuava a
rispondere 200 — è una pagina statica — e ogni lettura di dati andava in timeout.

```
10:37 ca.   internal_label_clusters, prima stesura      la base dati smette di accettare connessioni
            (autore_e_persona su 91.399 righe)          si riprende da sola dopo qualche minuto
10:52 ca.   explain analyze della stessa aggregazione   di nuovo giù
10:55       impossibile perfino connettersi per fare pg_terminate_backend
10:56       riavvio del progetto dalla Management API
10:58:50    lettori serviti di nuovo
```

**La diagnosi completa, che la prima volta avevo sbagliato per difetto.** La
query pesante non era sola: la migrazione 0085, applicata mezz'ora prima, aveva
rimesso in coda 2.229 libri per il ricalcolo dell'embedding, e ogni libro
riembeddato è un inserimento in un indice HNSW da 91 MB. L'aggregazione è
arrivata **sopra** a quell'onda. Probabilmente nessuna delle due, da sola,
avrebbe fatto danno.

Tre cose ne escono, e valgono più della correzione puntuale:

1. **Il ruolo `postgres` non ha `statement_timeout`.** È comodo per le migrazioni
   ed è esattamente ciò che ha permesso il guasto: `authenticated` sarebbe stato
   fermato a 8 secondi. Ora `internal_label_clusters` porta il suo limite (30 s),
   e le query esplorative vanno scritte con `set statement_timeout` in testa.
   Non è un dettaglio di stile: è la differenza fra una query che fallisce e una
   che porta via l'app.

2. **Trenta secondi, non novanta.** Il primo limite che avevo messo era di
   novanta secondi, e sarebbe stato una protezione finta: l'istanza si è
   ingolfata molto prima. Un limite che scatta dopo il danno è un commento.

3. **Le due cose non si fanno lo stesso giorno.** Un'onda di ri-embedding e un
   ricalcolo dei filoni sono entrambe operazioni da catalogo intero: la seconda
   aspetta che la prima sia finita.

Il contesto è sempre quello di B-1 e A-2: 224 MB di `shared_buffers` contro un
set di lavoro di 270 MB. Su questa taglia, «gira una query e vediamo» non è una
misura, è un rischio.

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

*Fatto il 17 agosto: `scripts/check-silent-errors.py` + un lavoro di CI.*

### C-2 · La forma che il controllo di C-1 non vedeva

**Impatto: alto, ed è misurato, non temuto. Costo: pagato il 17 agosto.**

`check-silent-errors.py` cercava `const { data } = await supabase...`: una
lettura che destruttura `data` e lascia fuori `error`. Ma esiste una seconda
forma, che non destruttura niente:

```ts
try { await supabase.rpc("save_read_progress", { … }); } catch { /* best-effort */ }
```

supabase-js **non solleva**: restituisce `{ data, error }`. Quel `try/catch` non
aveva niente da catturare, e nessuno leggeva `error`. Nove chiamate nel client
avevano questa forma.

Quanto è costato saperlo tardi:

```
save_read_progress   errore di tipo 42804 per ogni percentuale fra 3 e 90
book_read_progress   15 righe dal 24 luglio al 17 agosto
                     percent fra 3 e 89 →  0
                     percent >= 90      →  0
                     percent < 3        → 15
```

Tre settimane in cui nessuna posizione di lettura è stata salvata oltre il 2%.
Il lettore leggeva mezzo libro, riapriva, ripartiva dall'inizio — e non c'era un
errore da nessuna parte, né a schermo né nei log.

**Fatto:** il controllo ora vede anche `await supabase...` il cui risultato non
viene guardato; delle nove chiamate, tre propagano l'errore (posizione di
lettura, segnaposto, cancellazione delle preferenze in onboarding) e sei hanno la
giustificazione scritta. Il difetto nel database è corretto in 0084, e B-7 nella
specifica lo verifica alle percentuali di mezzo — perché al 95% funzionava.

### C-3 · Quattro RPC che il lettore non poteva chiamare

**Impatto: alto. Costo: pagato il 17 agosto.**

Trovate chiamando una per una tutte le 31 RPC che il client usa, con l'identità
di un lettore vero:

```
get_my_review        42501  → il compositore di recensioni
upsert_review        42501  → salvare una recensione, impossibile
get_similar_books    42501  → «Simili a questo» sulla scheda libro
get_trending_books   42501  → nessun chiamante nel client
```

S-5 protegge `books` togliendo il `select` sulla tabella e ridandolo colonna per
colonna: una funzione senza `security definer` perde il permesso appena tocca
una colonna aggiunta dopo (`work_id`) o la riga intera
(`book_avg_rating(b)`). Le prime due sono una regressione di 0071.

**Fatto:** 0084, e S-6 nella specifica — un controllo che le chiama tutte, perché
nessuna lettura del codice mostrava il problema.

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


---

## Esito, 15 agosto — cosa è stato fatto e cosa si è imparato

**A-1 fatto, e il difetto era peggiore di come l'avevo scritto.** Il piano diceva
che il caso del lettore autenticato «va misurato a parte». Misurato:
**29.977 ms** per la carta «gratis» e **15.629 ms** per quella dei titoli
recenti, contro un `statement_timeout` di 8 secondi. Non erano lente: **non
arrivavano mai a nessuno che avesse uno scaffale.** Ora 9–102 ms (0075).

**B-1 fatto**: `gcTime` allineato alle 24 ore del persister.

**Lo strato di cache (0079, 0080): costruito, misurato, lasciato inutilizzato.**
Le funzioni esistono e sono corrette; il client non le chiama. Il motivo è nei
numeri:

| lettura | prima | con l'indice | con la cache |
|---|---|---|---|
| nuove uscite | 353 – 3.992 ms | **0,1 ms** | 2,3 ms |
| classifica | 409 – 437 ms | **4,3 ms** | 3,6 ms |
| scheda libro | 1,8 – 49 ms | (chiave primaria) | 1,5 ms |

Gli indici vincono. Sulle nuove uscite la cache è venti volte più lenta.

I trigger di invalidazione restano attivi anche se nessuno legge la cache:
misurati su 200 righe, **612 ms con e 647 ms senza** — cioè niente. Così il
giorno in cui servisse, la cache è già corretta invece di essere da rifare.

### Quattro indici che sembravano servire una query e non la servivano

Il filo che tiene insieme quasi tutto il lavoro di questi due giorni:

| indice | perché non veniva usato |
|---|---|
| `books_free_read_idx` | una condizione in più (`cover_url is not null`) che la query non chiede |
| `books_popularity_idx` | espressione `(reads+saves+likes)` contro `(reads+saves+likes+reviews)` |
| `books_paid_recent_idx` | nessun chiamante, dopo la rimozione della riga Home |
| `books_new_releases_nl_idx` | **creato da me su una diagnosi sbagliata**, zero scansioni |

L'ultimo merita di essere raccontato perché l'errore è mio e recente. Avevo
misurato la query delle nuove uscite sull'endpoint REST — 710–3.091 ms — e
concluso che l'indice non venisse usato. Quello che non avevo misurato è **quanto
costa una chiamata HTTP qualunque** da quella postazione: 300–555 ms per una
singola riga da una tabella di quindici. Il pavimento era quello. `idx_scan`
diceva 22 scansioni sull'indice che credevo ignorato, e 0 su quello che avevo
creato per rimediare.

Stessa cosa dieci minuti dopo con i trigger: prima misura 10.330 ms contro
1.787, quindi «costano 5,8 volte»; con un giro di riscaldamento e l'ordine
invertito, 612 contro 647, cioè niente.

**La regola che ne esce non è tecnica: un numero senza un controllo non è una
misura.** Vale per i tempi HTTP quanto per i piani di query, e in entrambi i
casi il controllo costava trenta secondi.


---

## Esito, 17 agosto — D-1, D-2 e C-1

**D-1 · L'allarme c'è** (`.github/workflows/monitor.yml`). Ogni dieci minuti.

Il punto delicato: `jacopoz.vercel.app` restituisce **200 anche col database
giù** — è il guscio statico di una SPA, ed è precisamente per questo che le due
ore del 15 agosto sono passate inosservate. Quindi il controllo chiede **dei
dati**, non un segno di vita.

Per farlo serve la chiave anon, e la chiave **non** è un segreto del repository:
sta già nel bundle, la legge qualunque browser. Metterla fra i segreti avrebbe
significato un passaggio di configurazione a mano e — peggio — un allarme che
smette di funzionare **in silenzio** il giorno in cui le chiavi vengono ruotate.
Il controllo fa quello che fa un browser: scarica la pagina, trova il bundle, ne
estrae URL e chiave. Si riconfigura da solo.

Provato nei due sensi, che è la parte che conta: verde in produzione, e **rosso**
con un dominio inesistente e con un endpoint dati irraggiungibile. Un allarme che
non ho visto suonare non è un allarme.

Una correzione lungo la strada: la prima versione, con un dominio sbagliato,
diceva «bundle non trovato» invece di «il sito risponde 404», perché guardava il
corpo e non il codice HTTP. Una diagnosi sbagliata manda a cercare nel posto
sbagliato, ed è il costo che ho pagato più volte questa settimana.

**D-2 · La CI c'è** (`.github/workflows/ci.yml`): typecheck, lint, la prova del
modulo di scelta descrizioni, e il controllo sugli errori silenziosi.

`npm run lint` **non aveva alcuna configurazione ESLint**: lo script esisteva e
non era mai stato eseguito. Aggiunta, e le sue 14 segnalazioni erano tutte
codice morto reale — import mai usati, variabili calcolate e mai lette. Fra
queste una che non era un residuo: `ListRow` accettava un parametro `showAuthor`,
**passato dal chiamante e mai letto dentro la funzione**. Nelle liste che segui
non si è mai visto di chi sono. Il parametro è via; la funzione, se la si vuole,
va scritta.

**C-1 · Gli errori non diventano più liste vuote** — ma non con la stessa cura
per tutte le letture, perché non sono la stessa cosa:

| lettura | trattamento |
|---|---|
| `getSavedReviewsFallback`, `getSavedComments`, `getReadProgress` | l'errore **propaga**: sono contenuto, e «non hai niente salvato» a chi ha dei salvataggi è una bugia |
| `isFollowing`, `isFollowingList`, `attachViewerLikes`, `getBookmarkedIds` | l'errore **si ignora, dichiarandolo**: decorano. Propagare svuoterebbe una schermata perché un cuore non si è risolto |

`getBookmarkedIds` l'avevo classificata fra le prime, e avevo torto: guardando
chi la chiama, la usa solo la pagina di una recensione per decidere se l'icona è
piena o vuota. Corretta.

E perché la distinzione non torni ad essere folklore, `scripts/check-silent-errors.py`
la impone: una lettura che scarta `error` deve avere, **attaccato**, un commento
che dica perché. Il criterio guarda il commento attaccato all'istruzione e non
una finestra fissa di righe — la prima versione ne guardava sei e bocciava un
commento di otto scritto bene.

### D-5 · L'allarme campiona ogni 25–40 minuti, non ogni 10

**Impatto: medio. Costo: dipende da cosa si vuole.**

Il 18 agosto ho fermato la base dati **due volte** lavorando ai filoni (vedi
A-4). Il lavoro pianificato `l-app-risponde` è passato in mezzo ai due guasti e
ha riportato verde. Non è un difetto del controllo: è la sua cadenza vera.

```
esecuzioni del 18 agosto   06:17 · 07:09 · 07:52 · 08:32 · 09:06 · 09:46 · 10:11 · 10:49
distanza fra due           52 · 43 · 40 · 34 · 40 · 25 · 38 minuti
```

Il `cron` dice `*/10`. GitHub non garantisce la puntualità dei lavori pianificati
e nei fatti li dirada di tre o quattro volte — cosa che il commento in
`monitor.yml` prevedeva («spesso ritarda») ma senza un numero. Ora il numero c'è:
**la finestra cieca è di mezz'ora**, e un guasto di sei minuti ci passa dentro
senza essere visto.

Va bene per ciò per cui è stato costruito — un'indisponibilità di due ore non
sfugge. Non va bene per accorgersi di un guasto breve. Se serve quello, il
controllo non può stare su un `cron` di GitHub.

### Resta aperto

- **La production branch di Vercel.** Due click nel pannello, e sono i tuoi:
  *Settings → Git → Production Branch → `main`*. È l'unica impostazione di
  deploy che non sta nel repository — `vercel.json` non ha un campo per
  dichiararla — quindi è scritta in `docs/DEPLOY.md`, dove c'è anche il perché.
  Finché è il ramo di lavoro, il prossimo ramo va in produzione appena viene
  spinto e `main` non conta niente. Ricordarsi di impostare le variabili
  d'ambiente anche per **Preview**, altrimenti le anteprime costruiscono un
  bundle senza chiavi e sembrano rotte per il motivo sbagliato.
- **A-2**: `get_home_sections` fra 1 e 3 secondi, da strumentare prima di
  toccarla.
- **B-2**: la divisione del bundle, incerta e da misurare.
- **B-3**: le copertine che si ridisegnano tutte a ogni lotto risolto.
- **D-3**: ripristino puntuale disattivato.
- **D-4**: le chiavi da ruotare.
- **D-5**: la finestra cieca di mezz'ora dell'allarme. Va bene per un'
  indisponibilità di due ore, non per una di sei minuti; se serve la seconda, il
  controllo non può stare su un `cron` di GitHub.
