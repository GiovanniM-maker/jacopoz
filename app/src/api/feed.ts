import { supabase } from "@/lib/supabase";
import type { FeedItem } from "@/types/database";

/** The ranked "For You" feed via get_community_feed RPC. */
export async function getCommunityFeed(limit = 20, offset = 0): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc("get_community_feed", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as FeedItem[];
}

/** The "Following" feed: reviews from people you follow, newest first. */
export async function getFollowingFeed(limit = 20, offset = 0): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc("get_following_feed", {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as FeedItem[];
}

/** Reviews on a single book, ranked for the viewer (interests-aware). */
export async function getBookReviewsRanked(
  bookId: string,
  limit = 30,
  offset = 0,
): Promise<FeedItem[]> {
  const { data, error } = await supabase.rpc("get_book_reviews_ranked", {
    p_book_id: bookId,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as FeedItem[];
}
