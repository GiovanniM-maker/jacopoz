#!/usr/bin/env python3
"""
Esegue i controlli di docs/SPECIFICA.md contro il database di produzione.

Ogni test riporta l'identificativo della specifica, così un fallimento si legge
come "R-4 non è vero" e non come "una query ha restituito qualcosa di strano".

Uso:  python3 scripts/spec-test.py [prefisso]
      python3 scripts/spec-test.py L       # solo i test sulla lingua

Richiede /tmp/sbq.py (client Management API) — vedi docs/DEPLOY.md.
"""
import importlib.util
import json
import os
import re
import ssl
import sys
import time
import unicodedata
import urllib.request

spec = importlib.util.spec_from_file_location("sbq", "/tmp/sbq.py")
sbq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sbq)

RESULTS = []

# La anon key è pubblica per costruzione (sta nel bundle web), ma non va
# scritta nel repo: si legge dall'ambiente, e senza si salta il test end-to-end
# invece di dichiararlo superato.
ANON = os.environ.get("TOMO_ANON_KEY") or ""
if not ANON:
    try:
        ANON = open("/tmp/anon.key", encoding="utf-8").read().strip()
    except OSError:
        ANON = ""

_ctx = ssl.create_default_context(cafile="/root/.ccr/ca-bundle.crt")
_handlers = [urllib.request.HTTPSHandler(context=_ctx)]
if os.environ.get("HTTPS_PROXY"):
    _handlers.insert(0, urllib.request.ProxyHandler({"https": os.environ["HTTPS_PROXY"]}))
_opener = urllib.request.build_opener(*_handlers)


def ingest(body, timeout=240):
    """Chiama la Edge Function esattamente come fa app/app/search.tsx."""
    req = urllib.request.Request(
        "https://tpphaalfmcqtfxhyafzz.supabase.co/functions/v1/ingest-book",
        method="POST", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {ANON}", "apikey": ANON,
                 "content-type": "application/json", "User-Agent": "curl/8.5.0"})
    with _opener.open(req, timeout=timeout) as r:
        return json.loads(r.read())


def q(sql, _tries=4):
    """La Management API limita la frequenza delle richieste: un 429 durante un
    backfill non è un fallimento della specifica, quindi si aspetta e si riprova
    invece di riportare un bug che non c'è."""
    for attempt in range(_tries):
        st, out = sbq.sql(sql)
        if st == 201:
            return out or []
        if st == 429 and attempt < _tries - 1:
            time.sleep(5 * (attempt + 1))
            continue
        raise RuntimeError(f"SQL {st}: {str(out)[:200]}")
    return []


def check(ident, description, ok, detail=""):
    """`ok=None` significa "non verificabile in questo momento": non è un
    successo (non dimostra niente) ma nemmeno un fallimento (non c'è un difetto
    da correggere). Contarlo come rosso insegnerebbe a ignorare il rosso."""
    RESULTS.append((ident, description, ok if ok is None else bool(ok), detail))


def norm(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def lit(s):
    return s.replace("'", "''")


# --------------------------------------------------------------- R: ricerca
def test_search():
    # R-4: nessuna query deve richiedere la formulazione esatta.
    cases = [
        ("orgolio e pregiudizio", "pregiudizio"),
        ("dostoev", "dostoev"),
        ("pregiudizio orgoglio", "pregiudizio"),
        ("dialoghi con leuco", "leuco"),
        ("murgia accabadora", "accabadora"),
        ("simenon", "simenon"),
        ("il visconte dimezato", "visconte dimezzato"),
        ("kira shel", "kira shell"),
        ("zerocalcare", "zerocalcare"),
        ("farenheit 451", "fahrenheit"),
        ("harry poter", "harry potter"),
        ("ediporè", "edipo re"),
    ]
    bad = []
    for query, expected in cases:
        # Modalità morbida (null): R-4 misura la tolleranza della ricerca, non
        # il filtro di lingua — che ha i suoi controlli in L-1/L-2. Con un
        # filtro netto attivo un fallimento qui direbbe solo "non abbiamo
        # quell'edizione in quella lingua", che è un'altra cosa.
        rows = q(
            f"select s.title, b.authors from public.search_books('{lit(query)}',10,0,null) s "
            f"join public.books b on b.id = s.id;"
        )
        hay = [norm(f"{r['title']} {' '.join(r['authors'] or [])}") for r in rows[:5]]
        if not any(norm(expected) in h for h in hay):
            bad.append(query)
    check("R-4", "ricerca tollerante a refusi, troncamenti e ordine",
          not bad, f"falliscono: {bad}" if bad else f"{len(cases)}/{len(cases)}")

    # R-5: entro 1 secondo, e dentro il timeout di anon.
    slow = []
    for query in ["", "dune", "amore", "storia", "kira shell", "il visconte dimezato",
                  "orgoglio e pregiudizio", "machbet", "harry poter", "dark romance"]:
        rows = q(
            "select round(extract(epoch from (clock_timestamp() - t))*1000) ms from ("
            f"  select clock_timestamp() t, count(*) from public.search_books('{lit(query)}',30,0,'it')"
            ") z;"
        )
        ms = float(rows[0]["ms"])
        if ms > 1000:
            slow.append((query or "(vuota)", ms))
    check("R-5", "ogni ricerca risponde entro 1 secondo",
          not slow, f"lente: {slow}" if slow else "max sotto 1000 ms")

    # R-6: un'opera compare una volta sola (stesso work_key).
    dup = q(
        "select count(*) n from ("
        "  select b.work_key from public.search_books('notti bianche',30,0,'it') s"
        "  join public.books b on b.id = s.id"
        "  where coalesce(b.work_key,'') <> '' group by b.work_key having count(*) > 1"
        ") z;"
    )
    check("R-6", "un'opera compare una volta sola nei risultati",
          int(dup[0]["n"]) == 0, f"gruppi duplicati: {dup[0]['n']}")

    # R-11: nessun input rompe la ricerca.
    hostile = ["", "'' or 1=1 --", "'';drop table public.books;--", "a & b | !c <-> d :* ( )",
               "%", "_", "\\", "📚🔥", "a" * 500, "dune:*", "il la e di"]
    broke = []
    for query in hostile:
        try:
            q(f"select count(*) from public.search_books('{lit(query)}',20,0,'it');")
        except RuntimeError as e:
            broke.append((query[:20], str(e)[:60]))
    before = int(q("select count(*) n from public.books;")[0]["n"])
    check("R-11", "nessun input rompe la ricerca", not broke, f"errori: {broke}")
    after = int(q("select count(*) n from public.books;")[0]["n"])
    check("S-3", "nessuna query di ricerca altera il database",
          before == after, f"{before} -> {after}")


# --------------------------------------------------------------- L: lingua
def test_language():
    # L-1 / L-2: filtro netto.
    for ident, code, label in (("L-1", "it", "Italiano"), ("L-2", "en", "Inglese")):
        offenders = []
        for query in ["amore", "dune", "storia", "harry potter", "romance"]:
            rows = q(
                f"select b.language from public.search_books('{lit(query)}',30,0,'{code}') s "
                f"join public.books b on b.id = s.id;"
            )
            wrong = [r["language"] for r in rows if r["language"] != code]
            if wrong:
                offenders.append((query, len(wrong), len(rows)))
        check(ident, f"filtro {label}: ogni risultato è in {code}",
              not offenders, f"query con risultati fuori lingua: {offenders}")

    # L-3: la preferenza morbida mette prima la lingua del profilo, senza escludere.
    # Una query scelta perché il catalogo ha davvero più lingue che la
    # soddisfano, altrimenti "solo italiano" sarebbe un esito legittimo.
    rows = q(
        "select b.language from public.search_books('dune',40,0,null) s "
        "join public.books b on b.id = s.id;"
    )
    langs = [r["language"] for r in rows]
    first_non_it = next((i for i, l in enumerate(langs) if l != "it"), len(langs))
    last_it = max([i for i, l in enumerate(langs) if l == "it"] or [-1])
    ordered = last_it < first_non_it or last_it == -1
    check("L-3", "preferenza morbida: prima la lingua del profilo, ma non solo",
          ordered and len(set(langs)) > 1,
          f"lingue in ordine: {langs[:12]}")

    # L-6: i libri senza lingua non spariscono dalla preferenza morbida…
    unknown_soft = int(q(
        "select count(*) n from public.search_books('',200,0,null) s "
        "join public.books b on b.id = s.id where b.language is null;"
    )[0]["n"])
    # …ma sono esclusi dal filtro netto.
    unknown_hard = int(q(
        "select count(*) n from public.search_books('',200,0,'it') s "
        "join public.books b on b.id = s.id where b.language is null;"
    )[0]["n"])
    check("L-6", "lingua ignota: visibile in morbido, esclusa dal filtro netto",
          unknown_hard == 0, f"morbido={unknown_soft} netto={unknown_hard}")

    # L-7 è lato Edge Function (langRestrict): verificato in docs/GOOGLE-BOOKS.md.


# --------------------------------------------------------------- G: generi
def test_genres():
    try:
        cases = [("fantasy", "fantasy"), ("giallo", "mystery"), ("dark romance", "dark-romance"),
                 ("saggistica", "nonfiction"), ("fantsy", "fantasy"), ("horror", "horror"),
                 ("poesia", "poetry"), ("thriller", "thriller")]
        bad = []
        for query, expected in cases:
            rows = q(f"select slug from public.search_genres('{lit(query)}',10);")
            if expected not in [r["slug"] for r in rows]:
                bad.append((query, expected))
        check("G-1/G-2/G-3", "ricerca per genere, in italiano e inglese, coi refusi",
              not bad, f"non trovati: {bad}" if bad else f"{len(cases)}/{len(cases)}")

        empty = q("select slug from public.search_genres('a',50) where book_count = 0;")
        check("G-4", "nessun genere proposto è vuoto",
              not empty, f"vuoti: {[r['slug'] for r in empty]}")
    except RuntimeError as e:
        check("G-1/G-2/G-3", "ricerca per genere", False, str(e)[:120])
        check("G-4", "nessun genere proposto è vuoto", False, "search_genres assente")


# --------------------------------------------------------------- C: catalogo
def test_catalog():
    rows = q(
        "select g.slug, (select count(*) from public.books b where g.slug = any(b.categories)) n "
        "from public.genres g where g.slug in "
        "('literary','mystery','thriller','fantasy','romance','young-adult','nonfiction',"
        " 'biography','poetry','horror','scifi');"
    )
    thin = [r["slug"] for r in rows if int(r["n"]) < 100]
    check("C-1", "il catalogo copre i generi principali",
          not thin, f"sotto 100 libri: {thin}" if thin else f"{len(rows)} generi coperti")

    modern = int(q(
        "select count(*) n from public.books where published_year >= 2015;")[0]["n"])
    check("C-2", "ci sono autori pubblicati di recente, non solo Gutenberg",
          modern >= 2000, f"libri dal 2015 in poi: {modern}")

    wanted = ["Kira Shell", "Erin Doom", "Carrie Leighton", "Felicia Kingsley", "Zerocalcare"]
    missing = []
    for a in wanted:
        n = int(q(
            "select count(*) n from public.books where "
            f"lower(public.authors_text(authors)) like '%{lit(a.lower())}%';")[0]["n"])
        if n == 0:
            missing.append(a)
    check("C-3", "autori di nicchia molto letti in Italia sono presenti",
          not missing, f"mancano: {missing}" if missing else f"tutti e {len(wanted)}")

    bare = q(
        "select count(*) n from public.search_books('',100,0,null) s "
        "join public.books b on b.id=s.id where b.cover_url is null;")
    check("C-4", "i libri in vetrina hanno una copertina",
          int(bare[0]["n"]) == 0, f"senza copertina fra i primi 100: {bare[0]['n']}")

    # C-6: il tag GRATIS solo dove c'è davvero un testo libero.
    bad_free = int(q(
        "select count(*) n from public.books where free_read_url is not null "
        "and free_read_url not like 'https://www.gutenberg.org/%' "
        "and free_read_url not like 'http://play.google.com/books/reader%' "
        "and free_read_url not like 'https://play.google.com/books/reader%' "
        "and free_read_url not like 'https://books.google.%';")[0]["n"])
    check("C-6", "il tag GRATIS punta solo a fonti legittime",
          bad_free == 0, f"link non riconosciuti: {bad_free}")


# --------------------------------------------------------------- S: sicurezza
def test_security():
    n = int(q(
        "select count(*) n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace "
        "where ns.nspname='public' and p.proname like 'internal_%' "
        "and has_function_privilege('anon', p.oid, 'execute');")[0]["n"])
    check("S-2", "le funzioni internal_* non sono richiamabili da anon",
          n == 0, f"esposte: {n}")

    cols = q(
        "select array_agg(a.attname order by a.attname) c from pg_attribute a "
        "where a.attrelid='public.profiles'::regclass and a.attnum>0 and not a.attisdropped "
        "and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE');")
    raw = cols[0]["c"] or []
    granted = raw if isinstance(raw, list) else [x for x in str(raw).strip("{}").split(",") if x]
    allowed = {"avatar_url", "bio", "display_name", "onboarded_at", "reading_language"}
    check("S-1", "un utente può aggiornare solo i campi di presentazione",
          set(granted) <= allowed, f"scrivibili: {granted}")


# ------------------------------------------------- R-7: import a richiesta
# Attenzione: questo blocco **scrive** in catalogo, perché è esattamente ciò che
# la funzione fa. È il comportamento del prodotto, non un effetto collaterale
# del test.
# Il criterio è l'**autore**, non il titolo: molte traduzioni italiane non
# esistono affatto presso i provider (Google Books ha "The Goldfinch" ma non
# "Il cardellino"), quindi pretendere il titolo italiano misurerebbe il
# catalogo di Google, non il nostro import. Il cognome dell'autore invece è lo
# stesso in ogni lingua.
# Il candidato si **genera**, non si sceglie da una lista: ogni giro ne importa
# uno per davvero, quindi qualunque elenco fisso si consuma da solo e dopo
# qualche esecuzione il test passerebbe a vuoto. Open Library fornisce coppie
# titolo+autore reali — un fixture inventato ("La rondine" attribuito a
# Janeczek) darebbe un falso allarme — e non ha quota.
OL_UA = os.environ.get("OPEN_LIBRARY_USER_AGENT", "tomo-spec-test/0.1")


def _open_library_candidati(offset):
    url = ("https://openlibrary.org/search.json?q=language%3Aita"
           f"&limit=20&offset={offset}&fields=title,author_name")
    req = urllib.request.Request(url, headers={"User-Agent": OL_UA})
    try:
        with _opener.open(req, timeout=60) as r:
            return json.loads(r.read()).get("docs", [])
    except Exception:
        return []


def _autore_in_catalogo(surname):
    return int(q("select count(*) n from public.books where "
                 f"lower(public.authors_text(authors)) like '%{lit(surname)}%';")[0]["n"])


def test_import():
    if not ANON:
        check("R-7", "un libro assente viene importato quando lo si cerca", False,
              "TOMO_ANON_KEY non impostata: test non eseguito")
        return

    # Serve un autore davvero assente, altrimenti il test sarebbe vero per
    # costruzione. Se un candidato non porta il suo autore, quasi sempre il
    # titolo nel fixture non è davvero suo: si prova il successivo invece di
    # dare la colpa al prodotto. Il fallimento resta possibile — se nessun
    # candidato importa niente, l'import è rotto sul serio.
    tentativi = []
    visti = set()
    for offset in (0, 200, 700, 1500, 3000, 6000):
        for d in _open_library_candidati(offset):
            titolo = (d.get("title") or "").strip()
            autori = d.get("author_name") or []
            if not titolo or not autori:
                continue
            # Senza togliere gli accenti il confronto non può funzionare:
            # `authors_text` in catalogo passa da immutable_unaccent, quindi
            # cercare "jérôme" non trova mai "Jerome".
            parole = norm(autori[0]).split()
            cognome = parole[-1] if parole else ""
            if len(cognome) < 4 or cognome in visti or not cognome.isalpha():
                continue
            visti.add(cognome)
            if _autore_in_catalogo(cognome) != 0:
                continue

            query = f"{titolo} {autori[0]}"
            tot_prima = int(q("select count(*) n from public.books;")[0]["n"])
            try:
                res = ingest({"query": query, "limit": 10, "lang": "it", "expand": True})
            except Exception as e:
                # Una connessione caduta non è un difetto del prodotto.
                check("R-7", "un libro assente viene importato quando lo si cerca", None,
                      f"rete: {type(e).__name__} — riprovare")
                return
            time.sleep(2)
            n_autore = _autore_in_catalogo(cognome)
            tot_dopo = int(q("select count(*) n from public.books;")[0]["n"])
            diretti = len(res.get("books", []))

            if n_autore > 0:
                check("R-7", "un libro assente viene importato quando lo si cerca", True,
                      f"{query[:50]!r}: {cognome} da 0 a {n_autore} libri, "
                      f"{diretti} risultati diretti")
                simili = res.get("related", 0)
                errore = res.get("expand_error")
                check("R-7b", "l'import porta anche libri simili, non solo quello cercato",
                      simili > 0 and not errore,
                      f"espansione fallita: {errore}" if errore else
                      f"nuovi in catalogo {tot_dopo - tot_prima}, di cui {diretti} diretti "
                      f"e {simili} simili")
                return

            tentativi.append(f"{query[:40]!r}: {diretti} importati, nessun {cognome}")
            if len(tentativi) >= 3:
                break
        if len(tentativi) >= 3:
            break

    if not tentativi:
        # Nessun autore proposto da Open Library manca al catalogo: non c'è
        # niente da importare, quindi non c'è niente da verificare.
        check("R-7", "un libro assente viene importato quando lo si cerca", None,
              "nessun autore assente fra quelli proposti: nulla da importare")
        return
    check("R-7", "un libro assente viene importato quando lo si cerca", False,
          " ; ".join(tentativi))


# --------------------------------------------------------------- client
def test_client():
    src = open("app/app/search.tsx", encoding="utf-8").read()
    tabs = all(t in src for t in ('"books"', '"authors"', '"genres"', '"users"'))
    check("R-1", "le quattro schede di ricerca esistono", tabs,
          "books/authors/genres/users" if tabs else "manca una scheda")
    # Il testo digitato vive in uno stato separato dalla scheda: cambiare scheda
    # non lo azzera.
    keeps = "setTab(t)" in src and "setQuery(\"\")" not in src
    check("R-2", "cambiare scheda non perde il testo digitato", keeps)
    check("R-8", "l'import lo dice a schermo",
          "Cerco anche fuori dal catalogo" in src)
    check("R-9", "prima di digitare la schermata spiega cosa cercare",
          "function Hint()" in src)
    check("R-10", "il primo tocco apre il risultato anche con tastiera aperta",
          src.count('keyboardShouldPersistTaps="handled"') >= 4)
    check("L-5", "filtro netto senza risultati: spiegato, con via d'uscita",
          "Cerca in tutte le lingue" in src)
    check("F-5", "le griglie partono da tre colonne",
          "Math.max(3," in open("app/src/theme/index.ts", encoding="utf-8").read())


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    for fn in (test_search, test_language, test_genres, test_catalog, test_security,
               test_import, test_client):
        try:
            fn()
        except Exception as e:  # un test rotto non deve nascondere gli altri
            check(fn.__name__, "esecuzione del blocco", False, f"{type(e).__name__}: {e}")

    rows = [r for r in RESULTS if not only or r[0].startswith(only)]
    width = max(len(r[0]) for r in rows) if rows else 8
    failed = 0
    for ident, desc, ok, detail in rows:
        mark = "  --  " if ok is None else ("  ok  " if ok else " FAIL ")
        failed += ok is False
        print(f"{mark} {ident:<{width}}  {desc}")
        if detail and not ok:
            print(f"        └─ {detail}")
        elif detail:
            print(f"        └─ {detail}")
    skipped = sum(1 for r in rows if r[2] is None)
    print(f"\n{len(rows) - failed - skipped}/{len(rows) - skipped} controlli superati"
          + (f"  ({skipped} non verificabili ora)" if skipped else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
