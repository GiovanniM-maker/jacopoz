import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { getBooksByGenre, getGenres, getNewReleases, getTrendingSeeded } from "@/api/books";
import {
  dismissBook,
  getContinueReading,
  getFreeReadsForYou,
  getHomeSections,
  getPaidDiscoveries,
  getRecommendations,
  logRecoImpressions,
  type ContinueReadingBook,
  type HomeSection,
} from "@/api/reco";
import { getGenrePrefs } from "@/api/profile";
import { track } from "@/api/analytics";
import { AppHeader } from "@/components/AppHeader";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/BookRow";
import { RowHeader } from "@/components/RowHeader";
import { TopTenRow } from "@/components/TopTenRow";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { BookCard } from "@/components/BookCard";
import { useAuth } from "@/store/auth";
import { MAX_CONTENT, collanaMark, colors, displayFont, hardShadow, onBand, radius, spacing } from "@/theme";
import type { BookCard as BookCardType, BookReco, Genre } from "@/types/database";

const PAGE = 18;

export default function Home() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const cardW = Math.floor((Math.min(width, MAX_CONTENT) - spacing.lg * 2 - spacing.md * 2) / 3);

  // The seed drives rotation: same seed → same slate (stable while scrolling),
  // new seed → a different mix. Pull-to-refresh mints a new one, which is what
  // makes the home feel alive instead of frozen.
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000));
  const [refreshing, setRefreshing] = useState(false);

  const resume = useQuery({ queryKey: ["continue-reading"], queryFn: () => getContinueReading(12) });
  // Named, personalised rows; which ones appear depends on the seed.
  const sections = useQuery({
    queryKey: ["home-sections", seed],
    queryFn: () => getHomeSections(seed, 5),
  });
  const recos = useQuery({ queryKey: ["recos", seed], queryFn: () => getRecommendations(20, 0, seed) });
  const freeReads = useQuery({ queryKey: ["free-reads"], queryFn: () => getFreeReadsForYou(15) });
  const paidPicks = useQuery({ queryKey: ["paid-discoveries"], queryFn: () => getPaidDiscoveries(15) });
  const trending = useQuery({ queryKey: ["trending", seed], queryFn: () => getTrendingSeeded(20, seed) });
  const newReleases = useQuery({ queryKey: ["new-releases"], queryFn: () => getNewReleases(20) });

  // The infinite tail: keeps proposing new books as you scroll, paging into the
  // same seeded slate so nothing repeats.
  const more = useInfiniteQuery({
    queryKey: ["home-more", seed],
    queryFn: ({ pageParam }) => getRecommendations(PAGE, pageParam as number, seed),
    initialPageParam: 20,
    getNextPageParam: (last: BookReco[], all) =>
      last.length < PAGE ? undefined : 20 + all.length * PAGE,
  });
  // Genres are static reference data — cache for a day, never re-fetch on nav.
  const genres = useQuery({ queryKey: ["genres"], queryFn: getGenres, staleTime: 86_400_000 });
  const prefs = useQuery({
    queryKey: ["genre-prefs", userId],
    queryFn: () => getGenrePrefs(userId!),
    enabled: !!userId,
  });

  useEffect(() => {
    void track("feed_opened", { screen: "home" });
  }, []);

  // CTR denominator: log which recommendations were actually shown.
  const recoIds = (recos.data ?? []).map((b: BookReco) => b.id).join(",");
  useEffect(() => {
    if (recoIds) void logRecoImpressions(recoIds.split(",").slice(0, 12), "home");
  }, [recoIds]);

  async function onDismissReco(bookId: string) {
    await dismissBook(bookId);
    qc.invalidateQueries({ queryKey: ["recos"] });
    qc.invalidateQueries({ queryKey: ["home-more"] });
  }

  // Pull-to-refresh = "give me a different selection". New seed → every seeded
  // query refetches with a fresh mix.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setSeed(Math.floor(Math.random() * 1_000_000));
    await Promise.allSettled([
      qc.invalidateQueries({ queryKey: ["free-reads"] }),
      qc.invalidateQueries({ queryKey: ["paid-discoveries"] }),
      qc.invalidateQueries({ queryKey: ["new-releases"] }),
      qc.invalidateQueries({ queryKey: ["continue-reading"] }),
    ]);
    setRefreshing(false);
  }, [qc]);

  const genreName = (slug: string) =>
    genres.data?.find((g: Genre) => g.slug === slug)?.name ?? slug;
  const hero: BookReco | undefined = recos.data?.[0] ?? trending.data?.[0] ?? undefined;

  // The recommendation slices (recos / free / paid) all sort the same pool, so
  // a book easily lands in several carousels — and the hero is recos[0]. Dedupe
  // top-to-bottom so nothing repeats down the page. Top 10 keeps its full
  // ranking (it's a distinct ranked list) but still suppresses later repeats.
  const seen = new Set<string>();
  const dedupe = (list: readonly BookCardType[] | undefined): BookCardType[] => {
    const out: BookCardType[] = [];
    for (const b of list ?? []) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      out.push(b);
    }
    return out;
  };
  if (hero) seen.add(hero.id);
  const recoRow = dedupe(recos.data);
  const freeRow = dedupe(freeReads.data);
  const trendingRow: BookCardType[] = trending.data ?? [];
  trendingRow.forEach((b) => seen.add(b.id));
  const paidRow = dedupe(paidPicks.data);
  const newRow = dedupe(newReleases.data);
  const genreExclude = Array.from(seen);

  // Infinite tail, deduped against everything already shown above and chunked
  // into rows of three so it reads as a grid.
  const tail: BookCardType[] = [];
  for (const b of (more.data?.pages ?? []).flat() as BookCardType[]) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    tail.push(b);
  }
  const tailRows: BookCardType[][] = [];
  for (let i = 0; i < tail.length; i += 3) tailRows.push(tail.slice(i, i + 3));

  const header = (
    <View>
      {/* Masthead strip: this is a numbered issue of the collana. */}
      <View style={styles.masthead}>
        <Text style={styles.mastheadText}>Periodico di letture</Text>
        <Text style={styles.mastheadText}>Anno I · N°07</Text>
      </View>

      {/* "Continua a leggere" comes first once anything is in progress — the
          fastest path back into a book, like Netflix's Continue watching. */}
      {(resume.data ?? []).length > 0 ? (
        <ContinueReadingRow books={resume.data ?? []} />
      ) : hero ? (
        <IssueHero book={hero} />
      ) : null}

      <View style={styles.rows}>
          {recoRow.length > 0 ? (
            <BookRow title="Consigliati per te" books={recoRow} onDismiss={onDismissReco} showReason />
          ) : null}

          {freeRow.length > 0 ? (
            <BookRow title="Gratis, consigliati per te" books={freeRow} />
          ) : null}

          <TopTenRow title="Top 10 su Tomo oggi" books={trendingRow} />

          {/* Personalised, named rows — these rotate with the seed, so a
              refresh reveals different ones. */}
          {(sections.data ?? []).map((s: HomeSection) => {
            const books = s.books.filter((b) => !seen.has(b.id));
            books.forEach((b) => seen.add(b.id));
            return books.length >= 4 ? <BookRow key={s.key} title={s.title} books={books} /> : null;
          })}

          {paidRow.length > 0 ? (
            <BookRow title="Nuove scoperte · a pagamento" books={paidRow} />
          ) : null}

          {(prefs.data ?? []).map((slug: string) => (
            <GenreRow key={slug} slug={slug} title={genreName(slug)} exclude={genreExclude} />
          ))}

        {newRow.length > 0 ? <BookRow title="Nuove uscite" books={newRow} /> : null}
      </View>

      {tailRows.length > 0 ? (
        <Text style={styles.tailTitle}>Continua a scoprire</Text>
      ) : null}
    </View>
  );

  return (
    <ScreenContainer edges={["top"]}>
      <AppHeader />
      <FlatList
        data={tailRows}
        keyExtractor={(row, i) => `tail-${i}-${row[0]?.id ?? i}`}
        ListHeaderComponent={header}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || recos.isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            title="Nuove proposte…"
          />
        }
        onEndReachedThreshold={0.6}
        onEndReached={() => {
          if (more.hasNextPage && !more.isFetchingNextPage) void more.fetchNextPage();
        }}
        renderItem={({ item }) => (
          <View style={styles.gridRow}>
            {item.map((b) => (
              <BookCard key={b.id} book={b} width={cardW} showMeta />
            ))}
          </View>
        )}
        ListFooterComponent={
          <View style={styles.footer}>
            {more.isFetchingNextPage ? (
              <ActivityIndicator color={colors.primary} />
            ) : !more.hasNextPage && tailRows.length > 0 ? (
              <Text style={styles.footerText}>Hai visto tutto per ora — trascina in giù per una nuova selezione</Text>
            ) : null}
          </View>
        }
      />
    </ScreenContainer>
  );
}

/**
 * "Continua a leggere" — the Netflix resume row. Each cover carries a progress
 * bar (and a bookmark tick when one is set); tapping a free book jumps straight
 * back into the reader, otherwise it opens the book page.
 */
function ContinueReadingRow({ books }: { books: ContinueReadingBook[] }) {
  return (
    <View style={styles.resumeWrap}>
      <RowHeader title="Continua a leggere" />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.resumeList}
      >
        {books.map((b) => (
          <Pressable
            key={b.id}
            style={styles.resumeItem}
            onPress={() =>
              router.push(
                b.gutenberg_id
                  ? `/read/${b.gutenberg_id}?bookId=${b.id}`
                  : `/book/${b.id}`,
              )
            }
          >
            <BookCover url={b.cover_url} title={b.title} width={116} />
            <View style={styles.resumeBar}>
              <View style={[styles.resumeFill, { width: `${Math.min(100, Math.max(2, b.percent))}%` }]} />
              {b.bookmark_percent != null ? (
                <View style={[styles.resumeMark, { left: `${Math.min(99, b.bookmark_percent)}%` }]} />
              ) : null}
            </View>
            <Text style={styles.resumePct}>
              {b.percent >= 1 ? `${Math.round(b.percent)}%` : "Inizia"}
            </Text>
            <Text style={styles.resumeTitle} numberOfLines={2}>
              {b.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function GenreRow({ slug, title, exclude }: { slug: string; title: string; exclude: string[] }) {
  const q = useQuery({ queryKey: ["genre-books", slug], queryFn: () => getBooksByGenre(slug, 20) });
  const ex = new Set(exclude);
  const books = (q.data ?? []).filter((b: BookCardType) => !ex.has(b.id));
  return <BookRow title={title} books={books} />;
}

/**
 * "Il numero del mese" — the editorial cover-story block. A hard-framed
 * coloured card (not a Netflix billboard): masthead band, the featured book
 * beside its condensed title and reason, and a single call to action.
 */
function IssueHero({ book }: { book: BookReco }) {
  const { number } = collanaMark(book.title);
  const ink = onBand(colors.accent);
  const open = () => router.push(`/book/${book.id}`);

  return (
    <View style={[styles.issue, hardShadow]}>
      <View style={styles.issueBand}>
        <Text style={[styles.issueKicker, { color: ink }]}>Il numero del mese</Text>
        <Text style={[styles.issueKicker, { color: ink }]}>N°{number}</Text>
      </View>

      <View style={styles.issueBody}>
        <Pressable onPress={open}>
          <BookCover url={book.cover_url} title={book.title} width={96} />
        </Pressable>

        <View style={styles.issueInfo}>
          <Text style={[styles.issueTitle, { color: ink }]} numberOfLines={3}>
            {book.title}
          </Text>
          <Text style={[styles.issueAuthor, { color: ink }]} numberOfLines={2}>
            {book.authors[0]}
            {book.reason ? ` · ${book.reason}` : ""}
          </Text>
          <Pressable style={styles.issueCta} onPress={open}>
            <Text style={styles.issueCtaText}>Apri la scheda ▸</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingTop: spacing.sm },
  masthead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    marginBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  mastheadText: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  issue: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    overflow: "hidden",
  },
  issueBand: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  issueKicker: { fontSize: 10, fontWeight: "800", letterSpacing: 2, textTransform: "uppercase" },
  issueBody: { flexDirection: "row", gap: spacing.md, padding: spacing.md },
  issueInfo: { flex: 1, justifyContent: "center" },
  issueTitle: {
    fontFamily: displayFont,
    fontSize: 30,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    lineHeight: 30,
  },
  issueAuthor: { fontSize: 13, fontStyle: "italic", marginTop: spacing.xs, opacity: 0.9 },
  issueCta: {
    alignSelf: "flex-start",
    marginTop: spacing.md,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  issueCtaText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  rows: { marginTop: spacing.sm },
  resumeWrap: { marginTop: spacing.sm, marginBottom: spacing.md },
  resumeList: { paddingHorizontal: spacing.lg, gap: spacing.md },
  resumeItem: { width: 116 },
  resumeBar: {
    height: 5,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 6,
    position: "relative",
  },
  resumeFill: { height: "100%", backgroundColor: colors.primary },
  resumeMark: { position: "absolute", top: -2, width: 2, height: 9, backgroundColor: colors.accent },
  resumePct: { color: colors.textMuted, fontSize: 10, fontWeight: "800", marginTop: 3 },
  resumeTitle: { color: colors.text, fontSize: 12, fontWeight: "600", marginTop: 2 },
  tailTitle: {
    fontFamily: displayFont,
    fontSize: 18,
    fontWeight: "900",
    color: colors.text,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  gridRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  footer: { paddingVertical: spacing.xl, paddingHorizontal: spacing.lg, alignItems: "center" },
  footerText: { color: colors.textFaint, fontSize: 13, textAlign: "center" },
});
