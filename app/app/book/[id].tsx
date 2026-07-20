import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getBook, bookAvgRating } from "@/api/books";
import { getBookReviews } from "@/api/reviews";
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
import { colors, radius, spacing, typography } from "@/theme";
import type { ReviewWithAuthor } from "@/types/database";

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
    queryFn: () => getBookReviews(id!, userId),
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
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <View style={styles.hero}>
          <BookCover url={b.cover_url} title={b.title} width={130} />
          <View style={styles.heroInfo}>
            <Text style={styles.title}>{b.title}</Text>
            <Text style={styles.author}>{b.authors.join(", ")}</Text>
            <View style={styles.ratingRow}>
              <RatingStars value={bookAvgRating(b)} size={16} />
              <Text style={styles.ratingText}>
                {bookAvgRating(b) ? `${bookAvgRating(b)} · ${b.rating_count}` : "No ratings yet"}
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
          <ActionButton icon="✍️" label="Recensisci"
            onPress={() => router.push(`/compose-review?bookId=${b.id}`)} />
          <ActionButton icon="➕" label="Booklist"
            onPress={() => router.push(`/add-to-list?bookId=${b.id}`)} />
          <ActionButton icon={ub?.liked ? "❤️" : "🤍"} label="Like" active={!!ub?.liked}
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
          <Text style={styles.noReviews}>Be the first to review this book.</Text>
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
              likedByViewer={r.viewer_has_liked}
              onPress={() => router.push(`/review/${r.id}`)}
              onLike={() => onReviewLike(r.id)}
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
  onPress,
}: {
  icon: string;
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.action, active && styles.actionActive]} onPress={onPress}>
      <Text style={styles.actionIcon}>{icon}</Text>
      <Text style={[styles.actionLabel, active && styles.actionLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg },
  back: { paddingVertical: spacing.md },
  backText: { color: colors.textMuted, fontSize: 16 },
  hero: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.lg },
  heroInfo: { flex: 1, gap: spacing.xs },
  title: { ...typography.h2 },
  author: { ...typography.bodyMuted, fontSize: 15 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  ratingText: { color: colors.textMuted, fontSize: 13 },
  meta: { color: colors.textFaint, fontSize: 13, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  action: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  actionActive: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  actionIcon: { fontSize: 22 },
  actionLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  actionLabelActive: { color: colors.text },
  rateBox: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
  sectionTitle: { ...typography.h3 },
  noReviews: { ...typography.bodyMuted, marginBottom: spacing.lg },
});
