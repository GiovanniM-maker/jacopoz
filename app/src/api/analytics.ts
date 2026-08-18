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
  // `affiliate_click` era qui: nessuna schermata lo emette più da quando i
  // pulsanti Amazon sono stati rimossi. Le righe storiche in
  // `analytics_events` conservano quel nome — questo elenco dice cosa si può
  // scrivere da oggi, non cosa è stato scritto ieri.
  | "read_open"
  | "read_progress"
  | "feed_opened";

/**
 * Fire-and-forget analytics. Never throws into the UI: analytics must not
 * break a user action. user_id is filled from the session by RLS/default.
 */
export async function track(name: AnalyticsEvent, props: Record<string, unknown> = {}) {
  try {
    const { data } = await supabase.auth.getSession();
    // Ignorato di proposito: le statistiche non devono poter rompere un gesto
    // del lettore. È l'unico caso in questo file, e la differenza col difetto di
    // `saveReadProgress` è che qui non si perde niente che il lettore possieda.
    await supabase.from("analytics_events").insert({
      name,
      props,
      user_id: data.session?.user.id ?? null,
    });
  } catch {
    // swallow — telemetry is best-effort
  }
}
