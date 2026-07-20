import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { getCommunityFeed, getFollowingFeed } from "@/api/feed";
import { toggleLike } from "@/api/social";
import { AppHeader } from "@/components/AppHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, spacing } from "@/theme";
import type { FeedItem } from "@/types/database";

type Feed = "for_you" | "following";

export default function Community() {
  const qc = useQueryClient();
  const [feed, setFeed] = useState<Feed>("for_you");

  const { data = [], isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["feed", feed],
    queryFn: () => (feed === "for_you" ? getCommunityFeed(30) : getFollowingFeed(30)),
  });

  async function onLike(item: FeedItem) {
    qc.setQueryData<FeedItem[]>(["feed", feed], (prev: FeedItem[] | undefined) =>
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
      refetch();
    }
  }

  return (
    <ScreenContainer edges={["top"]}>
      <AppHeader />

      <View style={styles.segment}>
        {(["for_you", "following"] as Feed[]).map((f) => (
          <Pressable key={f} style={styles.seg} onPress={() => setFeed(f)}>
            <Text style={[styles.segLabel, feed === f && styles.segLabelOn]}>
              {f === "for_you" ? "Per te" : "Following"}
            </Text>
            {feed === f ? <View style={styles.segBar} /> : null}
          </Pressable>
        ))}
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
            feed === "following" ? (
              <EmptyState
                icon="👥"
                title="Nothing from your circle yet"
                message="Follow readers you like — their reviews show up here."
                action={{ label: "Discover readers", onPress: () => setFeed("for_you") }}
              />
            ) : (
              <EmptyState
                icon="💬"
                title="The feed is warming up"
                message="Write reviews and follow readers to bring this to life."
              />
            )
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
            onAuthorPress={() => router.push(`/user/${item.author_username}`)}
            onLike={() => onLike(item)}
          />
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  segment: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  seg: { paddingVertical: spacing.md, alignItems: "center" },
  segLabel: { color: colors.textFaint, fontSize: 15, fontWeight: "700" },
  segLabelOn: { color: colors.text },
  segBar: {
    position: "absolute",
    bottom: -StyleSheet.hairlineWidth,
    left: 0,
    right: 0,
    height: 2,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl, flexGrow: 1 },
});
