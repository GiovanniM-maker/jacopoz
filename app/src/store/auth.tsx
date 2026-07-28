// =====================================================================
// Auth context: exposes the current Supabase session, the loaded profile,
// and helpers. Drives the auth/onboarding gate in the root layout.
// =====================================================================
import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { queryClient } from "@/lib/queryClient";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/types/database";

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadProfile(userId: string) {
    // Right after sign-up the profile row is created by a DB trigger and may
    // not be visible on the first read — retry once before giving up, and use
    // maybeSingle so a transient error/empty result doesn't throw.
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
      if (data) {
        setProfile(data as Profile);
        return;
      }
      if (attempt === 0 && (error || !data)) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    setProfile(null);
  }

  useEffect(() => {
    let active = true;

    // Failsafe: never let the app hang on a blank loading screen. If the
    // network stalls, drop into the (signed-out) UI after a few seconds
    // rather than spinning forever.
    const failsafe = setTimeout(() => {
      if (active) setLoading(false);
    }, 6000);

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        setSession(data.session);
        if (data.session) await loadProfile(data.session.user.id);
      } catch {
        // ignore — fall through to signed-out state
      } finally {
        if (active) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      if (next) {
        try {
          await loadProfile(next.user.id);
        } catch {
          setProfile(null);
        }
      } else {
        setProfile(null);
      }
    });

    return () => {
      active = false;
      clearTimeout(failsafe);
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      refreshProfile: async () => {
        if (session) await loadProfile(session.user.id);
      },
      signOut: async () => {
        await supabase.auth.signOut();
        // Drop every cached query so the next user never sees the previous
        // user's feed, recommendations, or notification badge.
        queryClient.clear();
      },
    }),
    [session, profile, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
