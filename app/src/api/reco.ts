import { supabase } from "@/lib/supabase";
import type { BookReco } from "@/types/database";

/** Personalized recommendations (non-ML cascade) via get_recommendations RPC. */
export async function getRecommendations(limit = 20, offset = 0): Promise<BookReco[]> {
  const { data, error } = await supabase.rpc("get_recommendations", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as BookReco[];
}
