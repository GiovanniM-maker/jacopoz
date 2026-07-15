import { ActivityIndicator, View } from "react-native";
import { colors } from "@/theme";

// Landing route. The auth/onboarding gate in _layout.tsx immediately
// redirects to the right stack; this is just what shows during that tick.
export default function Index() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}
