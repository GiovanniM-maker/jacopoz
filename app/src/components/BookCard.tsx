import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BookCard as BookCardType } from "@/types/database";
import { getBook } from "@/api/books";
import { queryClient } from "@/lib/queryClient";
import { colors, displayFont, spacing } from "@/theme";
import { BookCover } from "./BookCover";
import { Icon } from "./ui/Icon";

/** Warm the book-detail cache before the tap completes → instant open. */
function prefetchBook(id: string) {
  void queryClient.prefetchQuery({
    queryKey: ["book", id],
    queryFn: () => getBook(id),
    staleTime: 60_000,
  });
}

interface Props {
  book: BookCardType & { reason?: string };
  width?: number;
  /** Netflix rows show only the artwork; meta is hidden by default. */
  showMeta?: boolean;
  /** "Non mi interessa": renders a small ✕ tile over the cover. */
  onDismiss?: () => void;
  /**
   * Show the personalised "why this book is here for you" line the recommender
   * produced ("Dagli autori che ami", "Popolare tra lettori come te", …). Global
   * genre labels say what a book *is*; this says what it is *to this reader*.
   */
  showReason?: boolean;
}

/** A tappable poster card used in dashboard rows and grids. */
export function BookCard({ book, width = 120, showMeta = false, onDismiss, showReason }: Props) {
  return (
    <Pressable
      style={[styles.card, { width }]}
      onPressIn={() => prefetchBook(book.id)}
      onPress={() => router.push(`/book/${book.id}`)}
    >
      {onDismiss ? (
        <Pressable
          style={styles.dismiss}
          hitSlop={6}
          onPress={onDismiss}
          accessibilityLabel="Non mi interessa"
        >
          <Icon name="close" color={colors.text} size={12} />
        </Pressable>
      ) : null}
      <BookCover url={book.cover_url} title={book.title} width={width} bookId={book.id} />
      {showReason && book.reason ? (
        <Text style={styles.reason} numberOfLines={2}>
          {book.reason}
        </Text>
      ) : null}
      {showMeta ? (
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>
            {book.title}
          </Text>
          <Text style={styles.author} numberOfLines={1}>
            {book.authors[0] ?? "Autore ignoto"}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  reason: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginTop: 4,
  },
  // No margin here. Every grid that holds these cards sizes its columns with
  // gridCardWidth() and spaces them with `gap`, so a margin on the card is
  // width the layout never budgeted for: three cards plus their margins came to
  // 381pt inside 358pt on a 390pt phone, and the third one wrapped. That is the
  // "profile shows two columns" report. Horizontal rows set their own gap.
  card: {},
  dismiss: {
    position: "absolute",
    top: 4,
    right: 4,
    zIndex: 2,
    width: 22,
    height: 22,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.92,
  },
  meta: { marginTop: spacing.sm, gap: 2 },
  title: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 15,
    fontWeight: "900",
    textTransform: "uppercase",
    lineHeight: 17,
  },
  author: { color: colors.textMuted, fontSize: 12, fontStyle: "italic" },
});
