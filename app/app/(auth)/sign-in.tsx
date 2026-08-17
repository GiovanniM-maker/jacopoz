import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { Wordmark } from "@/components/Wordmark";
import { InstallPrompt } from "@/components/InstallPrompt";
import { colors, spacing, typography } from "@/theme";

/** Map the most common Supabase auth errors to Italian. */
function itAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login")) return "Email o password non corretti.";
  if (m.includes("email not confirmed")) return "Conferma prima la tua email, poi accedi.";
  if (m.includes("rate limit") || m.includes("too many")) return "Troppi tentativi. Riprova tra poco.";
  return "Accesso non riuscito. Riprova.";
}

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSignIn() {
    setError(null);
    setLoading(true);
    try {
      // Guard against a stalled network so the button never spins forever.
      const result = await Promise.race([
        supabase.auth.signInWithPassword({ email: email.trim(), password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), 15000),
        ),
      ]);
      if (result.error) setError(itAuthError(result.error.message));
      // On success the auth listener + gate navigate automatically.
    } catch {
      setError("Connessione lenta o assente. Riprova.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScreenContainer padded>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.flex}>
          <View style={styles.header}>
            <Wordmark size={48} />
            <Text style={styles.tagline}>Scopri libri attraverso persone come te.</Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textFaint}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Accedi" onPress={onSignIn} loading={loading} />
            <Link href="/(auth)/forgot-password" style={styles.link}>
              <Text style={styles.linkText}>Password dimenticata?</Text>
            </Link>
            <Link href="/(auth)/sign-up" style={styles.link}>
              <Text style={styles.linkText}>Nuovo qui? Crea un account</Text>
            </Link>
            <InstallPrompt />
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.sm },
  logo: { ...typography.h1, color: colors.primary, fontSize: 40 },
  tagline: { ...typography.bodyMuted, textAlign: "center" },
  form: { flex: 1, gap: spacing.md, justifyContent: "center" },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.lg,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.primary, fontSize: 14 },
  link: { alignSelf: "center", marginTop: spacing.md },
  linkText: { color: colors.textMuted, fontSize: 14 },
});
