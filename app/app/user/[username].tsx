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
import { useAuth } from "@/store/auth";
import { colors, spacing, typography } from "@/theme";
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

  return (
    <ScreenContainer edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <View style={styles.header}>
          <Avatar url={p.avatar_url} name={p.display_name} size={72} ring />
          <Text style={styles.name}>{p.display_name}</Text>
          <Text style={styles.username}>@{p.username}</Text>
          {p.bio ? <Text style={styles.bio}>{p.bio}</Text> : null}
          {!isSelf ? (
            <Button
              label={following.data ? "Following" : "Follow"}
              variant={following.data ? "secondary" : "primary"}
              onPress={onToggleFollow}
              style={styles.followBtn}
            />
          ) : null}
        </View>

        <View style={styles.statsRow}>
          <Stat label="Read" value={stats.data?.books_read ?? 0} />
          <Stat label="Reviews" value={stats.data?.reviews ?? 0} />
          <Stat
            label="Followers"
            value={stats.data?.followers ?? p.followers_count}
            onPress={() => router.push(`/connections?userId=${p.id}&type=followers`)}
          />
          <Stat
            label="Following"
            value={stats.data?.following ?? p.following_count}
            onPress={() => router.push(`/connections?userId=${p.id}&type=following`)}
          />
        </View>

        <Text style={styles.sectionTitle}>Read</Text>
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

function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  return (
    <Pressable style={styles.stat} onPress={onPress} disabled={!onPress}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backText: { color: colors.textMuted, fontSize: 16 },
  header: { alignItems: "center", gap: spacing.xs, paddingBottom: spacing.lg },
  name: { ...typography.h2, marginTop: spacing.sm },
  username: { ...typography.bodyMuted },
  bio: { ...typography.body, textAlign: "center", paddingHorizontal: spacing.xl, marginTop: spacing.sm },
  followBtn: { marginTop: spacing.md, minWidth: 160 },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingVertical: spacing.lg,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 12,
  },
  stat: { alignItems: "center" },
  statValue: { ...typography.h3 },
  statLabel: { ...typography.caption },
  sectionTitle: { ...typography.h3, paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
