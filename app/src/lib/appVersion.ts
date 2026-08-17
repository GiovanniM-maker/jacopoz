import { Platform } from "react-native";

/**
 * The build currently running, stamped into index.html by scripts/inject-pwa.mjs.
 * An installed PWA can keep serving an older bundle from the service-worker
 * cache, which makes "I still see the old behaviour" impossible to tell apart
 * from "it was never fixed". Showing the build — and offering a hard refresh —
 * removes that ambiguity.
 */
export function buildId(): string {
  if (Platform.OS !== "web" || typeof document === "undefined") return "native";
  const meta = document.querySelector('meta[name="tomo-build"]');
  return meta?.getAttribute("content") ?? "dev";
}

/**
 * Drop every cached asset, unregister the service worker and reload, so the next
 * load comes straight from the network. The only reliable escape hatch when a
 * stale worker is pinning an old build.
 */
export async function hardRefresh(): Promise<void> {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    // best effort — reload anyway
  }
  window.location.reload();
}
