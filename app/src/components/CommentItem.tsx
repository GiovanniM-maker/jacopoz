import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CommentWithAuthor } from "@/types/database";
import { colors, spacing } from "@/theme";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./ui/Avatar";
import { HeartButton } from "./HeartButton";

interface Props {
  comment: CommentWithAuthor;
  isReply?: boolean;
  saved?: boolean;
  onLike?: () => void;
  onReply?: () => void;
  onSave?: () => void;
  onPress?: () => void;
}

/** A single comment or reply in a review thread. */
export function CommentItem({ comment, isReply, saved, onLike, onReply, onSave, onPress }: Props) {
  return (
    <Pressable style={[styles.row, isReply && styles.reply]} onPress={onPress} disabled={!onPress}>
      <Avatar url={comment.author.avatar_url} name={comment.author.display_name} size={30} />
      <View style={styles.body}>
        <Text style={styles.author}>
          {comment.author.display_name} <Text style={styles.time}>· {timeAgo(comment.created_at)}</Text>
        </Text>
        <Text style={styles.text}>{comment.body}</Text>
        <View style={styles.actions}>
          <HeartButton
            liked={!!comment.viewer_has_liked}
            count={comment.like_count}
            size={18}
            onPress={onLike}
          />
          {!isReply && onReply ? (
            <Pressable onPress={onReply} hitSlop={8}>
              <Text style={styles.action}>Reply{comment.reply_count ? ` (${comment.reply_count})` : ""}</Text>
            </Pressable>
          ) : null}
          {onSave ? (
            <Pressable onPress={onSave} hitSlop={8}>
              <Text style={[styles.action, saved && styles.liked]}>{saved ? "🔖 Saved" : "🔖 Save"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.md },
  reply: { paddingLeft: spacing.xl },
  body: { flex: 1, gap: 2 },
  author: { color: colors.text, fontSize: 14, fontWeight: "700" },
  time: { color: colors.textFaint, fontSize: 12, fontWeight: "400" },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.xs },
  action: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  liked: { color: colors.text },
});
