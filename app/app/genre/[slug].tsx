import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Dimensions, FlatList, StyleSheet, Text, View } from "react-native";
import { getBooksByGenre, getGenres } from "@/api/books";
import { BookCard } from "@/components/BookCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, displayFont, spacing, typography } from "@/theme";
import type { BookCard as BookCardType, Genre } from "@/types/database";

const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

/** All books in a genre — reached by tapping a category tag on a book page. */
export default function GenreScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const genreSlug = (slug ?? "").toLowerCase();

  const books = useQuery({
    queryKey: ["genre-page", genreSlug],
    queryFn: () => getBooksByGenre(genreSlug, 60),
    enabled: !!genreSlug,
  });
  const genres = useQuery({ queryKey: ["genres"], queryFn: getGenres, staleTime: 86_400_000 });
  const name = genres.data?.find((g: Genre) => g.slug === genreSlug)?.name ?? genreSlug;

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Sezione" backFallback="/(tabs)" />
      <View style={styles.hero}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.count}>{books.data?.length ?? 0} libri consigliati</Text>
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
  hero: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
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
  grid: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  col: { gap: spacing.md, marginBottom: spacing.lg },
});
