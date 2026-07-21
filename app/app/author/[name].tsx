import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { FlatList } from "react-native";
import { getBooksByAuthor } from "@/api/books";
import { BookCard } from "@/components/BookCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { goBack } from "@/lib/nav";
import { colors, displayFont, spacing, typography } from "@/theme";
import type { BookCard as BookCardType } from "@/types/database";

const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

export default function AuthorScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const author = decodeURIComponent(name ?? "");

  const books = useQuery({
    queryKey: ["author-books", author],
    queryFn: () => getBooksByAuthor(author),
    enabled: !!author,
  });

  return (
    <ScreenContainer edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => goBack("/(tabs)/search")} hitSlop={10}>
          <Text style={styles.back}>‹ Indietro</Text>
        </Pressable>
      </View>
      <View style={styles.hero}>
        <Text style={styles.name}>{author}</Text>
        <Text style={styles.count}>{books.data?.length ?? 0} libri nel catalogo</Text>
      </View>
      <FlatList
        data={books.data ?? []}
        keyExtractor={(b) => b.id}
        numColumns={3}
        columnWrapperStyle={styles.col}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: BookCardType }) => (
          <BookCard book={item} width={CARD_W} showMeta />
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  back: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  name: {
    fontFamily: displayFont,
    fontSize: 34,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
  },
  count: {
    ...typography.bodyMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: spacing.xs,
  },
  grid: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  col: { gap: spacing.md, marginBottom: spacing.lg },
});
