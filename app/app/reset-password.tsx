import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing, typography } from "@/theme";

/**
 * Landing page of the recovery email link. Supabase's detectSessionInUrl
 * turns the link's token into a session, so updateUser just works here.
 */
export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    if (password.length < 8) {
      setError("La password deve avere almeno 8 caratteri.");
      return;
    }
    if (password !== confirm) {
      setError("Le due password non coincidono.");
      return;
    }
    setLoading(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) {
      setError(
        err.message.includes("session")
          ? "Link scaduto o già usato: richiedi una nuova email di recupero."
          : err.message,
      );
      return;
    }
    router.replace("/(tabs)");
  }

  return (
    <ScreenContainer padded>
      <View style={styles.form}>
        <Text style={styles.title}>Nuova password</Text>
        <TextInput
          style={styles.input}
          placeholder="Nuova password (min 8 caratteri)"
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TextInput
          style={styles.input}
          placeholder="Ripeti la password"
          placeholderTextColor={colors.textFaint}
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          label="Salva e accedi"
          onPress={onSubmit}
          loading={loading}
          disabled={password.length === 0 || confirm.length === 0}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, gap: spacing.md, justifyContent: "center" },
  title: { ...typography.h1, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.lg,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.primary, fontSize: 14 },
});
