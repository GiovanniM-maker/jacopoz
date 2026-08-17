import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, displayFont } from "@/theme";

function tabIcon(name: IconName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Icon name={name} color={color} filled={focused} size={24} />
  );
}

export default function TabsLayout() {
  // Extend the bar into the home-indicator area so labels aren't overlapped in
  // an installed PWA / on notched iPhones.
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          borderTopWidth: 2,
          height: 66 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarItemStyle: { paddingTop: 8, paddingBottom: 4 },
        tabBarLabelStyle: {
          fontFamily: displayFont,
          fontSize: 11,
          fontWeight: "900",
          letterSpacing: 1,
          textTransform: "uppercase",
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="community" options={{ title: "Feed", tabBarIcon: tabIcon("community") }} />
      <Tabs.Screen name="profile" options={{ title: "Tu", tabBarIcon: tabIcon("profile") }} />
      {/* Reachable from the header (review left) — hidden from the tab bar.
          Search is a root stack route (app/search.tsx) so "back" returns to
          wherever it was opened from (Home or Feed), not a fixed tab. */}
      <Tabs.Screen name="create" options={{ href: null }} />
    </Tabs>
  );
}
