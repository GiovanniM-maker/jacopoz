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
import { getBookmarkedIds, toggleBookmark } from "@/api/bookmarks";
import { CommentItem } from "@/components/CommentItem";
import { ReviewCard } from "@/components/ReviewCard";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, displayFont, radius, spacing, typography } from "@/theme";
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
  const savedComments = useQuery({
    queryKey: ["saved-comment-ids", userId],
    queryFn: () => getBookmarkedIds(userId!, "comment"),
    enabled: !!userId,
  });

  async function onSaveComment(commentId: string) {
    if (!userId) return;
    await toggleBookmark(userId, "comment", commentId);
    qc.invalidateQueries({ queryKey: ["saved-comment-ids", userId] });
  }

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
        <ScreenHeader title="Recensione" backFallback="/(tabs)/community" />

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
              onAuthorPress={() => router.push(`/user/${r.author.username}`)}
              onLike={onReviewLike}
            />
          ) : null}

          <Text style={styles.commentsTitle}>Commenti</Text>
          {(comments.data ?? []).map((c: CommentWithAuthor) => (
            <View key={c.id}>
              <CommentItem
                comment={c}
                saved={savedComments.data?.has(c.id) ?? false}
                onLike={() => onCommentLike(c.id)}
                onReply={() => setReplyTo(c)}
                onSave={() => onSaveComment(c.id)}
              />
              {c.reply_count > 0 ? (
                <ReplyList parentId={c.id} viewerId={userId} onLike={onCommentLike} />
              ) : null}
            </View>
          ))}
          {(comments.data ?? []).length === 0 ? (
            <Text style={styles.noComments}>Ancora nessun commento. Inizia tu la conversazione.</Text>
          ) : null}
          <View style={{ height: spacing.xl }} />
        </ScrollView>

        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replyBanner}>
              <Text style={styles.replyText}>Risposta a {replyTo.author.display_name}</Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <Text style={styles.replyCancel}>✕</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={replyTo ? "Scrivi una risposta…" : "Aggiungi un commento…"}
              placeholderTextColor={colors.textFaint}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable
              onPress={onPost}
              disabled={posting || text.trim().length === 0}
              style={[styles.send, (posting || text.trim().length === 0) && { opacity: 0.5 }]}
            >
              <Text style={styles.sendText}>Invia</Text>
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  commentsTitle: {
    fontFamily: displayFont,
    fontSize: 18,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: colors.text,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  noComments: { ...typography.bodyMuted, marginTop: spacing.md },
  composer: {
    borderTopWidth: 2,
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
  replyText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  replyCancel: { color: colors.textMuted, fontSize: 16 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  input: {
    flex: 1,
    maxHeight: 100,
    backgroundColor: colors.bg,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  send: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.border,
  },
  sendText: {
    color: colors.onPrimary,
    fontWeight: "800",
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
});
