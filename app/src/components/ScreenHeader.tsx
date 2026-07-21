import { Pressable, StyleSheet, Text, View } from "react-native";
import { goBack } from "@/lib/nav";
import { colors, displayFont, spacing } from "@/theme";
import { Icon, type IconName } from "./ui/Icon";

interface Props {
  title?: string;
  /** Where to land if there is no history to go back to (default: tabs home). */
  backFallback?: string;
  /** Optional right-side action: an icon tile or free element. */
  rightIcon?: IconName;
  rightColor?: string;
  onRightPress?: () => void;
  right?: React.ReactNode;
}

/**
 * Standard sub-page chrome: a hard-ruled masthead with the back icon in a
 * bordered tile (robust to empty history — see goBack), a condensed uppercase
 * title, and an optional right action.
 */
export function ScreenHeader({ title, backFallback, rightIcon, rightColor, onRightPress, right }: Props) {
  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.tile}
        hitSlop={8}
        onPress={() => goBack(backFallback)}
        accessibilityLabel="Indietro"
      >
        <Icon name="back" color={colors.text} size={20} />
      </Pressable>

      <Text style={styles.title} numberOfLines={1}>
        {title ?? ""}
      </Text>

      {right ? (
        right
      ) : rightIcon && onRightPress ? (
        <Pressable style={styles.tile} hitSlop={8} onPress={onRightPress}>
          <Icon name={rightIcon} color={rightColor ?? colors.text} size={20} />
        </Pressable>
      ) : (
        <View style={styles.tileGhost} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
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
  tileGhost: { width: 40, height: 36 },
  title: {
    flex: 1,
    textAlign: "center",
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 18,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});
