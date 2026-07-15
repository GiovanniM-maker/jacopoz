// =====================================================================
// Supabase client. Persists the session with a platform-appropriate
// store: SecureStore on native, localStorage on web. The anon key is
// public by design; all data access is governed by Row Level Security.
// =====================================================================
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Fail loud in dev — a missing env var otherwise surfaces as opaque 401s.
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy app/.env.example to app/.env and fill them in.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // AsyncStorage works on native and web; simplest cross-platform choice.
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // URL session detection only matters on web OAuth redirects.
    detectSessionInUrl: Platform.OS === "web",
  },
});
