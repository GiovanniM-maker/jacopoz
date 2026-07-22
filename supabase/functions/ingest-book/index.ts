// =====================================================================
// Edge Function: ingest-book
//
// Resolves external book metadata (Google Books, Open Library) into our
// CANONICAL catalog, deduping by ISBN-13 then by normalized title+author.
// This is the single writer to public.books, so the client never touches
// the catalog directly. Runs with the service role (bypasses RLS).
//
// POST body (one of):
//   { "isbn": "9780441172719" }            -> import a single edition
//   { "googleVolumeId": "abc123" }         -> import a specific Google volume
//   { "query": "dune", "limit": 10 }       -> search Google Books and import top N
//
// Returns: { books: BookRow[] } — the canonical rows (existing or created).
// =====================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

interface NormalizedBook {
  title: string;
  subtitle: string | null;
  authors: string[];
  description: string | null;
  cover_url: string | null;
  published_year: number | null;
  page_count: number | null;
  language: string | null;
  isbn_13: string | null;
  isbn_10: string | null;
  categories: string[];
  gutenberg_id: number | null;
  free_read_url: string | null;
  providerIds: { provider: "google_books" | "open_library"; external_id: string }[];
}

// Study guides / summaries / notes pollute book search — never a real book.
const JUNK_TITLE =
  /\b(cliffs?notes?|sparknotes?|study guide|summary|summaries|analysis of|a guide to|workbook|quicklet|shmoop|notes on|reading group guide|companion to|the unofficial)\b/i;

function isJunk(title: string, authors: string[]): boolean {
  if (JUNK_TITLE.test(title)) return true;
  if (authors.some((a) => /cliffs|sparknotes|bookrags|shmoop/i.test(a))) return true;
  return false;
}

// "Dostoyevsky, Fyodor" -> "Fyodor Dostoyevsky".
function flipName(name: string): string {
  const p = name.split(",");
  return p.length === 2 ? `${p[1].trim()} ${p[0].trim()}` : name.trim();
}

// Map noisy provider category strings onto our controlled genre slugs.
const GENRE_KEYWORDS: Record<string, string[]> = {
  fantasy: ["fantasy"],
  scifi: ["science fiction", "sci-fi", "space opera"],
  thriller: ["thriller", "suspense"],
  romance: ["romance", "love"],
  mystery: ["mystery", "detective", "crime"],
  horror: ["horror"],
  literary: ["literary", "classics", "literature"],
  historical: ["historical", "history"],
  nonfiction: ["nonfiction", "non-fiction"],
  business: ["business", "economics", "entrepreneur"],
  psychology: ["psychology"],
  "self-help": ["self-help", "self help", "personal development"],
  biography: ["biography", "memoir", "autobiography"],
  "young-adult": ["young adult", "juvenile"],
  poetry: ["poetry"],
};

function mapCategories(raw: string[]): string[] {
  const out = new Set<string>();
  for (const c of raw) {
    const lc = c.toLowerCase();
    for (const [slug, kws] of Object.entries(GENRE_KEYWORDS)) {
      if (kws.some((k) => lc.includes(k))) out.add(slug);
    }
  }
  return [...out];
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupKey(title: string, authors: string[]): string {
  return `${slugify(title)}|${slugify(authors[0] ?? "")}`;
}

// --- Google Books ------------------------------------------------------
function normalizeGoogleVolume(v: any): NormalizedBook | null {
  const info = v?.volumeInfo;
  if (!info?.title) return null;
  const ids: any[] = info.industryIdentifiers ?? [];
  const isbn13 = ids.find((i) => i.type === "ISBN_13")?.identifier ?? null;
  const isbn10 = ids.find((i) => i.type === "ISBN_10")?.identifier ?? null;
  const year = info.publishedDate ? parseInt(info.publishedDate.slice(0, 4), 10) : null;
  return {
    title: info.title,
    subtitle: info.subtitle ?? null,
    authors: info.authors ?? [],
    description: info.description ?? null,
    cover_url:
      info.imageLinks?.thumbnail?.replace("http://", "https://").replace("&edge=curl", "") ??
      (isbn13 ? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg` : null),
    published_year: Number.isFinite(year) ? year : null,
    page_count: info.pageCount ?? null,
    language: info.language ?? null,
    isbn_13: isbn13,
    isbn_10: isbn10,
    categories: mapCategories(info.categories ?? []),
    gutenberg_id: null,
    free_read_url: null,
    providerIds: v.id ? [{ provider: "google_books", external_id: v.id }] : [],
  };
}

// --- Project Gutenberg (Gutendex) — clean canonical data for classics --
async function gutendexSearch(query: string, limit: number): Promise<NormalizedBook[]> {
  const res = await fetch(`https://gutendex.com/books?search=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "TomoBeta/1.0" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results ?? [])
    .slice(0, limit)
    .map((r: any): NormalizedBook | null => {
      if (!r.title || !(r.authors?.length)) return null;
      const fmt = r.formats ?? {};
      const textUrl =
        fmt["text/plain; charset=utf-8"] || fmt["text/plain; charset=us-ascii"] ||
        fmt["text/plain"] || null;
      const author = r.authors[0];
      const year = author?.death_year ?? author?.birth_year ?? null;
      return {
        title: r.title,
        subtitle: null,
        authors: r.authors.map((a: any) => flipName(a.name)),
        description: null,
        cover_url: fmt["image/jpeg"] ?? null,
        published_year: year,
        page_count: null,
        language: (r.languages ?? [])[0] ?? null,
        isbn_13: null,
        isbn_10: null,
        categories: mapCategories(r.subjects ?? []),
        gutenberg_id: r.id,
        free_read_url: textUrl,
        providerIds: [],
      };
    })
    .filter(Boolean) as NormalizedBook[];
}

async function googleBooksSearch(query: string, limit: number): Promise<NormalizedBook[]> {
  const key = Deno.env.get("GOOGLE_BOOKS_API_KEY");
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(Math.min(limit, 40)));
  if (key) url.searchParams.set("key", key);
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items ?? []).map(normalizeGoogleVolume).filter(Boolean) as NormalizedBook[];
}

// --- Open Library (fallback, no key) ----------------------------------
async function openLibraryByIsbn(isbn: string): Promise<NormalizedBook | null> {
  const ua = Deno.env.get("OPEN_LIBRARY_USER_AGENT") ?? "jacopoz/0.1";
  const res = await fetch(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
    { headers: { "User-Agent": ua } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  const rec = data[`ISBN:${isbn}`];
  if (!rec) return null;
  const year = rec.publish_date ? parseInt((rec.publish_date.match(/\d{4}/) ?? [])[0], 10) : null;
  return {
    title: rec.title,
    subtitle: rec.subtitle ?? null,
    authors: (rec.authors ?? []).map((a: any) => a.name),
    description: typeof rec.notes === "string" ? rec.notes : null,
    cover_url: rec.cover?.large ?? `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`,
    published_year: Number.isFinite(year) ? year : null,
    page_count: rec.number_of_pages ?? null,
    language: null,
    isbn_13: isbn.length === 13 ? isbn : null,
    isbn_10: isbn.length === 10 ? isbn : null,
    categories: mapCategories((rec.subjects ?? []).map((s: any) => s.name)),
    gutenberg_id: null,
    free_read_url: null,
    providerIds: [{ provider: "open_library", external_id: `ISBN:${isbn}` }],
  };
}

// Open Library free-text search. Used as the primary free-text source
// because Google Books free-text is unreliable from the edge runtime
// without an API key (it silently returns nothing).
async function openLibrarySearch(query: string, limit: number): Promise<NormalizedBook[]> {
  const ua = Deno.env.get("OPEN_LIBRARY_USER_AGENT") ?? "jacopoz/0.1";
  const url = new URL("https://openlibrary.org/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", String(Math.min(limit, 20)));
  url.searchParams.set("fields", "key,title,author_name,first_publish_year,isbn,cover_i,subject,number_of_pages_median");
  const res = await fetch(url, { headers: { "User-Agent": ua } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.docs ?? [])
    .map((d: any): NormalizedBook | null => {
      if (!d.title || !(d.author_name?.length)) return null;
      const isbn13 = (d.isbn ?? []).find((i: string) => i.length === 13) ?? null;
      return {
        title: d.title,
        subtitle: null,
        authors: d.author_name ?? [],
        description: null,
        cover_url: d.cover_i
          ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg`
          : isbn13
            ? `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg`
            : null,
        published_year: d.first_publish_year ?? null,
        page_count: d.number_of_pages_median ?? null,
        language: null,
        isbn_13: isbn13,
        isbn_10: null,
        categories: mapCategories(d.subject ?? []),
        gutenberg_id: null,
        free_read_url: null,
        providerIds: d.key ? [{ provider: "open_library", external_id: d.key }] : [],
      };
    })
    .filter(Boolean) as NormalizedBook[];
}

// --- Canonical upsert (dedup) -----------------------------------------
async function upsertCanonical(supabase: any, nb: NormalizedBook) {
  // 1) Try to find an existing canonical row: ISBN-13 first, then dedup_key.
  let existing: any = null;
  if (nb.isbn_13) {
    const { data } = await supabase.from("books").select("*").eq("isbn_13", nb.isbn_13).maybeSingle();
    existing = data;
  }
  if (!existing) {
    const { data } = await supabase
      .from("books")
      .select("*")
      .eq("dedup_key", dedupKey(nb.title, nb.authors))
      .maybeSingle();
    existing = data;
  }

  let book = existing;
  if (!book) {
    const { data, error } = await supabase
      .from("books")
      .insert({
        title: nb.title,
        subtitle: nb.subtitle,
        authors: nb.authors,
        description: nb.description,
        cover_url: nb.cover_url,
        published_year: nb.published_year,
        page_count: nb.page_count,
        language: nb.language,
        isbn_13: nb.isbn_13,
        isbn_10: nb.isbn_10,
        categories: nb.categories,
        gutenberg_id: nb.gutenberg_id,
        free_read_url: nb.free_read_url,
        gutenberg_checked_at: nb.gutenberg_id ? new Date().toISOString() : null,
        dedup_key: dedupKey(nb.title, nb.authors),
      })
      .select("*")
      .single();
    if (error) throw error;
    book = data;
  } else if (nb.gutenberg_id && !existing.gutenberg_id) {
    // Enrich an existing row with the free-read link discovered via Gutenberg.
    await supabase
      .from("books")
      .update({
        gutenberg_id: nb.gutenberg_id,
        free_read_url: nb.free_read_url,
        gutenberg_checked_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  }

  // 2) Record provider ids (idempotent) so future lookups resolve instantly.
  if (nb.providerIds.length) {
    await supabase
      .from("book_external_ids")
      .upsert(
        nb.providerIds.map((p) => ({ ...p, book_id: book.id })),
        { onConflict: "provider,external_id", ignoreDuplicates: true },
      );
  }
  return book;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json();
    let normalized: NormalizedBook[] = [];

    if (body.isbn) {
      const isbn = String(body.isbn).replace(/[^0-9Xx]/g, "");
      const g = await googleBooksSearch(`isbn:${isbn}`, 1);
      normalized = g.length ? g : ([await openLibraryByIsbn(isbn)].filter(Boolean) as NormalizedBook[]);
    } else if (body.googleVolumeId) {
      const res = await fetch(`https://www.googleapis.com/books/v1/volumes/${body.googleVolumeId}`);
      const v = res.ok ? await res.json() : null;
      const nb = v ? normalizeGoogleVolume(v) : null;
      if (nb) normalized = [nb];
    } else if (body.query) {
      // Gutenberg first — clean canonical data for public-domain classics
      // (correct author, free to read). Then Google Books (richer modern
      // metadata), Open Library as the always-available fallback.
      const q = String(body.query);
      const n = Number(body.limit ?? 10);
      const [guten, google] = await Promise.all([
        gutendexSearch(q, Math.min(n, 5)),
        googleBooksSearch(q, n),
      ]);
      normalized = [...guten, ...google];
      if (normalized.length === 0) normalized = await openLibrarySearch(q, n);
    } else {
      return new Response(JSON.stringify({ error: "provide isbn, googleVolumeId or query" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const books = [];
    const seen = new Set<string>();
    for (const nb of normalized) {
      // Skip rows with no author/title, and study guides / summaries.
      if (!nb.title || nb.authors.length === 0) continue;
      if (isJunk(nb.title, nb.authors)) continue;
      const k = dedupKey(nb.title, nb.authors);
      if (seen.has(k)) continue; // Gutenberg + Google dupes of the same work
      seen.add(k);
      books.push(await upsertCanonical(supabase, nb));
    }

    return new Response(JSON.stringify({ books }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
