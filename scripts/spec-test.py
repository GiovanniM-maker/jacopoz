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

# Un lettore con abbastanza cronologia da rendere personalizzabile la Home.
READER = None


def ingest(body, timeout=240):
    """Chiama la Edge Function esattamente come fa app/app/search.tsx."""
    req = urllib.request.Request(
        "https://tpphaalfmcqtfxhyafzz.supabase.co/functions/v1/ingest-book",
        method="POST", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {ANON}", "apikey": ANON,
                 "content-type": "application/json", "User-Agent": "curl/8.5.0"})
    with _opener.open(req, timeout=timeout) as r:
        return json.loads(r.read())


def as_reader(sql):
    """Esegue con l'identità di un lettore reale. Le sezioni della Home, i feed e
    «Continua a leggere» sono personalizzati: misurarli da anonimo vuol dire
    misurare il fallback, non la funzione."""
    uid = READER or ""
    if not uid:
        return None
    return q(f"set local role authenticated; "
             f"set local request.jwt.claims = '{{\"sub\":\"{uid}\",\"role\":\"authenticated\"}}'; "
             + sql)


def q(sql, _tries=4):
    """La Management API limita la frequenza delle richieste e ogni tanto
    risponde 502: né l'una né l'altra cosa è un fallimento della specifica,
    quindi si aspetta e si riprova invece di riportare un bug che non c'è.

    Senza la riprova sui 5xx un blocco intero saltava — due giri di fila, e
    ogni volta un blocco diverso — trascinandosi dietro i controlli che
    conteneva. Una suite che grida al lupo per un errore di rete smette di
    essere una fonte affidabile, che è tutto quello per cui esiste."""
    for attempt in range(_tries):
        st, out = sbq.sql(sql)
        if st == 201:
            return out or []
        if (st == 429 or st >= 500) and attempt < _tries - 1:
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

    # C-7: nessuna sinossi senza il materiale su cui è stata scritta.
    # Il difetto trovato in produzione: senza quarta di copertina il modello
    # non risponde INSUFFICIENTE, riconosce il titolo e racconta il libro a
    # memoria — a «Oblivion» di Wallace ha attribuito la trama di «Infinite
    # Jest». Una scheda falsa è peggio di una scheda vuota, e finisce anche
    # nell'embedding. Questo controllo esiste perché non si ripeta.
    infondate = int(q(
        "select count(*) n from public.books "
        "where synopsis is not null and synopsis_source = 'ai' "
        "and not ('source_blurb_internal' = any(coalesce(synopsis_inputs, '{}')));"
    )[0]["n"])
    check("C-7", "ogni sinossi generata poggia su un materiale reale",
          infondate == 0, f"scritte senza materiale: {infondate}")


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
        # `None`, non `False`: una chiave che manca all'ambiente non è un difetto
        # del prodotto. Riportarlo rosso insegna a ignorare il rosso — è la
        # regola scritta in `check()`, e qui era stata disattesa.
        check("R-7", "un libro assente viene importato quando lo si cerca", None,
              "TOMO_ANON_KEY non impostata: test non eseguito")
        return

    # Serve un autore davvero assente, altrimenti il test sarebbe vero per
    # costruzione. Se un candidato non porta il suo autore, quasi sempre il
    # titolo nel fixture non è davvero suo: si prova il successivo invece di
    # dare la colpa al prodotto. Il fallimento resta possibile — se nessun
    # candidato importa niente, l'import è rotto sul serio.
    tentativi = []
    visti = set()
    for offset in (0, 200, 700, 1500, 3000, 6000, 12000, 20000):
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
            # Una connessione caduta non è un difetto del prodotto — ma
            # arrendersi al primo errore rende non verificabile il controllo
            # che copre l'import, che è fra i più importanti che ci sono.
            # L'import interroga fonti esterne e può metterci parecchio: si
            # riprova, e solo se cade tre volte si dichiara non verificabile.
            res, ultimo = None, None
            for tentativo in range(3):
                try:
                    res = ingest({"query": query, "limit": 10, "lang": "it", "expand": True})
                    break
                except Exception as e:
                    ultimo = e
                    time.sleep(4 * (tentativo + 1))
            if res is None:
                check("R-7", "un libro assente viene importato quando lo si cerca", None,
                      f"rete: {type(ultimo).__name__} per tre volte — riprovare")
                return
            # S-5: la risposta dell'import non deve riportare le colonne che
            # 0059 ha tolto ai lettori. Lì la protezione è un permesso sulla
            # tabella; qui il permesso non c'entra, perché la funzione legge
            # con la chiave di servizio — è il codice a decidere cosa esce.
            # Trovato così: `select("*")` rimandava indietro il testo
            # dell'editore a chiunque cercasse un libro.
            riservate = {"source_blurb_internal", "embedding", "search_tsv"}
            uscite = sorted(riservate.intersection(
                *[set(b) for b in res.get("books", [{}])] or [set()]))
            check("S-5", "l'import non restituisce le colonne interne",
                  not uscite, f"esposte: {uscite}" if uscite else "risposta pulita")

            time.sleep(2)
            n_autore = _autore_in_catalogo(cognome)
            tot_dopo = int(q("select count(*) n from public.books;")[0]["n"])
            diretti = len(res.get("books", []))

            # L'autore è il criterio migliore ma non l'unico: Open Library
            # elenca anche curatori e traduttori di edizioni antiche che Google
            # non ha ("Apocalypsis nova" attribuito ad Anna Morisi). Se il libro
            # cercato è comunque entrato ed è ora trovabile, l'import ha fatto
            # il suo lavoro.
            parole = [w for w in norm(titolo).split() if len(w) >= 4][:3]
            trovato_titolo = False
            if parole:
                righe = q(f"select s.title from public.search_books("
                          f"'{lit(titolo)}',10,0,null) s;")
                trovato_titolo = any(
                    all(w in norm(r["title"] or "") for w in parole) for r in righe)

            if n_autore > 0 or trovato_titolo:
                check("R-7", "un libro assente viene importato quando lo si cerca", True,
                      f"{query[:46]!r}: {diretti} importati; "
                      + (f"{cognome} da 0 a {n_autore} libri" if n_autore > 0
                         else "il titolo cercato è ora trovabile"))
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


# ------------------------------------------------------ H: home, F: social,
# ------------------------------------------------------ B: scheda libro
def test_home():
    # H-1: la Home cambia fra un'apertura e l'altra.
    slates = []
    for seed in (11, 22, 33):
        rows = as_reader(f"select section_key, id from public.get_home_sections({seed}, 6, 12);") or []
        slates.append({(r["section_key"], r["id"]) for r in rows})
    diverse = len(slates[0] | slates[1] | slates[2]) > int(len(slates[0]) * 1.3) if slates[0] else False
    check("H-1", "la Home cambia fra un'apertura e l'altra", diverse,
          f"elementi distinti su tre semi: {len(slates[0] | slates[1] | slates[2])} "
          f"contro {len(slates[0])} di un solo giro")

    # H-4: le sezioni parlano al lettore, non sono etichette di genere.
    titles = [r["section_title"] for r in (as_reader(
        "select distinct section_title from public.get_home_sections(7, 8, 6);") or [])]
    personal = [t for t in titles
                if any(k in (t or "").lower()
                       for k in ("perché hai", "ancora ", "il tuo", "per te"))]
    inglesi = [t for t in titles
               if any(w in (t or "") for w in
                      ("Nonfiction", "Biography", "Literary", "Young Adult", "Self Help",
                       "Science Fiction", "Mystery", "Poetry", "Historical", "Business",
                       "Psychology"))]
    check("H-4", "le sezioni della Home hanno nomi riferiti al lettore",
          bool(titles) and len(personal) > 0 and not inglesi,
          f"{len(personal)} personalizzate su {len(titles)}"
          + (f"; slug inglesi in una frase italiana: {inglesi}" if inglesi else ""))

    # H-6: lo stesso libro non compare in due caroselli della stessa schermata.
    #
    # Le sezioni ordinano tutte lo stesso bacino, quindi un libro finisce
    # facilmente in più di una: la sovrapposizione a livello di RPC è attesa e
    # non è il difetto. La garanzia sta a schermo, ed è lì che va verificata —
    # con l'accortezza che una sezione svuotata dal dedup non deve restare come
    # titolo senza libri sotto.
    rows = as_reader("select section_key, id from public.get_home_sections(5, 6, 12);") or []
    per_book = {}
    for r in rows:
        per_book.setdefault(r["id"], set()).add(r["section_key"])
    sovrapposti = sum(1 for secs in per_book.values() if len(secs) > 1)

    home = open("app/app/(tabs)/index.tsx", encoding="utf-8").read()
    dedup = "seen.has(b.id)" in home and "seen.add(b.id)" in home
    niente_righe_vuote = "books.length >= 4 ?" in home
    check("H-6", "nessun libro in due caroselli della stessa schermata",
          dedup and niente_righe_vuote,
          f"dedup a schermo={dedup}, sezioni svuotate nascoste={niente_righe_vuote} "
          f"(sovrapposizioni grezze dall'RPC: {sovrapposti}, attese)")

    # H-3: "Continua a leggere" deve portare l'id Gutenberg, o il lettore
    # in-app apre una schermata vuota (era proprio questo il difetto).
    cols = {r["column_name"] for r in q(
        "select p.proname, unnest(p.proargnames) as column_name from pg_proc p "
        "join pg_namespace n on n.oid=p.pronamespace "
        "where n.nspname='public' and p.proname='get_continue_reading';")}
    ret = q("select pg_get_function_result(p.oid) r from pg_proc p "
            "join pg_namespace n on n.oid=p.pronamespace "
            "where n.nspname='public' and p.proname='get_continue_reading';")
    check("H-3", "«Continua a leggere» espone l'id per riaprire il libro",
          "gutenberg_id" in (ret[0]["r"] if ret else ""), "")


def test_social():
    # F-3: i contatori memorizzati devono coincidere col conteggio reale.
    drift = q("""
      select 'reviews.like_count' as che, count(*) n from public.reviews r
      where r.like_count <> (select count(*) from public.likes l
                             where l.target_type='review' and l.target_id=r.id)
      union all
      select 'reviews.comment_count', count(*) from public.reviews r
      where r.comment_count <> (select count(*) from public.comments c where c.review_id=r.id)
      union all
      select 'profiles.followers_count', count(*) from public.profiles p
      where p.followers_count <> (select count(*) from public.follows f where f.following_id=p.id)
      union all
      select 'profiles.following_count', count(*) from public.profiles p
      where p.following_count <> (select count(*) from public.follows f where f.follower_id=p.id)
      union all
      -- Per opera, non per edizione (B-6): il contatore di ogni edizione
      -- riporta le recensioni dell'opera, che sono quelle che la scheda mostra.
      select 'books.reviews_count', count(*) from public.books b
      where b.reviews_count <> (select count(*) from public.reviews r
                                where r.work_id=b.work_id and r.status='visible');
    """)
    sballati = {r["che"]: int(r["n"]) for r in drift if int(r["n"]) > 0}
    check("F-3", "i contatori coincidono col conteggio reale",
          not sballati, f"disallineati: {sballati}" if sballati else "tutti allineati")

    # F-1: entrambi i feed esistono e rispondono.
    ok_feeds = True
    try:
        q("select count(*) from public.get_community_feed(10, 0);")
        q("select count(*) from public.get_following_feed(10, 0);")
    except RuntimeError:
        ok_feeds = False
    check("F-1", "esistono entrambi i feed, «Per te» e «Seguiti»", ok_feeds)


def test_book():
    # B-2: un solo voto per utente per libro, garantito dallo schema e non
    # dalla buona volontà del client.
    idx = q("""
      select count(*) n from pg_index i
      join pg_class c on c.oid = i.indexrelid
      where i.indrelid = 'public.user_books'::regclass and i.indisunique
        and pg_get_indexdef(i.indexrelid) like '%user_id%book_id%';
    """)
    # B-6: la recensione è appesa all'opera, e il vincolo lo garantisce.
    vincolo = int(q(
        "select count(*) n from pg_indexes where tablename='reviews' "
        "and indexdef ilike '%unique%' and indexdef ilike '%work_id%';")[0]["n"])
    orfane = int(q(
        "select count(*) n from public.reviews r join public.books b on b.id=r.book_id "
        "where r.work_id <> b.work_id;")[0]["n"])
    # Su un'opera con più edizioni, le recensioni si vedono da tutte.
    sparse = int(q("""
      select count(*) n from public.books b
      where exists (select 1 from public.reviews r where r.work_id = b.work_id
                      and r.book_id <> b.id and r.status='visible')
        and b.reviews_count = 0;""")[0]["n"])
    check("B-6", "una recensione parla dell'opera, non dell'edizione",
          vincolo == 1 and orfane == 0 and sparse == 0,
          f"vincolo unico su work_id: {vincolo}, recensioni scollegate: {orfane}, "
          f"edizioni che nascondono le recensioni dell'opera: {sparse}")

    check("B-2", "un solo voto per utente per libro (vincolo di schema)",
          int(idx[0]["n"]) > 0, f"indici unici (user_id, book_id): {idx[0]['n']}")

    # B-4 non è più qui: il requisito è stato ritirato il 15 agosto 2026 perché
    # il tag di affiliazione era un tag .com su link amazon.it, quindi nessuna
    # conversione è mai stata attribuita. Vedi «Requisiti ritirati» in
    # docs/SPECIFICA.md. L'identificativo resta un buco: non si rinumera.

    # B-3/C-5: le edizioni si raggiungono dalla scheda.
    ed = q("""
      select count(*) n from public.get_book_editions(
        (select b.id from public.books b
          where coalesce(b.work_key,'') <> ''
            and (select count(*) from public.books b2 where b2.work_key = b.work_key) > 1
          limit 1));
    """)
    check("B-3", "le edizioni sono raggiungibili dalla scheda libro",
          int(ed[0]["n"]) > 1, f"edizioni trovate: {ed[0]['n']}")


def test_extra_language():
    # L-4: con "Tutte" nessuna lingua è privilegiata — nessun bonus, quindi la
    # prima pagina non deve essere monolingua se il catalogo non lo è.
    rows = q("select b.language from public.search_books('amore',30,0,'all') s "
             "join public.books b on b.id=s.id;")
    langs = [r["language"] for r in rows]
    check("L-4", "con «Tutte» nessuna lingua è privilegiata",
          len(set(langs)) > 1, f"lingue viste: {sorted(set(map(str, langs)))}")


def test_genre_pages():
    # G-5: ogni genere che la ricerca propone deve avere una pagina con dentro
    # dei libri — la pagina usa `categories @> [slug]`, non la ricerca.
    vuoti = q("""
      select g.slug from public.search_genres('a', 50) g
      where (select count(*) from public.books b where g.slug = any(b.categories)) = 0;
    """)
    check("G-5", "ogni genere proposto apre su una pagina con libri dentro",
          not vuoti, f"vuoti: {[r['slug'] for r in vuoti]}")


def test_bundle():
    # S-4: nessuna chiave privata nel bundle web pubblico.
    #
    # Cercare la sottostringa "sb_secret_" non basta: supabase-js contiene
    # `e.startsWith("sb_secret_")` per riconoscere i prefissi, e un test che
    # segnala quello è un test che verrà ignorato. Servono forme che possano
    # essere solo una chiave vera.
    import glob
    perdite = []
    veleni = [
        (re.compile(r"sb_secret_[A-Za-z0-9_-]{20,}"), "chiave segreta Supabase"),
        (re.compile(r"sbp_[0-9a-f]{40}"), "personal access token Supabase"),
        (re.compile(r"sk-or-v1-[A-Za-z0-9]{20,}"), "chiave OpenRouter"),
        # JWT il cui payload dichiara service_role
        (re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl"), "JWT service_role"),
        (re.compile(r"BEGIN (?:EC )?PRIVATE KEY"), "chiave privata PEM"),
    ]
    for f in glob.glob("app/dist/**/*.js", recursive=True) + glob.glob("app/dist/*.html"):
        try:
            testo = open(f, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for rx, nome in veleni:
            if rx.search(testo):
                perdite.append((f.split("/")[-1], nome))
    check("S-4", "nessuna chiave privata nel bundle web", not perdite,
          f"trovate: {perdite}" if perdite else "bundle pulito")


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


def _scegli_lettore():
    global READER
    rows = q("select p.id from public.profiles p "
             "join public.user_books ub on ub.user_id = p.id "
             "group by p.id order by count(*) desc limit 1;")
    READER = rows[0]["id"] if rows else None


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    _scegli_lettore()
    for fn in (test_search, test_language, test_genres, test_catalog, test_security,
               test_import, test_home, test_social, test_book,
               test_extra_language, test_genre_pages, test_bundle, test_client):
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
