import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getBook, bookAvgRating } from "@/api/books";
import { getBookReviewsRanked } from "@/api/feed";
import { getUserBook, setShelf } from "@/api/shelves";
import { toggleLike } from "@/api/social";
import { affiliateUrl } from "@/api/config";
import { track } from "@/api/analytics";
import { BookCover } from "@/components/BookCover";
import { Chip } from "@/components/ui/Chip";
import { RatingStars } from "@/components/ui/RatingStars";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, displayFont, hardShadow, radius, spacing, typography } from "@/theme";
import type { FeedItem } from "@/types/database";

export default function BookPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const book = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id!), enabled: !!id });
  const userBook = useQuery({
    queryKey: ["user-book", id, userId],
    queryFn: () => getUserBook(userId!, id!),
    enabled: !!id && !!userId,
  });
  const reviews = useQuery({
    queryKey: ["book-reviews", id, userId],
    queryFn: () => getBookReviewsRanked(id!),
    enabled: !!id,
  });
  const affiliate = useQuery({
    queryKey: ["affiliate", book.data?.isbn_13],
    queryFn: () => affiliateUrl(book.data?.isbn_13 ?? null),
    enabled: !!book.data,
  });

  useEffect(() => {
    if (id) void track("book_viewed", { bookId: id });
  }, [id]);

  async function mutateShelf(patch: Parameters<typeof setShelf>[2]) {
    if (!userId || !id) return;
    await setShelf(userId, id, patch);
    qc.invalidateQueries({ queryKey: ["user-book", id, userId] });
    qc.invalidateQueries({ queryKey: ["book", id] });
    qc.invalidateQueries({ queryKey: ["shelf", userId] });
  }

  if (!book.data) return <ScreenContainer />;
  const b = book.data;
  const ub = userBook.data;
  const isRead = ub?.status === "read";
  const isSaved = ub?.status === "want_to_read";

  async function onBuy() {
    if (!affiliate.data) return;
    void track("affiliate_click", { bookId: id });
    Linking.openURL(affiliate.data);
  }

  async function onReviewLike(reviewId: string) {
    await toggleLike("review", reviewId);
    qc.invalidateQueries({ queryKey: ["book-reviews", id, userId] });
  }

  return (
    <ScreenContainer edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={10}>
          <Text style={styles.backText}>‹ Indietro</Text>
        </Pressable>

        <View style={styles.hero}>
          <BookCover url={b.cover_url} title={b.title} width={130} />
          <View style={styles.heroInfo}>
            <Text style={styles.title}>{b.title}</Text>
            <Text style={styles.author}>{b.authors.join(", ")}</Text>
            <View style={styles.ratingRow}>
              <RatingStars value={bookAvgRating(b)} size={16} />
              <Text style={styles.ratingText}>
                {bookAvgRating(b) ? `${bookAvgRating(b)} · ${b.rating_count}` : "Nessuna valutazione"}
              </Text>
            </View>
            {b.published_year ? <Text style={styles.meta}>{b.published_year}</Text> : null}
          </View>
        </View>

        {/* Synopsis — right under the average rating */}
        {b.description ? (
          <View style={styles.synopsis}>
            <Text style={styles.synTitle}>Sinossi</Text>
            <Text style={styles.description}>{b.description}</Text>
          </View>
        ) : null}

        {/* Categories */}
        {b.categories.length > 0 ? (
          <View style={styles.chips}>
            {b.categories.map((c: string) => (
              <Chip key={c} label={c} />
            ))}
          </View>
        ) : null}

        {/* Personal rating */}
        <View style={styles.rateBox}>
          <Text style={styles.rateLabel}>La tua valutazione</Text>
          <RatingStars value={ub?.rating ?? null} size={30} onChange={(r) => mutateShelf({ rating: r })} />
        </View>

        {/* Primary actions */}
        <View style={styles.actions}>
          <ActionButton icon="✍️" label="Recensisci" primary
            onPress={() => router.push(`/compose-review?bookId=${b.id}`)} />
          <ActionButton icon="＋" label="Lista"
            onPress={() => router.push(`/add-to-list?bookId=${b.id}`)} />
          <ActionButton icon={ub?.liked ? "♥" : "♡"} label="Like" active={!!ub?.liked}
            onPress={() => mutateShelf({ liked: !ub?.liked })} />
        </View>

        {/* Amazon — kept in reserve, secondary link */}
        {affiliate.data ? (
          <Pressable style={styles.buyLink} onPress={onBuy}>
            <Text style={styles.buyLinkText}>Disponibile su Amazon ↗</Text>
          </Pressable>
        ) : null}

        {/* Reviews */}
        <View style={styles.reviewsHeader}>
          <Text style={styles.sectionTitle}>Recensioni della community</Text>
        </View>

        {(reviews.data ?? []).length === 0 ? (
          <Text style={styles.noReviews}>Sii il primo a recensire questo libro.</Text>
        ) : (
          (reviews.data ?? []).map((r: FeedItem) => (
            <ReviewCard
              key={r.review_id}
              authorName={r.author_display_name}
              authorAvatar={r.author_avatar_url}
              createdAt={r.created_at}
              rating={r.rating}
              body={r.body}
              containsSpoilers={r.contains_spoilers}
              likeCount={r.like_count}
              commentCount={r.comment_count}
              likedByViewer={r.viewer_has_liked}
              onPress={() => router.push(`/review/${r.review_id}`)}
              onAuthorPress={() => router.push(`/user/${r.author_username}`)}
              onLike={() => onReviewLike(r.review_id)}
            />
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function ActionButton({
  icon,
  label,
  active = false,
  primary = false,
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.action, primary && styles.actionPrimary, active && styles.actionActive]}
      onPress={onPress}
    >
      <Text
        style={[
          styles.actionIcon,
          primary && styles.actionLabelPrimary,
          active && styles.actionLabelActive,
        ]}
      >
        {icon}
      </Text>
      <Text
        style={[
          styles.actionLabel,
          primary && styles.actionLabelPrimary,
          active && styles.actionLabelActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg },
  back: { paddingVertical: spacing.md },
  backText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  hero: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.lg },
  heroInfo: { flex: 1, gap: spacing.xs },
  title: {
    fontFamily: displayFont,
    fontSize: 30,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
    lineHeight: 30,
  },
  author: { ...typography.bodyMuted, fontSize: 15, fontStyle: "italic" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  ratingText: { color: colors.textMuted, fontSize: 13 },
  meta: { color: colors.textFaint, fontSize: 13, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 6,
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionActive: { backgroundColor: colors.surfaceAlt },
  actionIcon: { fontSize: 15, color: colors.text },
  actionLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  actionLabelActive: { color: colors.star },
  actionLabelPrimary: { color: colors.onPrimary },
  rateBox: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    ...hardShadow,
    marginBottom: spacing.lg,
  },
  rateLabel: { ...typography.bodyMuted },
  buyLink: { alignItems: "center", paddingVertical: spacing.sm, marginBottom: spacing.lg },
  buyLinkText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  synopsis: { marginBottom: spacing.lg },
  synTitle: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  description: { ...typography.body, lineHeight: 22 },
  reviewsHeader: { marginBottom: spacing.md },
  sectionTitle: {
    fontFamily: displayFont,
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
  },
  noReviews: { ...typography.bodyMuted, marginBottom: spacing.lg },
});
