import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useEffect } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getBooksByGenre, getGenres, getNewReleases, getTrendingBooks } from "@/api/books";
import { getRecommendations } from "@/api/reco";
import { getGenrePrefs } from "@/api/profile";
import { track } from "@/api/analytics";
import { AppHeader } from "@/components/AppHeader";
import { BookRow } from "@/components/BookRow";
import { TopTenRow } from "@/components/TopTenRow";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, displayFont, radius, spacing, typography } from "@/theme";
import type { BookReco, Genre } from "@/types/database";

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

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
      <ScrollView showsVerticalScrollIndicator={false}>
        {hero ? <Billboard book={hero} /> : <View style={{ height: spacing.xxl }} />}

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

/** Full-bleed Netflix billboard: backdrop, gradient fade, title, Play / Info. */
function Billboard({ book }: { book: BookReco }) {
  const height = Math.min(SCREEN_H * 0.62, SCREEN_W * 1.35);
  return (
    <View style={[styles.billboard, { height }]}>
      {book.cover_url ? (
        <Image source={{ uri: book.cover_url }} style={StyleSheet.absoluteFill} contentFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.surfaceAlt }]} />
      )}
      {/* Fade the backdrop into the page background at the bottom. */}
      <LinearGradient
        colors={["transparent", `${colors.bg}66`, colors.bg]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.billboardContent}>
        <Text style={styles.billboardTitle} numberOfLines={2}>
          {book.title}
        </Text>
        <Text style={styles.billboardMeta} numberOfLines={1}>
          {book.reason} · {book.authors[0]}
        </Text>
        <View style={styles.billboardButtons}>
          <Pressable style={styles.playBtn} onPress={() => router.push(`/book/${book.id}`)}>
            <Text style={styles.playIcon}>▶</Text>
            <Text style={styles.playLabel}>Apri</Text>
          </Pressable>
          <Pressable style={styles.infoBtn} onPress={() => router.push(`/book/${book.id}`)}>
            <Text style={styles.infoIcon}>ⓘ</Text>
            <Text style={styles.infoLabel}>Info</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  billboard: { width: SCREEN_W, justifyContent: "flex-end" },
  billboardContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, alignItems: "center" },
  billboardTitle: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 40,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "center",
    textShadowColor: colors.overlay,
    textShadowRadius: 10,
  },
  billboardMeta: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    textAlign: "center",
  },
  billboardButtons: { flexDirection: "row", gap: spacing.md },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
  },
  playIcon: { color: colors.onPrimary, fontSize: 15 },
  playLabel: { color: colors.onPrimary, fontSize: 16, fontWeight: "700" },
  infoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.sm,
  },
  infoIcon: { color: colors.text, fontSize: 16 },
  infoLabel: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rows: { marginTop: spacing.lg },
});
