import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getSavedComments, getSavedReviews } from "@/api/bookmarks";
import { CommentItem } from "@/components/CommentItem";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, spacing, typography } from "@/theme";
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
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>Saved</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.tabs}>
        {(["reviews", "comments"] as Tab[]).map((t) => (
          <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelOn]}>
              {t === "reviews" ? "Reviews" : "Comments"}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {tab === "reviews" ? (
          (reviews.data ?? []).length === 0 ? (
            <View style={styles.empty}>
              <EmptyState icon="🔖" title="No saved reviews" message="Tap Save on any review to keep it here." />
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
              />
            ))
          )
        ) : (comments.data ?? []).length === 0 ? (
          <View style={styles.empty}>
            <EmptyState icon="🔖" title="No saved comments" message="Tap Save on any comment to keep it here." />
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
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { color: colors.textMuted, fontSize: 16 },
  title: { ...typography.h3 },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  tabOn: { backgroundColor: colors.primary },
  tabLabel: { color: colors.textMuted, fontWeight: "600" },
  tabLabelOn: { color: "#fff" },
  body: { paddingHorizontal: spacing.lg, flexGrow: 1 },
  empty: { height: 260 },
  commentWrap: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
