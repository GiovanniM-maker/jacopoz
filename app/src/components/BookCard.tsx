import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { BookCard as BookCardType } from "@/types/database";
import { colors, displayFont, spacing } from "@/theme";
import { BookCover } from "./BookCover";
import { Icon } from "./ui/Icon";

interface Props {
  book: BookCardType;
  width?: number;
  /** Netflix rows show only the artwork; meta is hidden by default. */
  showMeta?: boolean;
  /** "Non mi interessa": renders a small ✕ tile over the cover. */
  onDismiss?: () => void;
}

/** A tappable poster card used in dashboard rows and grids. */
export function BookCard({ book, width = 120, showMeta = false, onDismiss }: Props) {
  return (
    <Pressable
      style={[styles.card, { width }]}
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
      <BookCover url={book.cover_url} title={book.title} width={width} />
      {showMeta ? (
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>
            {book.title}
          </Text>
          <Text style={styles.author} numberOfLines={1}>
            {book.authors[0] ?? "Unknown"}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginRight: spacing.sm },
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
