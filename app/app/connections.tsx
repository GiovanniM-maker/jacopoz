import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { getFollowers, getFollowing } from "@/api/profile";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, spacing, typography } from "@/theme";

export default function Connections() {
  const { userId, type } = useLocalSearchParams<{ userId: string; type: "followers" | "following" }>();
  const isFollowers = type === "followers";

  const q = useQuery({
    queryKey: ["connections", userId, type],
    queryFn: () => (isFollowers ? getFollowers(userId!) : getFollowing(userId!)),
    enabled: !!userId,
  });

  return (
    <ScreenContainer edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title}>{isFollowers ? "Followers" : "Following"}</Text>
        <View style={{ width: 44 }} />
      </View>

      <FlatList
        data={q.data ?? []}
        keyExtractor={(u) => u.id}
        contentContainerStyle={{ flexGrow: 1 }}
        ListEmptyComponent={
          !q.isLoading ? (
            <EmptyState icon="👥" title={isFollowers ? "No followers yet" : "Not following anyone"} />
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => router.push(`/user/${item.username}`)}>
            <Avatar url={item.avatar_url} name={item.display_name} size={44} />
            <View>
              <Text style={styles.name}>{item.display_name}</Text>
              <Text style={styles.username}>@{item.username}</Text>
            </View>
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  back: { color: colors.textMuted, fontSize: 16 },
  title: { ...typography.h3 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: "600" },
  username: { color: colors.textMuted, fontSize: 13 },
});
