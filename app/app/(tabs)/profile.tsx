import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { getProfileStats } from "@/api/profile";
import { getFollowedLists, getUserLists } from "@/api/lists";
import { getUserReviews, type UserReview } from "@/api/reviews";
import { getShelfBooks } from "@/api/shelves";
import { toggleLike } from "@/api/social";
import { BookCard } from "@/components/BookCard";
import { ReviewCard } from "@/components/ReviewCard";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { useAuth } from "@/store/auth";
import { colors, radius, spacing, typography } from "@/theme";
import type { BookCard as BookCardType, BookList } from "@/types/database";

type Section = "reviews" | "lists" | "liked";
const CARD_W = (Dimensions.get("window").width - spacing.lg * 2 - spacing.md * 2) / 3;

export default function ProfileScreen() {
  const { session, profile, signOut } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  const [section, setSection] = useState<Section>("reviews");
  const [listTab, setListTab] = useState<"mine" | "followed">("mine");

  const stats = useQuery({
    queryKey: ["stats", userId],
    queryFn: () => getProfileStats(userId!),
    enabled: !!userId,
  });
  const reviews = useQuery({
    queryKey: ["user-reviews", userId],
    queryFn: () => getUserReviews(userId!),
    enabled: !!userId && section === "reviews",
  });
  const lists = useQuery({
    queryKey: ["lists", userId],
    queryFn: () => getUserLists(userId!),
    enabled: !!userId && section === "lists",
  });
  const followedLists = useQuery({
    queryKey: ["followed-lists", userId],
    queryFn: () => getFollowedLists(userId!),
    enabled: !!userId && section === "lists" && listTab === "followed",
  });
  const liked = useQuery({
    queryKey: ["shelf", userId, "liked"],
    queryFn: () => getShelfBooks(userId!, { liked: true }),
    enabled: !!userId && section === "liked",
  });

  if (!profile) return <ScreenContainer />;
  const s = stats.data;

  return (
    <ScreenContainer edges={["top"]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
          <Pressable onPress={() => router.push("/saved")} hitSlop={8}>
            <Text style={styles.topLink}>🔖 Salvati</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/settings")} hitSlop={8}>
            <Text style={styles.topLink}>⚙ Impostazioni</Text>
          </Pressable>
        </View>

        {/* Identity + 4 stats */}
        <View style={styles.header}>
          <Avatar url={profile.avatar_url} name={profile.display_name} size={80} />
          <View style={styles.statsRow}>
            <Stat label="Like" value={s?.likes_received ?? 0} />
            <Stat label="Recensioni" value={s?.reviews ?? 0} />
            <Stat
              label="Follower"
              value={s?.followers ?? profile.followers_count}
              onPress={() => router.push(`/connections?userId=${userId}&type=followers`)}
            />
            <Stat
              label="Seguiti"
              value={s?.following ?? profile.following_count}
              onPress={() => router.push(`/connections?userId=${userId}&type=following`)}
            />
          </View>
        </View>
        <View style={styles.nameBlock}>
          <Text style={styles.name}>{profile.display_name}</Text>
          <Text style={styles.username}>@{profile.username}</Text>
          {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
        </View>

        {/* IG-style section tabs */}
        <View style={styles.tabbar}>
          <SectionTab icon="review" active={section === "reviews"} onPress={() => setSection("reviews")} />
          <SectionTab icon="create" active={section === "lists"} onPress={() => setSection("lists")} />
          <SectionTab icon="community" active={section === "liked"} onPress={() => setSection("liked")} />
        </View>

        {section === "reviews" ? (
          <View style={styles.feed}>
            {(reviews.data ?? []).length === 0 ? (
              <SectionEmpty icon="✍️" title="Nessuna recensione" msg="Le tue recensioni appariranno qui." />
            ) : (
              (reviews.data ?? []).map((r: UserReview) => (
                <ReviewCard
                  key={r.id}
                  authorName={r.author.display_name}
                  authorAvatar={r.author.avatar_url}
                  createdAt={r.created_at}
                  rating={r.rating}
                  body={r.body}
                  containsSpoilers={r.contains_spoilers}
                  likeCount={r.like_count}
                  commentCount={r.comment_count}
                  bookTitle={r.book?.title}
                  bookCover={r.book?.cover_url}
                  onPress={() => router.push(`/review/${r.id}`)}
                  onBookPress={() => r.book && router.push(`/book/${r.book.id}`)}
                  onLike={async () => {
                    await toggleLike("review", r.id);
                    qc.invalidateQueries({ queryKey: ["user-reviews", userId] });
                  }}
                />
              ))
            )}
          </View>
        ) : null}

        {section === "lists" ? (
          <View style={styles.listsWrap}>
            <View style={styles.listToggle}>
              {(["mine", "followed"] as const).map((t) => (
                <Pressable
                  key={t}
                  style={[styles.ltBtn, listTab === t && styles.ltBtnOn]}
                  onPress={() => setListTab(t)}
                >
                  <Text style={[styles.ltLabel, listTab === t && styles.ltLabelOn]}>
                    {t === "mine" ? "Mie" : "Seguite"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {listTab === "mine" ? (
              <>
                <Pressable style={styles.newList} onPress={() => router.push("/new-list")}>
                  <View style={styles.newListIcon}>
                    <Icon name="create" color={colors.primary} size={22} />
                  </View>
                  <Text style={styles.newListLabel}>Crea nuova lista</Text>
                </Pressable>
                {(lists.data ?? []).length === 0 ? (
                  <SectionEmpty icon="📚" title="Nessuna booklist" msg="Crea la tua prima lista qui sopra." />
                ) : (
                  (lists.data ?? []).map((l: BookList) => <ListRow key={l.id} list={l} />)
                )}
              </>
            ) : (followedLists.data ?? []).length === 0 ? (
              <SectionEmpty icon="🔖" title="Nessuna lista seguita" msg="Segui le liste pubbliche che ti piacciono." />
            ) : (
              (followedLists.data ?? []).map((l: BookList) => <ListRow key={l.id} list={l} showAuthor />)
            )}
          </View>
        ) : null}

        {section === "liked" ? (
          <View style={styles.grid}>
            {(liked.data ?? []).length === 0 ? (
              <SectionEmpty icon="❤️" title="Nessun libro piaciuto" msg="I libri a cui metti like appaiono qui." />
            ) : (
              (liked.data ?? []).map((b: BookCardType) => (
                <BookCard key={b.id} book={b} width={CARD_W} showMeta />
              ))
            )}
          </View>
        ) : null}

        <View style={{ height: spacing.xxl }} />
      </ScrollView>
    </ScreenContainer>
  );
}

function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  return (
    <Pressable style={styles.stat} onPress={onPress} disabled={!onPress}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

function ListRow({ list, showAuthor }: { list: BookList; showAuthor?: boolean }) {
  return (
    <Pressable style={styles.listRow} onPress={() => router.push(`/list/${list.id}`)}>
      <View style={styles.listThumb}>
        <Icon name="create" color={colors.primary} size={22} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.listName}>{list.name}</Text>
        <Text style={styles.listMeta}>
          {list.book_count} {list.book_count === 1 ? "libro" : "libri"}
          {list.follower_count > 0 ? ` · ${list.follower_count} follower` : ""}
          {list.is_public ? "" : " · privata"}
        </Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

function SectionTab({ icon, active, onPress }: { icon: any; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.tab, active && styles.tabOn]} onPress={onPress}>
      <Icon name={icon} color={active ? colors.text : colors.textFaint} filled={active} size={24} />
    </Pressable>
  );
}

function SectionEmpty({ icon, title, msg }: { icon: string; title: string; msg: string }) {
  return (
    <View style={{ height: 220, width: "100%" }}>
      <EmptyState icon={icon} title={title} message={msg} />
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  topLink: { color: colors.textMuted, fontSize: 14, fontWeight: "600" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  statsRow: { flexDirection: "row", flex: 1, justifyContent: "space-around" },
  stat: { alignItems: "center" },
  statValue: { ...typography.h3, color: colors.text, fontSize: 19 },
  statLabel: { ...typography.caption, marginTop: 2 },
  nameBlock: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 2 },
  name: { ...typography.h3 },
  username: { ...typography.bodyMuted },
  bio: { ...typography.body, marginTop: spacing.xs },
  tabbar: {
    flexDirection: "row",
    marginTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabOn: { borderBottomColor: colors.primary },
  feed: { paddingHorizontal: spacing.lg },
  listsWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  listToggle: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  ltBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  ltBtnOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  ltLabel: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  ltLabelOn: { color: colors.onPrimary },
  newList: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  newListIcon: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  newListLabel: { color: colors.primary, fontSize: 16, fontWeight: "700" },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  listThumb: {
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  listName: { color: colors.text, fontSize: 16, fontWeight: "600" },
  listMeta: { color: colors.textFaint, fontSize: 13, marginTop: 2 },
  chev: { color: colors.textFaint, fontSize: 22 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
});
