import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

interface Props {
  value: number | null; // 0..5 (or null)
  size?: number;
  onChange?: (rating: number) => void; // interactive when provided
}

/**
 * Rating — read-only display or tappable input. Stars by default; the
 * Rivista family rates with Lucy's diamonds (◆◇) instead.
 */
export function RatingStars({ value, size = 18, onChange }: Props) {
  const rounded = value ? Math.round(value) : 0;
  const [full, empty] = colors.diamonds ? ["◆", "◇"] : ["★", "☆"];
  return (
    <View style={styles.row}>
      {[1, 2, 3, 4, 5].map((i) => {
        const filled = i <= rounded;
        const star = (
          <Text style={{ fontSize: size, color: filled ? colors.star : colors.textFaint }}>
            {filled ? full : empty}
          </Text>
        );
        return onChange ? (
          <Pressable key={i} onPress={() => onChange(i)} hitSlop={6} style={styles.tap}>
            {star}
          </Pressable>
        ) : (
          <View key={i} style={styles.tap}>
            {star}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  tap: { paddingHorizontal: 1 },
});
