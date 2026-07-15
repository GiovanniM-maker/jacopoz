import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect } from "react";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getBooksByGenre, getGenres, getNewReleases, getTrendingBooks } from "@/api/books";
import { getRecommendations } from "@/api/reco";
import { getGenrePrefs } from "@/api/profile";
import { track } from "@/api/analytics";
import { BookRow } from "@/components/BookRow";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";
import type { BookReco, Genre } from "@/types/database";

const { width: SCREEN_W } = Dimensions.get("window");

export default function Home() {
  const { session, profile } = useAuth();
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
  const hero: BookReco | undefined = recos.data?.[0] ?? undefined;

  return (
    <ScreenContainer edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>jacopoz</Text>
          <Text style={styles.hello}>Hi, {profile?.display_name?.split(" ")[0] ?? "reader"}</Text>
        </View>

        {hero ? <Hero book={hero} /> : null}

        {recos.data && recos.data.length > 0 ? (
          <BookRow title="For you" subtitle="Picked from your taste" books={recos.data} />
        ) : null}

        <BookRow title="Popular now" books={trending.data ?? []} />

        {(prefs.data ?? []).map((slug: string) => (
          <GenreRow key={slug} slug={slug} title={genreName(slug)} />
        ))}

        <BookRow title="New releases" books={newReleases.data ?? []} />

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function GenreRow({ slug, title }: { slug: string; title: string }) {
  const q = useQuery({ queryKey: ["genre-books", slug], queryFn: () => getBooksByGenre(slug, 20) });
  return <BookRow title={title} books={q.data ?? []} />;
}

function Hero({ book }: { book: BookReco }) {
  return (
    <Pressable style={styles.hero} onPress={() => router.push(`/book/${book.id}`)}>
      {book.cover_url ? (
        <Image source={{ uri: book.cover_url }} style={styles.heroImage} contentFit="cover" blurRadius={2} />
      ) : (
        <View style={[styles.heroImage, { backgroundColor: colors.surfaceAlt }]} />
      )}
      <View style={styles.heroOverlay}>
        <Text style={styles.heroReason}>{book.reason}</Text>
        <Text style={styles.heroTitle} numberOfLines={2}>
          {book.title}
        </Text>
        <Text style={styles.heroAuthor}>{book.authors[0]}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  logo: { ...typography.h2, color: colors.primary },
  hello: { ...typography.bodyMuted },
  hero: {
    height: SCREEN_W * 0.9,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    borderRadius: radius.lg,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  heroImage: { ...StyleSheet.absoluteFillObject, width: "100%", height: "100%" },
  heroOverlay: { padding: spacing.lg, backgroundColor: colors.overlay },
  heroReason: { color: colors.accent, fontSize: 13, fontWeight: "700", marginBottom: spacing.xs },
  heroTitle: { color: "#fff", fontSize: 26, fontWeight: "800" },
  heroAuthor: { color: colors.text, fontSize: 15, marginTop: spacing.xs },
});
