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
// Conference proceedings / seminars masquerading as authors.
const JUNK_AUTHOR =
  /\b(cliffs|sparknotes|bookrags|shmoop|semin[aá]rio|seminar|simp[oó]sio|symposium|congress|congresso|proceedings|atti del|conference)\b/i;

function isJunk(title: string, authors: string[]): boolean {
  if (JUNK_TITLE.test(title)) return true;
  if (authors.some((a) => JUNK_AUTHOR.test(a))) return true;
  // Author strings carrying a year-in-parens are almost always event records
  // ("Seminário … (1985 Rio de Janeiro)"), never a person.
  if (authors.some((a) => /\(\s*(1[5-9]\d\d|20\d\d)\b/.test(a))) return true;
  return false;
}

// Cyrillic → Latin, leaning to the forms an Italian reader recognises
// (Dostoevskij, not Dostoyevsky). Italian users don't want "Фёдор".
const CYR: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "ë", ж: "ž", з: "z",
  и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "ch", ц: "c", ч: "č", ш: "š", щ: "šč",
  ъ: "", ы: "y", ь: "", э: "e", ю: "ju", я: "ja",
};
function hasCyrillic(s: string): boolean {
  return /[Ѐ-ӿ]/.test(s);
}
function translit(s: string): string {
  let out = "";
  for (const ch of s) {
    const low = ch.toLowerCase();
    const mapped = CYR[low];
    if (mapped === undefined) { out += ch; continue; }
    out += ch === low ? mapped : mapped.charAt(0).toUpperCase() + mapped.slice(1);
  }
  return out;
}
// Russian patronymic (…ovič / …evič / …ovna / …ična) — checked on the
// transliterated form and dropped, so we show the familiar
// "Fëdor Dostoevskij" rather than the full three-part name.
const PATRONYMIC = /(ovi[čc]|evi[čc]|ovna|evna|i[čc]na)$/i;

// "Dostoyevsky, Fyodor" -> "Fyodor Dostoyevsky"; Cyrillic -> Latin;
// drops a Russian patronymic when present.
function flipName(name: string): string {
  const p = name.split(",");
  let n = p.length === 2 ? `${p[1].trim()} ${p[0].trim()}` : name.trim();
  if (hasCyrillic(n)) {
    n = translit(n);
    const parts = n.split(/\s+/);
    if (parts.length === 3 && PATRONYMIC.test(parts[1])) parts.splice(1, 1);
    n = parts.join(" ");
  }
  return n;
}

// Apply flipName to every author, dropping blanks and duplicates.
function normalizeAuthors(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = flipName(raw);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
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
    authors: normalizeAuthors(info.authors ?? []),
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
        authors: normalizeAuthors(r.authors.map((a: any) => a.name)),
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
    authors: normalizeAuthors((rec.authors ?? []).map((a: any) => a.name)),
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
        authors: normalizeAuthors(d.author_name ?? []),
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

// --- Instant embedding -------------------------------------------------
// Mirror of the SQL book_embedding_text(): the string we embed.
function embeddingText(b: any): string {
  return (
    `${b.title ?? ""} — ${(b.authors ?? []).join(", ")}. ` +
    `${(b.categories ?? []).join(", ")}. ${b.description ?? ""}`
  ).slice(0, 1500);
}

// Embed freshly-imported books synchronously so a just-searched title is
// recommendable immediately, instead of waiting for the 5-minute cron. Uses
// the same model/params as the cron (512-dim). Best-effort: on any failure
// the book simply keeps embedding=null and the cron picks it up as before.
async function embedNewBooks(supabase: any, books: any[]): Promise<void> {
  const need = books.filter((b) => b && b.embedding == null);
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!need.length || !key) return;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openai/text-embedding-3-small",
        input: need.map(embeddingText),
        dimensions: 512,
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const rows = (data.data ?? [])
      .filter((d: any) => need[d.index])
      .map((d: any) => ({ id: need[d.index].id, e: d.embedding }));
    if (rows.length) await supabase.rpc("set_book_embeddings", { p_rows: rows });
  } catch {
    // cron fallback covers it
  }
}

// Upsert a batch of normalized books, skipping junk and cross-source dupes.
// `seen` is shared so callers can avoid re-importing the same work twice.
async function upsertMany(
  supabase: any,
  list: NormalizedBook[],
  seen: Set<string>,
  cap = Infinity,
): Promise<any[]> {
  const out: any[] = [];
  for (const nb of list) {
    if (out.length >= cap) break;
    if (!nb.title || nb.authors.length === 0) continue;
    if (isJunk(nb.title, nb.authors)) continue;
    const k = dedupKey(nb.title, nb.authors);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(await upsertCanonical(supabase, nb));
  }
  return out;
}

// Grow the catalog around a search: pull books *related* to the ones just
// imported — other works by the same author, and titles in the same
// subject — so the "cluster" around a searched book fills in for next time.
// Public-domain related titles arrive free-to-read via Gutenberg.
async function gatherRelated(baseBooks: any[]): Promise<NormalizedBook[]> {
  const authors = new Set<string>();
  const cats = new Set<string>();
  for (const b of baseBooks.slice(0, 3)) {
    (b.authors ?? []).slice(0, 1).forEach((a: string) => a && authors.add(a));
    (b.categories ?? []).slice(0, 1).forEach((c: string) => c && cats.add(c));
  }
  const tasks: Promise<NormalizedBook[]>[] = [];
  for (const a of [...authors].slice(0, 2)) {
    tasks.push(googleBooksSearch(`inauthor:"${a}"`, 10));
    tasks.push(gutendexSearch(a.split(/\s+/).slice(-1)[0], 5)); // same author on Gutenberg
  }
  for (const c of [...cats].slice(0, 1)) {
    tasks.push(openLibrarySearch(c, 10));
  }
  const settled = await Promise.all(tasks.map((t) => t.catch(() => [] as NormalizedBook[])));
  return settled.flat();
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

    const seen = new Set<string>();
    const books = await upsertMany(supabase, normalized, seen);

    // Make the just-imported titles instantly recommendable.
    await embedNewBooks(supabase, books);

    // Catalog expansion: pull the cluster of related books around this
    // search (same author / same subject). Capped, and its embeddings run
    // too, so the reco engine has more to work with next time. Best-effort.
    let related: any[] = [];
    if (body.expand && books.length) {
      try {
        const rel = await gatherRelated(books);
        related = await upsertMany(supabase, rel, seen, 30);
        await embedNewBooks(supabase, related);
      } catch {
        // expansion is best-effort; never fail the base import
      }
    }

    return new Response(JSON.stringify({ books, related: related.length }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
