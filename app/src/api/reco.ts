import { supabase } from "@/lib/supabase";
import type { BookCard, BookReco, UUID } from "@/types/database";

/** Personalized recommendations (semantic + heuristic blend) via RPC. */
export async function getRecommendations(limit = 20, offset = 0): Promise<BookReco[]> {
  const { data, error } = await supabase.rpc("get_recommendations", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as BookReco[];
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

/** Taste-ranked PAID discoveries (newer titles, buy via Amazon). */
export async function getPaidDiscoveries(limit = 15): Promise<BookCard[]> {
  const { data, error } = await supabase.rpc("get_reco_by_availability", {
    p_free: false,
    p_limit: limit,
  });
  if (error) throw error;
  return (data ?? []) as BookCard[];
}

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
