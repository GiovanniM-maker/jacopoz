import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { colors, MAX_CONTENT, spacing } from "@/theme";

interface Props {
  children?: React.ReactNode;
  padded?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}

/**
 * Faint halftone print dots over the paper — the collana texture. Sits behind
 * all content; surfaces (cards, bands) cover it, so it reads in the gaps.
 */
function Halftone() {
  return (
    <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
      <Defs>
        <Pattern id="halftone" width={6} height={6} patternUnits="userSpaceOnUse">
          <Circle cx={1.2} cy={1.2} r={0.9} fill={colors.text} opacity={colors.isDark ? 0.07 : 0.05} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#halftone)" />
    </Svg>
  );
}

/** Safe-area page wrapper; themes with `texture` get the halftone dots. */
export function ScreenContainer({ children, padded, edges = ["top"], style }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      {colors.texture ? <Halftone /> : null}
      <View style={[styles.inner, padded && { paddingHorizontal: spacing.lg }, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  // Centred, width-capped column so tablets/desktop don't stretch content.
  inner: { flex: 1, width: "100%", maxWidth: MAX_CONTENT, alignSelf: "center" },
});
