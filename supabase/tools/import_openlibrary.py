#!/usr/bin/env python3
"""
Bulk-import a LARGE, multilingual book catalog from Open Library into Supabase.

Free, no API key. For every (subject, language) it walks several pages of the
Open Library "readinglog" popularity ranking, maps subjects onto Decameron's
genre slugs, and upserts into public.books with canonical dedup (ISBN-13 /
slugified title+author) — so re-running never creates duplicates. dedup_key and
the search vector are computed in SQL to match the app.

Usage:
    SB_PAT=<pat> SB_REF=<ref> \
        python3 supabase/tools/import_openlibrary.py [--per 100] [--pages 5] [--dry]

Scale guide (unique books grow sublinearly due to dedup):
    --per 40  --pages 1  -> ~700    (default seed)
    --per 100 --pages 5  -> ~15-25k
    --per 100 --pages 10 -> ~30-45k
Writes via the Supabase Management API over HTTPS (no direct Postgres needed).
"""
import argparse, json, os, time, urllib.parse, urllib.request

OL = "https://openlibrary.org/search.json"
UA = os.environ.get("OPEN_LIBRARY_USER_AGENT", "decameron/0.1 (catalog import)")

# (Open Library subject query, Decameron genre slug). Multiple subjects per
# slug broaden coverage well beyond the 15 core genres.
SUBJECTS = [
    ("fantasy", "fantasy"), ("epic_fantasy", "fantasy"), ("magic", "fantasy"),
    ("science_fiction", "scifi"), ("dystopian", "scifi"), ("space_opera", "scifi"),
    ("thriller", "thriller"), ("suspense", "thriller"),
    ("romance", "romance"), ("love_stories", "romance"),
    ("mystery", "mystery"), ("detective_and_mystery_stories", "mystery"), ("crime", "mystery"),
    ("horror", "horror"),
    ("literature", "literary"), ("fiction", "literary"), ("classics", "literary"),
    ("historical_fiction", "historical"), ("history", "historical"),
    ("nonfiction", "nonfiction"), ("science", "nonfiction"), ("philosophy", "nonfiction"),
    ("religion", "nonfiction"), ("travel", "nonfiction"), ("cooking", "nonfiction"),
    ("business", "business"), ("economics", "business"), ("management", "business"),
    ("psychology", "psychology"),
    ("self-help", "self-help"), ("personal_development", "self-help"),
    ("biography", "biography"), ("biography_autobiography", "biography"),
    ("young_adult_fiction", "young-adult"), ("juvenile_fiction", "young-adult"),
    ("poetry", "poetry"),
]

LANGS = [("eng", "en"), ("ita", "it"), ("spa", "es"), ("fre", "fr"), ("ger", "de"), ("por", "pt")]

GENRE_KEYWORDS = {
    "fantasy": ["fantasy"], "scifi": ["science fiction", "sci-fi", "dystop"],
    "thriller": ["thriller", "suspense"], "romance": ["romance", "love"],
    "mystery": ["mystery", "detective", "crime"], "horror": ["horror"],
    "literary": ["literary", "classic", "literature"], "historical": ["historical", "history"],
    "nonfiction": ["nonfiction", "non-fiction", "science", "philosophy"],
    "business": ["business", "economics", "management"], "psychology": ["psychology"],
    "self-help": ["self-help", "personal development"], "biography": ["biography", "memoir"],
    "young-adult": ["young adult", "juvenile", "children"], "poetry": ["poetry"],
}


def map_categories(subjects, primary):
    out = {primary}
    for s in subjects or []:
        low = s.lower()
        for slug, kws in GENRE_KEYWORDS.items():
            if any(k in low for k in kws):
                out.add(slug)
    return sorted(out)


def fetch(subject, lang_code, per, page):
    params = {
        "subject": subject, "language": lang_code, "sort": "readinglog",
        "limit": per, "page": page,
        "fields": "title,author_name,first_publish_year,isbn,cover_i,subject",
    }
    url = OL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r).get("docs", [])
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return []


def normalize(doc, primary_slug, our_lang):
    title = (doc.get("title") or "").strip()
    authors = doc.get("author_name") or []
    if not title or not authors:
        return None
    isbn13 = next((i for i in (doc.get("isbn") or []) if len(i) == 13 and i.isdigit()), None)
    year = doc.get("first_publish_year")
    if isinstance(year, int) and (year < 0 or year > 2100):
        year = None
    cover = f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-L.jpg" if doc.get("cover_i") else (
        f"https://covers.openlibrary.org/b/isbn/{isbn13}-L.jpg" if isbn13 else None)
    return {
        "title": title[:400], "authors": authors[:5],
        "categories": map_categories(doc.get("subject"), primary_slug),
        "isbn_13": isbn13, "published_year": year,
        "language": our_lang, "cover_url": cover,
    }


def upsert_batch(rows, pat, ref):
    payload = json.dumps(rows, ensure_ascii=False)
    sql = (
        "insert into public.books "
        "(title, authors, categories, isbn_13, dedup_key, published_year, language, cover_url) "
        "select x.title, "
        "  array(select jsonb_array_elements_text(x.authors)), "
        "  array(select jsonb_array_elements_text(x.categories)), "
        "  nullif(x.isbn_13,''), "
        "  public.slugify(x.title) || '|' || public.slugify(coalesce(x.authors->>0,'')), "
        "  x.published_year, nullif(x.language,''), nullif(x.cover_url,'') "
        "from jsonb_to_recordset($jz$" + payload + "$jz$::jsonb) "
        "as x(title text, authors jsonb, categories jsonb, isbn_13 text, "
        "     published_year int, language text, cover_url text) "
        "on conflict do nothing;"
    )
    body = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}/database/query",
        data=body, method="POST",
        headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json",
                 "User-Agent": "curl/8.5.0"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status
        except Exception:
            time.sleep(2 * (attempt + 1))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=100, help="books per page (max ~100)")
    ap.add_argument("--pages", type=int, default=5, help="pages per (subject,language)")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    pat, ref = os.environ.get("SB_PAT"), os.environ.get("SB_REF")
    if not args.dry and not (pat and ref):
        raise SystemExit("Set SB_PAT and SB_REF (or use --dry).")

    seen, batch, sent = set(), [], 0
    for si, (subject, slug) in enumerate(SUBJECTS):
        for ol_lang, our_lang in LANGS:
            for page in range(1, args.pages + 1):
                docs = fetch(subject, ol_lang, args.per, page)
                if not docs:
                    break  # no more pages for this subject/lang
                for d in docs:
                    nb = normalize(d, slug, our_lang)
                    if not nb:
                        continue
                    key = (nb["title"].lower(), (nb["authors"][0] or "").lower())
                    if key in seen:
                        continue
                    seen.add(key)
                    batch.append(nb)
                if len(batch) >= 300 and not args.dry:
                    sent += len(batch)
                    upsert_batch(batch, pat, ref)
                    batch = []
                time.sleep(0.25)
        print(f"[{si + 1}/{len(SUBJECTS)}] {subject:28} unique={len(seen)} sent={sent}", flush=True)

    if batch and not args.dry:
        sent += len(batch)
        upsert_batch(batch, pat, ref)
    print(f"\nDone. {len(seen)} unique candidates; {sent} rows sent (server-side dedup applied).")


if __name__ == "__main__":
    main()
