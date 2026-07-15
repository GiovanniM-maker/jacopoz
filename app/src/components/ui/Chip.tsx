import { Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing } from "@/theme";

interface Props {
  label: string;
  selected?: boolean;
  onPress?: () => void;
}

/** Pill chip — used for genres in onboarding and category tags. */
export function Chip({ label, selected, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.chip, selected && styles.selected]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.primary, borderColor: colors.primary },
  label: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  selectedLabel: { color: "#fff" },
});
