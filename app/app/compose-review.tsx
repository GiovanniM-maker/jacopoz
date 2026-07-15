import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { getMyReview, upsertReview } from "@/api/reviews";
import { Button } from "@/components/ui/Button";
import { RatingStars } from "@/components/ui/RatingStars";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";

export default function ComposeReview() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();

  const [body, setBody] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [spoilers, setSpoilers] = useState(false);
  const [saving, setSaving] = useState(false);

  const existing = useQuery({
    queryKey: ["my-review", bookId, userId],
    queryFn: () => getMyReview(userId!, bookId!),
    enabled: !!bookId && !!userId,
  });

  useEffect(() => {
    if (existing.data) {
      setBody(existing.data.body);
      setRating(existing.data.rating);
      setSpoilers(existing.data.contains_spoilers);
    }
  }, [existing.data]);

  async function onSubmit() {
    if (!userId || !bookId || body.trim().length === 0) return;
    setSaving(true);
    await upsertReview(userId, bookId, { body: body.trim(), rating, contains_spoilers: spoilers });
    qc.invalidateQueries({ queryKey: ["book-reviews", bookId] });
    qc.invalidateQueries({ queryKey: ["book", bookId] });
    qc.invalidateQueries({ queryKey: ["feed"] });
    setSaving(false);
    router.back();
  }

  return (
    <ScreenContainer padded>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.title}>{existing.data ? "Edit review" : "Write a review"}</Text>
        <View style={{ width: 50 }} />
      </View>

      <View style={styles.rateRow}>
        <Text style={styles.label}>Rating</Text>
        <RatingStars value={rating} size={30} onChange={setRating} />
      </View>

      <TextInput
        style={styles.textArea}
        placeholder="What did you think? A single line is fine, or go deep…"
        placeholderTextColor={colors.textFaint}
        multiline
        value={body}
        onChangeText={setBody}
        maxLength={5000}
        textAlignVertical="top"
      />

      <View style={styles.spoilerRow}>
        <Text style={styles.label}>Contains spoilers</Text>
        <Switch
          value={spoilers}
          onValueChange={setSpoilers}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>

      <Button
        label={existing.data ? "Update review" : "Post review"}
        onPress={onSubmit}
        loading={saving}
        disabled={body.trim().length === 0}
        style={styles.submit}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
  },
  cancel: { color: colors.textMuted, fontSize: 16 },
  title: { ...typography.h3 },
  rateRow: { alignItems: "center", gap: spacing.sm, marginVertical: spacing.lg },
  label: { ...typography.bodyMuted },
  textArea: {
    minHeight: 160,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    color: colors.text,
    fontSize: 16,
    lineHeight: 22,
  },
  spoilerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  submit: { marginTop: spacing.xl },
});
