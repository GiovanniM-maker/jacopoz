import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { getMyReview, upsertReview } from "@/api/reviews";
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

      <TextInput
        style={styles.textArea}
        placeholder="Che cosa ne pensi? Basta una riga, o vai in profondità…"
        placeholderTextColor={colors.textFaint}
        multiline
        value={body}
        onChangeText={setBody}
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
