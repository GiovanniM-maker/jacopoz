import { useEffect, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { colors } from "@/theme";

/**
 * A thin bar that appears when the browser goes offline, so actions that
 * silently fail (likes, comments, shelving — the SW passes mutations straight
 * to Supabase) have a visible explanation. Web-only; native handles this at the
 * OS level.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined") return;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <View style={styles.bar}>
      <Text style={styles.text}>Sei offline — alcune azioni potrebbero non salvarsi</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.accent,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  text: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
});
