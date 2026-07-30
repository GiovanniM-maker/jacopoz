import { supabase } from "@/lib/supabase";
import type { Book, BookCard, ExternalReview, Genre, UUID } from "@/types/database";

/** Full catalog search via the search_books RPC (FTS + trigram fallback). */
export async function searchBooks(
  query: string,
  limit = 20,
  offset = 0,
  lang?: string | null,
): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc("search_books", {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
    p_lang: lang ?? null,
  });
  if (error) throw error;
  return mergeEditions((data ?? []) as BookCard[]);
}

/** Normalise a title for comparison: drop edition parentheticals, accents,
 *  punctuation and case, so "A' Ciascuno Il Suo (Gli Adelphi)" ≡ "A ciascuno il suo".
 *  A leading article goes too — providers disagree about it on the same work
 *  ("Notti Bianche" and "Le notti bianche" are the same book). */
function normTitle(t: string): string {
  const flat = (t || "")
    .replace(/\([^)]*\)/g, " ")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return flat.replace(/^(?:il|lo|la|i|gli|le|l|un|uno|una|the|a|an)\s+/, "").replace(/\s+/g, "");
}

/** Any author in common, compared on accent-folded full names. Providers list
 *  translators, editors and imprints ahead of the author, so the *first* author
 *  is not a reliable identity — "Notti bianche" arrives credited to Cortese,
 *  Martinulli or Dostoevskij depending on the edition, with Dostoevskij present
 *  further down the list. Requiring a shared name still keeps two different
 *  works that happen to share a title apart. */
function sharesAuthor(a: string[] | null, b: string[] | null): boolean {
  const fold = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const setA = new Set((a ?? []).map(fold).filter(Boolean));
  if (setA.size === 0) return false;
  return (b ?? []).map(fold).some((n) => n && setA.has(n));
}

/** True when two same-length titles differ in a single character — catches
 *  provider typos like "a ciascuno il suo" vs "a ciascuno il sur". */
function oneCharApart(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 10) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && ++diff > 1) return false;
  }
  return diff === 1;
}

/** How complete a row is — decides which edition survives a merge. */
function completeness(b: BookCard): number {
  return (
    (b.cover_url ? 4 : 0) +
    (b.avg_rating ? 1 : 0) +
    Math.min(3, (b.reads_count + b.saves_count + b.likes_count + b.reviews_count) / 5)
  );
}

/**
 * Collapse duplicate *editions* of the same work. Providers hand us the same
 * book several times — a translated edition, an "(Gli Adelphi)" reprint, and
 * sometimes a typo'd title — each as its own row with its own ISBN. Merge rows
 * that share an author and whose titles match exactly once normalised, or differ
 * by a single character (a typo). Deliberately conservative: series like
 * "The Dark Tower I"/"II" differ in length and are left alone.
 */
export function mergeEditions(rows: BookCard[]): BookCard[] {
  const kept: { norm: string; book: BookCard }[] = [];
  for (const b of rows) {
    const norm = normTitle(b.title);
    const hit = kept.find(
      (k) =>
        (k.norm === norm || oneCharApart(k.norm, norm)) && sharesAuthor(k.book.authors, b.authors),
    );
    if (!hit) {
      kept.push({ norm, book: b });
    } else if (completeness(b) > completeness(hit.book)) {
      hit.book = b; // keep the richer edition
      hit.norm = norm;
    }
  }
  return kept.map((k) => k.book);
}

/** Attributed external voices for the "Dalla critica" section. */
export async function getExternalReviews(bookId: UUID): Promise<ExternalReview[]> {
  const { data, error } = await supabase
    .from("external_reviews")
    .select("id,book_id,source,source_label,excerpt,url,license")
    .eq("book_id", bookId);
  if (error) throw error;
  return (data ?? []) as ExternalReview[];
}

/** Fire-and-forget: ask the pipeline to enrich this book (circle 2). */
export async function requestBookEnrichment(bookId: UUID): Promise<void> {
  try {
    await supabase.rpc("request_book_enrichment", { p_book_id: bookId });
  } catch {
    // enrichment is best-effort
  }
}

/** Semantic neighbours from the embedding space — "Simili a questo". */
export async function getSimilarBooks(bookId: UUID, limit = 12): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc("get_similar_books", {
    p_book_id: bookId,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as BookCard[];
}

/** Popularity-with-recency row for the dashboard cold-start backstop. */
export async function getTrendingBooks(limit = 20, offset = 0): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc("get_trending_books", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as BookCard[];
}

/** Trending, rotated by `seed` so the row isn't frozen between visits. */
export async function getTrendingSeeded(limit = 20, seed = 0): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc("get_trending_seeded", {
    p_limit: limit,
    p_seed: seed,
  });
  if (error) throw error;
  return (data ?? []) as BookCard[];
}

/** Books in a single genre — powers the genre rows on the dashboard. */
export async function getBooksByGenre(slug: string, limit = 20): Promise<BookCard[]> {
  const { data, error } = await supabase
    .from("books")
    .select(
      "id,title,subtitle,authors,cover_url,published_year,categories,reads_count,saves_count,likes_count,reviews_count,rating_sum,rating_count",
    )
    .contains("categories", [slug])
    .order("reads_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  // Map raw rows to BookCard (compute avg_rating client-side).
  return (data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    authors: b.authors,
    cover_url: b.cover_url,
    published_year: b.published_year,
    categories: b.categories,
    avg_rating: b.rating_count > 0 ? Number((b.rating_sum / b.rating_count).toFixed(2)) : null,
    reads_count: b.reads_count,
    saves_count: b.saves_count,
    likes_count: b.likes_count,
    reviews_count: b.reviews_count,
  }));
}

/** New releases row. */
export async function getNewReleases(limit = 20): Promise<BookCard[]> {
  const { data, error } = await supabase
    .from("books")
    .select(
      "id,title,subtitle,authors,cover_url,published_year,categories,reads_count,saves_count,likes_count,reviews_count,rating_sum,rating_count",
    )
    .not("published_year", "is", null)
    .order("published_year", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    authors: b.authors,
    cover_url: b.cover_url,
    published_year: b.published_year,
    categories: b.categories,
    avg_rating: b.rating_count > 0 ? Number((b.rating_sum / b.rating_count).toFixed(2)) : null,
    reads_count: b.reads_count,
    saves_count: b.saves_count,
    likes_count: b.likes_count,
    reviews_count: b.reviews_count,
  }));
}

/** Author search via the search_authors RPC. */
export async function searchAuthors(
  query: string,
  limit = 30,
): Promise<{ author: string; book_count: number }[]> {
  if (!query.trim()) return [];
  const { data, error } = await supabase.rpc("search_authors", { p_query: query, p_limit: limit });
  if (error) throw error;
  return (data ?? []) as { author: string; book_count: number }[];
}

/** Books by a specific author, as cards. */
export async function getBooksByAuthor(author: string, limit = 40): Promise<BookCard[]> {
  const { data, error } = await supabase
    .from("books")
    .select(
      "id,title,subtitle,authors,cover_url,published_year,categories,reads_count,saves_count,likes_count,reviews_count,rating_sum,rating_count",
    )
    .contains("authors", [author])
    .order("reads_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((b) => ({
    id: b.id,
    title: b.title,
    subtitle: b.subtitle,
    authors: b.authors,
    cover_url: b.cover_url,
    published_year: b.published_year,
    categories: b.categories,
    avg_rating: b.rating_count > 0 ? Number((b.rating_sum / b.rating_count).toFixed(2)) : null,
    reads_count: b.reads_count,
    saves_count: b.saves_count,
    likes_count: b.likes_count,
    reviews_count: b.reviews_count,
  }));
}

/** Single canonical book row. */
export async function getBook(id: UUID): Promise<Book> {
  const { data, error } = await supabase.from("books").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Book;
}

export async function getGenres(): Promise<Genre[]> {
  const { data, error } = await supabase
    .from("genres")
    .select("*")
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Genre[];
}

export function bookAvgRating(book: Pick<Book, "rating_sum" | "rating_count">): number | null {
  return book.rating_count > 0 ? Number((book.rating_sum / book.rating_count).toFixed(2)) : null;
}

/**
 * Ask the ingest-book Edge Function to import search results from external
 * providers into the catalog. Called when local search is thin so results
 * populate over time. Best-effort — failure just means no new imports.
 */
export async function importFromProviders(
  query: string,
  limit = 10,
  lang?: string | null,
  expand = false,
): Promise<void> {
  try {
    // Passing the reader's language makes the provider return editions in that
    // language first, so searching an Italian title imports the Italian edition
    // instead of whichever translation ranks globally.
    //
    // `expand` also pulls the cluster around the hits (same author, same
    // subject). It used to be a second, unconditional Edge invocation on every
    // search; folding it in here means a search costs one provider round-trip
    // instead of two.
    await supabase.functions.invoke("ingest-book", { body: { query, limit, lang, expand } });
  } catch {
    // ignore — catalog stays as-is
  }
}

export interface CatalogLanguage {
  language: string;
  book_count: number;
}

/** Languages the catalogue actually carries, for the search filter. */
export async function getCatalogLanguages(): Promise<CatalogLanguage[]> {
  const { data, error } = await supabase.rpc("get_catalog_languages");
  if (error) return [];
  return (data ?? []) as CatalogLanguage[];
}

export interface BookEdition {
  id: string;
  title: string;
  authors: string[];
  cover_url: string | null;
  language: string | null;
  published_year: number | null;
  isbn_13: string | null;
  page_count: number | null;
  is_current: boolean;
}

/**
 * Every edition of the work this book belongs to, best-for-this-reader first.
 * Lets the book page offer an edition picker instead of scattering the same work
 * across several search results.
 */
export async function getBookEditions(bookId: string): Promise<BookEdition[]> {
  const { data, error } = await supabase.rpc("get_book_editions", { p_book_id: bookId });
  if (error) return [];
  return (data ?? []) as BookEdition[];
}
