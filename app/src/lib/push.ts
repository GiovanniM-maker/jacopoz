import { Platform } from "react-native";
import { supabase } from "./supabase";

// VAPID public application-server key. This is PUBLIC by design (it ships in
// every browser subscription) — the matching private key lives only in the
// Edge Function secrets. Must stay in sync with the deployed VAPID_PUBLIC_KEY.
const VAPID_PUBLIC_KEY =
  "BHbDi-Pf5MW1Mscspi0mjfCDUCWL9jbREk62hWc8M20fQP4JG7XyGY4MxsVAHGqnFS7znmVK9Xze2GZdpX2jiWY";

export type PushState = "unsupported" | "denied" | "granted" | "default";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Whether this environment can do Web Push at all (web + SW + PushManager). */
export function pushSupported(): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Current permission state without prompting. */
export function pushState(): PushState {
  if (!pushSupported()) return "unsupported";
  return Notification.permission as PushState;
}

async function subscribeAndSave(): Promise<boolean> {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return false;
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
    p_user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  });
  return !error;
}

/**
 * Ask for permission (if needed) and register this device for push. Must be
 * called from a user gesture on iOS. Returns the resulting state so the caller
 * can show the right message.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  let perm = Notification.permission;
  if (perm === "default") perm = await Notification.requestPermission();
  if (perm !== "granted") return perm as PushState;
  try {
    await subscribeAndSave();
  } catch {
    // subscription can fail (e.g. not installed to Home on iOS) — permission
    // is still granted; surfacing that is enough.
  }
  return "granted";
}

/**
 * Silent re-sync: if the user already granted permission, make sure the
 * current subscription is stored (endpoints rotate). Safe to call on launch;
 * never prompts.
 */
export async function syncPushIfGranted(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  try {
    await subscribeAndSave();
  } catch {
    // ignore
  }
}

/** Revoke this device's subscription server-side (keeps browser permission). */
export async function disablePush(): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await supabase.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
  } catch {
    // ignore
  }
}
