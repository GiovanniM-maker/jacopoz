import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont } from "@/theme";

interface Props {
  size?: number;
}

/**
 * The wordmark, per family:
 *  • Collana — tall condensed uppercase "TOMO" in the primary colour with an
 *    out-of-register colour ghost (cheap-print charm);
 *  • Rivista — a quiet serif "Tomo" in ink, like a magazine masthead.
 * No custom fonts are bundled; both lean on system stacks.
 */
export function Wordmark({ size = 34 }: Props) {
  if (colors.serifLogo) {
    return (
      <View style={styles.wrap}>
        <Text style={[styles.serif, { fontSize: size * 1.05 }]}>Tomo</Text>
      </View>
    );
  }
  return (
    <View style={styles.wrap}>
      <Text
        style={[
          styles.poster,
          {
            fontSize: size,
            letterSpacing: size * 0.01,
            fontFamily: displayFont,
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
  poster: {
    color: colors.primary,
    fontWeight: "900",
    textTransform: "uppercase",
    // Slightly tall, condensed proportions like a paperback masthead.
    transform: [{ scaleY: 1.14 }],
    includeFontPadding: false,
  },
  serif: {
    color: colors.text,
    fontFamily: displayFont,
    fontWeight: "400",
    letterSpacing: -0.5,
    includeFontPadding: false,
  },
});
