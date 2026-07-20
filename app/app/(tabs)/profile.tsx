import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { getProfileStats } from "@/api/profile";
import { getUserLists } from "@/api/lists";
import { getShelfBooks } from "@/api/shelves";
import { BookCard } from "@/components/BookCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";
import type { BookCard as BookCardType, BookList, ShelfStatus } from "@/types/database";

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
  const lists = useQuery({
    queryKey: ["lists", userId],
    queryFn: () => getUserLists(userId!),
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
  const s = stats.data;

  return (
    <ScreenContainer edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Avatar url={profile.avatar_url} name={profile.display_name} size={72} />
          <Text style={styles.name}>{profile.display_name}</Text>
          <Text style={styles.username}>@{profile.username}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <Stat label="Read" value={s?.books_read ?? 0} />
          <Stat label="Reviews" value={s?.reviews ?? 0} />
          <Stat label="Comments" value={s?.comments ?? 0} />
          <Stat label="Likes" value={s?.likes_received ?? 0} />
          <Stat
            label="Followers"
            value={s?.followers ?? profile.followers_count}
            onPress={() => router.push(`/connections?userId=${userId}&type=followers`)}
          />
          <Stat
            label="Following"
            value={s?.following ?? profile.following_count}
            onPress={() => router.push(`/connections?userId=${userId}&type=following`)}
          />
        </View>

        {/* Quick links */}
        <View style={styles.links}>
          <Pressable style={styles.link} onPress={() => router.push("/saved")}>
            <Text style={styles.linkText}>🔖 Saved</Text>
          </Pressable>
        </View>

        {/* Lists */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Lists</Text>
          {(lists.data ?? []).length === 0 ? (
            <Text style={styles.emptyLine}>No lists yet — add books to a list from any book page.</Text>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: spacing.md }}
            >
              {(lists.data ?? []).map((l: BookList) => (
                <Pressable key={l.id} style={styles.listCard} onPress={() => router.push(`/list/${l.id}`)}>
                  <Text style={styles.listName} numberOfLines={2}>
                    {l.name}
                  </Text>
                  <Text style={styles.listMeta}>
                    {l.book_count} {l.book_count === 1 ? "book" : "books"}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Shelves */}
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
              <BookCard key={b.id} book={b} width={CARD_W} showMeta />
            ))
          )}
        </View>

        <Button label="Sign out" variant="secondary" onPress={signOut} style={styles.signOut} />
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  return (
    <Pressable style={styles.stat} onPress={onPress} disabled={!onPress}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", paddingVertical: spacing.lg, gap: spacing.xs },
  name: { ...typography.h2, marginTop: spacing.sm },
  username: { ...typography.bodyMuted },
  bio: { ...typography.body, textAlign: "center", paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: spacing.md,
  },
  stat: { width: "33.33%", alignItems: "center", paddingVertical: spacing.sm },
  statValue: { ...typography.h3, color: colors.text },
  statLabel: { ...typography.caption },
  links: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.md },
  link: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flex: 1,
    alignItems: "center",
  },
  linkText: { color: colors.text, fontWeight: "600", fontSize: 15 },
  section: { marginTop: spacing.xl, paddingLeft: spacing.lg },
  sectionTitle: { ...typography.h3, marginBottom: spacing.md },
  emptyLine: { ...typography.bodyMuted, paddingRight: spacing.lg },
  listCard: {
    width: 140,
    height: 90,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    justifyContent: "space-between",
  },
  listName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  listMeta: { color: colors.textMuted, fontSize: 12 },
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
