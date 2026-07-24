import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getSuggestedReaders } from "@/api/profile";
import { FollowButton } from "@/components/FollowButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { inviteFriend } from "@/lib/invite";
import { colors, displayFont, spacing } from "@/theme";
import type { Profile } from "@/types/database";

/**
 * "Trova lettori" — the growth surface. An invite card (native share sheet on
 * web) sits above suggested active readers, each with an inline follow. The
 * two halves of the loop in one screen: bring friends in, follow the ones
 * already here.
 */
export default function FindFriends() {
  const [toast, setToast] = useState<string | null>(null);
  const suggested = useQuery({ queryKey: ["suggested-readers"], queryFn: () => getSuggestedReaders(20) });

  async function onInvite() {
    const r = await inviteFriend();
    if (r === "copied") flash("Link copiato — incollalo dove vuoi");
    else if (r === "failed") flash("Condivisione non disponibile qui");
  }

  function flash(m: string) {
    setToast(m);
    setTimeout(() => setToast(null), 2200);
  }

  const readers = suggested.data ?? [];

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Trova lettori" backFallback="/(tabs)/profile" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.invite} onPress={onInvite}>
          <View style={styles.inviteIcon}>
            <Icon name="community" color={colors.onPrimary} size={22} />
          </View>
          <View style={styles.inviteText}>
            <Text style={styles.inviteTitle}>Invita un amico</Text>
            <Text style={styles.inviteSub}>Tomo è più bello letto insieme. Manda un invito.</Text>
          </View>
        </Pressable>

        <Pressable style={styles.searchRow} onPress={() => router.push("/(tabs)/search")}>
          <Icon name="search" color={colors.textMuted} size={18} />
          <Text style={styles.searchLabel}>Cerca un lettore per nome</Text>
        </Pressable>

        <Text style={styles.sectionLabel}>Lettori da seguire</Text>

        {readers.length === 0 && !suggested.isLoading ? (
          <View style={styles.empty}>
            <EmptyState
              icon="👋"
              title="Sei tra i primi"
              message="Non ci sono ancora altri lettori da suggerire. Invita qualcuno e inizia la collana insieme."
            />
          </View>
        ) : (
          readers.map((p: Profile) => (
            <View key={p.id} style={styles.row}>
              <Pressable style={styles.rowMain} onPress={() => router.push(`/user/${p.username}`)}>
                <Avatar url={p.avatar_url} name={p.display_name} size={44} />
                <View style={styles.rowText}>
                  <Text style={styles.name} numberOfLines={1}>
                    {p.display_name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    @{p.username}
                    {p.books_read_count > 0 ? ` · ${p.books_read_count} libri letti` : ""}
                  </Text>
                </View>
              </Pressable>
              <FollowButton targetId={p.id} />
            </View>
          ))
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>

      {toast ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, flexGrow: 1 },
  invite: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  inviteIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  inviteText: { flex: 1 },
  inviteTitle: { fontFamily: displayFont, fontSize: 18, fontWeight: "900", color: colors.text },
  inviteSub: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: "dashed",
  },
  searchLabel: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  empty: { height: 300 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md },
  rowText: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: "700" },
  meta: { color: colors.textFaint, fontSize: 12, marginTop: 1 },
  toast: {
    position: "absolute",
    bottom: spacing.xl,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.text,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 8,
    alignItems: "center",
  },
  toastText: { color: colors.bg, fontSize: 14, fontWeight: "700" },
});
