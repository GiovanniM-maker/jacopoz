import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useIsFree } from "@/lib/freeBooks";
import {
  COVER_ASPECT,
  collanaMark,
  colors,
  displayFont,
  hardShadow,
  onBand,
  radius,
  spacing,
} from "@/theme";

interface Props {
  url?: string | null;
  title: string;
  width: number;
  /** When given, the cover shows a "GRATIS" tag if the book is free to read. */
  bookId?: string | null;
}

/**
 * A book cover rendered as a numbered item in the Tomo "collana":
 *  • real cover art → framed with a hard ink border + offset print shadow;
 *  • no artwork → a generated newsstand poster (coloured spine band + catalogue
 *    number up top, condensed title on the paper plate).
 * Tiny sizes (thumbnails in review rows) drop the banding and stay minimal.
 */
export function BookCover({ url, title, width, bookId }: Props) {
  const height = width / COVER_ASPECT;
  const compact = width < 64;
  const { band, number } = collanaMark(title);

  // A broken/404 cover URL must degrade to the generated poster, not an empty
  // frame. Reset the failed flag whenever the URL changes (list recycling).
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);

  // Half the catalogue is readable free in-app; say so on the artwork. Hidden on
  // thumbnails, where a tag would cover the cover.
  const isFree = useIsFree(bookId);
  const tag =
    isFree && !compact ? (
      <View style={styles.freeTag} pointerEvents="none">
        <Text style={styles.freeTagText}>GRATIS</Text>
      </View>
    ) : null;

  if (url && !failed) {
    return (
      <View style={[styles.frame, compact ? styles.frameThin : hardShadow, { width, height }]}>
        <Image
          source={{ uri: url }}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
        />
        {tag}
      </View>
    );
  }

  if (compact) {
    return (
      <View style={[styles.frame, styles.frameThin, styles.plate, { width, height }]}>
        <Text style={[styles.plateTitle, { fontSize: 9 }]} numberOfLines={3}>
          {title}
        </Text>
      </View>
    );
  }

  const bandText = onBand(band);
  const titleSize = Math.max(11, Math.min(26, width * 0.16));
  return (
    <View style={[styles.frame, hardShadow, { width, height }]}>
      <View style={[styles.band, { backgroundColor: band }]}>
        <Text style={[styles.bandLabel, { color: bandText }]}>TOMO</Text>
        <Text style={[styles.bandLabel, { color: bandText }]}>N°{number}</Text>
      </View>
      <View style={[styles.plate, { flex: 1 }]}>
        <Text style={[styles.plateTitle, { fontSize: titleSize }]} numberOfLines={4}>
          {title}
        </Text>
      </View>
      <View style={[styles.bandBottom, { backgroundColor: band }]} />
      {tag}
    </View>
  );
}

const styles = StyleSheet.create({
  freeTag: {
    position: "absolute",
    top: 4,
    left: 4,
    backgroundColor: colors.primary,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  freeTagText: {
    color: colors.onPrimary,
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  frame: {
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.coverPaper,
    overflow: "hidden",
  },
  frameThin: { borderWidth: 1 },
  band: {
    height: 22,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  bandBottom: {
    height: 12,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  bandLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  plate: {
    backgroundColor: colors.coverPaper,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.sm,
  },
  plateTitle: {
    color: colors.coverInk,
    fontFamily: displayFont,
    fontWeight: "900",
    textTransform: "uppercase",
    textAlign: "center",
    lineHeight: undefined,
  },
});
