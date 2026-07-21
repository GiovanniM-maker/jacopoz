import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { deleteAccount, updateProfile } from "@/api/profile";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { confirmDialog } from "@/lib/confirm";
import { useAuth } from "@/store/auth";
import { activeTheme, colors, radius, setTheme, spacing, THEMES, typography } from "@/theme";

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

  async function onDelete() {
    const ok = await confirmDialog(
      "Eliminare l'account?",
      "Verranno cancellati per sempre profilo, recensioni, commenti, liste e tutti i tuoi dati. L'azione è irreversibile.",
      "Elimina tutto",
    );
    if (!ok) return;
    try {
      await deleteAccount();
    } finally {
      await signOut();
    }
  }

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title="Impostazioni" backFallback="/(tabs)/profile" />

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

        {/* Appearance / theme */}
        <Text style={styles.section}>Aspetto</Text>
        {THEMES.map((t) => {
          const on = t.name === activeTheme;
          return (
            <Pressable key={t.name} style={styles.themeRow} onPress={() => !on && setTheme(t.name)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.themeName}>{t.label}</Text>
                <Text style={styles.themeHint}>{t.hint}</Text>
              </View>
              <View style={[styles.radio, on && styles.radioOn]}>
                {on ? <View style={styles.radioDot} /> : null}
              </View>
            </Pressable>
          );
        })}
        <Text style={styles.note}>Cambiando tema l'app si ricarica per applicarlo.</Text>

        {/* Lists & content */}
        <Text style={styles.section}>Liste e contenuti</Text>
        <Row icon="create" label="Crea nuova lista" onPress={() => router.push("/new-list")} />
        <Row icon="bookmark" label="Elementi salvati" onPress={() => router.push("/saved")} />

        {/* Privacy */}
        <Text style={styles.section}>Privacy e termini</Text>
        <Text style={styles.note}>
          Profilo, recensioni e liste pubbliche sono visibili agli altri lettori. Puoi rendere privata
          una lista quando la crei o modifichi. Le liste private restano visibili solo a te.
        </Text>
        <Row icon="list" label="Informativa privacy" onPress={() => router.push("/legal/privacy")} />
        <Row icon="list" label="Termini di servizio" onPress={() => router.push("/legal/terms")} />

        {/* Danger zone */}
        <Text style={[styles.section, { color: colors.primary }]}>Zona pericolosa</Text>
        <Pressable style={styles.danger} onPress={onDelete}>
          <Icon name="trash" color={colors.primary} size={18} />
          <Text style={styles.dangerText}>Elimina account e tutti i dati</Text>
        </Pressable>
        <Row icon="back" label="Esci" onPress={signOut} />

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function Row({ icon, label, onPress }: { icon?: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      {icon ? (
        <View style={styles.rowIcon}>
          <Icon name={icon} color={colors.text} size={18} />
        </View>
      ) : null}
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    gap: spacing.md,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowIcon: {
    width: 34,
    height: 30,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  rowLabel: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
  chev: { color: colors.textFaint, fontSize: 22 },
  note: { ...typography.bodyMuted, lineHeight: 20, marginTop: spacing.sm },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  themeName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  themeHint: { color: colors.textFaint, fontSize: 13, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: { borderColor: colors.border },
  radioDot: { width: 10, height: 10, backgroundColor: colors.primary },
  danger: {
    flexDirection: "row",
    gap: spacing.sm,
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.primary,
    borderRadius: radius.sm,
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
  },
  dangerText: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
});
