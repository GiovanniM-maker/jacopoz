import { supabase } from "@/lib/supabase";
import type { FeedItem } from "@/types/database";

/** The ranked (non-chronological) community feed via get_community_feed RPC. */
export async function getCommunityFeed(limit = 20, offset = 0): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc("get_community_feed", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as FeedItem[];
}
