#!/usr/bin/env python3
"""
Bulk-import a rich, multilingual book catalog from Open Library into Supabase.

Free, no API key. Pulls the most popular works (Open Library "readinglog"
ranking) for each of jacopoz's genres across several languages, maps subjects
onto our genre slugs, and upserts into public.books using the canonical dedup
(ISBN-13 / slugified title+author) — so re-running is safe and never creates
duplicates. dedup_key and search vector are computed in SQL to match the app.

Usage:
    SB_PAT=<personal-access-token> SB_REF=<project-ref> \
        python3 supabase/tools/import_openlibrary.py [--per 40] [--dry]

Writes via the Supabase Management API over HTTPS (no direct Postgres needed).
"""
import argparse, json, os, time, urllib.parse, urllib.request

OL = "https://openlibrary.org/search.json"
UA = os.environ.get("OPEN_LIBRARY_USER_AGENT", "jacopoz/0.1 (catalog import)")

# jacopoz genre slug -> Open Library subject term
GENRE_SUBJECTS = {
    "fantasy": "fantasy",
    "scifi": "science_fiction",
    "thriller": "thriller",
    "romance": "romance",
    "mystery": "mystery",
    "horror": "horror",
    "literary": "literature",
    "historical": "historical_fiction",
    "nonfiction": "nonfiction",
    "business": "business",
    "psychology": "psychology",
    "self-help": "self-help",
    "biography": "biography",
    "young-adult": "young_adult_fiction",
    "poetry": "poetry",
}

# Open Library language code (639-2/B) -> our ISO 639-1 tag. English first so
# global bestsellers keep their English title before localized queries run.
LANGS = [("eng", "en"), ("ita", "it"), ("spa", "es"), ("fre", "fr"), ("ger", "de"), ("por", "pt")]

# Keyword -> extra genre slug, to enrich categories beyond the queried genre.
GENRE_KEYWORDS = {
    "fantasy": ["fantasy"], "scifi": ["science fiction", "sci-fi"],
    "thriller": ["thriller", "suspense"], "romance": ["romance", "love stories"],
    "mystery": ["mystery", "detective", "crime"], "horror": ["horror"],
    "literary": ["literary", "classics", "literature"], "historical": ["historical", "history"],
    "nonfiction": ["nonfiction", "non-fiction"], "business": ["business", "economics"],
    "psychology": ["psychology"], "self-help": ["self-help", "personal development"],
    "biography": ["biography", "memoir"], "young-adult": ["young adult", "juvenile"],
    "poetry": ["poetry"],
}


def map_categories(subjects, primary):
    out = {primary}
    for s in subjects or []:
        low = s.lower()
        for slug, kws in GENRE_KEYWORDS.items():
            if any(k in low for k in kws):
                out.add(slug)
    return sorted(out)


def fetch(subject, lang_code, per):
    params = {
        "subject": subject, "language": lang_code, "sort": "readinglog",
        "limit": per,
        "fields": "title,author_name,first_publish_year,isbn,cover_i,subject",
    }
    url = OL + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=45) as r:
            return json.load(r).get("docs", [])
    except Exception as e:
        print(f"  ! fetch failed ({subject}/{lang_code}): {e}")
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
        "title": title[:400],
        "authors": authors[:5],
        "categories": map_categories(doc.get("subject"), primary_slug),
        "isbn_13": isbn13,
        "published_year": year,
        "language": our_lang,
        "cover_url": cover,
    }


def upsert_batch(rows, pat, ref):
    payload = json.dumps(rows, ensure_ascii=False)
    # dedup_key + tsv computed in SQL (public.slugify) to match existing rows.
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
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.status


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per", type=int, default=40, help="books per (genre,language)")
    ap.add_argument("--dry", action="store_true", help="fetch only, no writes")
    args = ap.parse_args()
    pat, ref = os.environ.get("SB_PAT"), os.environ.get("SB_REF")
    if not args.dry and not (pat and ref):
        raise SystemExit("Set SB_PAT and SB_REF (or use --dry).")

    seen, batch, total = set(), [], 0
    for slug, subject in GENRE_SUBJECTS.items():
        for ol_lang, our_lang in LANGS:
            docs = fetch(subject, ol_lang, args.per)
            for d in docs:
                nb = normalize(d, slug, our_lang)
                if not nb:
                    continue
                key = (nb["title"].lower(), (nb["authors"][0] or "").lower())
                if key in seen:
                    continue
                seen.add(key)
                batch.append(nb)
            print(f"  {slug:12} {ol_lang}  (+{len(docs)} docs, {len(seen)} unique so far)")
            time.sleep(0.3)  # be polite to Open Library
        # flush per genre to keep requests bounded
        if batch and not args.dry:
            for i in range(0, len(batch), 200):
                chunk = batch[i:i + 200]
                upsert_batch(chunk, pat, ref)
                total += len(chunk)
            batch = []

    print(f"\nDone. {len(seen)} unique candidates gathered; {total} rows sent (dedup applied server-side).")


if __name__ == "__main__":
    main()
