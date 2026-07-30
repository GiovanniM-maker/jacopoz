import { useWindowDimensions } from "react-native";
import { gridCardWidth } from "@/theme";

/**
 * Reactive card width for the book grids. A hook (not a module constant) so it
 * survives rotation, window resizes, and — the case that actually bit us — a
 * first paint on web where a module-load-time Dimensions read is still stale.
 */
export function useGridCardWidth(columns = 3): number {
  const { width } = useWindowDimensions();
  return gridCardWidth(width, columns);
}
