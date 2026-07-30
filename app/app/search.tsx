import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { expandCatalog, importFromProviders, searchAuthors, searchBooks } from "@/api/books";
import { searchUsers } from "@/api/profile";
import { track } from "@/api/analytics";
import { BookCard } from "@/components/BookCard";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { goBack } from "@/lib/nav";
import { contentWidth, collanaMark, colors, displayFont, onBand, radius, spacing } from "@/theme";

type Tab = "books" | "authors" | "users";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// Language filter options. "auto" follows the reader's profile preference;
// "all" removes the boost entirely (useful to find an original-language edition).
const LANGS: { code: string; label: string }[] = [
  { code: "auto", label: "La mia lingua" },
  { code: "it", label: "Italiano" },
  { code: "en", label: "Inglese" },
  { code: "all", label: "Tutte" },
];

export default function Search() {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("books");
  const [lang, setLang] = useState("auto");
  const debounced = useDebounced(query.trim(), 350);

  const books = useQuery({
    queryKey: ["search-books", debounced, lang],
    queryFn: () => searchBooks(debounced, 30, 0, lang === "auto" ? null : lang),
    enabled: tab === "books" && debounced.length >= 2,
  });
  const authors = useQuery({
    queryKey: ["search-authors", debounced],
    queryFn: () => searchAuthors(debounced, 30),
    enabled: tab === "authors" && debounced.length >= 2,
  });
  const users = useQuery({
    queryKey: ["search-users", debounced],
    queryFn: () => searchUsers(debounced, 30),
    enabled: tab === "users" && debounced.length >= 2,
  });

  // Grow the catalog around each distinct query at most once (background).
  const grownFor = useRef<string>("");
  useEffect(() => {
    if (tab === "books" && debounced.length >= 3 && grownFor.current !== debounced) {
      grownFor.current = debounced;
      void track("search_performed", { q: debounced });
      void expandCatalog(debounced, 10);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, tab]);

  // Import direct matches from providers ONLY once the local search has settled
  // and actually came back thin — not blindly on every keystroke.
  const importedFor = useRef<string>("");
  useEffect(() => {
    if (
      tab === "books" &&
      debounced.length >= 3 &&
      !books.isFetching &&
      books.isSuccess &&
      (books.data?.length ?? 0) < 5 &&
      importedFor.current !== debounced
    ) {
      importedFor.current = debounced;
      void importFromProviders(debounced, 10, lang === "auto" ? "it" : lang).then(() => books.refetch());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, tab, books.isFetching, books.isSuccess, books.data]);

  const cardWidth = useMemo(
    () => (contentWidth() - spacing.lg * 2 - spacing.md * 2) / 3,
    [],
  );

  return (
    <ScreenContainer edges={["top"]}>
      <View style={styles.header}>
        <Pressable style={styles.backTile} hitSlop={8} onPress={() => goBack()} accessibilityLabel="Indietro">
          <Icon name="back" color={colors.text} size={20} />
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Cerca libri, autori, utenti…"
          placeholderTextColor={colors.textFaint}
          autoCapitalize="none"
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
      </View>

      <View style={styles.segment}>
        {(["books", "authors", "users"] as Tab[]).map((t) => (
          <Pressable key={t} style={styles.seg} onPress={() => setTab(t)}>
            <Text style={[styles.segLabel, tab === t && styles.segLabelOn]}>
              {t === "books" ? "Libri" : t === "authors" ? "Autori" : "Utenti"}
            </Text>
            {tab === t ? <View style={styles.segBar} /> : null}
          </Pressable>
        ))}
      </View>

      {tab === "books" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.langRow}
        >
          {LANGS.map((l) => (
            <Pressable
              key={l.code}
              onPress={() => setLang(l.code)}
              style={[styles.langChip, lang === l.code && styles.langChipOn]}
            >
              <Text style={[styles.langText, lang === l.code && styles.langTextOn]}>{l.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {/* Loading feedback: searches hit the network (and sometimes import from
          providers), so without this the screen looked frozen. */}
      {(tab === "books" ? books.isFetching : tab === "authors" ? authors.isFetching : users.isFetching) ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={styles.loadingText}>Sto cercando…</Text>
        </View>
      ) : null}

      {tab === "books" ? (
        <FlatList
          key="books-grid"
          data={books.data ?? []}
          keyExtractor={(b) => b.id}
          numColumns={3}
          columnWrapperStyle={styles.col}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            debounced.length >= 3 && !books.isFetching ? (
              <Empty msg="Nessun libro trovato. Stiamo importando nuovi titoli mentre cerchi." />
            ) : null
          }
          renderItem={({ item }) => <BookCard book={item} width={cardWidth} showMeta />}
        />
      ) : tab === "authors" ? (
        <FlatList
          key="authors-list"
          data={authors.data ?? []}
          keyExtractor={(a) => a.author}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={debounced.length >= 2 ? <Empty msg="Nessun autore trovato." /> : null}
          renderItem={({ item }) => (
            <Pressable
              style={styles.row}
              onPress={() => router.push(`/author/${encodeURIComponent(item.author)}`)}
            >
              <View style={[styles.authorIcon, { backgroundColor: collanaMark(item.author).band }]}>
                <Text style={[styles.authorInitial, { color: onBand(collanaMark(item.author).band) }]}>
                  {item.author[0]?.toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.author}</Text>
                <Text style={styles.rowMeta}>{item.book_count} libri</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          key="users-list"
          data={users.data ?? []}
          keyExtractor={(u) => u.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={debounced.length >= 2 ? <Empty msg="Nessun utente trovato." /> : null}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => router.push(`/user/${item.username}`)}>
              <Avatar url={item.avatar_url} name={item.display_name} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.display_name}</Text>
                <Text style={styles.rowMeta}>@{item.username}</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>
          )}
        />
      )}
    </ScreenContainer>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <View style={{ height: 240 }}>
      <EmptyState icon="🔍" title="Nessun risultato" message={msg} />
    </View>
  );
}

const styles = StyleSheet.create({
  langRow: { paddingHorizontal: spacing.lg, gap: spacing.sm, paddingVertical: spacing.sm },
  langChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  langChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  langText: { color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  langTextOn: { color: colors.onPrimary },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadingText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  backTile: {
    width: 44,
    height: 48,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    height: 48,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  segment: {
    flexDirection: "row",
    gap: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  seg: { paddingVertical: spacing.md, alignItems: "center" },
  segLabel: {
    color: colors.textFaint,
    fontFamily: displayFont,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  segLabelOn: { color: colors.primary },
  segBar: {
    position: "absolute",
    bottom: -2,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.primary,
  },
  grid: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  col: { gap: spacing.md, marginBottom: spacing.lg },
  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  authorIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  authorInitial: { fontFamily: displayFont, color: colors.primary, fontSize: 20, fontWeight: "900" },
  rowName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  chev: { color: colors.textFaint, fontSize: 22 },
});
