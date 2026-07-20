import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getBooksByGenre, getGenres, getNewReleases, getTrendingBooks } from "@/api/books";
import { getRecommendations } from "@/api/reco";
import { getGenrePrefs } from "@/api/profile";
import { track } from "@/api/analytics";
import { AppHeader } from "@/components/AppHeader";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/BookRow";
import { TopTenRow } from "@/components/TopTenRow";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { collanaMark, colors, displayFont, hardShadow, onBand, radius, spacing } from "@/theme";
import type { BookReco, Genre } from "@/types/database";

export default function Home() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const recos = useQuery({ queryKey: ["recos"], queryFn: () => getRecommendations(20) });
  const trending = useQuery({ queryKey: ["trending"], queryFn: () => getTrendingBooks(20) });
  const newReleases = useQuery({ queryKey: ["new-releases"], queryFn: () => getNewReleases(20) });
  const genres = useQuery({ queryKey: ["genres"], queryFn: getGenres });
  const prefs = useQuery({
    queryKey: ["genre-prefs", userId],
    queryFn: () => getGenrePrefs(userId!),
    enabled: !!userId,
  });

  useEffect(() => {
    void track("feed_opened", { screen: "home" });
  }, []);

  const genreName = (slug: string) =>
    genres.data?.find((g: Genre) => g.slug === slug)?.name ?? slug;
  const hero: BookReco | undefined = recos.data?.[0] ?? trending.data?.[0] ?? undefined;

  return (
    <ScreenContainer edges={["top"]}>
      <AppHeader />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* Masthead strip: this is a numbered issue of the collana. */}
        <View style={styles.masthead}>
          <Text style={styles.mastheadText}>Periodico di letture</Text>
          <Text style={styles.mastheadText}>Anno I · N°07</Text>
        </View>

        {hero ? <IssueHero book={hero} /> : null}

        <View style={styles.rows}>
          {recos.data && recos.data.length > 0 ? (
            <BookRow title="Consigliati per te" books={recos.data} />
          ) : null}

          <TopTenRow title="Top 10 su Tomo oggi" books={trending.data ?? []} />

          {(prefs.data ?? []).map((slug: string) => (
            <GenreRow key={slug} slug={slug} title={genreName(slug)} />
          ))}

          <BookRow title="Nuove uscite" books={newReleases.data ?? []} />
          <View style={{ height: spacing.xxl }} />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function GenreRow({ slug, title }: { slug: string; title: string }) {
  const q = useQuery({ queryKey: ["genre-books", slug], queryFn: () => getBooksByGenre(slug, 20) });
  return <BookRow title={title} books={q.data ?? []} />;
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
});
