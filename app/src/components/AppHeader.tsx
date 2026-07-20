import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, spacing } from "@/theme";
import { Icon } from "./ui/Icon";
import { Wordmark } from "./Wordmark";

/**
 * The app's top bar: review a book (left), the wordmark (center), search
 * (right). Shown across the main tabs for a consistent Instagram-like chrome.
 */
export function AppHeader() {
  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.side}
        hitSlop={10}
        onPress={() => router.push("/create")}
        accessibilityLabel="Review a book"
      >
        <Icon name="review" color={colors.text} size={24} />
      </Pressable>

      <Wordmark size={22} />

      <Pressable
        style={[styles.side, styles.right]}
        hitSlop={10}
        onPress={() => router.push("/search")}
        accessibilityLabel="Search books"
      >
        <Icon name="search" color={colors.text} size={24} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  side: { width: 44, alignItems: "flex-start", justifyContent: "center" },
  right: { alignItems: "flex-end" },
});
