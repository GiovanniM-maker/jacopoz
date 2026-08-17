import { supabase } from "@/lib/supabase";
import type { BookCard, BookReco, UUID } from "@/types/database";

/**
 * Personalized recommendations (semantic + heuristic blend) via RPC.
 *
 * `seed` rotates the slate: the same seed always returns the same ordering
 * (so paging is stable), a new seed reshuffles which good books surface. Pass
 * a fresh seed on pull-to-refresh; keep it while scrolling.
 */
export async function getRecommendations(limit = 20, offset = 0, seed = 0): Promise<BookReco[]> {
  const { data, error } = await supabase.rpc("get_recommendations", {
    p_limit: limit,
    p_offset: offset,
    p_seed: seed,
  });
  if (error) throw error;
  return (data ?? []) as BookReco[];
}

export interface ContinueReadingBook extends BookCard {
  percent: number;
  bookmark_percent: number | null;
  free_read_url: string | null;
  /** Only a Gutenberg text can be opened by the in-app reader; a Google Books
   *  free read is an external page, so those go to the book detail instead. */
  gutenberg_id: number | null;
}

/** Books the reader has actually started — the "Continua a leggere" row. */
export async function getContinueReading(limit = 12): Promise<ContinueReadingBook[]> {
  const { data, error } = await supabase.rpc("get_continue_reading", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as ContinueReadingBook[];
}

export interface HomeSection {
  key: string;
  title: string;
  rank: number;
  books: BookCard[];
}

/**
 * Personalised, named home rows ("Perché hai letto X", "Ancora <autore>",
 * "Il tuo filone: …", editorial angles). Which rows come back depends on
 * `seed`, so a refresh surfaces different sections. Returns them grouped and
 * ordered, dropping rows too thin to look intentional.
 */
export async function getHomeSections(seed = 0, maxSections = 5): Promise<HomeSection[]> {
  const { data, error } = await supabase.rpc("get_home_sections", {
    p_seed: seed,
    p_max_sections: maxSections,
    p_per_section: 12,
  });
  if (error) throw error;
  const groups = new Map<string, HomeSection>();
  for (const row of (data ?? []) as any[]) {
    let g = groups.get(row.section_key);
    if (!g) {
      g = { key: row.section_key, title: row.section_title, rank: row.section_rank, books: [] };
      groups.set(row.section_key, g);
    }
    g.books.push(row as BookCard);
  }
  return [...groups.values()].filter((g) => g.books.length >= 4).sort((a, b) => a.rank - b.rank);
}

/** Taste-ranked FREE reads (readable in-app now). */
export async function getFreeReadsForYou(limit = 15): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc("get_reco_by_availability", {
    p_free: true,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as BookCard[];
}

// `getPaidDiscoveries` stava qui, unica chiamante di `get_reco_by_availability`
// con `p_free = false`. Rimossa insieme alla riga della Home che la usava: il
// senso di quella riga per il lettore era «questo lo puoi comprare», e senza i
// link Amazon era un sottoinsieme di «Consigliati per te» ordinato per data.
// La RPC resta e serve «Gratis, consigliati per te» con `p_free = true`.

/**
 * Log which recommendations were actually shown — the denominator of CTR.
 * Fire-and-forget: metrics must never break the UI.
 */
export async function logRecoImpressions(
  bookIds: UUID[],
  surface: "home" | "similar" | "search" = "home",
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid || bookIds.length === 0) return;
    // Position logged with each impression → CTR can be corrected for
    // rank bias (top slots get clicked regardless of relevance).
    await supabase
      .from("reco_impressions")
      .insert(bookIds.map((book_id, i) => ({ user_id: uid, book_id, surface, position: i })));
  } catch {
    // never surface metrics failures
  }
}

/** Explicit negative signal: hide this book from recommendations. */
export async function dismissBook(bookId: UUID): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const { error } = await supabase
    .from("book_dismissals")
    .upsert({ user_id: uid, book_id: bookId });
  if (error) throw error;
}
