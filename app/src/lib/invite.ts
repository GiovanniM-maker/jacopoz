import { Platform } from "react-native";

/** The public app URL new readers land on. */
export const APP_URL = "https://jacopoz.vercel.app";

const MESSAGE =
  "Sto usando Tomo, la collana che leggi con gli amici — recensioni, liste e libri gratis da leggere insieme. Unisciti a me:";

/**
 * Invite a friend. On web with the Web Share API this opens the native share
 * sheet (WhatsApp, Messages, …) — the cheapest, highest-intent growth lever we
 * have. Otherwise it copies the invite to the clipboard. Returns how it went so
 * the caller can show the right toast.
 */
export async function inviteFriend(): Promise<"shared" | "copied" | "failed"> {
  const text = `${MESSAGE} ${APP_URL}`;
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ title: "Tomo", text: MESSAGE, url: APP_URL });
        return "shared";
      } catch {
        // user dismissed the sheet, or share failed — fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      return "failed";
    }
  }
  return "failed";
}
