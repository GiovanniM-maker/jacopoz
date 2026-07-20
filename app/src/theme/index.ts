// =====================================================================
// Theming. Three switchable palettes (Notturno / Carta / Sobrio) exposed
// through a context so the whole app restyles at runtime. Non-color tokens
// (spacing, radius, type scale) are constant; only colors + the derived
// typography colors change per theme.
//
// Components read colors via useTheme() and build styles with
// useThemedStyles(({ colors, typography }) => StyleSheet.create(...)), which
// memoizes per active palette.
// =====================================================================
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
// Sharp, editorial corners — minimal, "blog"-like rather than rounded.
export const radius = { sm: 2, md: 4, lg: 8, pill: 999 } as const;
export const COVER_ASPECT = 2 / 3;

export interface Palette {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textMuted: string;
  textFaint: string;
  primary: string;
  primaryDim: string;
  accent: string;
  success: string;
  star: string;
  overlay: string;
  onPrimary: string; // text/icon color on top of `primary`
  tabBar: string;
  isDark: boolean;
}

export type ThemeName = "notturno" | "carta" | "sobrio";

export const THEMES: { name: ThemeName; label: string; hint: string }[] = [
  { name: "notturno", label: "Notturno", hint: "Scuro · ottone" },
  { name: "carta", label: "Carta", hint: "Chiaro · oxblood" },
  { name: "sobrio", label: "Sobrio", hint: "Chiaro · petrolio" },
];

export const palettes: Record<ThemeName, Palette> = {
  // Warm near-black + ivory + brass. Elegant evolution of the dark app.
  notturno: {
    bg: "#17130E", surface: "#221C15", surfaceAlt: "#2E2619", border: "#342A1D",
    text: "#EFE7DA", textMuted: "#A99A82", textFaint: "#766A56",
    primary: "#C6A15B", primaryDim: "#6E5A33", accent: "#C6A15B",
    success: "#7DA36B", star: "#C6A15B", overlay: "rgba(0,0,0,0.55)",
    onPrimary: "#17130E", tabBar: "#120F0A", isDark: true,
  },
  // Warm paper + ink + oxblood. Editorial, light.
  carta: {
    bg: "#F6F4EF", surface: "#FFFFFF", surfaceAlt: "#EFEBE2", border: "#E6E1D8",
    text: "#1E1B18", textMuted: "#6E675E", textFaint: "#9A9184",
    primary: "#7B2E3B", primaryDim: "#C9A6AC", accent: "#7B2E3B",
    success: "#4B7A52", star: "#C08A2E", overlay: "rgba(30,27,24,0.5)",
    onPrimary: "#FFFFFF", tabBar: "#FFFFFF", isDark: false,
  },
  // Cool light greys + petrol. Swiss minimal, light.
  sobrio: {
    bg: "#F4F5F6", surface: "#FFFFFF", surfaceAlt: "#EAECEE", border: "#E2E5E7",
    text: "#16191C", textMuted: "#5E676D", textFaint: "#98A0A6",
    primary: "#0E6E6E", primaryDim: "#A8C9C9", accent: "#0E6E6E",
    success: "#2E7D5B", star: "#C08A2E", overlay: "rgba(22,25,28,0.45)",
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

const DEFAULT: ThemeName = "notturno";

interface ThemeState {
  name: ThemeName;
  colors: Palette;
  typography: Typography;
  setTheme: (n: ThemeName) => void;
}

// Default colors/typography for any non-component reference (kept in sync
// with the default palette).
export const colors = palettes[DEFAULT];
export const typography = makeTypography(palettes[DEFAULT]);

const ThemeContext = createContext<ThemeState>({
  name: DEFAULT,
  colors: palettes[DEFAULT],
  typography: makeTypography(palettes[DEFAULT]),
  setTheme: () => {},
});

const STORAGE_KEY = "decameron.theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState<ThemeName>(DEFAULT);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v && v in palettes) setName(v as ThemeName);
    });
  }, []);

  const value = useMemo<ThemeState>(() => {
    const pal = palettes[name];
    return {
      name,
      colors: pal,
      typography: makeTypography(pal),
      setTheme: (n: ThemeName) => {
        setName(n);
        void AsyncStorage.setItem(STORAGE_KEY, n);
      },
    };
  }, [name]);

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeState {
  return useContext(ThemeContext);
}

/** Build a StyleSheet from the active theme, memoized per palette. */
export function useThemedStyles<T>(factory: (t: { colors: Palette; typography: Typography }) => T): T {
  const { colors: c, typography: t } = useTheme();
  return useMemo(() => factory({ colors: c, typography: t }), [c, t, factory]);
}
