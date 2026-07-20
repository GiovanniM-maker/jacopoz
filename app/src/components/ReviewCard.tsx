import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "@/theme";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./ui/Avatar";
import { BookCover } from "./BookCover";
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

/** A community review, used both in the feed and on the book page. */
export function ReviewCard(props: ReviewCardProps) {
  const [revealed, setRevealed] = useState(false);
  const hideBody = props.containsSpoilers && !revealed;

  return (
    <Pressable style={styles.card} onPress={props.onPress}>
      <View style={styles.headerRow}>
        <Pressable
          style={styles.authorBlock}
          onPress={props.onAuthorPress}
          disabled={!props.onAuthorPress}
        >
          <Avatar url={props.authorAvatar} name={props.authorName} size={36} />
          <View style={styles.headerText}>
            <Text style={styles.author}>{props.authorName}</Text>
            <Text style={styles.time}>{timeAgo(props.createdAt)}</Text>
          </View>
        </Pressable>
        {props.rating != null ? <RatingStars value={props.rating} size={15} /> : null}
      </View>

      {props.bookTitle ? (
        <Pressable style={styles.bookRow} onPress={props.onBookPress}>
          <BookCover url={props.bookCover} title={props.bookTitle} width={36} />
          <Text style={styles.bookTitle} numberOfLines={2}>
            {props.bookTitle}
          </Text>
        </Pressable>
      ) : null}

      {hideBody ? (
        <Pressable onPress={() => setRevealed(true)} style={styles.spoiler}>
          <Text style={styles.spoilerText}>⚠️ Contains spoilers — tap to reveal</Text>
        </Pressable>
      ) : (
        <Text style={styles.body} numberOfLines={props.onPress ? 6 : undefined}>
          {props.body}
        </Text>
      )}

      <View style={styles.actions}>
        <Pressable onPress={props.onLike} hitSlop={8} style={styles.action}>
          <Text style={[styles.actionText, props.likedByViewer && styles.liked]}>
            {props.likedByViewer ? "❤️" : "🤍"} {props.likeCount}
          </Text>
        </Pressable>
        <View style={styles.action}>
          <Text style={styles.actionText}>💬 {props.commentCount}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  authorBlock: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  headerText: { flex: 1 },
  author: { color: colors.text, fontSize: 15, fontWeight: "700" },
  time: { color: colors.textFaint, fontSize: 12 },
  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  bookTitle: { color: colors.textMuted, fontSize: 13, fontWeight: "600", flex: 1 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21, marginTop: spacing.md },
  spoiler: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  spoilerText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.xl, marginTop: spacing.md },
  action: { flexDirection: "row", alignItems: "center" },
  actionText: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  liked: { color: colors.text },
});
