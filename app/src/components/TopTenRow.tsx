import { router } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import type { BookCard as BookCardType } from "@/types/database";
import { COVER_ASPECT, colors, spacing } from "@/theme";
import { BookCover } from "./BookCover";

interface Props {
  title: string;
  books: BookCardType[];
}

/** Netflix "Top 10" row: a giant outlined rank numeral behind each poster. */
export function TopTenRow({ title, books }: Props) {
  if (books.length === 0) return null;
  const top = books.slice(0, 10);
  const posterW = 96;
  const posterH = posterW / COVER_ASPECT;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <FlatList
        horizontal
        data={top}
        keyExtractor={(b) => b.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item, index }) => (
          <Pressable style={styles.item} onPress={() => router.push(`/book/${item.id}`)}>
            <Text style={[styles.rank, { height: posterH }]}>{index + 1}</Text>
            <View style={{ width: posterW }}>
              <BookCover url={item.cover_url} title={item.title} width={posterW} />
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "700",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.lg, alignItems: "flex-end" },
  item: { flexDirection: "row", alignItems: "flex-end", marginRight: spacing.sm },
  rank: {
    fontSize: 120,
    fontWeight: "900",
    color: "#2A2A2A",
    marginRight: -22,
    textAlignVertical: "bottom",
    lineHeight: 120,
    // Outlined numeral look, Netflix-style.
    textShadowColor: colors.textFaint,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 1,
  },
});
