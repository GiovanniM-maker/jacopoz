import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCommunityFeed, getFollowingFeed } from "@/api/feed";
import { toggleLike } from "@/api/social";
import { AppHeader } from "@/components/AppHeader";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, displayFont, spacing } from "@/theme";
import type { FeedItem } from "@/types/database";

type Feed = "for_you" | "following";

export default function Community() {
  const qc = useQueryClient();
  const [feed, setFeed] = useState<Feed>("for_you");

  const { data = [], isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["feed", feed],
    queryFn: () => (feed === "for_you" ? getCommunityFeed(30) : getFollowingFeed(30)),
  });

  // Active-readers strip (stories-like): distinct authors from the community,
  // fetched independently so it's populated even on the "Seguiti" tab.
  const readersQ = useQuery({ queryKey: ["feed-readers"], queryFn: () => getCommunityFeed(30) });
  const readers = dedupeAuthors(readersQ.data ?? []).slice(0, 12);

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

      <FlatList
        data={data}
        keyExtractor={(f) => f.review_id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            {readers.length > 0 ? (
              <View style={styles.readersWrap}>
                <Text style={styles.stripLabel}>Lettori attivi</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.readers}
                >
                  {readers.map((r) => (
                    <Pressable
                      key={r.author_id}
                      style={styles.reader}
                      onPress={() => router.push(`/user/${r.author_username}`)}
                    >
                      <View style={styles.ring}>
                        <Avatar url={r.author_avatar_url} name={r.author_display_name} size={58} />
                      </View>
                      <Text style={styles.readerName} numberOfLines={1}>
                        {r.author_display_name.split(" ")[0]}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.segment}>
              {(["for_you", "following"] as Feed[]).map((f) => (
                <Pressable key={f} style={styles.seg} onPress={() => setFeed(f)}>
                  <Text style={[styles.segLabel, feed === f && styles.segLabelOn]}>
                    {f === "for_you" ? "Per te" : "Seguiti"}
                  </Text>
                  {feed === f ? <View style={styles.segBar} /> : null}
                </Pressable>
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          !isLoading ? (
            feed === "following" ? (
              <EmptyState
                icon="👥"
                title="Ancora niente dai tuoi seguiti"
                message="Segui i lettori che ti piacciono — le loro recensioni appaiono qui."
                action={{ label: "Scopri lettori", onPress: () => setFeed("for_you") }}
              />
            ) : (
              <EmptyState
                icon="💬"
                title="Il feed si sta scaldando"
                message="Scrivi recensioni e segui lettori per dargli vita."
              />
            )
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.itemPad}>
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
          </View>
        )}
      />
    </ScreenContainer>
  );
}

function dedupeAuthors(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  const out: FeedItem[] = [];
  for (const it of items) {
    if (seen.has(it.author_id)) continue;
    seen.add(it.author_id);
    out.push(it);
  }
  return out;
}

const styles = StyleSheet.create({
  header: {},
  readersWrap: { paddingTop: spacing.sm, paddingBottom: spacing.md },
  stripLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  readers: { paddingHorizontal: spacing.lg, gap: spacing.md },
  reader: { alignItems: "center", width: 68 },
  ring: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  readerName: { color: colors.textMuted, fontSize: 11, marginTop: 4, maxWidth: 64 },
  itemPad: { paddingHorizontal: spacing.lg },
  segment: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  seg: { paddingVertical: spacing.md, alignItems: "center" },
  segLabel: {
    color: colors.textFaint,
    fontFamily: displayFont,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  segLabelOn: { color: colors.primary },
  segBar: {
    position: "absolute",
    bottom: -2,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.primary,
  },
  list: { paddingBottom: spacing.xxl, flexGrow: 1 },
});
