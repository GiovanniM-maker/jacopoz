import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { collanaMark, colors, displayFont, hardShadow, onBand, radius } from "@/theme";

interface Props {
  url?: string | null;
  name: string;
  size?: number;
  /** Adds the hard "printed" offset shadow — used for the profile hero tessera. */
  ring?: boolean;
}

/**
 * A reader's avatar as a collana "tessera": a hard-bordered square. Real
 * photos are framed; the fallback is a spine-coloured tile with the reader's
 * condensed initials (colour derived deterministically from their name).
 */
export function Avatar({ url, name, size = 40, ring }: Props) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const { band } = collanaMark(name);
  const border = Math.max(2, Math.round(size * 0.05));
  const box = [
    styles.box,
    { width: size, height: size, borderRadius: radius.sm, borderWidth: border },
    ring ? hardShadow : null,
  ];

  if (url) {
    return (
      <View style={box}>
        <Image
          source={{ uri: url }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
        />
      </View>
    );
  }

  return (
    <View style={[box, { backgroundColor: band, alignItems: "center", justifyContent: "center" }]}>
      <Text
        style={{ color: onBand(band), fontFamily: displayFont, fontSize: size * 0.5, fontWeight: "900" }}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderColor: colors.border, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
});
