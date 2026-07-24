import { supabase } from "@/lib/supabase";
import type { UUID } from "@/types/database";

export interface ReadInfo {
  readable: boolean;
  gutenberg_id: number | null;
}

/**
 * Availability of a free (public-domain) read for a book. The edge function
 * lazily matches the book to Project Gutenberg on first ask and caches the
 * result — so this also repairs classic author names.
 */
export async function getReadInfo(bookId: UUID): Promise<ReadInfo> {
  const { data, error } = await supabase.functions.invoke("read", {
    body: { book_id: bookId },
  });
  if (error || !data) return { readable: false, gutenberg_id: null };
  return { readable: !!data.readable, gutenberg_id: data.gutenberg_id ?? null };
}

/** The cleaned full text of a public-domain book (proxied, boilerplate stripped). */
export async function getBookText(gutenbergId: number): Promise<string> {
  const { data, error } = await supabase.functions.invoke("read", {
    body: { gutenberg_id: gutenbergId },
  });
  if (error || !data?.text) throw new Error("Testo non disponibile");
  return data.text as string;
}

/** Persist reading position; ≥90% marks the book read (strongest signal). */
export async function saveReadProgress(bookId: UUID, percent: number): Promise<void> {
  try {
    await supabase.rpc("save_read_progress", { p_book_id: bookId, p_percent: Math.round(percent) });
  } catch {
    // best-effort
  }
}

export interface ReadState {
  percent: number;
  bookmark: number | null;
}

export async function getReadProgress(bookId: UUID): Promise<ReadState> {
  const { data } = await supabase
    .from("book_read_progress")
    .select("percent, bookmark_percent")
    .eq("book_id", bookId)
    .maybeSingle();
  return {
    percent: data ? Number(data.percent) : 0,
    bookmark: data?.bookmark_percent != null ? Number(data.bookmark_percent) : null,
  };
}

/** Drop (or clear, with null) a deliberate bookmark at a scroll position. */
export async function saveBookmark(bookId: UUID, percent: number | null): Promise<void> {
  try {
    await supabase.rpc("save_bookmark", {
      p_book_id: bookId,
      p_percent: percent == null ? null : Math.round(percent),
    });
  } catch {
    // best-effort
  }
}

/**
 * A plain Amazon (.it) link for any book — by ISBN when we have it, else a
 * books search on title + author. No affiliate tag yet; we'll tag the
 * most-read titles later.
 */
export function amazonUrl(book: { title: string; authors: string[]; isbn_13?: string | null }): string {
  const term = book.isbn_13 ?? `${book.title} ${book.authors[0] ?? ""}`.trim();
  return `https://www.amazon.it/s?k=${encodeURIComponent(term)}&i=stripbooks`;
}
