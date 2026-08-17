import { supabase } from "@/lib/supabase";
import type { ReportTarget, UUID } from "@/types/database";

// Re-exported for callers that import it from here. It must stay identical to
// the DB's report_target enum (review | comment | profile | book) — a local
// copy declaring "user" is what silently broke profile reports.
export type { ReportTarget };

/** File a report. Duplicate reports by the same user are ignored. */
export async function reportContent(
  targetType: ReportTarget,
  targetId: UUID,
  reason?: string,
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const { error } = await supabase.from("reports").insert({
    reporter_id: uid,
    target_type: targetType,
    target_id: targetId,
    // reports.reason is NOT NULL — passing null made every report from the flag
    // button fail silently, which is why it looked like it did nothing.
    reason: reason && reason.trim() ? reason.trim() : "segnalato da un lettore",
  });
  // 23505 = already reported by this user — treat as success.
  if (error && error.code !== "23505") throw error;
}

export async function blockUser(blockedId: UUID): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const { error } = await supabase
    .from("user_blocks")
    .upsert({ blocker_id: uid, blocked_id: blockedId });
  if (error) throw error;
}

export async function unblockUser(blockedId: UUID): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) return;
  const { error } = await supabase
    .from("user_blocks")
    .delete()
    .eq("blocker_id", uid)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}

export async function isBlocked(blockedId: UUID): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_blocks")
    .select("blocked_id")
    .eq("blocked_id", blockedId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** Ids of users the viewer blocked — for client-side filtering (comments). */
export async function getBlockedIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from("user_blocks").select("blocked_id");
  if (error) throw error;
  return new Set((data ?? []).map((r: { blocked_id: string }) => r.blocked_id));
}
