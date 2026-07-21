import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, hardShadow, spacing } from "@/theme";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./ui/Avatar";
import { BookCover } from "./BookCover";
import { HeartButton } from "./HeartButton";
import { Icon } from "./ui/Icon";
import { RatingStars } from "./ui/RatingStars";

export interface ReviewCardProps {
  authorName: string;
  authorAvatar?: string | null;
  createdAt: string;
  rating: number | null;
  body: string;
  containsSpoilers?: boolean;
  likeCount: number;
  commentCount: number;
  likedByViewer?: boolean;
  bookTitle?: string;
  bookCover?: string | null;
  onPress?: () => void;
  onLike?: () => void;
  onBookPress?: () => void;
  onAuthorPress?: () => void;
}

/**
 * A community review as a press clipping: a hard-bordered card with the
 * offset print shadow. Header band (author tessera + name + time + stars),
 * an optional book strip, the typeset body, and a ruled footer with actions.
 */
export function ReviewCard(props: ReviewCardProps) {
  const [revealed, setRevealed] = useState(false);
  const hideBody = props.containsSpoilers && !revealed;

  return (
    <Pressable style={[styles.card, hardShadow]} onPress={props.onPress}>
      {/* Header band */}
      <View style={styles.head}>
        <Pressable
          style={styles.authorBlock}
          onPress={props.onAuthorPress}
          disabled={!props.onAuthorPress}
        >
          <Avatar url={props.authorAvatar} name={props.authorName} size={34} />
          <View style={styles.headText}>
            <Text style={styles.author} numberOfLines={1}>
              {props.authorName}
            </Text>
            <Text style={styles.time}>{timeAgo(props.createdAt)}</Text>
          </View>
        </Pressable>
        {props.rating != null ? <RatingStars value={props.rating} size={14} /> : null}
      </View>

      {/* Book strip */}
      {props.bookTitle ? (
        <Pressable style={styles.bookStrip} onPress={props.onBookPress} disabled={!props.onBookPress}>
          <BookCover url={props.bookCover} title={props.bookTitle} width={26} />
          <Text style={styles.bookTitle} numberOfLines={1}>
            {props.bookTitle}
          </Text>
          <Text style={styles.bookChev}>›</Text>
        </Pressable>
      ) : null}

      {/* Body */}
      {hideBody ? (
        <Pressable onPress={() => setRevealed(true)} style={styles.spoiler}>
          <Text style={styles.spoilerText}>⚠ Contiene spoiler — tocca per leggere</Text>
        </Pressable>
      ) : (
        <Text style={styles.body} numberOfLines={props.onPress ? 6 : undefined}>
          {props.body}
        </Text>
      )}

      {/* Footer rule + actions */}
      <View style={styles.footer}>
        <HeartButton liked={!!props.likedByViewer} count={props.likeCount} onPress={props.onLike} />
        <View style={styles.action}>
          <Icon name="community" color={colors.textMuted} size={17} />
          <Text style={styles.actionText}>{props.commentCount}</Text>
        </View>
        {props.onPress ? <Text style={styles.readMore}>Leggi ▸</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: spacing.lg,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  authorBlock: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  headText: { flex: 1 },
  author: {
    color: colors.text,
    fontFamily: displayFont,
    fontSize: 15,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  time: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginTop: 1,
  },
  bookStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.textFaint,
    borderStyle: "dashed",
  },
  bookTitle: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  bookChev: { color: colors.textFaint, fontSize: 16 },
  body: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  spoiler: {
    margin: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.textFaint,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
  },
  spoilerText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 2,
    borderTopColor: colors.border,
  },
  action: { flexDirection: "row", alignItems: "center", gap: 6 },
  actionText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  readMore: {
    marginLeft: "auto",
    color: colors.primary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
