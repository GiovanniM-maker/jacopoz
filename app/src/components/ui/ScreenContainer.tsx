import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { colors, spacing } from "@/theme";

interface Props {
  children?: React.ReactNode;
  padded?: boolean;
  edges?: Edge[];
  style?: StyleProp<ViewStyle>;
}

/** Dark safe-area page wrapper. */
export function ScreenContainer({ children, padded, edges = ["top"], style }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={[styles.inner, padded && { paddingHorizontal: spacing.lg }, style]}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1 },
});
