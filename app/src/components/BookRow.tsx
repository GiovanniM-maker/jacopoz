import { FlatList, StyleSheet, Text, View } from "react-native";
import type { BookCard as BookCardType } from "@/types/database";
import { colors, displayFont, spacing } from "@/theme";
import { BookCard } from "./BookCard";

interface Props {
  title: string;
  books: BookCardType[];
  cardWidth?: number;
}

/** A Netflix-style horizontally-scrolling row of book posters. */
export function BookRow({ title, books, cardWidth = 108 }: Props) {
  if (books.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <FlatList
        horizontal
        data={books}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <BookCard book={item} width={cardWidth} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  title: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg },
});
