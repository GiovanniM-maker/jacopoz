import { Tabs } from "expo-router";
import { Icon, type IconName } from "@/components/ui/Icon";
import { colors, displayFont } from "@/theme";

function tabIcon(name: IconName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Icon name={name} color={color} filled={focused} size={24} />
  );
}

export default function TabsLayout() {
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
          height: 60,
        },
        tabBarItemStyle: { paddingTop: 6, paddingBottom: 6 },
        tabBarLabelStyle: {
          fontFamily: displayFont,
          fontSize: 12,
          fontWeight: "900",
          letterSpacing: 1,
          textTransform: "uppercase",
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="community" options={{ title: "Feed", tabBarIcon: tabIcon("community") }} />
      <Tabs.Screen name="profile" options={{ title: "Tu", tabBarIcon: tabIcon("profile") }} />
      {/* Reachable from the header (search right, review left) — hidden from the tab bar. */}
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="create" options={{ href: null }} />
    </Tabs>
  );
}
