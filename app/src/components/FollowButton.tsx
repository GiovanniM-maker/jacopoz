import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";
import { followUser, isFollowing, unfollowUser } from "@/api/social";
import { colors, radius, spacing } from "@/theme";

interface Props {
  targetId: string;
  /** Skip the follow-state query when the caller already knows it (rare). */
  initial?: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Compact inline follow/unfollow pill with optimistic toggle. Reusable in any
 * list of readers (search, suggestions, connections) so following someone is
 * one tap without leaving the list.
 */
export function FollowButton({ targetId, style }: Props) {
  const qc = useQueryClient();
  const state = useQuery({
    queryKey: ["is-following", targetId],
    queryFn: () => isFollowing(targetId),
  });
  const on = state.data ?? false;

  const toggle = useMutation({
    mutationFn: () => (on ? unfollowUser(targetId) : followUser(targetId)),
    onMutate: () => qc.setQueryData(["is-following", targetId], !on),
    onError: () => qc.setQueryData(["is-following", targetId], on),
    onSettled: () => qc.invalidateQueries({ queryKey: ["is-following", targetId] }),
  });

  return (
    <Pressable
      onPress={() => toggle.mutate()}
      style={[styles.pill, on ? styles.pillOn : styles.pillOff, style]}
      hitSlop={6}
    >
      <Text style={[styles.label, on ? styles.labelOn : styles.labelOff]}>
        {on ? "Seguito" : "Segui"}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minWidth: 92,
    paddingHorizontal: spacing.md,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  pillOff: { backgroundColor: colors.primary },
  pillOn: { backgroundColor: colors.surface },
  label: { fontSize: 12, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  labelOff: { color: colors.onPrimary },
  labelOn: { color: colors.textMuted },
});
