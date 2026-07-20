import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont, spacing } from "@/theme";

/**
 * A collana "rubric" header: an orange square marker, the section title in
 * condensed display, and a hard rule running to the edge — the same editorial
 * device used across the app's mastheads, so rows read as sections of the
 * periodical rather than free-floating carousels.
 */
export function RowHeader({ title }: { title: string }) {
  return (
    <View style={styles.wrap}>
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
  marker: { width: 16, height: 16, backgroundColor: colors.primary },
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
