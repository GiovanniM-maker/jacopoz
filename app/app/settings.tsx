import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { deleteAccount, updateProfile } from "@/api/profile";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";

export default function Settings() {
  const { session, profile, refreshProfile, signOut } = useAuth();
  const userId = session?.user.id;
  const [displayName, setDisplayName] = useState(profile?.display_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSaveProfile() {
    if (!userId) return;
    setSaving(true);
    await updateProfile(userId, { display_name: displayName.trim(), bio: bio.trim() || null });
    await refreshProfile();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function onDelete() {
    Alert.alert(
      "Eliminare l'account?",
      "Verranno cancellati per sempre profilo, recensioni, commenti, liste e tutti i tuoi dati. L'azione è irreversibile.",
      [
        { text: "Annulla", style: "cancel" },
        {
          text: "Elimina tutto",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteAccount();
            } finally {
              await signOut();
            }
          },
        },
      ],
    );
  }

  return (
    <ScreenContainer edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Indietro</Text>
        </Pressable>
        <Text style={styles.title}>Impostazioni</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <Text style={styles.section}>Profilo</Text>
        <Text style={styles.field}>Nome visualizzato</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Il tuo nome"
          placeholderTextColor={colors.textFaint}
          maxLength={60}
        />
        <Text style={styles.field}>Bio</Text>
        <TextInput
          style={[styles.input, styles.area]}
          value={bio}
          onChangeText={setBio}
          placeholder="Raccontati in una riga…"
          placeholderTextColor={colors.textFaint}
          multiline
          maxLength={300}
          textAlignVertical="top"
        />
        <Button
          label={saved ? "Salvato ✓" : "Salva profilo"}
          onPress={onSaveProfile}
          loading={saving}
          style={styles.save}
        />

        {/* Lists & content */}
        <Text style={styles.section}>Liste e contenuti</Text>
        <Row label="➕  Crea nuova lista" onPress={() => router.push("/new-list")} />
        <Row label="🔖  Elementi salvati" onPress={() => router.push("/saved")} />

        {/* Privacy */}
        <Text style={styles.section}>Privacy</Text>
        <Text style={styles.note}>
          Profilo, recensioni e liste pubbliche sono visibili agli altri lettori. Puoi rendere privata
          una lista quando la crei o modifichi. Le liste private restano visibili solo a te.
        </Text>

        {/* Danger zone */}
        <Text style={[styles.section, { color: colors.primary }]}>Zona pericolosa</Text>
        <Pressable style={styles.danger} onPress={onDelete}>
          <Text style={styles.dangerText}>Elimina account e tutti i dati</Text>
        </Pressable>
        <Row label="Esci" onPress={signOut} />

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function Row({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { color: colors.textMuted, fontSize: 16 },
  title: { ...typography.h3 },
  body: { paddingHorizontal: spacing.lg },
  section: {
    ...typography.caption,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  field: { ...typography.bodyMuted, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text,
    fontSize: 16,
  },
  area: { minHeight: 84 },
  save: { marginTop: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { color: colors.text, fontSize: 16 },
  chev: { color: colors.textFaint, fontSize: 22 },
  note: { ...typography.bodyMuted, lineHeight: 20 },
  danger: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  dangerText: { color: colors.primary, fontSize: 16, fontWeight: "700" },
});
