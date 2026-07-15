import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { getGenres } from "@/api/books";
import { saveOnboarding } from "@/api/profile";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, spacing, typography } from "@/theme";
import type { Genre } from "@/types/database";

const MIN_PICKS = 3;

/**
 * Taste picker. This screen exists to solve the recommendation cold-start:
 * a brand-new user leaves with enough signal for the dashboard to fill up.
 */
export default function Onboarding() {
  const { session, refreshProfile } = useAuth();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: genres = [] } = useQuery({ queryKey: ["genres"], queryFn: getGenres });

  function toggle(slug: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }

  async function onContinue() {
    if (!session) return;
    setSaving(true);
    await saveOnboarding(session.user.id, [...selected]);
    await refreshProfile(); // flips onboarded_at → gate moves to the app
    setSaving(false);
  }

  return (
    <ScreenContainer padded>
      <View style={styles.header}>
        <Text style={styles.title}>What do you love to read?</Text>
        <Text style={styles.subtitle}>
          Pick at least {MIN_PICKS}. We'll use this to fill your home with books you'll actually
          want.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
        {genres.map((g: Genre) => (
          <Chip
            key={g.slug}
            label={g.name}
            selected={selected.has(g.slug)}
            onPress={() => toggle(g.slug)}
          />
        ))}
      </ScrollView>

      <Button
        label={
          selected.size < MIN_PICKS
            ? `Pick ${MIN_PICKS - selected.size} more`
            : `Continue (${selected.size})`
        }
        onPress={onContinue}
        loading={saving}
        disabled={selected.size < MIN_PICKS}
        style={styles.cta}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: { marginTop: spacing.xl, marginBottom: spacing.lg, gap: spacing.sm },
  title: typography.h1,
  subtitle: typography.bodyMuted,
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingVertical: spacing.md },
  cta: { marginVertical: spacing.lg },
});
