import { useQuery } from "@tanstack/react-query";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { getProfileStats } from "@/api/profile";
import { getShelfBooks } from "@/api/shelves";
import { BookCard } from "@/components/BookCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, spacing, typography } from "@/theme";
import type { BookCard as BookCardType, ShelfStatus } from "@/types/database";

type Tab = "read" | "saved" | "liked";
const TABS: { key: Tab; label: string }[] = [
  { key: "read", label: "Read" },
  { key: "saved", label: "Saved" },
  { key: "liked", label: "Liked" },
];

const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

export default function ProfileScreen() {
  const { session, profile, signOut } = useAuth();
  const userId = session?.user.id;
  const [tab, setTab] = useState<Tab>("read");

  const stats = useQuery({
    queryKey: ["stats", userId],
    queryFn: () => getProfileStats(userId!),
    enabled: !!userId,
  });

  const shelf = useQuery({
    queryKey: ["shelf", userId, tab],
    queryFn: () => {
      const filter =
        tab === "liked"
          ? { liked: true }
          : { status: (tab === "read" ? "read" : "want_to_read") as ShelfStatus };
      return getShelfBooks(userId!, filter);
    },
    enabled: !!userId,
  });

  if (!profile) return <ScreenContainer />;

  return (
    <ScreenContainer edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Avatar url={profile.avatar_url} name={profile.display_name} size={72} />
          <Text style={styles.name}>{profile.display_name}</Text>
          <Text style={styles.username}>@{profile.username}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        </View>

        <View style={styles.statsRow}>
          <Stat label="Read" value={stats.data?.booksRead ?? 0} />
          <Stat label="Reviews" value={stats.data?.reviews ?? 0} />
          <Stat label="Likes" value={stats.data?.likesReceived ?? 0} />
          <Stat label="Followers" value={profile.followers_count} />
        </View>

        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              style={[styles.tab, tab === t.key && styles.tabActive]}
              onPress={() => setTab(t.key)}
            >
              <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.grid}>
          {(shelf.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <EmptyState icon="📚" title="Nothing here yet" message="Books you add will show up here." />
            </View>
          ) : (
            (shelf.data ?? []).map((b: BookCardType) => (
              <BookCard key={b.id} book={b} width={CARD_W} />
            ))
          )}
        </View>

        <Button label="Sign out" variant="secondary" onPress={signOut} style={styles.signOut} />
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.xs },
  name: { ...typography.h2, marginTop: spacing.sm },
  username: { ...typography.bodyMuted },
  bio: { ...typography.body, textAlign: "center", paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing.lg,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  stat: { alignItems: "center" },
  statValue: { ...typography.h3, color: colors.text },
  statLabel: { ...typography.caption },
  tabs: { flexDirection: "row", marginTop: spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.sm },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabLabel: { color: colors.textMuted, fontWeight: "600" },
  tabLabelActive: { color: "#fff" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  empty: { width: "100%", height: 200 },
  signOut: { marginHorizontal: spacing.lg, marginTop: spacing.xl },
});
