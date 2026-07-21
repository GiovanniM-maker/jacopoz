import { router } from "expo-router";

/**
 * Go back robustly. `router.back()` silently does nothing when the history
 * stack is empty — which happens after a full page reload (e.g. the theme
 * switch reloads the app on /settings) or when a page is opened from a direct
 * URL. In that case fall back to replacing with a sensible destination.
 */
export function goBack(fallback: string = "/(tabs)"): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback as never);
  }
}
