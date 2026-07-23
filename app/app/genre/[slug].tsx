import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { Dimensions, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getBooksByGenre, getGenres, importFromProviders, searchBooks } from "@/api/books";
import { BookCard } from "@/components/BookCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Chip } from "@/components/ui/Chip";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, displayFont, spacing, typography } from "@/theme";
import type { BookCard as BookCardType, Genre } from "@/types/database";

const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

/**
 * A genre or subgenre section, reached from a book's category tags or from a
 * parent genre's subgenre chips. Top-level genres list books tagged with that
 * genre; subgenres (which books aren't individually tagged with) are surfaced
 * by searching their name — and imported in the background to fill the niche.
 */
export default function GenreScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const genreSlug = (slug ?? "").toLowerCase();

  const genres = useQuery({ queryKey: ["genres"], queryFn: getGenres, staleTime: 86_400_000 });
  const genre = genres.data?.find((g: Genre) => g.slug === genreSlug);
  const name = genre?.name ?? genreSlug;
  const isSub = !!genre?.parent_slug;
  const parent = genre?.parent_slug
    ? genres.data?.find((g: Genre) => g.slug === genre.parent_slug)
    : undefined;
  const children = useMemo(
    () => (genres.data ?? []).filter((g: Genre) => g.parent_slug === genreSlug),
    [genres.data, genreSlug],
  );

  const books = useQuery({
    queryKey: ["genre-page", genreSlug, isSub],
    queryFn: async () => {
      if (!isSub) return getBooksByGenre(genreSlug, 60);
      // Books aren't tagged at subgenre level, so surface name-matches first,
      // then fill from the parent genre so the section is never empty.
      const [byName, parentBooks] = await Promise.all([
        searchBooks(name, 40),
        genre?.parent_slug ? getBooksByGenre(genre.parent_slug, 60) : Promise.resolve([]),
      ]);
      const seen = new Set(byName.map((b) => b.id));
      return [...byName, ...parentBooks.filter((b) => !seen.has(b.id))].slice(0, 60);
    },
    enabled: !!genreSlug && !genres.isLoading,
  });

  // For a subgenre, grow the catalog around its name in the background.
  useEffect(() => {
    if (isSub && name) void importFromProviders(name, 12);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSub, name]);

  const header = (
    <View>
      <View style={styles.hero}>
        {parent ? (
          <Pressable onPress={() => router.replace(`/genre/${parent.slug}`)} hitSlop={6}>
            <Text style={styles.parentLink}>‹ {parent.name}</Text>
          </Pressable>
        ) : null}
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.count}>{books.data?.length ?? 0} libri consigliati</Text>
      </View>
      {children.length > 0 ? (
        <View style={styles.subs}>
          {children.map((c: Genre) => (
            <Chip key={c.slug} label={c.name} onPress={() => router.push(`/genre/${c.slug}`)} />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Sezione" backFallback="/(tabs)" />
      <FlatList
        data={books.data ?? []}
        keyExtractor={(b) => b.id}
        numColumns={3}
        columnWrapperStyle={styles.col}
        contentContainerStyle={styles.grid}
        ListHeaderComponent={header}
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
  parentLink: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
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
  subs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  grid: { paddingBottom: spacing.xxl },
  col: { gap: spacing.md, marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
});
