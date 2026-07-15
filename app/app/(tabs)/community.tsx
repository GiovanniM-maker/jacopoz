import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, RefreshControl, StyleSheet, Text, View } from "react-native";
import { getCommunityFeed } from "@/api/feed";
import { toggleLike } from "@/api/social";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, spacing, typography } from "@/theme";
import type { FeedItem } from "@/types/database";

export default function Community() {
  const qc = useQueryClient();
  const { data = [], isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["feed"],
    queryFn: () => getCommunityFeed(30),
  });

  async function onLike(item: FeedItem) {
    // Optimistic update of the cached feed.
    qc.setQueryData<FeedItem[]>(["feed"], (prev: FeedItem[] | undefined) =>
      (prev ?? []).map((f: FeedItem) =>
        f.review_id === item.review_id
          ? {
              ...f,
              viewer_has_liked: !f.viewer_has_liked,
              like_count: f.like_count + (f.viewer_has_liked ? -1 : 1),
            }
          : f,
      ),
    );
    try {
      await toggleLike("review", item.review_id);
    } catch {
      refetch(); // reconcile on failure
    }
  }

  return (
    <ScreenContainer edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Community</Text>
        <Text style={styles.subtitle}>Reviews ranked for you — not just the newest.</Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={(f) => f.review_id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              icon="💬"
              title="The feed is warming up"
              message="Follow readers and write reviews to bring this to life."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <ReviewCard
            authorName={item.author_display_name}
            authorAvatar={item.author_avatar_url}
            createdAt={item.created_at}
            rating={item.rating}
            body={item.body}
            containsSpoilers={item.contains_spoilers}
            likeCount={item.like_count}
            commentCount={item.comment_count}
            likedByViewer={item.viewer_has_liked}
            bookTitle={item.book_title}
            bookCover={item.book_cover_url}
            onPress={() => router.push(`/review/${item.review_id}`)}
            onBookPress={() => router.push(`/book/${item.book_id}`)}
            onLike={() => onLike(item)}
          />
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 2 },
  title: typography.h1,
  subtitle: typography.bodyMuted,
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
});
