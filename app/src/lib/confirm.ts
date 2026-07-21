import { Alert, Platform } from "react-native";

/**
 * Cross-platform confirm dialog. React Native Web does NOT implement
 * Alert.alert (it silently does nothing), so destructive confirmations
 * must go through window.confirm on web.
 */
export function confirmDialog(
  title: string,
  message: string,
  confirmLabel = "Conferma",
): Promise<boolean> {
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
    return Promise.resolve(!!ok);
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Annulla", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
