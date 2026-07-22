import { Link } from "expo-router";
import { useState } from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { supabase } from "@/lib/supabase";
import { colors, radius, spacing, typography } from "@/theme";

/** Request a password-reset email. Works with Supabase's built-in mailer. */
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    const redirectTo =
      Platform.OS === "web" && typeof window !== "undefined"
        ? `${window.location.origin}/reset-password`
        : "https://jacopoz.vercel.app/reset-password";
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo,
    });
    setLoading(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  return (
    <ScreenContainer padded>
      <View style={styles.form}>
        <Text style={styles.title}>Password dimenticata</Text>
        {sent ? (
          <>
            <Text style={styles.notice}>
              Se l'indirizzo esiste, ti abbiamo inviato una email con il link per reimpostare la
              password. Controlla anche lo spam.
            </Text>
            <Link href="/(auth)/sign-in" style={styles.link}>
              <Text style={styles.linkText}>Torna all'accesso</Text>
            </Link>
          </>
        ) : (
          <>
            <Text style={styles.hint}>
              Inserisci l'email del tuo account: ti mandiamo un link per scegliere una nuova
              password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              label="Invia il link"
              onPress={onSubmit}
              loading={loading}
              disabled={email.trim().length < 5}
            />
            <Link href="/(auth)/sign-in" style={styles.link}>
              <Text style={styles.linkText}>Torna all'accesso</Text>
            </Link>
          </>
        )}
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  form: { flex: 1, gap: spacing.md, justifyContent: "center" },
  title: { ...typography.h1, marginBottom: spacing.sm },
  hint: { ...typography.bodyMuted, lineHeight: 21 },
  notice: { ...typography.body, lineHeight: 22, color: colors.success },
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
  link: { alignSelf: "center", marginTop: spacing.md },
  linkText: { color: colors.textMuted, fontSize: 14 },
});
