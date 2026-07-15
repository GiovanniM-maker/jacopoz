import { supabase } from "@/lib/supabase";
import type { Genre, Profile, UUID } from "@/types/database";
import { track } from "./analytics";

export async function getProfile(id: UUID): Promise<Profile> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).single();
  if (error) throw error;
  return data as Profile;
}

export async function getProfileByUsername(username: string): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single();
  if (error) throw error;
  return data as Profile;
}

export async function updateProfile(
  id: UUID,
  patch: Partial<Pick<Profile, "display_name" | "bio" | "avatar_url">>,
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Profile;
}

// ---- Onboarding: genre preferences ----------------------------------

export async function getGenrePrefs(userId: UUID): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_genre_prefs")
    .select("genre_slug")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.genre_slug);
}

/** Replace the user's genre picks and stamp onboarded_at. Called from the
 *  onboarding taste picker — this is what solves reco cold-start. */
export async function saveOnboarding(userId: UUID, genreSlugs: string[]): Promise<void> {
  await supabase.from("user_genre_prefs").delete().eq("user_id", userId);
  if (genreSlugs.length) {
    const { error } = await supabase
      .from("user_genre_prefs")
      .insert(genreSlugs.map((slug) => ({ user_id: userId, genre_slug: slug })));
    if (error) throw error;
  }
  await supabase
    .from("profiles")
    .update({ onboarded_at: new Date().toISOString() })
    .eq("id", userId);
  void track("onboarding_completed", { genres: genreSlugs.length });
}

export interface ProfileStats {
  booksRead: number;
  booksSaved: number;
  reviews: number;
  likesReceived: number;
}

/** Basic profile statistics assembled from a few cheap count queries. */
export async function getProfileStats(userId: UUID): Promise<ProfileStats> {
  const [read, saved, reviews] = await Promise.all([
    supabase
      .from("user_books")
      .select("book_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "read"),
    supabase
      .from("user_books")
      .select("book_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("status", "want_to_read"),
    supabase
      .from("reviews")
      .select("id, like_count")
      .eq("user_id", userId)
      .eq("status", "visible"),
  ]);

  const likesReceived = (reviews.data ?? []).reduce(
    (sum: number, r: any) => sum + (r.like_count ?? 0),
    0,
  );

  return {
    booksRead: read.count ?? 0,
    booksSaved: saved.count ?? 0,
    reviews: (reviews.data ?? []).length,
    likesReceived,
  };
}
