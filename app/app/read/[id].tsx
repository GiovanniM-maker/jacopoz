import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { getBookText, getReadProgress, saveReadProgress } from "@/api/reading";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ScreenContainer } from "@/components/ui/ScreenContainer";
import { Platform } from "react-native";
import { colors, displayFont, spacing } from "@/theme";

// A comfortable reading serif on web, regardless of the active theme.
const READING_FONT = Platform.select({
  web: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  default: undefined,
}) as string | undefined;

/**
 * In-app reader for public-domain books. Long-scroll with a live progress
 * bar; position is saved (debounced) and resumed. Crossing 90% marks the
 * book "read" server-side — the strongest signal for the algorithm.
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
  const scrollRef = useRef<ScrollView>(null);
  const contentH = useRef(0);
  const viewH = useRef(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restored = useRef(false);

  // Restore last position once the text and layout are ready.
  const startPct = useQuery({
    queryKey: ["read-progress", bookId],
    queryFn: () => getReadProgress(bookId!),
    enabled: !!bookId,
  });

  useEffect(() => {
    if (
      !restored.current &&
      text.data &&
      startPct.data &&
      startPct.data > 1 &&
      contentH.current > 0 &&
      viewH.current > 0
    ) {
      restored.current = true;
      const y = (startPct.data / 100) * (contentH.current - viewH.current);
      scrollRef.current?.scrollTo({ y, animated: false });
      setPercent(startPct.data);
    }
  }, [text.data, startPct.data]);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    contentH.current = contentSize.height;
    viewH.current = layoutMeasurement.height;
    const max = contentSize.height - layoutMeasurement.height;
    const p = max > 0 ? Math.min(100, Math.max(0, (contentOffset.y / max) * 100)) : 0;
    setPercent(p);
    if (bookId) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void saveReadProgress(bookId, p), 1200);
    }
  }

  return (
    <ScreenContainer edges={["top"]}>
      <ScreenHeader
        title={`Lettura · ${Math.round(percent)}%`}
        backFallback="/(tabs)"
      />
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${percent}%` }]} />
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
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  bar: { height: 3, backgroundColor: colors.surfaceAlt },
  barFill: { height: 3, backgroundColor: colors.primary },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  loading: {
    color: colors.textMuted,
    fontFamily: displayFont,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontSize: 13,
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
});
