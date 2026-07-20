import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { createList } from "@/api/lists";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";

export default function NewList() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [saving, setSaving] = useState(false);

  async function onCreate() {
    if (!userId || name.trim().length === 0) return;
    setSaving(true);
    const list = await createList(userId, name.trim(), {
      description: description.trim() || undefined,
      isPublic,
    });
    qc.invalidateQueries({ queryKey: ["lists", userId] });
    setSaving(false);
    router.replace(`/list/${list.id}`);
  }

  return (
    <ScreenContainer padded>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.cancel}>Annulla</Text>
        </Pressable>
        <Text style={styles.title}>Nuova lista</Text>
        <View style={{ width: 60 }} />
      </View>

      <TextInput
        style={styles.input}
        placeholder="Nome della lista"
        placeholderTextColor={colors.textFaint}
        value={name}
        onChangeText={setName}
        maxLength={80}
      />
      <TextInput
        style={[styles.input, styles.area]}
        placeholder="Descrizione (facoltativa)"
        placeholderTextColor={colors.textFaint}
        value={description}
        onChangeText={setDescription}
        multiline
        maxLength={500}
        textAlignVertical="top"
      />

      <View style={styles.row}>
        <View>
          <Text style={styles.rowLabel}>Lista pubblica</Text>
          <Text style={styles.rowHint}>{isPublic ? "Visibile a tutti" : "Solo tu puoi vederla"}</Text>
        </View>
        <Switch
          value={isPublic}
          onValueChange={setIsPublic}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>

      <Button
        label="Crea lista"
        onPress={onCreate}
        loading={saving}
        disabled={name.trim().length === 0}
        style={styles.cta}
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
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    color: colors.text,
    fontSize: 16,
    marginTop: spacing.md,
  },
  area: { minHeight: 96 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
  },
  rowLabel: { ...typography.body, fontWeight: "600" },
  rowHint: { ...typography.caption, marginTop: 2 },
  cta: { marginTop: spacing.xl },
});
