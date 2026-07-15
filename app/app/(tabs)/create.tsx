import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getShelfBooks } from "@/api/shelves";
import { BookCard } from "@/components/BookCard";
import { Icon } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";
import type { BookCard as BookCardType, ShelfStatus } from "@/types/database";

const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

/**
 * Instagram-style "create a post" hub. A post here is a book review, so we
 * help the user pick a book fast — from what they're reading / have read, or
 * via search — then send them to the book page to write it.
 */
export default function Create() {
  const { session } = useAuth();
  const userId = session?.user.id;

  const reading = useQuery({
    queryKey: ["shelf", userId, "reading"],
    queryFn: () => getShelfBooks(userId!, { status: "reading" as ShelfStatus }),
    enabled: !!userId,
  });
  const read = useQuery({
    queryKey: ["shelf", userId, "read"],
    queryFn: () => getShelfBooks(userId!, { status: "read" as ShelfStatus }),
    enabled: !!userId,
  });

  const hasBooks = (reading.data?.length ?? 0) + (read.data?.length ?? 0) > 0;

  return (
    <ScreenContainer edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Create</Text>
        <Text style={styles.subtitle}>Share your take on a book.</Text>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.body}>
        <Pressable style={styles.searchCta} onPress={() => router.push("/search")}>
          <Icon name="search" color={colors.text} size={20} />
          <Text style={styles.searchLabel}>Find a book to review…</Text>
        </Pressable>

        {hasBooks ? (
          <Text style={styles.hint}>…or tap one of yours to review it</Text>
        ) : (
          <Text style={styles.hint}>
            Books you're reading or have read will appear here for quick reviewing.
          </Text>
        )}

        <Section title="Currently reading" books={reading.data ?? []} />
        <Section title="Read" books={read.data ?? []} />
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title, books }: { title: string; books: BookCardType[] }) {
  if (books.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grid}>
        {books.map((b) => (
          <BookCard key={b.id} book={b} width={CARD_W} showMeta />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: 2 },
  title: typography.h1,
  subtitle: typography.bodyMuted,
  body: { paddingHorizontal: spacing.lg },
  searchCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  searchLabel: { color: colors.textMuted, fontSize: 16 },
  hint: { ...typography.caption, marginBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: { ...typography.h3, marginBottom: spacing.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
});
