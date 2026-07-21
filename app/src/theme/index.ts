// =====================================================================
// Theming. Six selectable looks in two families plus two legacy ones:
//   • Collana        — newsstand paperback: newsprint paper, hard black
//                      borders, offset shadows, condensed display type
//   • Collana Notte  — night newsstand (dark)
//   • Rivista        — cultural magazine à la Lucy sulla cultura: pure
//                      white, borderless soft cards, serif logo, green
//                      #00E35B as the touch colour, diamond ratings
//   • Rivista Notte  — the magazine's black band as a full theme (dark)
//   • Notturno       — legacy warm-dark + brass
//   • Social         — legacy Instagram-like light
//
// The active palette is chosen ONCE at startup (read synchronously from
// localStorage on web) and exposed as the static `colors`/`radius`/
// `typography` that every component already imports — so switching needs
// no per-file refactor. Changing the theme persists the choice and reloads.
// =====================================================================
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const COVER_ASPECT = 2 / 3;

// Display faces, no bundled webfonts. Collana uses a condensed heavy
// "poster" stack (Impact-adjacent — on-brand for pulp); Rivista uses a
// light editorial serif à la Lucy. Resolved per active theme below.
const CONDENSED_FONT = Platform.select({
  web: "'Haettenschweiler','Arial Narrow','Oswald','Impact','Franklin Gothic Bold',sans-serif",
  default: undefined,
}) as string | undefined;
const SERIF_FONT = Platform.select({
  web: "Georgia,'Times New Roman','Palatino Linotype',serif",
  default: undefined,
}) as string | undefined;

export interface Radius { sm: number; md: number; lg: number; pill: number }

export interface Palette {
  bg: string; surface: string; surfaceAlt: string; border: string;
  text: string; textMuted: string; textFaint: string;
  primary: string; primaryDim: string; accent: string;
  success: string; star: string; overlay: string;
  onPrimary: string; tabBar: string; isDark: boolean;
  radius: Radius;
  shadow: string;        // drop-shadow colour (hard for collana, soft veil for rivista)
  bands: string[];       // spine/rubric colours cycled across generated covers & avatars
  coverPaper: string;    // plate colour of a generated poster cover
  coverInk: string;      // ink colour on a generated poster cover
  wordmarkGhost: string; // offset "out-of-register" ghost behind the wordmark
  // Family flags — let shared primitives restyle without per-file forks:
  texture: boolean;      // halftone print dots behind screens (collana)
  serifLogo: boolean;    // "Tomo" serif wordmark instead of condensed TOMO
  diamonds: boolean;     // ratings drawn as ◆◇ instead of ★☆ (rivista)
  soft: boolean;         // soft diffuse shadow instead of the hard offset one
}

export type ThemeName =
  | "collana" | "collananotte"
  | "rivista" | "rivistanotte"
  | "notturno" | "social";

export const THEMES: { name: ThemeName; label: string; hint: string }[] = [
  { name: "collana", label: "Collana", hint: "Chiaro · edicola / tascabile" },
  { name: "collananotte", label: "Collana Notte", hint: "Scuro · edicola di notte" },
  { name: "rivista", label: "Rivista", hint: "Chiaro · magazine, verde e rombi" },
  { name: "rivistanotte", label: "Rivista Notte", hint: "Scuro · la banda nera" },
  { name: "notturno", label: "Notturno", hint: "Scuro ed elegante · ottone" },
  { name: "social", label: "Social", hint: "Chiaro · stile Instagram" },
];

const SHARP: Radius = { sm: 0, md: 0, lg: 2, pill: 999 };
const ROUND: Radius = { sm: 2, md: 4, lg: 8, pill: 999 };
const SOFT: Radius = { sm: 8, md: 10, lg: 14, pill: 999 };

// The seven collana spine colours, in light and night variants.
const BANDS_DAY = ["#D9531E", "#1C3C86", "#E3A11F", "#BE3327", "#216F60", "#7A2E4A", "#1B1610"];
const BANDS_NIGHT = ["#F26B34", "#3E63C8", "#E9B23A", "#E56A5A", "#3E9C86", "#A24C6C", "#C8A24A"];
// Lucy-style rubric colours shared by both Rivista modes.
const BANDS_RIVISTA = ["#FF008C", "#3549D3", "#4E8E79", "#FF5100", "#00E35B"];

export const palettes: Record<ThemeName, Palette> = {
  // Newsprint paper + hard black ink + burnt-orange spine. The default.
  collana: {
    bg: "#ECE1C8", surface: "#E4D6B6", surfaceAlt: "#D9C7A0", border: "#1B1610",
    text: "#1B1610", textMuted: "#4A3F30", textFaint: "#8A7A5E",
    primary: "#D9531E", primaryDim: "#E8A57F", accent: "#1C3C86",
    success: "#216F60", star: "#BE3327", overlay: "rgba(27,22,16,0.55)",
    onPrimary: "#ECE1C8", tabBar: "#ECE1C8", isDark: false,
    radius: SHARP, shadow: "#1B1610", bands: BANDS_DAY,
    coverPaper: "#ECE1C8", coverInk: "#1B1610", wordmarkGhost: "#1C3C86",
    texture: true, serifLogo: false, diamonds: false, soft: false,
  },
  // Night newsstand: deep warm black, paper-coloured hard borders.
  collananotte: {
    bg: "#14110B", surface: "#1E1913", surfaceAlt: "#2A2217", border: "#E7DCC2",
    text: "#ECE1C8", textMuted: "#B6A888", textFaint: "#7C6F57",
    primary: "#F26B34", primaryDim: "#7A3A1E", accent: "#E3A11F",
    success: "#4FA98E", star: "#E56A5A", overlay: "rgba(0,0,0,0.6)",
    onPrimary: "#14110B", tabBar: "#14110B", isDark: true,
    radius: SHARP, shadow: "#000000", bands: BANDS_NIGHT,
    coverPaper: "#1E1913", coverInk: "#ECE1C8", wordmarkGhost: "#3E63C8",
    texture: true, serifLogo: false, diamonds: false, soft: false,
  },
  // Cultural magazine (Lucy): pure white, borderless soft cards, serif,
  // green as the touch colour, acid yellow as the spark.
  rivista: {
    bg: "#FFFFFF", surface: "#F6F6F3", surfaceAlt: "#ECEBE6", border: "#E4E4DE",
    text: "#101010", textMuted: "#5A5A5A", textFaint: "#A3A3A3",
    primary: "#00E35B", primaryDim: "#B8F5CF", accent: "#3549D3",
    success: "#00A947", star: "#101010", overlay: "rgba(16,16,16,0.5)",
    onPrimary: "#101010", tabBar: "#FFFFFF", isDark: false,
    radius: SOFT, shadow: "rgba(16,16,16,0.16)", bands: BANDS_RIVISTA,
    coverPaper: "#F6F6F3", coverInk: "#101010", wordmarkGhost: "transparent",
    texture: false, serifLogo: true, diamonds: true, soft: true,
  },
  // The magazine's black band as a full theme.
  rivistanotte: {
    bg: "#0E0E0E", surface: "#1A1A1A", surfaceAlt: "#222222", border: "#2A2A2A",
    text: "#FFFFFF", textMuted: "#9B9B9B", textFaint: "#6E6E6E",
    primary: "#00E35B", primaryDim: "#0A5A2C", accent: "#EFFC73",
    success: "#00E35B", star: "#FFFFFF", overlay: "rgba(0,0,0,0.65)",
    onPrimary: "#101010", tabBar: "#0E0E0E", isDark: true,
    radius: SOFT, shadow: "rgba(0,0,0,0.6)", bands: BANDS_RIVISTA,
    coverPaper: "#1A1A1A", coverInk: "#FFFFFF", wordmarkGhost: "transparent",
    texture: false, serifLogo: true, diamonds: true, soft: true,
  },
  // Legacy — warm near-black + ivory + brass.
  notturno: {
    bg: "#17130E", surface: "#221C15", surfaceAlt: "#2E2619", border: "#342A1D",
    text: "#EFE7DA", textMuted: "#A99A82", textFaint: "#766A56",
    primary: "#C6A15B", primaryDim: "#6E5A33", accent: "#C6A15B",
    success: "#7DA36B", star: "#C6A15B", overlay: "rgba(0,0,0,0.55)",
    onPrimary: "#17130E", tabBar: "#120F0A", isDark: true,
    radius: ROUND, shadow: "rgba(0,0,0,0.5)", bands: BANDS_DAY,
    coverPaper: "#2E2619", coverInk: "#EFE7DA", wordmarkGhost: "rgba(198,161,91,0.4)",
    texture: false, serifLogo: false, diamonds: false, soft: true,
  },
  // Legacy — bright, Instagram-like.
  social: {
    bg: "#FAFAFA", surface: "#FFFFFF", surfaceAlt: "#F1F1F1", border: "#DBDBDB",
    text: "#1A1A1A", textMuted: "#737373", textFaint: "#B0B0B0",
    primary: "#0095F6", primaryDim: "#B2DFFC", accent: "#0095F6",
    success: "#2E9E5B", star: "#FFB800", overlay: "rgba(0,0,0,0.5)",
    onPrimary: "#FFFFFF", tabBar: "#FFFFFF", isDark: false,
    radius: ROUND, shadow: "rgba(0,0,0,0.25)", bands: BANDS_DAY,
    coverPaper: "#F1F1F1", coverInk: "#1A1A1A", wordmarkGhost: "rgba(0,149,246,0.25)",
    texture: false, serifLogo: false, diamonds: false, soft: true,
  },
};

export interface Typography {
  h1: { fontSize: number; fontWeight: "800"; color: string };
  h2: { fontSize: number; fontWeight: "700"; color: string };
  h3: { fontSize: number; fontWeight: "700"; color: string };
  body: { fontSize: number; fontWeight: "400"; color: string };
  bodyMuted: { fontSize: number; fontWeight: "400"; color: string };
  caption: { fontSize: number; fontWeight: "500"; color: string };
  display: {
    fontFamily: string | undefined; fontWeight: "900";
    color: string; textTransform: "uppercase"; letterSpacing: number;
  };
}

function makeTypography(c: Palette): Typography {
  return {
    h1: { fontSize: 28, fontWeight: "800", color: c.text },
    h2: { fontSize: 22, fontWeight: "700", color: c.text },
    h3: { fontSize: 17, fontWeight: "700", color: c.text },
    body: { fontSize: 15, fontWeight: "400", color: c.text },
    bodyMuted: { fontSize: 14, fontWeight: "400", color: c.textMuted },
    caption: { fontSize: 12, fontWeight: "500", color: c.textFaint },
    display: {
      fontFamily: displayFont, fontWeight: "900",
      color: c.text, textTransform: "uppercase", letterSpacing: 0.3,
    },
  };
}

const STORAGE_KEY = "tomo.theme";
const DEFAULT: ThemeName = "collana";

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
export const radius: Radius = palettes[activeTheme].radius;

// Display face follows the family: editorial serif for Rivista, condensed
// poster type everywhere else.
export const displayFont = colors.serifLogo ? SERIF_FONT : CONDENSED_FONT;

export const typography: Typography = makeTypography(palettes[activeTheme]);

/** Deterministic spine colour + catalogue number for a book, from its title. */
export function collanaMark(seed: string): { band: string; number: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const band = colors.bands[h % colors.bands.length];
  const number = String((h % 99) + 1).padStart(2, "0");
  return { band, number };
}

/** Pick ink or paper for text sitting on a coloured band, by its luminance. */
export function onBand(hex: string): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#1B1610" : "#ECE1C8";
}

/**
 * The theme's card shadow. Collana: hard, blur-free offset — printed "paper
 * on paper". Soft themes (Rivista & legacy): a diffuse drop instead.
 */
export const hardShadow = colors.soft
  ? ({
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 1,
      shadowRadius: 16,
      elevation: 4,
    } as const)
  : ({
      shadowColor: colors.shadow,
      shadowOffset: { width: 3, height: 4 },
      shadowOpacity: 1,
      shadowRadius: 0,
      elevation: 4,
    } as const);

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
