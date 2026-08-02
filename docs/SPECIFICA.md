# Tomo — specifica funzionale

Questo documento dice **come deve comportarsi l'app**, non come è fatta. Serve a
due cose: mettersi d'accordo su cosa è giusto, e avere qualcosa contro cui
scrivere test. Ogni comportamento verificabile ha un identificativo (`R-1`,
`L-3`, …) che il file `scripts/spec-test.py` usa per riportare esito.

Quando il documento e il codice non vanno d'accordo, **il documento ha ragione**
e il codice è un bug.

---

## 0. Cos'è Tomo

Una app per scoprire libri **attraverso le persone**. Non un catalogo con sopra
delle recensioni: un feed di lettori di cui ti fidi, da cui i libri emergono.
"Tomo" = libro (italiano) + amico (giapponese). Claim: *la collana che leggi con
gli amici*.

Pubblico iniziale: lettori italiani. Il catalogo è multilingua, ma **la lingua
di lettura del profilo è il centro di gravità di tutto ciò che si vede.**

---

## 1. Ricerca

La lente d'ingrandimento è presente in Home e nel Feed. La schermata ha una
barra di testo, delle schede, e — per i libri — dei filtri lingua.

### 1.1 Schede

| Scheda | Cosa cerca | Cosa apre il risultato |
|---|---|---|
| **Libri** | titolo, sottotitolo, autore | scheda libro |
| **Autori** | nome dell'autore | pagina autore |
| **Generi** | nome del genere e sinonimi | pagina genere |
| **Utenti** | username e nome visualizzato | profilo pubblico |

- **R-1** — Le quattro schede esistono e sono raggiungibili.
- **R-2** — Cambiare scheda non perde il testo digitato.

### 1.2 Come deve rispondere la barra

- **R-3** — Si cerca **mentre si digita** (debounce ~350 ms), da 2 caratteri.
- **R-4** — Una ricerca **non deve mai** richiedere la formulazione esatta.
  Devono funzionare: refusi (`orgolio e pregiudizio`), parole troncate
  (`dostoev`), ordine invertito (`pregiudizio orgoglio`), accenti mancanti
  (`dialoghi con leuco`), autore+titolo insieme (`murgia accabadora`), solo il
  cognome (`simenon`).
- **R-5** — Ogni ricerca risponde **entro 1 secondo** nel caso peggiore. Il
  ruolo `anon` ha `statement_timeout = 3s` e `authenticated` 8s: superarli non
  dà un errore, dà un catalogo che sembra vuoto.
- **R-6** — Un'opera compare **una volta sola**. Le edizioni diverse dello
  stesso libro si scelgono dalla scheda libro, non affollano i risultati.
- **R-7** — Se i risultati locali **non contengono ogni parola significativa**
  della query, l'app va a prenderli dai provider e aggiorna la lista da sola.
  Il criterio è la pertinenza, non il numero di risultati.
- **R-8** — Durante l'import la schermata lo dice ("Cerco anche fuori dal
  catalogo…"). Non resta mai muta.
- **R-9** — Prima di digitare la schermata spiega cosa si può cercare.
- **R-10** — Il primo tocco su un risultato lo apre, anche con la tastiera
  aperta.
- **R-11** — Nessun input rompe la ricerca: vuoto, `null`, solo simboli, emoji,
  500 caratteri, `%`, `_`, apici, operatori di full-text.

### 1.3 Lingua — il punto delicato

I chip sono quattro e **non fanno tutti la stessa cosa**:

| Chip | Comportamento |
|---|---|
| **La mia lingua** (default) | *preferenza morbida*: mostra tutto, ma mette prima le edizioni nella lingua del profilo |
| **Italiano** | **filtro netto**: solo libri in italiano |
| **Inglese** | **filtro netto**: solo libri in inglese |
| **Tutte** | nessun filtro e nessuna preferenza |

- **L-1** — Con **Italiano** selezionato, **ogni** risultato è in italiano.
  Zero eccezioni. Un filtro che ordina soltanto è un filtro rotto: è la
  differenza fra "preferisco" e "voglio solo".
- **L-2** — Con **Inglese** selezionato, ogni risultato è in inglese.
- **L-3** — Con **La mia lingua**, i risultati nella lingua del profilo
  precedono gli altri, ma gli altri restano visibili.
- **L-4** — Con **Tutte**, nessuna lingua è privilegiata.
- **L-5** — Se un filtro netto non lascia risultati, la schermata lo dice e
  offre di togliere il filtro. Non mostra una lista vuota senza spiegazione.
- **L-6** — I libri senza lingua nota non spariscono da "La mia lingua" e da
  "Tutte"; sono esclusi dai filtri netti (non sappiamo che lingua siano).
- **L-7** — L'import dai provider chiede le edizioni **nella lingua
  selezionata**.

> **Limite noto.** Il filtro netto vale quanto il campo `language`, e alcuni
> libri arrivano dai provider con la lingua sbagliata: "Accabadora" di Michela
> Murgia e "Dialoghi con Leucò" di Pavese erano dichiarati `en`. La correzione
> automatica (0053) è volutamente prudente — due marcatori italiani nel titolo e
> nessuna parola funzionale inglese — perché una regola più generosa
> dichiarerebbe italiani libri inglesi (`Lonesome Dove`, `Non-fiction books`),
> cioè rimetterebbe risultati inglesi dentro il filtro italiano. La copertura
> piena richiede un riconoscimento di lingua sulla descrizione al momento
> dell'import: **non fatto**.

### 1.4 Generi

- **G-1** — Cercare un genere per nome lo trova (`fantasy`, `giallo`,
  `dark romance`, `saggistica`).
- **G-2** — Funziona in italiano e in inglese: il catalogo usa slug inglesi, il
  lettore scrive in italiano.
- **G-3** — Tollera i refusi, come tutto il resto (`fantsy`).
- **G-4** — Ogni genere mostrato ha **almeno un libro**. Un genere vuoto in
  un elenco è una porta su una stanza vuota.
- **G-5** — Aprire un genere porta alla sua pagina con i libri dentro.

---

## 2. Catalogo

- **C-1** — Il catalogo copre generi diversi, non solo classici di pubblico
  dominio. Vanno rappresentati almeno: narrativa contemporanea, giallo/thriller,
  fantasy, romance (**dark romance e new adult inclusi**), young adult,
  saggistica, biografie, poesia, fumetto/graphic novel.
- **C-2** — Ci sono autori vivi e pubblicati oggi, non solo Gutenberg.
- **C-3** — Gli autori di nicchia molto letti in Italia sono presenti: Kira
  Shell, Erin Doom, Carrie Leighton, Felicia Kingsley, Zerocalcare.
- **C-4** — Un libro ha copertina, autore e anno. Una scheda spoglia è un
  risultato che nessuno tocca.
- **C-5** — Un'opera = una riga. Le edizioni stanno sotto, nella scheda.
- **C-6** — Il tag **GRATIS** appare solo su libri realmente leggibili
  gratuitamente e legalmente (pubblico dominio Gutenberg, o ebook che Google
  stessa offre gratis).

---

## 3. Home

- **H-1** — La Home cambia fra un'apertura e l'altra: non è una vetrina fissa.
- **H-2** — Il *pull to refresh* propone roba nuova ed è un segnale di gusto.
- **H-3** — "Continua a leggere" mostra i libri iniziati, con la percentuale, e
  li riapre al punto giusto.
- **H-4** — Le sezioni hanno nomi **riferiti al lettore** ("Perché hai letto X",
  "Ancora <autore>"), non etichette di genere generiche.
- **H-5** — Scorrendo in fondo arriva altro, senza ricaricare la pagina.
- **H-6** — Lo stesso libro non compare in due caroselli della stessa schermata.

---

## 4. Feed e social

- **F-1** — Due feed: "Per te" e "Seguiti".
- **F-2** — Una recensione si può mettere fra i preferiti, commentare, salvare,
  segnalare.
- **F-3** — I contatori (like, commenti, follower) sono corretti dopo ogni
  azione.
- **F-4** — Il profilo pubblico mostra scaffali **e recensioni**.
- **F-5** — Le griglie di libri sono a **tre colonne** su telefono in verticale,
  ovunque nell'app.

---

## 5. Libro

- **B-1** — Titolo, autore, copertina, anno, descrizione, media voti.
- **B-2** — Voto in rombi: **uno solo per utente per libro**, e coincide con
  quello della propria recensione.
- **B-3** — Le edizioni sono selezionabili dalla scheda.
- **B-4** — "Compra su Amazon" porta all'edizione giusta per lingua.
- **B-5** — Se il libro è gratis si legge dentro l'app (testo Gutenberg) o si
  apre il lettore esterno.

---

## 6. Sicurezza (invarianti, non funzionalità)

- **S-1** — Un utente non può cambiarsi il ruolo né i propri contatori.
- **S-2** — Le funzioni `internal_*` non sono richiamabili da `anon`.
- **S-3** — Nessuna query di ricerca può alterare il database.
- **S-4** — Le chiavi stanno nei secret Supabase, mai nel bundle web.

---

## Stato noto (aggiornato dai test)

Vedi in fondo a `docs/AUDIT-FINDINGS.md` per lo storico. Gli esiti correnti si
ottengono con:

```
python3 scripts/spec-test.py
```
