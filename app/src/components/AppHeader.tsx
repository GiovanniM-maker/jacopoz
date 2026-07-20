import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { colors, spacing } from "@/theme";
import { Icon } from "./ui/Icon";
import { Wordmark } from "./Wordmark";

/**
 * The app's top bar as a collana masthead: a review icon (left) and a search
 * icon (right), each in a hard-bordered square tile, flanking the TOMO
 * wordmark over a hard rule.
 */
export function AppHeader() {
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

      <Pressable
        style={styles.tile}
        hitSlop={8}
        onPress={() => router.push("/search")}
        accessibilityLabel="Cerca"
      >
        <Icon name="search" color={colors.text} size={22} />
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
    height: 56,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
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
});
