import { Tabs } from "expo-router";
import { Icon, type IconName } from "@/components/ui/Icon";
import { colors } from "@/theme";

function tabIcon(name: IconName) {
  return ({ color, focused }: { color: string; focused: boolean }) => (
    <Icon name={name} color={color} filled={focused} size={26} />
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.border,
          height: 58,
        },
        tabBarItemStyle: { paddingTop: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="community" options={{ tabBarIcon: tabIcon("community") }} />
      <Tabs.Screen name="profile" options={{ tabBarIcon: tabIcon("profile") }} />
      {/* Reachable from the header (search right, review left) — hidden from the tab bar. */}
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen name="create" options={{ href: null }} />
    </Tabs>
  );
}
