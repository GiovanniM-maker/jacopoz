import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "@/theme";
import { Wordmark } from "./Wordmark";

/**
 * The app's top bar as a collana masthead: bordered "RECENSISCI" (left) and
 * "CERCA" (right) buttons flanking the TOMO wordmark, over a hard rule.
 */
export function AppHeader() {
  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.btn}
        hitSlop={8}
        onPress={() => router.push("/create")}
        accessibilityLabel="Recensisci un libro"
      >
        <Text style={styles.btnLabel}>Recensisci</Text>
      </Pressable>

      <Wordmark size={24} />

      <Pressable
        style={styles.btn}
        hitSlop={8}
        onPress={() => router.push("/search")}
        accessibilityLabel="Cerca"
      >
        <Text style={styles.btnLabel}>Cerca</Text>
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
  btn: {
    borderWidth: 2,
    borderColor: colors.border,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
  },
  btnLabel: {
    color: colors.text,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
});
