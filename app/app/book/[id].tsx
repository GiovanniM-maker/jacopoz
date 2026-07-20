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

        {/* Shelf actions */}
        <View style={styles.actions}>
          <ActionButton icon={isRead ? "✅" : "📖"} label="Read" active={isRead}
            onPress={() => mutateShelf({ status: isRead ? null : "read" })} />
          <ActionButton icon={isSaved ? "🔖" : "📚"} label="Save" active={isSaved}
            onPress={() => mutateShelf({ status: isSaved ? null : "want_to_read" })} />
          <ActionButton icon={ub?.liked ? "❤️" : "🤍"} label="Like" active={!!ub?.liked}
            onPress={() => mutateShelf({ liked: !ub?.liked })} />
          <ActionButton icon="➕" label="List"
            onPress={() => router.push(`/add-to-list?bookId=${b.id}`)} />
        </View>

        {/* Personal rating */}
        <View style={styles.rateBox}>
          <Text style={styles.rateLabel}>Your rating</Text>
          <RatingStars value={ub?.rating ?? null} size={28} onChange={(r) => mutateShelf({ rating: r })} />
        </View>

        {affiliate.data ? (
          <Pressable style={styles.buy} onPress={onBuy}>
            <Text style={styles.buyText}>🛒 Buy on Amazon</Text>
          </Pressable>
        ) : null}

        {b.categories.length > 0 ? (
          <View style={styles.chips}>
            {b.categories.map((c: string) => (
              <Chip key={c} label={c} />
            ))}
          </View>
        ) : null}

        {b.description ? <Text style={styles.description}>{b.description}</Text> : null}

        {/* Reviews */}
        <View style={styles.reviewsHeader}>
          <Text style={styles.sectionTitle}>Community reviews</Text>
          <Pressable onPress={() => router.push(`/compose-review?bookId=${b.id}`)}>
            <Text style={styles.writeReview}>✍️ Write</Text>
          </Pressable>
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
  buy: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  buyText: { color: "#1a1a1a", fontSize: 16, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg },
  description: { ...typography.body, lineHeight: 22, marginBottom: spacing.xl },
  reviewsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  sectionTitle: { ...typography.h3 },
  writeReview: { color: colors.primary, fontSize: 15, fontWeight: "700" },
  noReviews: { ...typography.bodyMuted, marginBottom: spacing.lg },
});
