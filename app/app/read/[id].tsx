import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getBookText, getReadProgress, saveBookmark, saveReadProgress } from "@/api/reading";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Icon } from "@/components/ui/Icon";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { colors, displayFont, spacing } from "@/theme";

// A comfortable reading serif on web, regardless of the active theme.
const READING_FONT = Platform.select({
  web: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  default: undefined,
}) as string | undefined;

/**
 * In-app reader for public-domain books. Long-scroll with a live progress
 * bar; position is saved (debounced) and resumed. Crossing 90% marks the
 * book "read". A deliberate bookmark can be dropped and jumped back to.
 */
export default function Reader() {
  const { id, bookId } = useLocalSearchParams<{ id: string; bookId?: string }>();
  const gutenbergId = Number(id);

  const text = useQuery({
    queryKey: ["book-text", gutenbergId],
    queryFn: () => getBookText(gutenbergId),
    enabled: Number.isFinite(gutenbergId),
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const [percent, setPercent] = useState(0);
  const [bookmark, setBookmark] = useState<number | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [saved, setSaved] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const contentH = useRef(0);
  const viewH = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restored = useRef(false);

  const startState = useQuery({
    queryKey: ["read-progress", bookId],
    queryFn: () => getReadProgress(bookId!),
    enabled: !!bookId,
  });

  // Restore last position + surface the bookmark once text and layout are ready.
  useEffect(() => {
    if (!restored.current && text.data && startState.data && contentH.current > 0 && viewH.current > 0) {
      restored.current = true;
      const p = startState.data.percent;
      if (p > 1) {
        scrollRef.current?.scrollTo({ y: (p / 100) * (contentH.current - viewH.current), animated: false });
        setPercent(p);
      }
      if (startState.data.bookmark != null) {
        setBookmark(startState.data.bookmark);
        setShowJump(Math.abs(startState.data.bookmark - p) > 2);
      }
    }
  }, [text.data, startState.data]);

  function scrollToPercent(p: number) {
    const max = contentH.current - viewH.current;
    scrollRef.current?.scrollTo({ y: (p / 100) * max, animated: true });
  }

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    contentH.current = contentSize.height;
    viewH.current = layoutMeasurement.height;
    const max = contentSize.height - layoutMeasurement.height;
    const p = max > 0 ? Math.min(100, Math.max(0, (contentOffset.y / max) * 100)) : 0;
    setPercent(p);
    if (showJump && bookmark != null && Math.abs(p - bookmark) < 2) setShowJump(false);
    if (bookId) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveReadProgress(bookId, p), 1200);
    }
  }

  function onBookmark() {
    if (!bookId) return;
    const p = Math.round(percent);
    setBookmark(p);
    setShowJump(false);
    void saveBookmark(bookId, p);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader title={`Lettura · ${Math.round(percent)}%`} backFallback="/(tabs)" />
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${percent}%` }]} />
        {bookmark != null ? <View style={[styles.mark, { left: `${bookmark}%` }]} /> : null}
      </View>

      {text.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loading}>Sto aprendo il libro…</Text>
        </View>
      ) : text.isError ? (
        <View style={styles.center}>
          <Text style={styles.loading}>Non è stato possibile aprire il testo.</Text>
        </View>
      ) : (
        <>
          {showJump && bookmark != null ? (
            <Pressable
              style={styles.jump}
              onPress={() => {
                scrollToPercent(bookmark);
                setShowJump(false);
              }}
            >
              <Icon name="bookmark" color={colors.onPrimary} size={14} filled />
              <Text style={styles.jumpText}>Riprendi dal segnalibro · {Math.round(bookmark)}%</Text>
            </Pressable>
          ) : null}

          <ScrollView
            ref={scrollRef}
            onScroll={onScroll}
            scrollEventThrottle={100}
            contentContainerStyle={styles.reader}
            showsVerticalScrollIndicator
          >
            <Text style={styles.body} selectable>
              {text.data}
            </Text>
            <View style={{ height: spacing.xxl * 2 }} />
          </ScrollView>

          {/* Floating bookmark button */}
          <Pressable style={styles.fab} onPress={onBookmark} accessibilityLabel="Metti un segnalibro qui">
            <Icon name="bookmark" color={colors.onPrimary} size={20} filled={bookmark != null} />
          </Pressable>
          {saved ? (
            <View style={styles.toast}>
              <Text style={styles.toastText}>Segnalibro a {Math.round(percent)}%</Text>
            </View>
          ) : null}
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  bar: { height: 3, backgroundColor: colors.surfaceAlt },
  barFill: { height: 3, backgroundColor: colors.primary },
  mark: { position: "absolute", top: -2, width: 2, height: 7, backgroundColor: colors.accent },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loading: {
    color: colors.textMuted,
    fontFamily: displayFont,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: 13,
  },
  jump: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "center",
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: 999,
  },
  jumpText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  reader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    maxWidth: 680,
    alignSelf: "center",
    width: "100%",
  },
  body: {
    color: colors.text,
    fontSize: 18,
    lineHeight: 29,
    fontFamily: READING_FONT,
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 5,
  },
  toast: {
    position: "absolute",
    bottom: spacing.xl + 8,
    right: spacing.lg + 60,
    backgroundColor: colors.text,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
  },
  toastText: { color: colors.bg, fontSize: 12, fontWeight: "700" },
});
