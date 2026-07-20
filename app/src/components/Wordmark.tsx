import { Platform, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

interface Props {
  size?: number;
}

/**
 * The "TOMO" wordmark: tall, condensed, uppercase, in the theme's primary
 * colour with a subtle glow. We fake the condensed-tall look with a vertical
 * scale + tight letter spacing so no custom font is bundled.
 */
export function Wordmark({ size = 34 }: Props) {
  return (
    <View style={styles.wrap}>
      <Text
        style={[
          styles.text,
          {
            fontSize: size,
            letterSpacing: -size * 0.02,
            // Netflix letters read tall; condensed stacks approximate it.
            fontFamily: Platform.select({
              web: "'Arial Narrow', 'Helvetica Neue', Impact, sans-serif",
              default: undefined,
            }),
          },
        ]}
      >
        TOMO
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  text: {
    color: colors.primary,
    fontWeight: "900",
    textTransform: "uppercase",
    // Elongate to mimic the Netflix logo's tall proportions.
    transform: [{ scaleY: 1.22 }],
    // Warm red glow for depth.
    textShadowColor: "rgba(229,9,20,0.45)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
    includeFontPadding: false,
  },
});
