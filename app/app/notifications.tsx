import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { getNotifications, markNotificationsRead, type AppNotification } from "@/api/notifications";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { timeAgo } from "@/lib/format";
import { enablePush, pushState, type PushState } from "@/lib/push";
import { colors, spacing } from "@/theme";

/**
 * The "return" inbox: who liked, commented, or followed you. Opening the
 * screen marks everything read (clears the header badge) but keeps unread
 * rows visually flagged so nothing gets lost on this first read.
 */
export default function Notifications() {
  const qc = useQueryClient();
  const notifs = useQuery({ queryKey: ["notifications"], queryFn: () => getNotifications(60) });
  const [push, setPush] = useState<PushState>("unsupported");

  useEffect(() => {
    // Clear the badge as soon as the inbox is opened.
    void markNotificationsRead().then(() => {
      qc.setQueryData(["unread-count"], 0);
    });
    setPush(pushState());
  }, [qc]);

  async function onEnablePush() {
    const r = await enablePush();
    setPush(r);
  }

  const items = notifs.data ?? [];
  const showPushPrompt = push === "default";

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Notifiche" backFallback="/(tabs)" />
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {showPushPrompt ? (
          <Pressable style={styles.pushCard} onPress={onEnablePush}>
            <View style={styles.pushIcon}>
              <Icon name="bell" color={colors.onPrimary} size={20} />
            </View>
            <View style={styles.pushText}>
              <Text style={styles.pushTitle}>Attiva le notifiche</Text>
              <Text style={styles.pushSub}>
                Ricevi un avviso sul telefono quando qualcuno mette like, commenta o ti segue.
              </Text>
            </View>
          </Pressable>
        ) : null}
        {items.length === 0 && !notifs.isLoading ? (
          <View style={styles.empty}>
            <EmptyState
              icon="🔔"
              title="Ancora nessuna notifica"
              message="Quando qualcuno mette like, commenta o ti segue, lo vedrai qui."
            />
          </View>
        ) : (
          items.map((n: AppNotification) => <NotificationRow key={n.id} n={n} />)
        )}
        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function NotificationRow({ n }: { n: AppNotification }) {
  const name = n.actor?.display_name ?? "Qualcuno";
  const username = n.actor?.username;
  const bookTitle = n.review?.book?.title;

  function verb(): string {
    if (n.type === "follow") return "ha iniziato a seguirti";
    if (n.type === "comment")
      return bookTitle ? `ha commentato la tua recensione di “${bookTitle}”` : "ha commentato la tua recensione";
    return bookTitle ? `ha messo like alla tua recensione di “${bookTitle}”` : "ha messo like alla tua recensione";
  }

  function onPress() {
    if (n.type === "follow") {
      if (username) router.push(`/user/${username}`);
    } else if (n.review?.id) {
      router.push(`/review/${n.review.id}`);
    }
  }

  return (
    <Pressable style={[styles.row, !n.read && styles.rowUnread]} onPress={onPress}>
      {!n.read && <View style={styles.dot} />}
      <Avatar url={n.actor?.avatar_url} name={name} size={44} />
      <View style={styles.rowText}>
        <Text style={styles.msg}>
          <Text style={styles.name}>{name}</Text> {verb()}
        </Text>
        <Text style={styles.time}>{timeAgo(n.created_at)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, flexGrow: 1 },
  empty: { height: 320 },
  pushCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  pushIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  pushText: { flex: 1 },
  pushTitle: { fontSize: 15, fontWeight: "800", color: colors.text },
  pushSub: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: 2 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  rowUnread: { borderColor: colors.primary },
  dot: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  rowText: { flex: 1, gap: 2 },
  msg: { color: colors.text, fontSize: 14, lineHeight: 19 },
  name: { fontWeight: "800", color: colors.text },
  time: { color: colors.textFaint, fontSize: 12, fontWeight: "500" },
});
