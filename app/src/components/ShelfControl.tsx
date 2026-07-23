import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import type { ShelfStatus } from "@/types/database";

export const SHELF_LABELS: Record<ShelfStatus, string> = {
  want_to_read: "Voglio leggere",
  reading: "Sto leggendo",
  read: "Letto",
  dnf: "Non finito",
};

// Order shown to the user — the natural reading lifecycle, DNF last.
const ORDER: ShelfStatus[] = ["want_to_read", "reading", "read", "dnf"];

/**
 * Goodreads-style shelf picker: one tap sets the reading state, tapping the
 * active one clears it. This is the app's primary taste signal — every choice
 * feeds the recommender (want=2 … reading=5 … read=6-8, dnf=1).
 */
export function ShelfControl({
  value,
  onChange,
}: {
  value: ShelfStatus | null | undefined;
  onChange: (next: ShelfStatus | null) => void;
}) {
  return (
    <View style={styles.row}>
      {ORDER.map((s) => {
        const active = value === s;
        return (
          <Pressable
            key={s}
            style={[styles.seg, active && styles.segOn]}
            onPress={() => onChange(active ? null : s)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelOn]} numberOfLines={2}>
              {SHELF_LABELS[s]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  seg: {
    flexGrow: 1,
    flexBasis: "22%",
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
    minHeight: 52,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
  },
  segOn: { backgroundColor: colors.primary },
  label: {
    color: colors.text,
    fontSize: 10.5,
    lineHeight: 13,
    fontWeight: "800",
    letterSpacing: 0.2,
    textTransform: "uppercase",
    textAlign: "center",
  },
  labelOn: { color: colors.onPrimary },
});
