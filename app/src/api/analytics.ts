import { supabase } from "@/lib/supabase";

// Documented event vocabulary. Keeping names in one place prevents drift
// and makes the analytics_events table queryable with confidence.
export type AnalyticsEvent =
  | "onboarding_completed"
  | "book_viewed"
  | "search_performed"
  | "shelf_added"
  | "shelf_removed"
  | "book_liked"
  | "book_rated"
  | "review_created"
  | "review_liked"
  | "comment_created"
  | "user_followed"
  | "affiliate_click"
  | "feed_opened";

/**
 * Fire-and-forget analytics. Never throws into the UI: analytics must not
 * break a user action. user_id is filled from the session by RLS/default.
 */
export async function track(name: AnalyticsEvent, props: Record<string, unknown> = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    await supabase.from("analytics_events").insert({
      name,
      props,
      user_id: data.session?.user.id ?? null,
    });
  } catch {
    // swallow — telemetry is best-effort
  }
}
