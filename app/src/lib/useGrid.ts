import { useWindowDimensions } from "react-native";
import { gridCardWidth, gridColumns } from "@/theme";

/**
 * Reactive card width for the book grids. A hook (not a module constant) so it
 * survives rotation, window resizes, and — the case that actually bit us — a
 * first paint on web where a module-load-time Dimensions read is still stale.
 *
 * Pass nothing to let the column count follow the window; pass a number to pin
 * it (the profile shelves are deliberately three-up to match the feed).
 */
export function useGridCardWidth(columns?: number): number {
  const { width } = useWindowDimensions();
  return gridCardWidth(width, columns ?? gridColumns(width));
}

/**
 * How many books fit across. Three is the phone-portrait answer and the one the
 * feed and shelves are designed around; turning the phone sideways roughly
 * doubles the usable width, and holding three columns there blew each cover up
 * to ~256pt — a grid of four enormous books.
 */
export function useGridColumns(): number {
  const { width } = useWindowDimensions();
  return gridColumns(width);
}
