import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { getCommunityFeed, getFollowingFeed } from "@/api/feed";
import { getFreeReadsForYou } from "@/api/reco";
import { toggleLike } from "@/api/social";
import { AppHeader } from "@/components/AppHeader";
import { BookRow } from "@/components/BookRow";
import { ReviewCard } from "@/components/ReviewCard";
import { Avatar } from "@/components/ui/Avatar";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, displayFont, radius, spacing } from "@/theme";
import type { BookCard, FeedItem } from "@/types/database";

// One row of the feed: a review post, the interleaved discovery row, or the
// "grow your feed" banner shown when you don't follow many people yet.
type Row =
  | { kind: "post"; item: FeedItem }
  | { kind: "recos"; books: BookCard[] }
  | { kind: "banner" };

/**
 * PREVIEW of a "Feed-first" home: opens on people's activity like Instagram,
 * not on a catalogue. Following feed first; when it's thin it falls back to
 * the community so a new user never sees an empty screen, with a nudge to
 * follow more readers and a woven-in "for you" discovery row. This is a
 * separate screen (reached from the current home) so we can compare it
 * without replacing anything yet.
 */
export default function FeedHome() {
  const qc = useQueryClient();

  const following = useQuery({ queryKey: ["ff-following"], queryFn: () => getFollowingFeed(30) });
  const community = useQuery({ queryKey: ["ff-community"], queryFn: () => getCommunityFeed(30) });
  const recos = useQuery({ queryKey: ["ff-recos"], queryFn: () => getFreeReadsForYou(10) });

  const foll = following.data ?? [];
  const comm = community.data ?? [];
  const thin = foll.length < 3;
  // Feed-first with fallback: your people if you have them, else the community.
  const feed: FeedItem[] = thin
    ? comm
    : [...foll, ...comm.filter((c: FeedItem) => !foll.some((f: FeedItem) => f.review_id === c.review_id))];
  const feedKey = thin ? "ff-community" : "ff-following";

  // Active readers strip (stories-like) — distinct authors from the community.
  const readers = dedupeAuthors(comm).slice(0, 12);

  // Build the mixed rows: optional banner, posts, and a discovery row after #4.
  const rows: Row[] = [];
  if (thin) rows.push({ kind: "banner" });
  feed.forEach((item, i) => {
    rows.push({ kind: "post", item });
    if (i === 3 && (recos.data ?? []).length > 0) rows.push({ kind: "recos", books: recos.data ?? [] });
  });

  async function onLike(item: FeedItem) {
    const key = ["ff-following"];
    for (const k of [["ff-following"], ["ff-community"]]) {
      qc.setQueryData<FeedItem[]>(k, (prev: FeedItem[] | undefined) =>
        (prev ?? []).map((f: FeedItem) =>
          f.review_id === item.review_id
            ? { ...f, viewer_has_liked: !f.viewer_has_liked, like_count: f.like_count + (f.viewer_has_liked ? -1 : 1) }
            : f,
        ),
      );
    }
    void key;
    try {
      await toggleLike("review", item.review_id);
    } catch {
      following.refetch();
      community.refetch();
    }
  }

  return (
    <ScreenContainer edges={["top"]}>
      <AppHeader />
      <FlatList
        data={rows}
        keyExtractor={(r, i) => (r.kind === "post" ? r.item.review_id : `${r.kind}-${i}`)}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={following.isRefetching || community.isRefetching}
            onRefresh={() => {
              following.refetch();
              community.refetch();
            }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          readers.length > 0 ? (
            <View style={styles.readersWrap}>
              <Text style={styles.stripLabel}>Lettori attivi</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.readers}>
                {readers.map((r) => (
                  <Pressable key={r.author_id} style={styles.reader} onPress={() => router.push(`/user/${r.author_username}`)}>
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
          ) : null
        }
        renderItem={({ item }) => {
          if (item.kind === "banner") {
            return (
              <Pressable style={styles.banner} onPress={() => router.push("/(tabs)/search")}>
                <Text style={styles.bannerTitle}>Segui altri lettori</Text>
                <Text style={styles.bannerSub}>
                  Il tuo feed diventa su misura man mano che segui persone. Intanto, ecco cosa legge la community.
                </Text>
              </Pressable>
            );
          }
          if (item.kind === "recos") {
            return (
              <View style={styles.recos}>
                <BookRow title="Da leggere per te" books={item.books} />
              </View>
            );
          }
          const f = item.item;
          return (
            <ReviewCard
              authorName={f.author_display_name}
              authorAvatar={f.author_avatar_url}
              createdAt={f.created_at}
              rating={f.rating}
              body={f.body}
              containsSpoilers={f.contains_spoilers}
              likeCount={f.like_count}
              commentCount={f.comment_count}
              likedByViewer={f.viewer_has_liked}
              bookTitle={f.book_title}
              bookCover={f.book_cover_url}
              onPress={() => router.push(`/review/${f.review_id}`)}
              onBookPress={() => router.push(`/book/${f.book_id}`)}
              onAuthorPress={() => router.push(`/user/${f.author_username}`)}
              onLike={() => onLike(f)}
            />
          );
        }}
        ListEmptyComponent={
          !following.isLoading && !community.isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.bannerTitle}>Il feed si sta scaldando</Text>
              <Text style={styles.bannerSub}>Scrivi una recensione e segui lettori per dargli vita.</Text>
            </View>
          ) : null
        }
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
  list: { paddingBottom: spacing.xxl },
  readersWrap: { paddingTop: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
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
  banner: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  bannerTitle: {
    fontFamily: displayFont,
    fontSize: 18,
    fontWeight: "900",
    color: colors.text,
    marginBottom: 4,
  },
  bannerSub: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  recos: { marginVertical: spacing.sm },
  empty: { padding: spacing.xxl, alignItems: "center", gap: spacing.sm },
});
