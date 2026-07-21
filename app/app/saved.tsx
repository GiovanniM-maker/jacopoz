import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getSavedComments, getSavedReviews } from "@/api/bookmarks";
import { CommentItem } from "@/components/CommentItem";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, spacing } from "@/theme";
import type { CommentWithAuthor, ReviewWithAuthor } from "@/types/database";

type Tab = "reviews" | "comments";

export default function Saved() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [tab, setTab] = useState<Tab>("reviews");

  const reviews = useQuery({
    queryKey: ["saved-reviews", userId],
    queryFn: () => getSavedReviews(userId!),
    enabled: !!userId && tab === "reviews",
  });
  const comments = useQuery({
    queryKey: ["saved-comments", userId],
    queryFn: () => getSavedComments(userId!),
    enabled: !!userId && tab === "comments",
  });

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Salvati" backFallback="/(tabs)/profile" />

      <View style={styles.tabs}>
        {(["reviews", "comments"] as Tab[]).map((t, i) => (
          <Pressable
            key={t}
            style={[styles.tab, i > 0 && styles.tabNotFirst, tab === t && styles.tabOn]}
            onPress={() => setTab(t)}
          >
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelOn]}>
              {t === "reviews" ? "Recensioni" : "Commenti"}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {tab === "reviews" ? (
          (reviews.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <EmptyState icon="🔖" title="Nessuna recensione salvata" message="Tocca Salva su una recensione per ritrovarla qui." />
            </View>
          ) : (
            (reviews.data ?? []).map((r: ReviewWithAuthor) => (
              <ReviewCard
                key={r.id}
                authorName={r.author.display_name}
                authorAvatar={r.author.avatar_url}
                createdAt={r.created_at}
                rating={r.rating}
                body={r.body}
                containsSpoilers={r.contains_spoilers}
                likeCount={r.like_count}
                commentCount={r.comment_count}
                onPress={() => router.push(`/review/${r.id}`)}
                onAuthorPress={() => router.push(`/user/${r.author.username}`)}
              />
            ))
          )
        ) : (comments.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <EmptyState icon="🔖" title="Nessun commento salvato" message="Tocca Salva su un commento per ritrovarlo qui." />
          </View>
        ) : (
          (comments.data ?? []).map((c: CommentWithAuthor) => (
            <View key={c.id} style={styles.commentWrap}>
              <CommentItem comment={c} onPress={() => router.push(`/review/${c.review_id}`)} />
            </View>
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.md,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tabNotFirst: { marginLeft: -2 },
  tabOn: { backgroundColor: colors.primary },
  tabLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  tabLabelOn: { color: colors.onPrimary },
  body: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  empty: { height: 260 },
  commentWrap: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
