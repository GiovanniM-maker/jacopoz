import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { getGenres, searchBooks, importFromProviders } from "@/api/books";
import { getFreeReadsForYou } from "@/api/reco";
import { setShelf } from "@/api/shelves";
import { saveOnboarding } from "@/api/profile";
import { BookCover } from "@/components/BookCover";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { RatingStars } from "@/components/ui/RatingStars";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, displayFont, radius, spacing, typography } from "@/theme";
import type { BookCard, Genre } from "@/types/database";

const MIN_PICKS = 3;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Two-step taste onboarding, built to beat the recommendation cold-start:
 *   1. Genres + subgenres (declared interest).
 *   2. Books you've already read + star ratings — this seeds the taste
 *      vector directly (the real signal), so the very first recommendations
 *      are already on-target. Step 2 is optional; the value grows visibly
 *      as you add books ("more books → sharper picks").
 */
export default function Onboarding() {
  const { session, refreshProfile } = useAuth();
  const userId = session?.user.id;
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: genres = [] } = useQuery({ queryKey: ["genres"], queryFn: getGenres });

  // Group subgenres under their parent for a readable picker.
  const groups = useMemo(() => {
    const parents = genres.filter((g: Genre) => !g.parent_slug);
    return parents.map((p: Genre) => ({
      parent: p,
      subs: genres.filter((g: Genre) => g.parent_slug === p.slug),
    }));
  }, [genres]);
  const parentOf = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const g of genres) m.set(g.slug, g.parent_slug);
    return m;
  }, [genres]);

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }

  async function finish() {
    if (!userId) return;
    setSaving(true);
    // Credit the parent of every chosen subgenre so genre-affinity (which
    // matches parent slugs on books) still fires.
    const slugs = new Set(selected);
    for (const s of selected) {
      const p = parentOf.get(s);
      if (p) slugs.add(p);
    }
    await saveOnboarding(userId, [...slugs]); // also flips onboarded_at → gate → app
    await refreshProfile();
    setSaving(false);
  }

  if (step === 1) {
    return (
      <ScreenContainer padded>
        <View style={styles.header}>
          <Text style={styles.kicker}>Passo 1 di 2</Text>
          <Text style={styles.title}>Cosa ami leggere?</Text>
          <Text style={styles.subtitle}>
            Scegline almeno {MIN_PICKS}. Tocca anche i sottogeneri per farci capire meglio i tuoi gusti.
          </Text>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
          {groups.map(({ parent, subs }: { parent: Genre; subs: Genre[] }) => (
            <View key={parent.slug} style={styles.group}>
              <View style={styles.groupRow}>
                <Chip
                  label={parent.name}
                  selected={selected.has(parent.slug)}
                  onPress={() => toggle(parent.slug)}
                />
              </View>
              {subs.length > 0 ? (
                <View style={styles.subRow}>
                  {subs.map((s: Genre) => (
                    <Chip
                      key={s.slug}
                      label={s.name}
                      selected={selected.has(s.slug)}
                      onPress={() => toggle(s.slug)}
                    />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>

        <Button
          label={
            selected.size < MIN_PICKS
              ? `Scegli ancora ${MIN_PICKS - selected.size}`
              : `Continua (${selected.size})`
          }
          onPress={() => setStep(2)}
          disabled={selected.size < MIN_PICKS}
          style={styles.cta}
        />
      </ScreenContainer>
    );
  }

  return <BooksStep userId={userId!} onBack={() => setStep(1)} onFinish={finish} saving={saving} />;
}

/** Step 2 — books you've read, rated. Each add seeds the taste vector live. */
function BooksStep({
  userId,
  onBack,
  onFinish,
  saving,
}: {
  userId: string;
  onBack: () => void;
  onFinish: () => void;
  saving: boolean;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 350);
  // bookId -> { book, rating }
  const [read, setRead] = useState<Map<string, { book: BookCard; rating: number | null }>>(new Map());

  const results = useQuery({
    queryKey: ["onb-search", debounced],
    queryFn: () => searchBooks(debounced, 20),
    enabled: debounced.length >= 2,
    placeholderData: keepPreviousData, // no blank flash between searches
  });

  // If the local catalog is thin for this query, import from providers in the
  // BACKGROUND — never blocks the input or the results already shown. Runs at
  // most once per query.
  const importedFor = useRef<string>("");
  useEffect(() => {
    if (
      debounced.length >= 2 &&
      importedFor.current !== debounced &&
      !results.isFetching &&
      (results.data?.length ?? 0) < 5
    ) {
      importedFor.current = debounced;
      void importFromProviders(debounced, 10).then(() => results.refetch());
    }
  }, [debounced, results.data, results.isFetching]);

  // Live preview: once a couple of books are in, show what we'd suggest.
  const preview = useQuery({
    queryKey: ["onb-preview", read.size],
    queryFn: () => getFreeReadsForYou(8),
    enabled: read.size >= 2,
  });

  async function addBook(book: BookCard) {
    if (read.has(book.id)) return;
    setRead((prev) => new Map(prev).set(book.id, { book, rating: null }));
    // Keep the query so the user can keep adding from the same results; the
    // just-added book is filtered out of the list below.
    await setShelf(userId, book.id, { status: "read", rating: null });
  }
  async function rate(bookId: string, rating: number) {
    setRead((prev) => {
      const next = new Map(prev);
      const e = next.get(bookId);
      if (e) next.set(bookId, { ...e, rating });
      return next;
    });
    await setShelf(userId, bookId, { status: "read", rating });
  }
  async function remove(bookId: string) {
    setRead((prev) => {
      const next = new Map(prev);
      next.delete(bookId);
      return next;
    });
    await setShelf(userId, bookId, { status: null, rating: null });
  }

  const list = [...read.values()];

  return (
    <ScreenContainer padded>
      <View style={styles.header}>
        <Text style={styles.kicker}>Passo 2 di 2 · facoltativo</Text>
        <Text style={styles.title}>Quali libri hai già letto?</Text>
        <Text style={styles.subtitle}>
          Aggiungine qualcuno e dai un voto. Più ne metti, più i consigli diventano precisi — puoi
          anche saltare.
        </Text>
      </View>

      <TextInput
        style={styles.search}
        placeholder="Cerca un libro che hai letto…"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        value={query}
        onChangeText={setQuery}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.lg }}>
        {/* Search results — local-first, already-added books filtered out */}
        {debounced.length >= 2 ? (
          <View style={styles.results}>
            {(() => {
              const rows = (results.data ?? []).filter((b: BookCard) => !read.has(b.id)).slice(0, 8);
              if (rows.length > 0) {
                return rows.map((b: BookCard) => (
                  <Pressable key={b.id} style={styles.resultRow} onPress={() => addBook(b)}>
                    <BookCover url={b.cover_url} title={b.title} width={34} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.resultTitle} numberOfLines={1}>{b.title}</Text>
                      <Text style={styles.resultAuthor} numberOfLines={1}>{b.authors[0] ?? ""}</Text>
                    </View>
                    <Text style={styles.add}>＋</Text>
                  </Pressable>
                ));
              }
              return (
                <View style={styles.searchHint}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={styles.searchHintText}>
                    {results.isFetching ? "Cerco…" : "Importo nuovi titoli…"}
                  </Text>
                </View>
              );
            })()}
          </View>
        ) : null}

        {/* Chosen read books with ratings */}
        {list.length > 0 ? (
          <View style={styles.chosen}>
            <Text style={styles.sectionLabel}>I tuoi libri ({list.length})</Text>
            {list.map(({ book, rating }) => (
              <View key={book.id} style={styles.chosenRow}>
                <BookCover url={book.cover_url} title={book.title} width={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.resultTitle} numberOfLines={1}>{book.title}</Text>
                  <RatingStars value={rating} size={20} onChange={(r) => rate(book.id, r)} />
                </View>
                <Pressable onPress={() => remove(book.id)} hitSlop={8}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* Live preview of what we'd recommend */}
        {(preview.data ?? []).length > 0 ? (
          <View style={styles.preview}>
            <Text style={styles.sectionLabel}>In base ai tuoi libri, ti consiglieremo…</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewRow}>
              {(preview.data ?? []).map((b: BookCard) => (
                <View key={b.id} style={styles.previewCard}>
                  <BookCover url={b.cover_url} title={b.title} width={72} />
                </View>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <Pressable onPress={onBack} hitSlop={8}>
          <Text style={styles.backLink}>‹ Generi</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        <Button
          label={list.length > 0 ? `Fine (${list.length})` : "Salta"}
          onPress={onFinish}
          loading={saving}
          style={styles.finishBtn}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: spacing.xl, marginBottom: spacing.md, gap: spacing.xs },
  kicker: {
    fontFamily: displayFont,
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: typography.h1,
  subtitle: typography.bodyMuted,
  group: { marginBottom: spacing.md },
  groupRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  subRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: spacing.md,
  },
  cta: { marginVertical: spacing.lg },
  search: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
    marginBottom: spacing.md,
  },
  results: { gap: 2, marginBottom: spacing.lg },
  searchHint: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md },
  searchHintText: { color: colors.textMuted, fontSize: 14, fontStyle: "italic" },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  resultAuthor: { color: colors.textMuted, fontSize: 13, marginTop: 1 },
  add: { color: colors.primary, fontSize: 24, fontWeight: "900", paddingHorizontal: 4 },
  chosen: { marginBottom: spacing.lg },
  sectionLabel: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  chosenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  remove: { color: colors.textMuted, fontSize: 16, fontWeight: "800", paddingHorizontal: 4 },
  preview: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  previewRow: { gap: spacing.sm, paddingTop: spacing.xs },
  previewCard: {},
  footer: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  backLink: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  finishBtn: { minWidth: 140 },
});
