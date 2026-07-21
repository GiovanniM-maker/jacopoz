import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getProfileByUsername, getProfileStats } from "@/api/profile";
import { getShelfBooks } from "@/api/shelves";
import { followUser, isFollowing, unfollowUser } from "@/api/social";
import { BookCard } from "@/components/BookCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { goBack } from "@/lib/nav";
import { useAuth } from "@/store/auth";
import { collanaMark, colors, displayFont, spacing, typography } from "@/theme";
import type { BookCard as BookCardType } from "@/types/database";

const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

export default function PublicProfile() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { session } = useAuth();
  const qc = useQueryClient();

  const profile = useQuery({
    queryKey: ["profile-by-username", username],
    queryFn: () => getProfileByUsername(username!),
    enabled: !!username,
  });
  const targetId = profile.data?.id;
  const isSelf = targetId === session?.user.id;

  const stats = useQuery({
    queryKey: ["stats", targetId],
    queryFn: () => getProfileStats(targetId!),
    enabled: !!targetId,
  });
  const read = useQuery({
    queryKey: ["shelf", targetId, "read"],
    queryFn: () => getShelfBooks(targetId!, { status: "read" }),
    enabled: !!targetId,
  });
  const following = useQuery({
    queryKey: ["is-following", targetId],
    queryFn: () => isFollowing(targetId!),
    enabled: !!targetId && !isSelf,
  });

  async function onToggleFollow() {
    if (!targetId) return;
    if (following.data) await unfollowUser(targetId);
    else await followUser(targetId);
    qc.invalidateQueries({ queryKey: ["is-following", targetId] });
    qc.invalidateQueries({ queryKey: ["profile-by-username", username] });
  }

  if (!profile.data) return <ScreenContainer />;
  const p = profile.data;
  const readerNo = collanaMark(p.username).number.padStart(3, "0");

  return (
    <ScreenContainer edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => goBack()} style={styles.back} hitSlop={10}>
          <Text style={styles.backText}>‹ Indietro</Text>
        </Pressable>

        <View style={styles.header}>
          <Avatar url={p.avatar_url} name={p.display_name} size={72} ring />
          <Text style={styles.name}>{p.display_name}</Text>
          <Text style={styles.username}>@{p.username} · lettore n° {readerNo}</Text>
          {p.bio ? <Text style={styles.bio}>{p.bio}</Text> : null}
          {!isSelf ? (
            <Button
              label={following.data ? "Seguito" : "Segui"}
              variant={following.data ? "secondary" : "primary"}
              onPress={onToggleFollow}
              style={styles.followBtn}
            />
          ) : null}
        </View>

        <View style={styles.statsBar}>
          <Stat label="Letti" value={stats.data?.books_read ?? 0} />
          <Stat label="Recensioni" value={stats.data?.reviews ?? 0} />
          <Stat
            label="Seguiti"
            value={stats.data?.following ?? p.following_count}
            onPress={() => router.push(`/connections?userId=${p.id}&type=following`)}
          />
          <Stat
            label="Follower"
            value={stats.data?.followers ?? p.followers_count}
            onPress={() => router.push(`/connections?userId=${p.id}&type=followers`)}
            last
          />
        </View>

        <Text style={styles.sectionTitle}>Letti di recente</Text>
        <View style={styles.grid}>
          {(read.data ?? []).map((b: BookCardType) => (
            <BookCard key={b.id} book={b} width={CARD_W} />
          ))}
        </View>
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function Stat({
  label,
  value,
  onPress,
  last,
}: {
  label: string;
  value: number;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Pressable style={[styles.stat, !last && styles.statDivider]} onPress={onPress} disabled={!onPress}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  header: { alignItems: "center", gap: spacing.xs, paddingBottom: spacing.lg },
  name: {
    fontFamily: displayFont,
    fontSize: 28,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
    marginTop: spacing.sm,
  },
  username: { ...typography.bodyMuted, fontSize: 13, fontStyle: "italic" },
  bio: { ...typography.body, textAlign: "center", paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  followBtn: { marginTop: spacing.md, minWidth: 180 },
  statsBar: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderColor: colors.border,
  },
  stat: { flex: 1, alignItems: "center", paddingVertical: spacing.md },
  statDivider: { borderRightWidth: 2, borderRightColor: colors.border },
  statValue: { fontFamily: displayFont, fontSize: 24, fontWeight: "900", color: colors.text },
  statLabel: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: displayFont,
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
