import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  addBookToList,
  createList,
  getListIdsContainingBook,
  getUserLists,
  removeBookFromList,
} from "@/api/lists";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";
import type { BookList } from "@/types/database";

export default function AddToList() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const lists = useQuery({
    queryKey: ["lists", userId],
    queryFn: () => getUserLists(userId!),
    enabled: !!userId,
  });
  const contained = useQuery({
    queryKey: ["lists-with-book", userId, bookId],
    queryFn: () => getListIdsContainingBook(userId!, bookId!),
    enabled: !!userId && !!bookId,
  });

  async function toggle(list: BookList, inList: boolean) {
    if (!bookId) return;
    if (inList) await removeBookFromList(list.id, bookId);
    else await addBookToList(list.id, bookId);
    qc.invalidateQueries({ queryKey: ["lists-with-book", userId, bookId] });
    qc.invalidateQueries({ queryKey: ["lists", userId] });
    qc.invalidateQueries({ queryKey: ["list-books", list.id] });
  }

  async function onCreate() {
    if (!userId || newName.trim().length === 0) return;
    setCreating(true);
    const list = await createList(userId, newName.trim());
    if (bookId) await addBookToList(list.id, bookId);
    setNewName("");
    setCreating(false);
    qc.invalidateQueries({ queryKey: ["lists", userId] });
    qc.invalidateQueries({ queryKey: ["lists-with-book", userId, bookId] });
  }

  return (
    <ScreenContainer padded>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.close}>Done</Text>
        </Pressable>
        <Text style={styles.title}>Add to list</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.createRow}>
        <TextInput
          style={styles.input}
          placeholder="New list name…"
          placeholderTextColor={colors.textFaint}
          value={newName}
          onChangeText={setNewName}
        />
        <Button
          label="Create"
          onPress={onCreate}
          loading={creating}
          disabled={newName.trim().length === 0}
          style={styles.createBtn}
        />
      </View>

      {lists.isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }}>
          {(lists.data ?? []).length === 0 ? (
            <Text style={styles.empty}>No lists yet. Create your first above.</Text>
          ) : (
            (lists.data ?? []).map((l: BookList) => {
              const inList = contained.data?.has(l.id) ?? false;
              return (
                <Pressable key={l.id} style={styles.row} onPress={() => toggle(l, inList)}>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName}>{l.name}</Text>
                    <Text style={styles.rowMeta}>
                      {l.book_count} {l.book_count === 1 ? "book" : "books"}
                      {l.is_public ? "" : " · private"}
                    </Text>
                  </View>
                  <View style={[styles.check, inList && styles.checkOn]}>
                    {inList ? <Text style={styles.checkMark}>✓</Text> : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  close: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  title: { ...typography.h3 },
  createRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: 15,
  },
  createBtn: { height: 44, paddingHorizontal: spacing.lg },
  empty: { ...typography.bodyMuted, textAlign: "center", marginTop: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowInfo: { flex: 1 },
  rowName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  rowMeta: { color: colors.textFaint, fontSize: 13, marginTop: 2 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: colors.onPrimary, fontWeight: "800" },
});
