import { QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { OfflineBanner } from "@/components/OfflineBanner";
import { queryClient } from "@/lib/queryClient";
import { syncPushIfGranted } from "@/lib/push";
import { AuthProvider, useAuth } from "@/store/auth";
import { colors } from "@/theme";

// Redirects the user to the right stack based on auth + onboarding state.
function useAuthGate() {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const group = segments[0];
    const inAuth = group === "(auth)";
    const inOnboarding = group === "onboarding";
    // Legal pages must be readable before signing up; the password-reset
    // landing page must not be hijacked by the boot redirect.
    if (group === "legal" || group === "reset-password") return;
    // The boot/landing route ("/") has no segment. Signed-in users must be
    // forwarded off it (and off the auth/onboarding stacks) into the app —
    // otherwise they sit on the index spinner forever. Deep links elsewhere
    // (/book, /settings, …) are left untouched.
    const atBoot = group === undefined || inAuth || inOnboarding;
    const needsOnboarding = !!session && !!profile && !profile.onboarded_at;

    if (!session) {
      if (!inAuth) router.replace("/(auth)/sign-in");
    } else if (needsOnboarding) {
      if (!inOnboarding) router.replace("/onboarding");
    } else if (atBoot) {
      router.replace("/(tabs)");
    }
  }, [session, profile, loading, segments, router]);
}

function RootNavigator() {
  const { loading, session } = useAuth();
  useAuthGate();

  // If the user already granted push permission, keep their device
  // subscription fresh (endpoints rotate). Never prompts.
  useEffect(() => {
    if (session) void syncPushIfGranted();
  }, [session]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="book/[id]" options={{ presentation: "card" }} />
      <Stack.Screen name="read/[id]" />
      <Stack.Screen name="review/[id]" />
      <Stack.Screen name="compose-review" options={{ presentation: "modal" }} />
      <Stack.Screen name="add-to-list" options={{ presentation: "modal" }} />
      <Stack.Screen name="new-list" options={{ presentation: "modal" }} />
      <Stack.Screen name="list/[id]" />
      <Stack.Screen name="connections" />
      <Stack.Screen name="saved" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="user/[username]" />
      <Stack.Screen name="author/[name]" />
      <Stack.Screen name="genre/[slug]" />
      <Stack.Screen name="search" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="find-friends" />
      {/* Anteprima «Feed-first»: recuperata da main il 15 agosto, prima di
          unire i due rami. Su main era un'anteprima raggiungibile da una
          pastiglia nella Home; qui la rotta è dichiarata ma **non c'è nessun
          punto di ingresso dall'app** — ci si arriva solo con l'URL
          /feed-home. La pastiglia non l'ho rimessa perché la Home è appena
          stata alleggerita di proposito, e riaggiungerci un elemento è una
          scelta di prodotto, non un recupero. */}
      <Stack.Screen name="feed-home" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="light" />
            <OfflineBanner />
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
