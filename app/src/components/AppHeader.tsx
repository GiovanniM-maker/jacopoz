import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { getUnreadCount } from "@/api/notifications";
import { colors, spacing } from "@/theme";
import { Icon } from "./ui/Icon";
import { Wordmark } from "./Wordmark";

/**
 * The app's top bar as a collana masthead: a review icon (left) and, on the
 * right, a notifications bell (with unread badge) and a search icon — each in
 * a hard-bordered square tile, flanking the TOMO wordmark over a hard rule.
 */
export function AppHeader() {
  const unread = useQuery({
    queryKey: ["unread-count"],
    queryFn: getUnreadCount,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const count = unread.data ?? 0;

  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.tile}
        hitSlop={8}
        onPress={() => router.push("/create")}
        accessibilityLabel="Recensisci un libro"
      >
        <Icon name="review" color={colors.text} size={22} />
      </Pressable>

      <Wordmark size={24} />

      <View style={styles.right}>
        <Pressable
          style={styles.tile}
          hitSlop={8}
          onPress={() => router.push("/notifications")}
          accessibilityLabel="Notifiche"
        >
          <Icon name="bell" color={colors.text} size={22} />
          {count > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{count > 9 ? "9+" : count}</Text>
            </View>
          )}
        </Pressable>

        <Pressable
          style={styles.tile}
          hitSlop={8}
          onPress={() => router.push("/search")}
          accessibilityLabel="Cerca"
        >
          <Icon name="search" color={colors.text} size={22} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    height: 56,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  tile: {
    width: 40,
    height: 36,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.bg,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: colors.bg,
    fontSize: 10,
    fontWeight: "900",
    lineHeight: 12,
  },
});
