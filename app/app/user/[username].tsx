import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { blockUser, isBlocked, reportContent, unblockUser } from "@/api/moderation";
import { getProfileByUsername, getProfileStats } from "@/api/profile";
import { getShelfBooks } from "@/api/shelves";
import { getUserReviews, type UserReview } from "@/api/reviews";
import { ReviewCard } from "@/components/ReviewCard";
import { followUser, isFollowing, unfollowUser } from "@/api/social";
import { confirmDialog } from "@/lib/confirm";
import { BookCard } from "@/components/BookCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { ErrorScreen, LoadingScreen } from "@/components/ui/ScreenState";
import { goBack } from "@/lib/nav";
import { useAuth } from "@/store/auth";
import { collanaMark, colors, displayFont, spacing, typography } from "@/theme";
import { useGridCardWidth } from "@/lib/useGrid";
import type { BookCard as BookCardType } from "@/types/database";


export default function PublicProfile() {
  const CARD_W = useGridCardWidth(3);
  const { username } = useLocalSearchParams<{ username: string }>();
  const { session } = useAuth();
  const qc = useQueryClient();
  const [reported, setReported] = useState(false);
  const [section, setSection] = useState<"books" | "reviews">("books");

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
  const reviews = useQuery({
    queryKey: ["user-reviews", targetId],
    queryFn: () => getUserReviews(targetId!),
    enabled: !!targetId && section === "reviews",
  });
  const blocked = useQuery({
    queryKey: ["is-blocked", targetId],
    queryFn: () => isBlocked(targetId!),
    enabled: !!targetId && !isSelf,
  });

  async function onToggleBlock() {
    if (!targetId) return;
    if (blocked.data) {
      await unblockUser(targetId);
    } else {
      const ok = await confirmDialog(
        "Bloccare questo lettore?",
        "Non vedrai più le sue recensioni e i suoi commenti.",
        "Blocca",
      );
      if (!ok) return;
      await blockUser(targetId);
    }
    qc.invalidateQueries({ queryKey: ["is-blocked", targetId] });
    qc.invalidateQueries({ queryKey: ["feed"] });
  }

  async function onReport() {
    if (!targetId) return;
    // "user" is not a member of the report_target enum — the valid value is
    // "profile", so this insert used to be rejected outright.
    try {
      await reportContent("profile", targetId);
      setReported(true);
    } catch {
      setReported(false);
    }
  }

  // Optimistic follow toggle guarded against double-taps (a second insert would
  // violate the follows PK). isPending disables the button while in flight.
  const followMut = useMutation({
    mutationFn: () => (following.data ? unfollowUser(targetId!) : followUser(targetId!)),
    onMutate: () => qc.setQueryData(["is-following", targetId], !following.data),
    onError: () => qc.setQueryData(["is-following", targetId], following.data),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["is-following", targetId] });
      qc.invalidateQueries({ queryKey: ["stats", targetId] });
      qc.invalidateQueries({ queryKey: ["profile-by-username", username] });
    },
  });

  if (profile.isLoading) return <LoadingScreen backFallback="/(tabs)" />;
  if (profile.isError) return <ErrorScreen backFallback="/(tabs)" onRetry={() => profile.refetch()} />;
  if (!profile.data)
    return (
      <ErrorScreen backFallback="/(tabs)" title="Profilo non trovato" message="Questo lettore non esiste più." />
    );
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
            <>
              <Button
                label={following.data ? "Seguito" : "Segui"}
                variant={following.data ? "secondary" : "primary"}
                onPress={() => followMut.mutate()}
                disabled={followMut.isPending}
                style={styles.followBtn}
              />
              <View style={styles.modRow}>
                <Pressable onPress={onReport} hitSlop={8} disabled={reported}>
                  <Text style={styles.modLink}>{reported ? "Segnalato ✓" : "Segnala"}</Text>
                </Pressable>
                <Text style={styles.modDot}>·</Text>
                <Pressable onPress={onToggleBlock} hitSlop={8}>
                  <Text style={styles.modLink}>{blocked.data ? "Sblocca" : "Blocca"}</Text>
                </Pressable>
              </View>
            </>
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

        {/* Tabs: a reader's reviews are the point of following them, and they
            were unreachable from here — the stat counted them but nothing
            listed them. */}
        <View style={styles.tabbar}>
          {(["books", "reviews"] as const).map((t, i) => {
            const on = section === t;
            return (
              <Pressable
                key={t}
                style={[styles.tab, i > 0 && styles.tabNotFirst, on && styles.tabOn]}
                onPress={() => setSection(t)}
              >
                <Text style={[styles.tabLabel, on && styles.tabLabelOn]}>
                  {t === "books" ? "Letti" : "Recensioni"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {section === "books" ? (
          (read.data ?? []).length === 0 ? (
            <Text style={styles.emptyNote}>Nessun libro letto, per ora.</Text>
          ) : (
            <View style={styles.grid}>
              {(read.data ?? []).map((b: BookCardType) => (
                <BookCard key={b.id} book={b} width={CARD_W} />
              ))}
            </View>
          )
        ) : reviews.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
        ) : (reviews.data ?? []).length === 0 ? (
          <Text style={styles.emptyNote}>
            {p.display_name.split(" ")[0]} non ha ancora scritto recensioni.
          </Text>
        ) : (
          <View style={styles.reviewList}>
            {(reviews.data ?? []).map((r: UserReview) => (
              <ReviewCard
                key={r.id}
                authorName={p.display_name}
                authorAvatar={p.avatar_url}
                createdAt={r.created_at}
                rating={r.rating}
                body={r.body}
                containsSpoilers={r.contains_spoilers}
                likeCount={r.like_count}
                commentCount={r.comment_count}
                bookTitle={r.book?.title}
                bookCover={r.book?.cover_url}
                bookId={r.book?.id}
                onPress={() => router.push(`/review/${r.id}`)}
                onBookPress={r.book ? () => router.push(`/book/${r.book!.id}`) : undefined}
              />
            ))}
          </View>
        )}
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
  modRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  modLink: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  modDot: { color: colors.textFaint },
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
  tabbar: { flexDirection: "row", paddingHorizontal: spacing.lg, marginTop: spacing.md },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabNotFirst: { marginLeft: -2 },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  tabLabelOn: { color: colors.onPrimary },
  emptyNote: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
  },
  reviewList: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
