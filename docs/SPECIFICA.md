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
- **R-7b** — Lo stesso import porta in catalogo anche i **libri vicini**: altre
  opere dello stesso autore e altri titoli sullo stesso soggetto. Una ricerca
  non deve arricchire il catalogo di una riga sola.

> **Come è fatto.** L'espansione parte da ciò che è stato davvero salvato (non
> dalla lista grezza del provider, che comincia con i risultati Gutenberg e
> porterebbe a espandere attorno all'autore sbagliato) e usa due segnali:
> `inauthor:` per le altre opere dell'autore, e `subject:` sulle categorie
> **grezze** del provider — "Fiction / Literary", non i nostri quindici slug,
> che sulla riga appena importata sono per giunta ancora vuoti.
>
> `inauthor:` da solo non basta: cerca il campo autore *come lo scrive Google*,
> e misurando si è visto che `inauthor:"Marco Missiroli"` non restituisce nulla
> mentre la query semplice "Marco Missiroli" restituisce otto suoi libri. C'è
> quindi un ripiego sul testo libero.
>
> L'espansione resta **best-effort**: non deve mai far fallire l'import
> principale. Quando salta, la risposta lo dichiara (`expand_error`), perché un
> `related: 0` muto non distingue "non c'era niente di nuovo" da "è andata
> storta".

> **Limite noto.** Molte traduzioni italiane non esistono affatto presso i
> provider: Google Books ha "The Goldfinch" ma non "Il cardellino". Cercare il
> titolo italiano di un libro straniero può quindi importare solo l'edizione
> originale. Non è un difetto dell'import, è il catalogo di Google.
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
- **C-7** — Una sinossi generata poggia su un materiale reale. Se di un libro
  non abbiamo la quarta di copertina, **la scheda resta senza sinossi**: non si
  chiede al modello di ricostruirla da titolo e autore.

  Non è una cautela teorica. Lasciato senza materiale, il modello non risponde
  «INSUFFICIENTE» come gli si chiede: riconosce il titolo e racconta il libro a
  memoria. Su 32 sinossi generate, 26 erano così, e fra queste «Oblivion» di
  David Foster Wallace aveva ricevuto la trama di «Infinite Jest». Il lettore
  non ha modo di accorgersene, e il testo finisce anche nell'embedding.

  Il materiale si recupera da Google Books (funzione `blurbs`), non si mostra
  mai a un lettore, e serve solo come base per una riscrittura originale.

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
- **H-7** — **Le vetrine sono in italiano, la ricerca no.** Tutto ciò che la
  Home propone senza che nessuno l'abbia chiesto — consigliati, gratis per te,
  classifica, sezioni con un nome, riga di genere, nuove uscite — mostra solo
  libri in italiano. La ricerca, la pagina di un genere, "Simili a questo" e le
  edizioni di un libro continuano a mostrare tutto il catalogo.

  Il perché sta nei numeri: 8.401 libri su 69.029 sono in italiano, e di 33.526
  leggibili gratis solo 1.020 sono entrambe le cose. Un filtro unico su tutta
  l'app ridurrebbe il catalogo a un ottavo e toglierebbe il GRATIS al 97% dei
  casi; separare le due cose dà una Home italiana **e** una ricerca che trova
  «Better di Carrie Leighton».
- **H-8** — Una sezione della Home che non può riempirsi **non viene proposta**.
  Le sezioni si estraggono a sorte da un serbatoio: una specifica che non ha
  quattro carte da mostrare non produce una riga vuota, produce una riga in
  meno. Vale per gli angoli editoriali (una soglia che nessun libro raggiunge) e
  per "Ancora \<autore\>" (un autore con meno di quattro libri italiani).
- **H-9** — Una riga della Home è **ordinata per qualcosa che il catalogo ha**.
  Ordinare per una colonna popolata sullo 0,35% delle righe è un pareggio fra
  decine di migliaia di libri: l'ordine risultante è quello che restituisce la
  scansione, e il seme che dovrebbe far ruotare la riga non la fa ruotare.

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
- **B-5** — Se il libro è gratis si legge dentro l'app (testo Gutenberg) o si
  apre il lettore esterno.
- **B-7** — **La posizione di lettura si salva anche a metà libro**, e se non si
  salva l'app non finge il contrario.

  Dal 24 luglio al 17 agosto non si è salvata: `save_read_progress` falliva con
  un errore di tipo per ogni percentuale fra il 3% e il 90% — cioè per un lettore
  a metà di un libro — e il client scartava l'errore. Quindici righe in
  `book_read_progress`, **tutte sotto il 2%**. Chi leggeva mezzo libro e riapriva
  l'app lo ritrovava all'inizio.

  Per questo il controllo prova le percentuali di mezzo e non una sola: al 95%
  funzionava. E per questo il segnaposto, che il lettore mette a mano e a cui
  l'app risponde «salvato», scrive quella conferma **dopo** che è salvato.
- **B-6** — **Una recensione parla dell'opera, non dell'edizione.** Chi apre
  l'Adelphi vede la recensione scritta sull'Einaudi, il conteggio è lo stesso su
  entrambe le schede, e lo stesso lettore non può recensire due volte lo stesso
  libro passando da un'edizione diversa.

  L'edizione da cui la recensione è stata scritta resta registrata — è
  informazione vera — ma non è il punto di attacco: quello è `work_id`, un'
  identità stabile che non cambia se qualcuno corregge un refuso nel titolo.

> Fra **B-3** e **B-5** manca **B-4**: è stato ritirato, vedi
> «Requisiti ritirati» in fondo al documento.

---

## 6. Sicurezza (invarianti, non funzionalità)

- **S-1** — Un utente non può cambiarsi il ruolo né i propri contatori.
- **S-2** — Le funzioni `internal_*` non sono richiamabili da `anon`.
- **S-3** — Nessuna query di ricerca può alterare il database.
- **S-4** — Le chiavi stanno nei secret Supabase, mai nel bundle web.
- **S-5** — Le colonne interne (`source_blurb_internal`, `embedding`,
  `search_tsv`) non escono verso un client, **da nessuna strada**. Sulla
  tabella la protezione è un permesso; nelle Edge Function il permesso non
  c'entra, perché leggono con la chiave di servizio — lì è il codice a dover
  scegliere cosa mettere nella risposta.
- **S-6** — **Ogni funzione che il client chiama è chiamabile da un lettore
  vero.** Non «esiste», non «ha il grant di esecuzione»: si chiama, e risponde.

  Il requisito nasce da quattro RPC che il 17 agosto fallivano con 42501 per
  ogni lettore autenticato, fra cui `upsert_review` — cioè **salvare una
  recensione era impossibile** da quando le recensioni sono passate all'opera.
  La causa è che S-5 protegge `books` togliendo il permesso sulla tabella e
  ridandolo colonna per colonna, quindi una funzione senza `security definer`
  perde il permesso appena tocca una colonna aggiunta dopo, o la riga intera.

  Leggere il codice non lo mostra: il grant sulla funzione c'è, la funzione
  esiste, la firma è giusta. Solo la chiamata lo dice.

---

## Requisiti ritirati

Un identificativo è un riferimento stabile: è citato qui, negli altri documenti,
nei commenti delle migrazioni e nei messaggi di commit. Quando un requisito cade
**non si rinumerano gli altri** — resta un buco, e questa sezione lo spiega.

| Identificativo | Requisito | Ritirato il | Perché |
|---|---|---|---|
| **B-4** | «Compra su Amazon» porta all'edizione giusta per lingua | 15 agosto 2026 | Il tag di affiliazione memorizzato (`jacopoz-20`) è un tag `.com`, mentre i link puntavano su `amazon.it`: **nessuna conversione è mai stata attribuita**. Si è tolta una complicazione che non rendeva niente. |

Nella stessa decisione sono cadute due cose che non erano requisiti — non
avevano un identificativo, e per questo si annotano qui, perché la scheda libro
oggi mostra meno di ieri e la ragione non deve andare perduta:

- **Le recensioni da fonti esterne** (blocco «Dalla critica»). Erano **238 voci
  enciclopediche contro 14 recensioni vere di lettori**: una scheda in cui la
  voce di fuori copre diciassette volte quella di dentro tradisce la promessa
  dell'app, *la collana che leggi con gli amici*. La tabella `external_reviews`
  **non è stata cancellata** — i dati restano, con attribuzione e licenza — ma
  non si legge e non si scrive più.
- **Le categorie nella scheda libro.** Sono slug interni: il lettore non li ha
  chiesti e non aggiungono nulla accanto a una sinossi. Restano invece **tutti**
  i requisiti su ricerca e generi (**G-1**…**G-5**), che poggiano sulla stessa
  colonna `books.categories`: quella serve e non si tocca.

---

## Stato noto (aggiornato dai test)

Vedi in fondo a `docs/AUDIT-FINDINGS.md` per lo storico. Gli esiti correnti si
ottengono con:

```
python3 scripts/spec-test.py
```
