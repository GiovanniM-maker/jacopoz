import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

interface Props {
  url?: string | null;
  name: string;
  size?: number;
}

/** User avatar with initials fallback. */
export function Avatar({ url, name, size = 40 }: Props) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      style={[styles.fallback, { width: size, height: size, borderRadius: size / 2 }]}
    >
      <Text style={{ color: colors.text, fontSize: size * 0.4, fontWeight: "700" }}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { backgroundColor: colors.surfaceAlt, alignItems: "center", justifyContent: "center" },
});
