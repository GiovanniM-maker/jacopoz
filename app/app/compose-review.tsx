import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { getMyReview, upsertReview } from "@/api/reviews";
import { getUserBook } from "@/api/shelves";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { RatingStars } from "@/components/ui/RatingStars";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { goBack } from "@/lib/nav";
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
  const [selection, setSelection] = useState({ start: 0, end: 0 });

  const existing = useQuery({
    queryKey: ["my-review", bookId, userId],
    queryFn: () => getMyReview(userId!, bookId!),
    enabled: !!bookId && !!userId,
  });
  // The rating the user may have already given from the book's page — so the
  // review opens pre-filled with the same score (one rating per book).
  const shelf = useQuery({
    queryKey: ["user-book", bookId, userId],
    queryFn: () => getUserBook(userId!, bookId!),
    enabled: !!bookId && !!userId,
  });

  useEffect(() => {
    if (existing.data) {
      setBody(existing.data.body);
      setRating(existing.data.rating);
      setSpoilers(existing.data.contains_spoilers);
    } else if (existing.isFetched && shelf.data?.rating != null) {
      // No review yet → inherit the score from the book page.
      setRating((prev) => prev ?? shelf.data!.rating);
    }
  }, [existing.data, existing.isFetched, shelf.data]);

  /** Wrap the current selection (or caret) with a markdown marker. */
  function wrap(marker: string) {
    const s = Math.min(selection.start, selection.end);
    const e = Math.max(selection.start, selection.end);
    const next = body.slice(0, s) + marker + body.slice(s, e) + marker + body.slice(e);
    setBody(next);
    setSelection({ start: s + marker.length, end: e + marker.length });
  }

  async function onSubmit() {
    if (!userId || !bookId || body.trim().length === 0) return;
    setSaving(true);
    await upsertReview(userId, bookId, { body: body.trim(), rating, contains_spoilers: spoilers });
    qc.invalidateQueries({ queryKey: ["book-reviews", bookId] });
    qc.invalidateQueries({ queryKey: ["book", bookId] });
    qc.invalidateQueries({ queryKey: ["feed"] });
    setSaving(false);
    goBack("/(tabs)/community");
  }

  return (
    <ScreenContainer>
      <ScreenHeader title={existing.data ? "Modifica recensione" : "Scrivi recensione"} />
      <View style={styles.body}>
      <View style={styles.rateRow}>
        <Text style={styles.label}>La tua valutazione</Text>
        <RatingStars value={rating} size={30} onChange={setRating} />
      </View>

      <View style={styles.toolbar}>
        <Pressable style={styles.fmtBtn} onPress={() => wrap("**")} accessibilityLabel="Grassetto">
          <Text style={[styles.fmtLabel, { fontWeight: "900" }]}>B</Text>
        </Pressable>
        <Pressable style={styles.fmtBtn} onPress={() => wrap("*")} accessibilityLabel="Corsivo">
          <Text style={[styles.fmtLabel, { fontStyle: "italic" }]}>I</Text>
        </Pressable>
        <Text style={styles.fmtHint}>Seleziona il testo, poi B o I</Text>
      </View>

      <TextInput
        style={styles.textArea}
        placeholder="Che cosa ne pensi? Basta una riga, o vai in profondità…"
        placeholderTextColor={colors.textFaint}
        multiline
        value={body}
        onChangeText={setBody}
        selection={selection}
        onSelectionChange={(e) => setSelection(e.nativeEvent.selection)}
        maxLength={5000}
        textAlignVertical="top"
      />

      <View style={styles.spoilerRow}>
        <Text style={styles.label}>Contiene spoiler</Text>
        <Switch
          value={spoilers}
          onValueChange={setSpoilers}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>

      <Button
        label={existing.data ? "Aggiorna recensione" : "Pubblica recensione"}
        onPress={onSubmit}
        loading={saving}
        disabled={body.trim().length === 0}
        style={styles.submit}
      />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.lg },
  rateRow: {
    alignItems: "center",
    gap: spacing.sm,
    marginVertical: spacing.lg,
    paddingVertical: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: {
    ...typography.bodyMuted,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  fmtBtn: {
    width: 40,
    height: 36,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  fmtLabel: { color: colors.text, fontSize: 16 },
  fmtHint: { color: colors.textFaint, fontSize: 12, marginLeft: spacing.xs },
  textArea: {
    minHeight: 160,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 2,
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
