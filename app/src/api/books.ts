import { supabase } from "@/lib/supabase";
import type { Book, BookCard, Genre, UUID } from "@/types/database";

/** Full catalog search via the search_books RPC (FTS + trigram fallback). */
export async function searchBooks(query: string, limit = 20, offset = 0): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc("search_books", {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as BookCard[];
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
export async function importFromProviders(query: string, limit = 10): Promise<void> {
  try {
    await supabase.functions.invoke("ingest-book", { body: { query, limit } });
  } catch {
    // ignore — catalog stays as-is
  }
}
