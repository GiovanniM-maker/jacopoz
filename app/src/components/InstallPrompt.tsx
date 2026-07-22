import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  canInstall,
  isIos,
  onInstallChange,
  promptInstall,
} from "@/lib/pwaInstall";
import { colors, displayFont, hardShadow, radius, spacing } from "@/theme";

const DISMISS_KEY = "tomo:install-dismissed";

/**
 * A dismissible "install this app" banner for the web build, rendered on the
 * sign-in screen (which has no bottom tab bar to collide with). Fires the
 * native install dialog on Android / desktop Chrome; shows the manual
 * Share → "Aggiungi a Home" steps on iPhone. Renders nothing on native,
 * when already installed, or once dismissed.
 */
export function InstallPrompt() {
  const [available, setAvailable] = useState(canInstall());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY)) setDismissed(true);
    } catch {
      // localStorage may throw in private mode — treat as not dismissed.
    }
    return onInstallChange(() => setAvailable(canInstall()));
  }, []);

  if (dismissed || !available) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
    setDismissed(true);
  }

  async function onInstall() {
    const ok = await promptInstall();
    if (!ok && isIos()) setShowIosHelp(true);
  }

  return (
    <View style={styles.card}>
      <View style={styles.text}>
        <Text style={styles.title}>Installa Tomo</Text>
        <Text style={styles.sub}>
          {showIosHelp
            ? "Tocca Condividi ⎋ in basso, poi «Aggiungi a Home»."
            : "Aggiungila alla Home: si apre a schermo intero, come un'app."}
        </Text>
      </View>
      {!showIosHelp ? (
        <Pressable style={styles.cta} onPress={onInstall} accessibilityRole="button">
          <Text style={styles.ctaText}>Installa</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.close} onPress={dismiss} hitSlop={10} accessibilityRole="button">
        <Text style={styles.closeText}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    width: "100%",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    ...hardShadow,
  },
  text: { flex: 1, gap: 2 },
  title: {
    fontFamily: displayFont,
    fontSize: 15,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: colors.text,
  },
  sub: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  cta: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
  },
  ctaText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  close: { paddingHorizontal: 4 },
  closeText: { color: colors.textMuted, fontSize: 15, fontWeight: "800" },
});
