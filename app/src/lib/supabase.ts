// =====================================================================
// Supabase client. Persists the session with a platform-appropriate
// store: SecureStore on native, localStorage on web. The anon key is
// public by design; all data access is governed by Row Level Security.
// =====================================================================
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

// Public project defaults so every build (local, Vercel, EAS) works with zero
// env configuration. These are NOT secrets: the URL and anon key ship in every
// client bundle by design, and all data access is enforced by Row Level
// Security. Override per-environment with EXPO_PUBLIC_* when needed (e.g. a
// staging project). Using constants also sidesteps EXPO_PUBLIC_* inlining
// pitfalls (Metro caches transforms, so changing env vars needs `-c`).
const FALLBACK_SUPABASE_URL = "https://tpphaalfmcqtfxhyafzz.supabase.co";
const FALLBACK_SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwcGhhYWxmbWNxdGZ4aHlhZnp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQxNDA5MDMsImV4cCI6MjA5OTcxNjkwM30.nJCpr6_KWtoB23_6ZtwNzDSJk40RqpFhGm7f7EMTOuM";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? FALLBACK_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? FALLBACK_SUPABASE_ANON_KEY;

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
