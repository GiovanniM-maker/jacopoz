import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getBook, getBookEditions, getSimilarBooks, requestBookEnrichment, requestSynopsis, bookAvgRating, type BookEdition } from "@/api/books";
import { getBookReviewsRanked } from "@/api/feed";
import { getUserBook, setShelf } from "@/api/shelves";
import { toggleLike } from "@/api/social";
import { getReadInfo } from "@/api/reading";
import { track } from "@/api/analytics";
import { BookCover } from "@/components/BookCover";
import { BookRow } from "@/components/BookRow";
import { RowHeader } from "@/components/RowHeader";
import { Icon, type IconName } from "@/components/ui/Icon";
import { RatingStars } from "@/components/ui/RatingStars";
import { ReviewCard } from "@/components/ReviewCard";
import { ShelfControl } from "@/components/ShelfControl";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { ErrorScreen, LoadingScreen } from "@/components/ui/ScreenState";
import { goBack } from "@/lib/nav";
import { shareBookCard } from "@/lib/shareCard";
import { useAuth } from "@/store/auth";
import { collanaMark, colors, displayFont, hardShadow, onBand, radius, spacing, typography } from "@/theme";
import type { FeedItem } from "@/types/database";

export default function BookPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const shelfBusy = useRef(false);

  const book = useQuery({ queryKey: ["book", id], queryFn: () => getBook(id!), enabled: !!id });
  const userBook = useQuery({
    queryKey: ["user-book", id, userId],
    queryFn: () => getUserBook(userId!, id!),
    enabled: !!id && !!userId,
  });
  const reviews = useQuery({
    queryKey: ["book-reviews", id, userId],
    queryFn: () => getBookReviewsRanked(id!),
    enabled: !!id,
  });
  // Free-read availability: matches the book to Project Gutenberg on demand
  // (and repairs classic author names as a side effect).
  const readInfo = useQuery({
    queryKey: ["read-info", id],
    queryFn: () => getReadInfo(id!),
    enabled: !!id,
    staleTime: 1000 * 60 * 60,
  });
  const editions = useQuery({
    queryKey: ["book-editions", id],
    queryFn: () => getBookEditions(id!),
    enabled: !!id,
  });
  const similar = useQuery({
    queryKey: ["similar-books", id],
    queryFn: () => getSimilarBooks(id!, 12),
    enabled: !!id,
  });

  // La sinossi si chiede una volta sola per apertura, e solo se manca davvero:
  // `book.data` arriva dopo, quindi l'effetto aspetta il libro invece di partire
  // sull'id e chiedere una sinossi che magari c'è già.
  const [synopsisPending, setSynopsisPending] = useState(false);
  const synopsisAsked = useRef<string>("");

  useEffect(() => {
    if (id) {
      void track("book_viewed", { bookId: id });
      // First view triggers the external-enrichment pipeline (circle 2).
      void requestBookEnrichment(id);
    }
  }, [id]);

  useEffect(() => {
    const b = book.data;
    if (!id || !b || b.synopsis || synopsisAsked.current === id) return;
    synopsisAsked.current = id;
    setSynopsisPending(true);
    void requestSynopsis(id)
      .then(() => book.refetch())
      .finally(() => setSynopsisPending(false));
  }, [id, book.data]);

  async function mutateShelf(patch: Parameters<typeof setShelf>[2]) {
    if (!userId || !id) return;
    // setShelf is read-modify-write; serialise so two quick taps (e.g. rating
    // then like) can't overwrite each other with a stale snapshot.
    if (shelfBusy.current) return;
    shelfBusy.current = true;
    try {
      await setShelf(userId, id, patch);
    } finally {
      shelfBusy.current = false;
    }
    qc.invalidateQueries({ queryKey: ["user-book", id, userId] });
    qc.invalidateQueries({ queryKey: ["book", id] });
    qc.invalidateQueries({ queryKey: ["shelf", userId] });
    // Rating changes now flow into the user's review too — refresh it.
    qc.invalidateQueries({ queryKey: ["book-reviews", id, userId] });
    qc.invalidateQueries({ queryKey: ["my-review", id, userId] });
  }

  if (book.isLoading) return <LoadingScreen backFallback="/(tabs)" />;
  if (book.isError) return <ErrorScreen backFallback="/(tabs)" onRetry={() => book.refetch()} />;
  if (!book.data)
    return (
      <ErrorScreen
        backFallback="/(tabs)"
        title="Libro non trovato"
        message="Questo libro non è più disponibile."
      />
    );
  const b = book.data;
  const ub = userBook.data;
  const mark = collanaMark(b.title);
  const bandInk = onBand(mark.band);
  const isRead = ub?.status === "read";
  const isSaved = ub?.status === "want_to_read";

  async function onReviewLike(reviewId: string) {
    await toggleLike("review", reviewId);
    qc.invalidateQueries({ queryKey: ["book-reviews", id, userId] });
  }

  return (
    <ScreenContainer edges={["top"]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Pressable onPress={() => goBack()} style={styles.back} hitSlop={10}>
          <Text style={styles.backText}>‹ Indietro</Text>
        </Pressable>

        {/* Rubric band. It used to also print "N°<n>" — a number derived from a
            hash of the title, purely decorative, but sitting next to real
            bibliographic data it read as a catalogue number the book doesn't
            have. Shows the language instead, which is genuinely useful here.
            La categoria non compare più accanto a «Tomo»: era la stessa
            classificazione grezza dei chip, e sulla fascia sembrava un dato
            bibliografico verificato che non è. Resta «Tomo» da solo, così la
            fascia conserva la sua ancora a sinistra e la lingua a destra. */}
        <View style={[styles.colBand, { backgroundColor: mark.band }]}>
          <Text style={[styles.colBandText, { color: bandInk }]} numberOfLines={1}>
            Tomo
          </Text>
          {b.language ? (
            <Text style={[styles.colBandText, { color: bandInk }]}>
              {b.language.toUpperCase()}
            </Text>
          ) : null}
        </View>

        <View style={styles.hero}>
          <BookCover url={b.cover_url} title={b.title} width={130} />
          <View style={styles.heroInfo}>
            <Text style={styles.title} numberOfLines={3}>{b.title}</Text>
            <Text style={styles.author} numberOfLines={2}>{b.authors.join(", ")}</Text>
            <View style={styles.ratingRow}>
              <RatingStars value={bookAvgRating(b)} size={16} />
              <Text style={styles.ratingText}>
                {bookAvgRating(b) ? `${bookAvgRating(b)} · ${b.rating_count}` : "Nessuna valutazione"}
              </Text>
            </View>
            {/* Qui stava «Web: 4,2/5 · 1.200 voti», il voto aggregato di Open
                Library. Via per lo stesso motivo delle recensioni esterne: un
                numero preso da internet accanto ai voti dei lettori di Tomo, che
                essendo pochi ne uscivano schiacciati. `external_rating` resta in
                tabella — sei funzioni la usano per ordinare consigli e code — ma
                non si mostra. */}
            {b.published_year ? <Text style={styles.meta}>{b.published_year}</Text> : null}
          </View>
        </View>

        {/* Sinossi. Tre stati, e il terzo è dichiarare che non c'è: una scheda
            vuota è più onesta di una trama inventata. */}
        <View style={styles.synopsis}>
          <Text style={styles.synTitle}>Sinossi</Text>
          {b.synopsis ? (
            <>
              <Text style={styles.description}>{b.synopsis}</Text>
              {b.synopsis_source === "ai" ? (
                // Visibile e in chiaro, non in un tooltip: chi legge deve sapere
                // che questo testo l'ha scritto una macchina.
                <Text style={styles.synFonte}>Sintesi generata automaticamente</Text>
              ) : null}
            </>
          ) : synopsisPending ? (
            <Text style={styles.synAttesa}>Stiamo scrivendo la sinossi…</Text>
          ) : (
            <Text style={styles.synAttesa}>
              Per questo libro non abbiamo ancora abbastanza informazioni per una sinossi.
            </Text>
          )}
        </View>

        {/* Editions of the same work. Search now returns one row per work, so
            this is where the other printings live: tap one to switch to it. */}
        {(editions.data ?? []).length > 1 ? (
          <View style={styles.editions}>
            <Text style={styles.synTitle}>Edizioni ({(editions.data ?? []).length})</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.edList}>
              {(editions.data ?? []).map((e: BookEdition) => (
                <Pressable
                  key={e.id}
                  style={[styles.edItem, e.is_current && styles.edItemOn]}
                  onPress={() => {
                    if (!e.is_current) router.replace(`/book/${e.id}`);
                  }}
                >
                  <BookCover url={e.cover_url} title={e.title} width={64} />
                  <Text style={styles.edMeta} numberOfLines={1}>
                    {e.language ? e.language.toUpperCase() : "—"}
                    {e.published_year ? ` · ${e.published_year}` : ""}
                  </Text>
                  {e.is_current ? <Text style={styles.edCurrent}>in lettura</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* I chip delle categorie non si mostrano più: `books.categories` resta
            nel modello perché serve a ricerca per genere, pagine genere e
            consigli, ma qui in scheda erano etichette non curate — spesso in
            inglese o duplicate — che rubavano il posto ai dati verificati. */}

        {/* Reading state — the primary taste signal */}
        <View style={styles.shelfBox}>
          <Text style={styles.shelfLabel}>Il tuo scaffale</Text>
          <ShelfControl value={ub?.status} onChange={(s) => mutateShelf({ status: s })} />
        </View>

        {/* Personal rating */}
        <View style={styles.rateBox}>
          <Text style={styles.rateLabel}>La tua valutazione</Text>
          <RatingStars value={ub?.rating ?? null} size={30} onChange={(r) => mutateShelf({ rating: r })} />
        </View>

        {/* Primary actions */}
        <View style={styles.actions}>
          <ActionButton icon="review" label="Recensisci" primary
            onPress={() => router.push(`/compose-review?bookId=${b.id}`)} />
          <ActionButton icon="create" label="Lista"
            onPress={() => router.push(`/add-to-list?bookId=${b.id}`)} />
          <ActionButton icon="heart" label="Like" active={!!ub?.liked}
            onPress={() => mutateShelf({ liked: !ub?.liked })} />
        </View>

        {Platform.OS === "web" ? (
          <Pressable
            style={styles.shareBtn}
            onPress={() =>
              void shareBookCard({
                title: b.title,
                author: b.authors[0],
                rating: ub?.rating,
                status: ub?.status,
              })
            }
          >
            <Text style={styles.shareBtnText}>Condividi ↗</Text>
          </Pressable>
        ) : null}

        {/* Lettura gratuita, quando c'è. Con i link Amazon è caduto anche il
            ramo negativo: il riquadro «Non disponibile gratuitamente» esisteva
            per dare un contesto al pulsante d'acquisto, e da solo sarebbe un
            contenitore che annuncia un'assenza senza offrire un'alternativa —
            su gran parte del catalogo, cioè quasi sempre. Meglio niente che un
            blocco vuoto: qui l'intero contenitore scompare, non solo il
            pulsante. */}
        {readInfo.data?.readable && readInfo.data.gutenberg_id ? (
          <View style={styles.readBox}>
            <Pressable
              style={styles.readBtn}
              onPress={() => {
                void track("read_open", { bookId: id });
                router.push(`/read/${readInfo.data!.gutenberg_id}?bookId=${b.id}`);
              }}
            >
              <Icon name="review" color={colors.onPrimary} size={16} />
              <Text style={styles.readBtnText}>Leggi gratis</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Il blocco «Dalla critica» non c'è più: le voci esterne erano 238
            contro 14 recensioni vere e la scheda finiva per parlare con la voce
            di altri. I dati restano in `external_reviews`, semplicemente non si
            leggono qui. */}

        {/* Semantic neighbours */}
        {(similar.data ?? []).length > 0 ? (
          <View style={styles.similar}>
            <BookRow title="Simili a questo" books={similar.data ?? []} />
          </View>
        ) : null}

        {/* Reviews */}
        <View style={styles.reviewsHeader}>
          <RowHeader title="Recensioni" flush />
        </View>

        {(reviews.data ?? []).length === 0 ? (
          <Text style={styles.noReviews}>Ancora nessuna recensione. Sii il primo.</Text>
        ) : (
          (reviews.data ?? []).map((r: FeedItem) => (
            <ReviewCard
              key={r.review_id}
              authorName={r.author_display_name}
              authorAvatar={r.author_avatar_url}
              createdAt={r.created_at}
              rating={r.rating}
              body={r.body}
              containsSpoilers={r.contains_spoilers}
              likeCount={r.like_count}
              commentCount={r.comment_count}
              likedByViewer={r.viewer_has_liked}
              onPress={() => router.push(`/review/${r.review_id}`)}
              onAuthorPress={() => router.push(`/user/${r.author_username}`)}
              onLike={() => onReviewLike(r.review_id)}
            />
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function ActionButton({
  icon,
  label,
  active = false,
  primary = false,
  onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  primary?: boolean;
  onPress: () => void;
}) {
  const tint = primary ? colors.onPrimary : active ? colors.star : colors.text;
  return (
    <Pressable
      style={[styles.action, primary && styles.actionPrimary, active && styles.actionActive]}
      onPress={onPress}
    >
      <Icon name={icon} color={tint} size={16} filled={active} />
      <Text
        style={[
          styles.actionLabel,
          primary && styles.actionLabelPrimary,
          active && styles.actionLabelActive,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg },
  back: { paddingVertical: spacing.md },
  backText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  colBand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 2,
    borderColor: colors.border,
    marginBottom: spacing.lg,
  },
  colBandText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.6,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  hero: { flexDirection: "row", gap: spacing.lg, marginBottom: spacing.lg },
  heroInfo: { flex: 1, gap: spacing.xs },
  title: {
    fontFamily: displayFont,
    fontSize: 30,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
    lineHeight: 30,
  },
  author: { ...typography.bodyMuted, fontSize: 15, fontStyle: "italic" },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  ratingText: { color: colors.textMuted, fontSize: 13 },
  meta: { color: colors.textFaint, fontSize: 13, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  shareBtn: {
    alignItems: "center",
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  shareBtnText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    gap: 6,
  },
  actionPrimary: { backgroundColor: colors.primary },
  actionActive: { backgroundColor: colors.surfaceAlt },
  actionLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  actionLabelActive: { color: colors.star },
  actionLabelPrimary: { color: colors.onPrimary },
  shelfBox: { gap: spacing.sm, marginBottom: spacing.lg },
  shelfLabel: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  rateBox: {
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    ...hardShadow,
    marginBottom: spacing.lg,
  },
  rateLabel: { ...typography.bodyMuted },
  // Un solo figlio da quando è caduto il pulsante d'acquisto: niente gap.
  readBox: { marginBottom: spacing.lg },
  readBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    ...hardShadow,
  },
  readBtnText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  editions: { marginBottom: spacing.lg },
  edList: { gap: spacing.sm, paddingTop: spacing.sm, paddingRight: spacing.lg },
  edItem: { width: 64, alignItems: "center", opacity: 0.85 },
  edItemOn: { opacity: 1 },
  edMeta: { color: colors.textMuted, fontSize: 10, fontWeight: "700", marginTop: 4 },
  edCurrent: { color: colors.primary, fontSize: 9, fontWeight: "800", textTransform: "uppercase" },
  synopsis: { marginBottom: spacing.lg },
  synFonte: {
    color: colors.textFaint,
    fontSize: 11,
    fontStyle: "italic",
    marginTop: 6,
  },
  synAttesa: { color: colors.textMuted, fontSize: 14, lineHeight: 20, fontStyle: "italic" },
  synTitle: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  description: { ...typography.body, lineHeight: 22 },
  similar: { marginHorizontal: -spacing.lg, marginTop: spacing.lg },
  reviewsHeader: { marginTop: spacing.md },
  noReviews: { ...typography.bodyMuted, marginBottom: spacing.lg },
});
