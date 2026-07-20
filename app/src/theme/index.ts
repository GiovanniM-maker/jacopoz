// =====================================================================
// Theming. Two selectable looks:
//   • Notturno — elegant warm-dark + brass (the crafted default)
//   • Social  — bright, Instagram-like (white surfaces, social blue)
//
// The active palette is chosen ONCE at startup (read synchronously from
// localStorage on web) and exposed as the static `colors`/`typography`
// that every component already imports — so switching needs no per-file
// refactor. Changing the theme persists the choice and reloads the app.
// =====================================================================
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
// Sharp, editorial corners — minimal, "blog"-like rather than rounded.
export const radius = { sm: 2, md: 4, lg: 8, pill: 999 } as const;
export const COVER_ASPECT = 2 / 3;

export interface Palette {
  bg: string; surface: string; surfaceAlt: string; border: string;
  text: string; textMuted: string; textFaint: string;
  primary: string; primaryDim: string; accent: string;
  success: string; star: string; overlay: string;
  onPrimary: string; tabBar: string; isDark: boolean;
}

export type ThemeName = "notturno" | "social";

export const THEMES: { name: ThemeName; label: string; hint: string }[] = [
  { name: "notturno", label: "Notturno", hint: "Scuro ed elegante · ottone" },
  { name: "social", label: "Social", hint: "Chiaro · stile Instagram" },
];

export const palettes: Record<ThemeName, Palette> = {
  // Warm near-black + ivory + brass.
  notturno: {
    bg: "#17130E", surface: "#221C15", surfaceAlt: "#2E2619", border: "#342A1D",
    text: "#EFE7DA", textMuted: "#A99A82", textFaint: "#766A56",
    primary: "#C6A15B", primaryDim: "#6E5A33", accent: "#C6A15B",
    success: "#7DA36B", star: "#C6A15B", overlay: "rgba(0,0,0,0.55)",
    onPrimary: "#17130E", tabBar: "#120F0A", isDark: true,
  },
  // Bright, Instagram-like: near-white canvas, crisp borders, social blue.
  social: {
    bg: "#FAFAFA", surface: "#FFFFFF", surfaceAlt: "#F1F1F1", border: "#DBDBDB",
    text: "#1A1A1A", textMuted: "#737373", textFaint: "#B0B0B0",
    primary: "#0095F6", primaryDim: "#B2DFFC", accent: "#0095F6",
    success: "#2E9E5B", star: "#FFB800", overlay: "rgba(0,0,0,0.5)",
    onPrimary: "#FFFFFF", tabBar: "#FFFFFF", isDark: false,
  },
};

export interface Typography {
  h1: { fontSize: number; fontWeight: "800"; color: string };
  h2: { fontSize: number; fontWeight: "700"; color: string };
  h3: { fontSize: number; fontWeight: "700"; color: string };
  body: { fontSize: number; fontWeight: "400"; color: string };
  bodyMuted: { fontSize: number; fontWeight: "400"; color: string };
  caption: { fontSize: number; fontWeight: "500"; color: string };
}

function makeTypography(c: Palette): Typography {
  return {
    h1: { fontSize: 28, fontWeight: "800", color: c.text },
    h2: { fontSize: 22, fontWeight: "700", color: c.text },
    h3: { fontSize: 17, fontWeight: "700", color: c.text },
    body: { fontSize: 15, fontWeight: "400", color: c.text },
    bodyMuted: { fontSize: 14, fontWeight: "400", color: c.textMuted },
    caption: { fontSize: 12, fontWeight: "500", color: c.textFaint },
  };
}

const STORAGE_KEY = "decameron.theme";
const DEFAULT: ThemeName = "notturno";

// Read the saved theme synchronously at startup (web localStorage). On native
// this is unavailable, so it starts at the default and applies on next launch.
function readInitialTheme(): ThemeName {
  try {
    const v = (globalThis as any)?.localStorage?.getItem(STORAGE_KEY);
    if (v && v in palettes) return v as ThemeName;
  } catch {
    // ignore
  }
  return DEFAULT;
}

export const activeTheme: ThemeName = readInitialTheme();
export const colors: Palette = palettes[activeTheme];
export const typography: Typography = makeTypography(palettes[activeTheme]);

/** Persist the chosen theme and reload so the whole app adopts it. */
export async function setTheme(name: ThemeName): Promise<void> {
  try {
    (globalThis as any)?.localStorage?.setItem(STORAGE_KEY, name);
  } catch {
    // ignore
  }
  try {
    await AsyncStorage.setItem(STORAGE_KEY, name);
  } catch {
    // ignore
  }
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    window.location.reload();
  }
}
