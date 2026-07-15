import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { addComment, getComments, getReplies } from "@/api/comments";
import { getReview } from "@/api/reviews";
import { toggleLike } from "@/api/social";
import { CommentItem } from "@/components/CommentItem";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, spacing, typography } from "@/theme";
import type { CommentWithAuthor } from "@/types/database";

export default function ReviewThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<CommentWithAuthor | null>(null);
  const [posting, setPosting] = useState(false);

  const review = useQuery({
    queryKey: ["review", id, userId],
    queryFn: () => getReview(id!, userId),
    enabled: !!id,
  });
  const comments = useQuery({
    queryKey: ["comments", id, userId],
    queryFn: () => getComments(id!, userId),
    enabled: !!id,
  });

  async function onReviewLike() {
    if (!id) return;
    await toggleLike("review", id);
    qc.invalidateQueries({ queryKey: ["review", id, userId] });
  }

  async function onCommentLike(commentId: string) {
    await toggleLike("comment", commentId);
    qc.invalidateQueries({ queryKey: ["comments", id, userId] });
  }

  async function onPost() {
    if (!userId || !id || text.trim().length === 0) return;
    setPosting(true);
    await addComment(userId, id, text.trim(), replyTo?.id);
    setText("");
    setReplyTo(null);
    qc.invalidateQueries({ queryKey: ["comments", id, userId] });
    qc.invalidateQueries({ queryKey: ["review", id, userId] });
    setPosting(false);
  }

  const r = review.data;

  return (
    <ScreenContainer edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {r ? (
            <ReviewCard
              authorName={r.author.display_name}
              authorAvatar={r.author.avatar_url}
              createdAt={r.created_at}
              rating={r.rating}
              body={r.body}
              containsSpoilers={r.contains_spoilers}
              likeCount={r.like_count}
              commentCount={r.comment_count}
              likedByViewer={r.viewer_has_liked}
              onLike={onReviewLike}
            />
          ) : null}

          <Text style={styles.commentsTitle}>Comments</Text>
          {(comments.data ?? []).map((c: CommentWithAuthor) => (
            <View key={c.id}>
              <CommentItem
                comment={c}
                onLike={() => onCommentLike(c.id)}
                onReply={() => setReplyTo(c)}
              />
              {c.reply_count > 0 ? (
                <ReplyList parentId={c.id} viewerId={userId} onLike={onCommentLike} />
              ) : null}
            </View>
          ))}
          {(comments.data ?? []).length === 0 ? (
            <Text style={styles.noComments}>No comments yet. Start the conversation.</Text>
          ) : null}
          <View style={{ height: spacing.xl }} />
        </ScrollView>

        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replyBanner}>
              <Text style={styles.replyText}>Replying to {replyTo.author.display_name}</Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <Text style={styles.replyCancel}>✕</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
              placeholderTextColor={colors.textFaint}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable
              onPress={onPost}
              disabled={posting || text.trim().length === 0}
              style={styles.send}
            >
              <Text style={styles.sendText}>Post</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

function ReplyList({
  parentId,
  viewerId,
  onLike,
}: {
  parentId: string;
  viewerId?: string;
  onLike: (id: string) => void;
}) {
  const replies = useQuery({
    queryKey: ["replies", parentId, viewerId],
    queryFn: () => getReplies(parentId, viewerId),
  });
  return (
    <>
      {(replies.data ?? []).map((rep: CommentWithAuthor) => (
        <CommentItem key={rep.id} comment={rep} isReply onLike={() => onLike(rep.id)} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topBar: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  back: { color: colors.textMuted, fontSize: 16 },
  content: { paddingHorizontal: spacing.lg },
  commentsTitle: { ...typography.h3, marginTop: spacing.lg, marginBottom: spacing.sm },
  noComments: { ...typography.bodyMuted, marginTop: spacing.md },
  composer: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  replyBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingBottom: spacing.sm,
  },
  replyText: { color: colors.textMuted, fontSize: 13 },
  replyCancel: { color: colors.textMuted, fontSize: 16 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  send: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sendText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
});
