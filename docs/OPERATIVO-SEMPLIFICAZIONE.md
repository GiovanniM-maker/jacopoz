# Documento operativo — semplificazione pre-lancio

Tre rimozioni decise il 15 agosto 2026: le categorie dalla scheda libro, le
recensioni prese da fonti esterne, i link Amazon. Questo documento esiste perché
**le tre modifiche si incrociano tutte nello stesso file**, e tre agenti che
modificano lo stesso blocco di import si sovrascrivono a vicenda.

La partizione è quindi **per file, non per funzionalità**. Ogni agente ha una
lista esclusiva: nessun altro scrive quei file, per nessun motivo.

---

## Perché per file e non per funzionalità

In `app/app/book/[id].tsx` le tre cose stanno in regioni distinte:

| cosa | righe |
|---|---|
| categorie | 163 (etichetta «Tomo · categoria»), 241–243 (i chip) |
| recensioni esterne | 6, 27, 70–72, 317–321 |
| Amazon | 10, 11, 49, 136–139, 287, 301–302, 310–311 |

Ma condividono il blocco `import` (righe 1–30) e l'oggetto `StyleSheet` in
fondo. Tre modifiche concorrenti su quei due punti sono una collisione garantita.
Quindi **un solo agente tocca quel file, e fa tutte e tre le rimozioni dentro**.

---

## Decisioni già prese: gli agenti non le rimettono in discussione

Queste tre righe evitano che ogni agente scelga per conto suo. Sono la parte
più importante del documento.

**1. Le categorie NON si rimuovono dal modello.** `books.categories` serve alla
ricerca per genere, alle pagine genere, ai consigli e all'inferenza automatica.
Si rimuove **solo la loro comparsa nella scheda libro**. Un agente che toglie la
colonna, o che smette di popolarla, rompe quattro funzioni che nessuno ha chiesto
di toccare.

**2. La tabella `external_reviews` NON si cancella.** Contiene 238 righe con
attribuzione e licenza (CC BY-SA). Si smette di **mostrarle** e di **scriverne
di nuove**; i dati restano. Cancellare è irreversibile e non serve a niente: una
tabella che nessuno legge non costa nulla, e se un giorno vorremo «Dalla critica»
sarà già lì.

**3. Amazon: si rimuove tutta la superficie, client e database.** Qui la
rimozione è completa perché il pezzo non funzionava comunque — il tag
memorizzato è `jacopoz-20`, un tag .com, mentre i link puntano su amazon.it,
quindi nessuna conversione è mai stata attribuita. Le funzioni SQL si eliminano,
le migrazioni che le hanno create restano dove sono (la storia non si riscrive).

---

## Regole comuni, valide per tutti

- **Nessun agente fa `git commit`, `git push` o cambia ramo.** I commit li faccio
  io alla fine, una volta, quando l'insieme sta in piedi. Tre agenti che
  committano sullo stesso ramo si intralciano nell'indice git.
- **Nessun agente esegue `npm install`, `expo export` o la suite di specifica.**
  Sono lenti e globali: li eseguo io in chiusura.
- **`npx tsc --noEmit` fallirà a metà strada, ed è previsto.** L'agente A smette
  di importare funzioni che l'agente B cancella: fino a quando entrambi non hanno
  finito, il typecheck è rosso. Nessun agente deve «aggiustare» un errore che
  riguarda un file non suo — lo segnala e va avanti.
- **I commenti nel codice si scrivono in italiano**, come nel resto del
  repository, e spiegano *perché*, non *cosa*.
- **Un solo agente scrive migrazioni** (agente B) e ha riservato il numero
  **0076**. Nessun altro crea file in `supabase/migrations/`.
- **Un solo agente scrive in `docs/`** (agente C), con l'eccezione di questo file
  che non tocca nessuno.
- Ogni agente chiude riportando: file toccati, cosa ha rimosso, cosa ha lasciato
  in piedi deliberatamente, e ogni dubbio che non ha risolto da solo.

---

## Agente A — la scheda libro

**Proprietà esclusiva:** `app/app/book/[id].tsx`

Fa tutte e tre le rimozioni dentro questo file:

1. **Categorie** — via l'etichetta `Tomo · {b.categories[0]}` (riga ~163) e il
   blocco dei chip (righe ~241–243). L'etichetta va sostituita con qualcosa che
   non lasci un buco nella grafica: `Tomo` da solo, o il nome della collana.
   Decide l'agente, ma **non deve restare una riga vuota o un separatore orfano**.
2. **Recensioni esterne** — via la `useQuery` `external-reviews` (~70–72), il
   blocco «Dalla critica» (~317–321), l'import di `getExternalReviews` e quello
   del tipo `ExternalReview`.
3. **Amazon** — via `buyUrl`, `amazonUrl`, la `useQuery` `affiliate` (~49), la
   funzione `onBuyAmazon` (~136–139) e i due pulsanti «Compra su Amazon»
   (~301–302 e ~310–311).

**Attenzione al punto delicato:** intorno alla riga 287 c'è il blocco
«leggi gratis / compra». Togliendo il ramo Amazon, **il blocco non deve
diventare vuoto** per i libri senza lettura gratuita: lì oggi c'è un pulsante e
domani non ci sarà niente. Se resta uno spazio senza contenuto va rimosso anche
il contenitore, non solo il pulsante.

Pulisce anche le voci di `StyleSheet` che restano senza utilizzatori
(`buyLink`, `buyLinkText`, `buyBtn`, `buyBtnText`, gli stili dei chip categoria,
quelli del blocco critica). Uno stile morto non rompe niente ma è esattamente
il tipo di residuo che fa sembrare che il pezzo esista ancora.

**Non tocca:** nessun altro file. Se serve una modifica in `app/src/api/*`, la
**segnala** all'agente B nel proprio rapporto invece di farla.

---

## Agente B — client API, tipi e database

**Proprietà esclusiva:**
- `app/src/api/config.ts`
- `app/src/api/reading.ts`
- `app/src/api/books.ts`
- `app/src/types/database.ts`
- `supabase/migrations/0076_remove_amazon_and_external_reviews.sql` (da creare)

Lato client rimuove:
- `buyUrl` e `amazonAffiliateUrl` da `config.ts`;
- `amazonUrl` da `reading.ts` (lasciando intatto tutto ciò che riguarda la
  lettura gratuita: `getReadInfo`, Gutenberg, `free_read_url`);
- `getExternalReviews` da `books.ts`;
- il tipo `ExternalReview` da `database.ts`.

Nel commento di rimozione va detto **perché**, non solo che è stato rimosso: il
tag di affiliazione non corrispondeva al dominio, quindi il pezzo non ha mai
reso niente; le recensioni esterne erano 238 contro 14 vere e tradivano la
promessa dell'app.

Nella migrazione 0076:
```sql
drop function if exists public.amazon_buy_url(uuid);
drop function if exists public.amazon_affiliate_url(text);
```
(verificare le firme esatte con `pg_get_function_identity_arguments` prima di
scriverle: sbagliare la firma fa passare il `drop if exists` senza fare niente,
che è il modo peggiore di fallire.)

E **ferma la scrittura di nuove recensioni esterne**: in
`internal_enrich_ingest` c'è il ramo `wiki_summary` che fa `insert into
public.external_reviews`. Va rimosso quell'inserimento, **lasciando in piedi**
la parte che scrive `source_blurb_internal` — quella è materiale per le sinossi
e serve. Recuperare il corpo attuale della funzione con `pg_get_functiondef` e
reissuarla per intero: un `create or replace` parziale scritto a memoria
perderebbe pezzi.

**Non tocca:** `app/app/**` (è dell'agente A), `docs/**` (agente C).

---

## Agente C — specifica, test e documentazione

**Proprietà esclusiva:**
- `docs/SPECIFICA.md`
- `scripts/spec-test.py`
- gli altri file in `docs/` che citano Amazon o le recensioni esterne
  (`API.md`, `PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, `CHECKLIST.md`,
  `ROADMAP-BACKLOG.md`, `GOOGLE-BOOKS.md`, `DEPLOY.md`, `CTO-REVIEW.md`)

In `SPECIFICA.md`:
- rimuove il requisito **B-4** («Compra su Amazon porta all'edizione giusta per
  lingua»);
- rimuove ogni requisito sulle recensioni esterne;
- **non rinumera gli identificativi rimasti.** B-4 diventa un buco, e va bene
  così: un identificativo è un riferimento stabile, rinumerare romperebbe ogni
  citazione in questo documento, nei commenti delle migrazioni e nei messaggi di
  commit. Va aggiunta una riga che dice che B-4 è stato ritirato e perché.

In `spec-test.py`:
- rimuove il controllo **B-4** (cerca `amazon.it` e `B-4`);
- rimuove eventuali controlli sulle recensioni esterne;
- **non toccare `q()`, `check()`, `as_reader()` né gli altri blocchi**: sono
  infrastruttura condivisa del file e sono stati corretti oggi.

Negli altri documenti: le menzioni di Amazon e delle recensioni esterne vanno
aggiornate, **non cancellate a forza**. Dove un documento racconta una decisione
storica (per esempio `CTO-REVIEW.md`, che è un'analisi datata), la voce resta e
si annota che è superata — riscrivere la storia rende inutili i documenti che
la contengono.

**Non tocca:** nessun file sotto `app/` o `supabase/`.

---

## Cosa NON è in questo lotto

**Il filtro «solo mercato italiano» non è qui.** È in attesa di una decisione:
il catalogo ha 69.020 libri di cui 8.401 in italiano, e dei 33.526 leggibili
gratis solo 1.020 sono in italiano. Un filtro netto ovunque riduce il catalogo
visibile a un ottavo e fa sparire il tag GRATIS dal 97% dei casi. La proposta
sul tavolo è: **Home e consigli solo in italiano, ricerca che continua a trovare
tutto**. Nessun agente lavori su questo prima che sia deciso.

---

## Chiusura, che faccio io

1. `npx tsc --noEmit` — deve tornare pulito solo **dopo** che A e B hanno finito.
2. `npm run lint`.
3. `python3 scripts/spec-test.py` — attesi tutti verdi, con B-4 non più presente.
4. Ricerca dei residui — **il controllo come l'avevo scritto era sbagliato.**
   Chiedeva che `grep -rn "amazon\|external_review\|ExternalReview"` tornasse
   vuoto, ma la regola «commenta il perché» impone di lasciare scritto nel codice
   *perché* una cosa è stata rimossa, e quei commenti citano `amazon.it` e
   `jacopoz-20`. Le due regole erano in contraddizione, e l'agente B l'ha fatto
   notare invece di scegliere di testa sua.
   Vince il commento: una riga che spiega perché un pezzo non c'è più vale più
   di un grep pulito. Il controllo giusto è **nessun uso di codice**, i commenti
   restano:
   ```
   grep -rn "amazon\|ExternalReview" app/src app/app --include=*.ts --include=*.tsx \
     | grep -vE ": *[0-9]+: *(//|\*|/\*)"
   ```
5. Un solo commit, con i tre rapporti riassunti nel messaggio.
