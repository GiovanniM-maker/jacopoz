import { Pressable, StyleSheet, Text, View } from "react-native";
import type { CommentWithAuthor } from "@/types/database";
import { colors, spacing } from "@/theme";
import { timeAgo } from "@/lib/format";
import { Avatar } from "./ui/Avatar";
import { HeartButton } from "./HeartButton";
import { Icon } from "./ui/Icon";

interface Props {
  comment: CommentWithAuthor;
  isReply?: boolean;
  saved?: boolean;
  onLike?: () => void;
  onReply?: () => void;
  onSave?: () => void;
  onPress?: () => void;
}

/**
 * A comment in a review thread, X-style but in collana clothing: tessera
 * avatar, bold author + uppercase timestamp, and micro-actions. Replies are
 * indented behind a dashed thread rule.
 */
export function CommentItem({ comment, isReply, saved, onLike, onReply, onSave, onPress }: Props) {
  return (
    <Pressable style={[styles.row, isReply && styles.reply]} onPress={onPress} disabled={!onPress}>
      <Avatar url={comment.author.avatar_url} name={comment.author.display_name} size={30} />
      <View style={styles.body}>
        <View style={styles.head}>
          <Text style={styles.author} numberOfLines={1}>
            {comment.author.display_name}
          </Text>
          <Text style={styles.time}>{timeAgo(comment.created_at)}</Text>
        </View>
        <Text style={styles.text}>{comment.body}</Text>
        <View style={styles.actions}>
          <HeartButton
            liked={!!comment.viewer_has_liked}
            count={comment.like_count}
            size={17}
            onPress={onLike}
          />
          {!isReply && onReply ? (
            <Pressable onPress={onReply} hitSlop={8}>
              <Text style={styles.action}>
                Rispondi{comment.reply_count ? ` (${comment.reply_count})` : ""}
              </Text>
            </Pressable>
          ) : null}
          {onSave ? (
            <Pressable onPress={onSave} hitSlop={8} style={styles.saveBtn}>
              <Icon name="bookmark" color={saved ? colors.primary : colors.textMuted} size={15} filled={saved} />
              <Text style={[styles.action, saved && styles.savedOn]}>
                {saved ? "Salvato" : "Salva"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.textFaint,
    borderStyle: "dashed",
  },
  reply: {
    paddingLeft: spacing.xl,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    marginLeft: spacing.md,
  },
  body: { flex: 1, gap: 2 },
  head: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  author: { color: colors.text, fontSize: 14, fontWeight: "800", flexShrink: 1 },
  time: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.xs },
  action: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  saveBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  savedOn: { color: colors.primary },
});
