import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { FlatList } from "react-native";
import { getBooksByAuthor } from "@/api/books";
import { BookCard } from "@/components/BookCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, spacing, typography } from "@/theme";
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
        <Pressable onPress={() => router.back()} hitSlop={10}>
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
  back: { color: colors.textMuted, fontSize: 16 },
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  name: { ...typography.h1 },
  count: { ...typography.bodyMuted, marginTop: spacing.xs },
  grid: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  col: { gap: spacing.md, marginBottom: spacing.lg },
});
