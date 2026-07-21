import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont, spacing, typography } from "@/theme";
import { Button } from "./Button";

interface Props {
  icon?: string;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}

/**
 * Empty state as a collana device: a dashed "placeholder slot" frame — like
 * the empty position of a numbered series on a shelf — with the icon in a
 * hard-bordered tessera and a condensed title. Gives blank sections relief
 * instead of letting them dissolve into the paper.
 */
export function EmptyState({ icon = "📚", title, message, action }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.frame}>
        <View style={styles.tile}>
          <Text style={styles.icon}>{icon}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {action ? <Button label={action.label} onPress={action.onPress} style={styles.btn} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  frame: {
    alignSelf: "stretch",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.textFaint,
    backgroundColor: colors.surface,
  },
  tile: {
    width: 52,
    height: 52,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  icon: { fontSize: 26 },
  title: {
    fontFamily: displayFont,
    fontSize: 20,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
    textAlign: "center",
  },
  message: { ...typography.bodyMuted, textAlign: "center", maxWidth: 300 },
  btn: { marginTop: spacing.md, minWidth: 200 },
});
