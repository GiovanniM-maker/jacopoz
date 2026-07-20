import { useRef } from "react";
import { Animated, Pressable, StyleSheet, Text } from "react-native";
import { Icon } from "./ui/Icon";
import { colors } from "@/theme";

// Instagram's like red — a semantic like colour, independent of the theme accent.
const LIKE_RED = "#ED4956";

interface Props {
  liked: boolean;
  count?: number;
  size?: number;
  onPress?: () => void;
}

/** IG-style like: outline heart that fills red with a little pop on tap. */
export function HeartButton({ liked, count, size = 22, onPress }: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  function press() {
    Animated.sequence([
      Animated.spring(scale, { toValue: 1.35, useNativeDriver: true, speed: 60, bounciness: 12 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 20, bounciness: 8 }),
    ]).start();
    onPress?.();
  }

  return (
    <Pressable onPress={press} hitSlop={8} style={styles.row}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Icon name="heart" color={liked ? LIKE_RED : colors.textMuted} filled={liked} size={size} />
      </Animated.View>
      {count != null ? <Text style={styles.count}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
});
