import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Dimensions, FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import { importFromProviders, searchBooks } from "@/api/books";
import { track } from "@/api/analytics";
import { BookCard } from "@/components/BookCard";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, spacing, typography } from "@/theme";

// Debounce keystrokes so we don't hit the RPC on every character.
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Search() {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 350);

  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => searchBooks(debounced, 30),
  });

  // When a real query returns thin local results, import from external
  // providers in the background and refetch once so the catalog grows.
  useEffect(() => {
    if (debounced.length >= 3) {
      void track("search_performed", { q: debounced });
      if (data.length < 5) {
        void importFromProviders(debounced, 10).then(() => refetch());
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const numColumns = 3;
  const cardWidth = useMemo(() => {
    return (require("react-native").Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;
  }, []);

  return (
    <ScreenContainer edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Search</Text>
        <TextInput
          style={styles.input}
          placeholder="Title, author…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
        />
      </View>

      {data.length === 0 && !isFetching && debounced.length >= 3 ? (
        <EmptyState
          icon="🔍"
          title="No books found"
          message="Try a different title or author. We're also importing new books as you search."
        />
      ) : (
        <FlatList
          key={numColumns}
          data={data}
          keyExtractor={(b) => b.id}
          numColumns={numColumns}
          columnWrapperStyle={styles.column}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <BookCard book={item} width={cardWidth} />
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.md },
  title: typography.h1,
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },
  column: { gap: spacing.md, marginBottom: spacing.lg },
});
