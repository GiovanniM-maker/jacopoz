import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont } from "@/theme";

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
            letterSpacing: size * 0.01,
            fontFamily: displayFont,
            // Cheap-print "out of register": a colour ghost offset behind.
            textShadowColor: colors.wordmarkGhost,
            textShadowOffset: { width: size * 0.06, height: size * 0.06 },
            textShadowRadius: 0,
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
    // Slightly tall, condensed proportions like a paperback masthead.
    transform: [{ scaleY: 1.14 }],
    includeFontPadding: false,
  },
});
