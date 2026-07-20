import { supabase } from "@/lib/supabase";
import type { Genre, Profile, ProfileStats, UUID } from "@/types/database";
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

/** Permanently delete the signed-in user's account and all their data. */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
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

/** Full profile statistics in one round trip (see get_profile_stats RPC). */
export async function getProfileStats(userId: UUID): Promise<ProfileStats> {
  const { data, error } = await supabase.rpc("get_profile_stats", { p_user: userId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (row ?? {
    books_read: 0,
    reviews: 0,
    comments: 0,
    likes_received: 0,
    likes_given: 0,
    followers: 0,
    following: 0,
    lists: 0,
  }) as ProfileStats;
}

type MiniProfile = Pick<Profile, "id" | "username" | "display_name" | "avatar_url">;

/** Users who follow `userId`. */
export async function getFollowers(userId: UUID): Promise<MiniProfile[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("follower:profiles!follows_follower_id_fkey(id,username,display_name,avatar_url)")
    .eq("following_id", userId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.follower).filter(Boolean) as MiniProfile[];
}

/** Users `userId` follows. */
export async function getFollowing(userId: UUID): Promise<MiniProfile[]> {
  const { data, error } = await supabase
    .from("follows")
    .select("following:profiles!follows_following_id_fkey(id,username,display_name,avatar_url)")
    .eq("follower_id", userId);
  if (error) throw error;
  return (data ?? []).map((r: any) => r.following).filter(Boolean) as MiniProfile[];
}
