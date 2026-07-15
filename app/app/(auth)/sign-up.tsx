import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from "react-native";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/Button";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, spacing, typography } from "@/theme";

export default function SignUp() {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSignUp() {
    setError(null);
    setNotice(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    // display_name lands in raw_user_meta_data; the DB trigger derives the
    // username and creates the profile row automatically.
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    if (!data.session) {
      setNotice("Check your email to confirm your account, then sign in.");
    }
    // With confirmations off, the session appears and the gate navigates.
  }

  return (
    <ScreenContainer padded>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.form}>
          <Text style={styles.title}>Create your account</Text>
          <TextInput
            style={styles.input}
            placeholder="Display name"
            placeholderTextColor={colors.textFaint}
            value={displayName}
            onChangeText={setDisplayName}
          />
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
            placeholder="Password (min 8 chars)"
            placeholderTextColor={colors.textFaint}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Button label="Sign up" onPress={onSignUp} loading={loading} />
          <Link href="/(auth)/sign-in" style={styles.link}>
            <Text style={styles.linkText}>Already have an account? Sign in</Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { flex: 1, gap: spacing.md, justifyContent: "center" },
  title: { ...typography.h1, marginBottom: spacing.lg },
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
  notice: { color: colors.success, fontSize: 14 },
  link: { alignSelf: "center", marginTop: spacing.md },
  linkText: { color: colors.textMuted, fontSize: 14 },
});
