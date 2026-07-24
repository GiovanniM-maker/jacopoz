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

/** Search users by username or display name. */
export async function searchUsers(query: string, limit = 30): Promise<Profile[]> {
  const q = query.trim();
  if (!q) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .order("followers_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Profile[];
}

/**
 * Readers to suggest following: the most active accounts the current user
 * doesn't already follow (and isn't). Ranked by review activity, then
 * followers. Powers the "Trova lettori" screen — the discovery half of the
 * social loop. Overfetches then filters client-side so a handful of already
 * followed accounts never empties the list.
 */
export async function getSuggestedReaders(limit = 20): Promise<Profile[]> {
  const { data: sess } = await supabase.auth.getSession();
  const me = sess.session?.user.id;

  let followed: string[] = [];
  if (me) followed = (await getFollowing(me)).map((u) => u.id);
  const exclude = new Set<string>([...(me ? [me] : []), ...followed]);

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("followers_count", { ascending: false })
    .order("books_read_count", { ascending: false })
    .limit(limit + exclude.size + 10);
  if (error) throw error;
  return ((data ?? []) as Profile[]).filter((p) => !exclude.has(p.id)).slice(0, limit);
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
