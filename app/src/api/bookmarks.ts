import { supabase } from "@/lib/supabase";
import type { BookmarkType, CommentWithAuthor, ReviewWithAuthor, UUID } from "@/types/database";

/** Toggle a bookmark on a review/comment. Returns the new state. */
export async function toggleBookmark(
  userId: UUID,
  targetType: BookmarkType,
  targetId: UUID,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from("bookmarks")
    .select("target_id")
    .eq("user_id", userId)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("bookmarks")
      .delete()
      .eq("user_id", userId)
      .eq("target_type", targetType)
      .eq("target_id", targetId);
    return false;
  }
  const { error } = await supabase
    .from("bookmarks")
    .insert({ user_id: userId, target_type: targetType, target_id: targetId });
  if (error) throw error;
  return true;
}

/** Bookmarked target ids of a type for the user (for filled/empty icons). */
export async function getBookmarkedIds(userId: UUID, targetType: BookmarkType): Promise<Set<UUID>> {
  const { data } = await supabase
    .from("bookmarks")
    .select("target_id")
    .eq("user_id", userId)
    .eq("target_type", targetType);
  return new Set((data ?? []).map((r) => r.target_id));
}

/** Saved reviews, hydrated with author + book, newest-saved first. */
export async function getSavedReviews(userId: UUID): Promise<ReviewWithAuthor[]> {
  const { data, error } = await supabase
    .from("bookmarks")
    .select(
      "target_id, created_at, review:reviews!bookmarks_target_id_fkey(*, author:profiles!reviews_user_id_fkey(id,username,display_name,avatar_url))",
    )
    .eq("user_id", userId)
    .eq("target_type", "review")
    .order("created_at", { ascending: false });
  // The FK hint above is best-effort; fall back to a two-step fetch if needed.
  if (error) return getSavedReviewsFallback(userId);
  return (data ?? []).map((r: any) => r.review).filter(Boolean) as ReviewWithAuthor[];
}

async function getSavedReviewsFallback(userId: UUID): Promise<ReviewWithAuthor[]> {
  const { data: ids } = await supabase
    .from("bookmarks")
    .select("target_id")
    .eq("user_id", userId)
    .eq("target_type", "review")
    .order("created_at", { ascending: false });
  const list = (ids ?? []).map((r) => r.target_id);
  if (list.length === 0) return [];
  const { data } = await supabase
    .from("reviews")
    .select("*, author:profiles!reviews_user_id_fkey(id,username,display_name,avatar_url)")
    .in("id", list);
  return (data ?? []) as unknown as ReviewWithAuthor[];
}

/** Saved comments, hydrated with author. */
export async function getSavedComments(userId: UUID): Promise<CommentWithAuthor[]> {
  const { data: ids } = await supabase
    .from("bookmarks")
    .select("target_id")
    .eq("user_id", userId)
    .eq("target_type", "comment")
    .order("created_at", { ascending: false });
  const list = (ids ?? []).map((r) => r.target_id);
  if (list.length === 0) return [];
  const { data } = await supabase
    .from("comments")
    .select("*, author:profiles!comments_user_id_fkey(id,username,display_name,avatar_url)")
    .in("id", list);
  return (data ?? []) as unknown as CommentWithAuthor[];
}
