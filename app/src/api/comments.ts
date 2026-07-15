import { supabase } from "@/lib/supabase";
import type { CommentWithAuthor, UUID } from "@/types/database";
import { track } from "./analytics";

/** Top-level comments for a review, each with its author and reply count. */
export async function getComments(
  reviewId: UUID,
  viewerId?: UUID,
): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*, author:profiles!comments_user_id_fkey(id,username,display_name,avatar_url)")
    .eq("review_id", reviewId)
    .is("parent_comment_id", null)
    .eq("status", "visible")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return attachViewerLikes((data ?? []) as unknown as CommentWithAuthor[], viewerId);
}

/** Replies to a single comment (one level deep). */
export async function getReplies(
  parentId: UUID,
  viewerId?: UUID,
): Promise<CommentWithAuthor[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*, author:profiles!comments_user_id_fkey(id,username,display_name,avatar_url)")
    .eq("parent_comment_id", parentId)
    .eq("status", "visible")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return attachViewerLikes((data ?? []) as unknown as CommentWithAuthor[], viewerId);
}

/** Add a comment or a reply. parentId keeps the tree shallow (one level). */
export async function addComment(
  userId: UUID,
  reviewId: UUID,
  body: string,
  parentId?: UUID,
): Promise<CommentWithAuthor> {
  const { data, error } = await supabase
    .from("comments")
    .insert({
      user_id: userId,
      review_id: reviewId,
      parent_comment_id: parentId ?? null,
      body,
    })
    .select("*, author:profiles!comments_user_id_fkey(id,username,display_name,avatar_url)")
    .single();
  if (error) throw error;
  void track("comment_created", { reviewId, isReply: !!parentId });
  return data as unknown as CommentWithAuthor;
}

export async function deleteComment(id: UUID): Promise<void> {
  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) throw error;
}

async function attachViewerLikes(
  comments: CommentWithAuthor[],
  viewerId?: UUID,
): Promise<CommentWithAuthor[]> {
  if (!viewerId || comments.length === 0) return comments;
  const ids = comments.map((c) => c.id);
  const { data } = await supabase
    .from("likes")
    .select("target_id")
    .eq("user_id", viewerId)
    .eq("target_type", "comment")
    .in("target_id", ids);
  const liked = new Set((data ?? []).map((l) => l.target_id));
  return comments.map((c) => ({ ...c, viewer_has_liked: liked.has(c.id) }));
}
