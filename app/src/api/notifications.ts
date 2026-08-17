import { supabase } from "@/lib/supabase";

export type NotificationType = "like" | "comment" | "follow";

export interface AppNotification {
  id: string;
  type: NotificationType;
  read: boolean;
  created_at: string;
  actor: { username: string; display_name: string; avatar_url: string | null } | null;
  review: { id: string; book: { title: string } | null } | null;
}

/** The current user's recent notifications (actor + which review). */
export async function getNotifications(limit = 50): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(
      "id, type, read, created_at, actor:profiles!actor_id(username, display_name, avatar_url), review:reviews!review_id(id, book:books(title))",
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  // supabase types nested relations as arrays sometimes; normalise to objects.
  return (data ?? []).map((n: any) => ({
    id: n.id,
    type: n.type,
    read: n.read,
    created_at: n.created_at,
    actor: Array.isArray(n.actor) ? n.actor[0] ?? null : n.actor ?? null,
    review: normReview(n.review),
  }));
}

function normReview(r: any): AppNotification["review"] {
  const rv = Array.isArray(r) ? r[0] : r;
  if (!rv) return null;
  const book = Array.isArray(rv.book) ? rv.book[0] : rv.book;
  return { id: rv.id, book: book ?? null };
}

/** Count of unread notifications (for the badge). */
export async function getUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("read", false);
  if (error) return 0;
  return count ?? 0;
}

export async function markNotificationsRead(): Promise<void> {
  try {
    await supabase.rpc("mark_notifications_read");
  } catch {
    // best-effort
  }
}
