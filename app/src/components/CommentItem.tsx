import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CommentWithAuthor } from "@/types/database";
import { colors, spacing } from "@/theme";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./ui/Avatar";

interface Props {
  comment: CommentWithAuthor;
  isReply?: boolean;
  onLike?: () => void;
  onReply?: () => void;
}

/** A single comment or reply in a review thread. */
export function CommentItem({ comment, isReply, onLike, onReply }: Props) {
  return (
    <View style={[styles.row, isReply && styles.reply]}>
      <Avatar url={comment.author.avatar_url} name={comment.author.display_name} size={30} />
      <View style={styles.body}>
        <Text style={styles.author}>
          {comment.author.display_name} <Text style={styles.time}>· {timeAgo(comment.created_at)}</Text>
        </Text>
        <Text style={styles.text}>{comment.body}</Text>
        <View style={styles.actions}>
          <Pressable onPress={onLike} hitSlop={8}>
            <Text style={[styles.action, comment.viewer_has_liked && styles.liked]}>
              {comment.viewer_has_liked ? "❤️" : "🤍"} {comment.like_count}
            </Text>
          </Pressable>
          {!isReply && onReply ? (
            <Pressable onPress={onReply} hitSlop={8}>
              <Text style={styles.action}>Reply{comment.reply_count ? ` (${comment.reply_count})` : ""}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
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
