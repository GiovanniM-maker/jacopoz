# Google Books API — cosa usiamo e cosa possiamo ancora usare

Serve solo una **API key** (nessun OAuth 2.0): le ricerche sui volumi sono
dati pubblici. OAuth servirebbe soltanto per la libreria personale di un utente
Google (`mylibrary`, scaffali, "preferiti"), che non ci interessa.

La chiave sta nei **secret delle Edge Function di Supabase**
(`GOOGLE_BOOKS_API_KEY`), mai su Vercel: il bundle web è pubblico e una chiave
lì dentro è una chiave regalata.

Quota: 1.000 richieste al giorno gratis. Ogni ricerca in app fa **una** chiamata
(prima ne faceva due).

## Attivo

| Funzione | Dove | Perché |
|---|---|---|
| `key=` | ogni chiamata | senza chiave l'API risponde **429** a tutto. Verificato: era questo a far fallire ogni import. |
| `langRestrict` | ricerca | edizioni nella lingua del lettore prima delle altre |
| `printType=books` | ricerca | esclude riviste e periodici |
| `inauthor:"…"` | scheda **Autori** | il campo autore del provider invece del testo libero. "Kira Shell" a testo libero restituisce anche un'enciclopedia giapponese di conchiglie; `inauthor:` restituisce i suoi romanzi. Un solo import ha portato l'intera bibliografia di Zerocalcare. |
| `country=IT` (retry) | ricerca | Google blocca su base geografica e risponde **403 "Cannot determine user location"** quando non riesce a localizzare l'IP del chiamante. Non capita da tutte le uscite di rete, quindi è un retry e non un default. |
| `accessInfo.publicDomain` + `viewability` | import | libro di pubblico dominio leggibile per intero |
| `saleInfo.saleability = FREE` | import | ebook che Google stessa offre gratis |
| `accessInfo.webReaderLink` | import | il link al lettore (mai i link di download) |
| `imageLinks` / endpoint `content?zoom=2` | import | le copertine nei risultati di ricerca sono ~128px: troppo morbide su un telefono |

Le due voci sul gratuito alimentano il tag **GRATIS** sulle copertine, che prima
dipendeva solo da Gutenberg. Verificato: "Uno, nessuno e centomila" di
Pirandello ora risulta gratis via Google, oltre ai testi Gutenberg.

## Da valutare

- **`saleInfo.buyLink` e `retailPrice`** — un link d'acquisto vero, con prezzo.
  Il confronto con Amazon non c'è più: il 15 agosto 2026 la ricerca Amazon
  costruita a mano è stata rimossa del tutto (il tag memorizzato era `.com` e i
  link puntavano su `amazon.it`, quindi non ha mai attribuito una conversione).
  Oggi nella scheda **non c'è nessun link d'acquisto**, e se un giorno tornerà
  questo è l'unico candidato: non rende niente, ma almeno porta all'edizione
  giusta invece di una pagina di risultati.
- **`orderBy=newest`** — una sezione "uscite recenti" senza doverla dedurre da
  `published_year`.
- **`subject:"…"`** — riempire un genere con titoli veri invece di sperare che
  la ricerca a testo libero peschi bene.
- **`isbn:`** — già usato in import puntuale; utile anche per una scansione del
  codice a barre di un libro fisico.
- **`searchInfo.textSnippet`** — la frase in cui la ricerca ha fatto match: una
  riga di contesto sotto il risultato.
- **`maturityRating`** — filtro contenuti per adulti, se mai servirà.

## Limiti trovati sul campo

- La ricerca per autore resta approssimativa: `inauthor:"Kira Shell"` senza
  vincolo di lingua fa rientrare Tetsuaki Kira. Il boost di lingua nel ranking
  lo compensa.
- Google Books **non ha** "Meet" attribuito a Kira Shell, con nessuna
  formulazione provata. Non è un problema di integrazione: quel volume non
  risulta nel loro indice.
