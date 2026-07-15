import { supabase } from "@/lib/supabase";
import type { LikeableType, ReportTarget, ContentStatus, UUID } from "@/types/database";
import { track } from "./analytics";

/** Toggle a like on a review/comment via the atomic RPC. Returns new state. */
export async function toggleLike(
  targetType: LikeableType,
  targetId: UUID,
): Promise<{ liked: boolean; like_count: number }> {
  const { data, error } = await supabase.rpc("toggle_like", {
    p_target_type: targetType,
    p_target_id: targetId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (row?.liked) void track("review_liked", { targetType, targetId });
  return row as { liked: boolean; like_count: number };
}

export async function followUser(targetId: UUID): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess.session?.user.id;
  if (!me) throw new Error("not authenticated");
  const { error } = await supabase.from("follows").insert({
    follower_id: me,
    following_id: targetId,
  });
  if (error) throw error;
  void track("user_followed", { targetId });
}

export async function unfollowUser(targetId: UUID): Promise<void> {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess.session?.user.id;
  if (!me) throw new Error("not authenticated");
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", me)
    .eq("following_id", targetId);
  if (error) throw error;
}

export async function isFollowing(targetId: UUID): Promise<boolean> {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess.session?.user.id;
  if (!me) return false;
  const { data } = await supabase
    .from("follows")
    .select("follower_id")
    .eq("follower_id", me)
    .eq("following_id", targetId)
    .maybeSingle();
  return !!data;
}

/** File a report. Re-reporting the same target is a silent no-op server-side. */
export async function reportContent(
  targetType: ReportTarget,
  targetId: UUID,
  reason: string,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc("report_content", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason: reason,
    p_note: note ?? null,
  });
  if (error) throw error;
}

/** Moderator-only: change the visibility of a review/comment. */
export async function moderateContent(
  targetType: LikeableType,
  targetId: UUID,
  status: ContentStatus,
): Promise<void> {
  const { error } = await supabase.rpc("moderate_content", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_status: status,
  });
  if (error) throw error;
}
