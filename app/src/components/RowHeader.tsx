import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont, spacing } from "@/theme";

/**
 * A collana "rubric" header: an orange square marker, the section title in
 * condensed display, and a hard rule running to the edge — the same editorial
 * device used across the app's mastheads, so rows read as sections of the
 * periodical rather than free-floating carousels.
 */
export function RowHeader({ title, flush }: { title: string; flush?: boolean }) {
  return (
    <View style={[styles.wrap, flush && { paddingHorizontal: 0 }]}>
      <View style={styles.marker} />
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  marker: {
    width: 14,
    height: 14,
    backgroundColor: colors.primary,
    // Rivista rotates the rubric square into Lucy's diamond.
    transform: colors.diamonds ? [{ rotate: "45deg" }] : undefined,
    marginHorizontal: colors.diamonds ? 2 : 0,
  },
  title: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    flexShrink: 1,
  },
  rule: { flex: 1, height: 2, backgroundColor: colors.border, marginLeft: spacing.xs },
});
