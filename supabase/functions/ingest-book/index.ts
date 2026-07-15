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
  providerIds: { provider: "google_books" | "open_library"; external_id: string }[];
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
    providerIds: v.id ? [{ provider: "google_books", external_id: v.id }] : [],
  };
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
    providerIds: [{ provider: "open_library", external_id: `ISBN:${isbn}` }],
  };
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
        dedup_key: dedupKey(nb.title, nb.authors),
      })
      .select("*")
      .single();
    if (error) throw error;
    book = data;
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
      normalized = await googleBooksSearch(String(body.query), Number(body.limit ?? 10));
    } else {
      return new Response(JSON.stringify({ error: "provide isbn, googleVolumeId or query" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const books = [];
    for (const nb of normalized) {
      // Skip junk rows with no author or title.
      if (!nb.title || nb.authors.length === 0) continue;
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
