import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

interface Props {
  url?: string | null;
  name: string;
  size?: number;
  /** Instagram-style gradient ring around the avatar. */
  ring?: boolean;
}

// Instagram's story-ring gradient.
const RING = ["#FEDA75", "#FA7E1E", "#D62976", "#962FBF", "#4F5BD5"] as const;

/** User avatar with initials fallback and an optional IG gradient ring. */
export function Avatar({ url, name, size = 40, ring }: Props) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const inner = url ? (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      contentFit="cover"
      transition={150}
    />
  ) : (
    <View style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={{ color: colors.text, fontSize: size * 0.4, fontWeight: "700" }}>{initials}</Text>
    </View>
  );

  if (!ring) return inner;

  const outer = size + 8;
  return (
    <LinearGradient
      colors={RING}
      start={{ x: 0, y: 1 }}
      end={{ x: 1, y: 0 }}
      style={{ width: outer, height: outer, borderRadius: outer / 2, alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ backgroundColor: colors.bg, borderRadius: (size + 4) / 2, padding: 2 }}>
        {inner}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
});
