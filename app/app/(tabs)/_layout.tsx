import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors } from "@/theme";

// Emoji tab icons keep the beta dependency-free (no icon font to bundle).
function TabIcon({ icon, color }: { icon: string; color: string }) {
  return <Text style={{ fontSize: 22, color }}>{icon}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color }) => <TabIcon icon="🏠" color={color} /> }}
      />
      <Tabs.Screen
        name="search"
        options={{ title: "Search", tabBarIcon: ({ color }) => <TabIcon icon="🔍" color={color} /> }}
      />
      <Tabs.Screen
        name="community"
        options={{ title: "Community", tabBarIcon: ({ color }) => <TabIcon icon="💬" color={color} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", tabBarIcon: ({ color }) => <TabIcon icon="👤" color={color} /> }}
      />
    </Tabs>
  );
}
