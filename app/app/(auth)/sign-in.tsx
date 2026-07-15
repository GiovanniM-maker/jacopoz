import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, spacing, typography } from "@/theme";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSignIn() {
    setError(null);
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message);
    // On success the auth listener + gate navigate automatically.
  }

  return (
    <ScreenContainer padded>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.flex}>
          <View style={styles.header}>
            <Text style={styles.logo}>jacopoz</Text>
            <Text style={styles.tagline}>Discover books through people like you.</Text>
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
            <Button label="Sign in" onPress={onSignIn} loading={loading} />
            <Link href="/(auth)/sign-up" style={styles.link}>
              <Text style={styles.linkText}>New here? Create an account</Text>
            </Link>
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
