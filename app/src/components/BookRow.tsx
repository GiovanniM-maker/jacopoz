import { FlatList, StyleSheet, Text, View } from "react-native";
import type { BookCard as BookCardType } from "@/types/database";
import { colors, spacing } from "@/theme";
import { BookCard } from "./BookCard";

interface Props {
  title: string;
  subtitle?: string;
  books: BookCardType[];
}

/** A Netflix-style horizontally-scrolling row of book posters. */
export function BookRow({ title, subtitle, books }: Props) {
  if (books.length === 0) return null;
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <FlatList
        horizontal
        data={books}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <BookCard book={item} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl },
  header: { paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  title: { color: colors.text, fontSize: 18, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  list: { paddingHorizontal: spacing.lg },
});
