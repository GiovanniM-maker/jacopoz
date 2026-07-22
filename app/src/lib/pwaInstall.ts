// Web PWA install helper. Chrome fires `beforeinstallprompt` exactly once and
// early (before our React tree may have mounted the relevant screen), so we
// capture it here at module load and expose a tiny store any component can use.
import { Platform } from "react-native";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function isWeb(): boolean {
  return Platform.OS === "web";
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

/** Whether an install affordance makes sense right now. */
export function canInstall(): boolean {
  if (!isWeb() || installed || isStandalone()) return false;
  // Native prompt is ready, or iOS where we can show manual steps.
  return !!deferred || isIos();
}

/** Fires the native install dialog. Returns false when it isn't available
 *  (e.g. iOS — the caller should show the manual "Aggiungi a Home" steps). */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  await deferred.userChoice.catch(() => undefined);
  deferred = null;
  emit();
  return true;
}

/** Subscribe to availability changes; returns an unsubscribe fn. */
export function onInstallChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress Chrome's mini-infobar; we drive install ourselves
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    installed = true;
    deferred = null;
    emit();
  });
}
