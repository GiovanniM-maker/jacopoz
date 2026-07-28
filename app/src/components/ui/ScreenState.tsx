import { ActivityIndicator, StyleSheet, View } from "react-native";
import { ScreenHeader } from "@/components/ScreenHeader";
import { colors } from "@/theme";
import { EmptyState } from "./EmptyState";
import { ScreenContainer } from "./ScreenContainer";

interface Props {
  /** Where the back button lands if there's no history. Omit to hide the header
   *  (e.g. on a tab screen that has no back). */
  backFallback?: string;
  header?: boolean;
}

/** Full-screen loading state with a back header, so a slow/failed load never
 *  leaves the user on a blank page they can't escape. */
export function LoadingScreen({ backFallback, header = true }: Props) {
  return (
    <ScreenContainer edges={["top"]}>
      {header ? <ScreenHeader backFallback={backFallback} /> : null}
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    </ScreenContainer>
  );
}

/** Full-screen error/not-found state with an optional retry. */
export function ErrorScreen({
  backFallback,
  onRetry,
  title = "Qualcosa è andato storto",
  message = "Non è stato possibile caricare questa pagina.",
}: Props & { onRetry?: () => void; title?: string; message?: string }) {
  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader backFallback={backFallback} />
      <View style={styles.center}>
        <EmptyState
          icon="⚠️"
          title={title}
          message={message}
          action={onRetry ? { label: "Riprova", onPress: onRetry } : undefined}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
});
