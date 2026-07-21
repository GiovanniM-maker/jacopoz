import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  deleteList,
  followList,
  getList,
  getListBooks,
  isFollowingList,
  unfollowList,
} from "@/api/lists";
import { BookCard } from "@/components/BookCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { goBack } from "@/lib/nav";
import { useAuth } from "@/store/auth";
import { colors, displayFont, spacing, typography } from "@/theme";
import type { BookCard as BookCardType } from "@/types/database";

const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

export default function ListDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const qc = useQueryClient();

  const list = useQuery({ queryKey: ["list", id], queryFn: () => getList(id!), enabled: !!id });
  const books = useQuery({
    queryKey: ["list-books", id],
    queryFn: () => getListBooks(id!),
    enabled: !!id,
  });

  const isOwner = list.data?.user_id === session?.user.id;
  const userId = session?.user.id;
  const following = useQuery({
    queryKey: ["is-following-list", id, userId],
    queryFn: () => isFollowingList(userId!, id!),
    enabled: !!id && !!userId && !isOwner,
  });

  async function onToggleFollow() {
    if (!userId || !id) return;
    if (following.data) await unfollowList(userId, id);
    else await followList(userId, id);
    qc.invalidateQueries({ queryKey: ["is-following-list", id, userId] });
    qc.invalidateQueries({ queryKey: ["followed-lists", userId] });
    qc.invalidateQueries({ queryKey: ["list", id] });
  }

  function onDelete() {
    if (!id) return;
    Alert.alert("Eliminare la lista?", "L'azione è irreversibile.", [
      { text: "Annulla", style: "cancel" },
      {
        text: "Elimina",
        style: "destructive",
        onPress: async () => {
          await deleteList(id);
          qc.invalidateQueries({ queryKey: ["lists", session?.user.id] });
          goBack("/(tabs)/profile");
        },
      },
    ]);
  }

  if (!list.data) return <ScreenContainer />;
  const l = list.data;

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader
        title="Booklist"
        backFallback="/(tabs)/profile"
        rightIcon={isOwner ? "trash" : undefined}
        rightColor={colors.primary}
        onRightPress={isOwner ? onDelete : undefined}
      />
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.name}>{l.name}</Text>
          {l.description ? <Text style={styles.desc}>{l.description}</Text> : null}
          <Text style={styles.meta}>
            {l.book_count} {l.book_count === 1 ? "libro" : "libri"}
            {l.follower_count > 0 ? ` · ${l.follower_count} follower` : ""}
            {l.is_public ? "" : " · privata"}
          </Text>
          {!isOwner ? (
            <Button
              label={following.data ? "Seguìta" : "Segui lista"}
              variant={following.data ? "secondary" : "primary"}
              onPress={onToggleFollow}
              style={styles.followBtn}
            />
          ) : null}
        </View>

        {(books.data ?? []).length === 0 ? (
          <View style={{ height: 260 }}>
            <EmptyState icon="📄" title="Lista vuota" message="Aggiungi libri da qualsiasi scheda libro." />
          </View>
        ) : (
          <View style={styles.grid}>
            {(books.data ?? []).map((b: BookCardType) => (
              <BookCard key={b.id} book={b} width={CARD_W} showMeta />
            ))}
          </View>
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.xs,
  },
  name: {
    fontFamily: displayFont,
    fontSize: 30,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
  },
  desc: { ...typography.body, color: colors.textMuted },
  meta: { ...typography.caption, marginTop: spacing.xs },
  followBtn: { marginTop: spacing.md, alignSelf: "flex-start", minWidth: 150 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
});
