import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@/theme";
import { Button } from "./Button";

interface Props {
  icon?: string;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}

/** Friendly empty state. Empty states matter a lot at cold-start. */
export function EmptyState({ icon = "📚", title, message, action }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>{icon}</Text>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <Button label={action.label} onPress={action.onPress} style={styles.btn} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.sm },
  icon: { fontSize: 44, marginBottom: spacing.sm },
  title: { ...typography.h3, textAlign: "center" },
  message: { ...typography.bodyMuted, textAlign: "center", maxWidth: 300 },
  btn: { marginTop: spacing.md, minWidth: 200 },
});
