import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";
import { COVER_ASPECT, colors, radius, spacing } from "@/theme";

interface Props {
  url?: string | null;
  title: string;
  width: number;
}

/** Book cover with a graceful title placeholder when no image exists. */
export function BookCover({ url, title, width }: Props) {
  const height = width / COVER_ASPECT;
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={[styles.cover, { width, height }]}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View style={[styles.cover, styles.placeholder, { width, height }]}>
      <Text style={styles.placeholderText} numberOfLines={4}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  placeholder: { alignItems: "center", justifyContent: "center", padding: spacing.sm },
  placeholderText: { color: colors.textMuted, fontSize: 13, fontWeight: "600", textAlign: "center" },
});
