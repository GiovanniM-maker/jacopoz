import { FlatList, StyleSheet, View } from "react-native";
import type { BookCard as BookCardType } from "@/types/database";
import { colors, spacing } from "@/theme";
import { BookCard } from "./BookCard";
import { RowHeader } from "./RowHeader";

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
      <RowHeader title={title} />
      <FlatList
        horizontal
        data={books}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <BookCard book={item} width={cardWidth} />}
      />
      <View style={styles.shelf} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl },
  list: { paddingHorizontal: spacing.lg },
  shelf: {
    height: 2,
    backgroundColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
});
