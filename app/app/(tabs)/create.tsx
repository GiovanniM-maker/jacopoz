import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getReviewedBookIds } from "@/api/reviews";
import { getBooksInUserLists } from "@/api/lists";
import { getShelfBooks } from "@/api/shelves";
import { BookCard } from "@/components/BookCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { contentWidth, colors, radius, spacing, typography } from "@/theme";
import type { BookCard as BookCardType } from "@/types/database";
import { FlatList } from "react-native";

const CARD_W = (contentWidth() - spacing.lg * 2 - spacing.md * 2) / 3;

/**
 * "Create a review" hub. Proposes books the user already cares about —
 * liked or saved into a list — but hasn't reviewed yet. Tapping one jumps
 * straight to the review composer.
 */
export default function Create() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const candidates = useQuery({
    queryKey: ["review-candidates", userId],
    queryFn: async (): Promise<BookCardType[]> => {
      const [liked, inLists, reviewed] = await Promise.all([
        getShelfBooks(userId!, { liked: true }),
        getBooksInUserLists(userId!),
        getReviewedBookIds(userId!),
      ]);
      const seen = new Set<string>();
      const out: BookCardType[] = [];
      for (const b of [...liked, ...inLists]) {
        if (seen.has(b.id) || reviewed.has(b.id)) continue;
        seen.add(b.id);
        out.push(b);
      }
      return out;
    },
    enabled: !!userId,
  });

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Recensisci" />

      <Pressable style={styles.searchCta} onPress={() => router.push("/search")}>
        <Icon name="search" color={colors.text} size={20} />
        <Text style={styles.searchLabel}>Cerca un altro libro da recensire…</Text>
      </Pressable>

      <Text style={styles.hint}>Da recensire — libri che ami o hai salvato in lista</Text>

      <FlatList
        data={candidates.data ?? []}
        keyExtractor={(b) => b.id}
        numColumns={3}
        columnWrapperStyle={styles.col}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          !candidates.isLoading ? (
            <View style={{ height: 260 }}>
              <EmptyState
                icon="✍️"
                title="Niente da recensire"
                message="Metti like o salva libri in una lista: appariranno qui, pronti da recensire."
                action={{ label: "Cerca libri", onPress: () => router.push("/search") }}
              />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push(`/compose-review?bookId=${item.id}`)}>
            <BookCard book={item} width={CARD_W} showMeta />
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  searchCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  searchLabel: { color: colors.textMuted, fontSize: 15 },
  hint: { ...typography.caption, paddingHorizontal: spacing.lg, marginBottom: spacing.md },
  grid: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, flexGrow: 1 },
  col: { gap: spacing.md, marginBottom: spacing.lg },
});
