// =====================================================================
// Design tokens. A single dark theme for the beta (the app is styled
// dark-first, Netflix-like). Centralized so screens never hardcode hex.
// =====================================================================

// Netflix palette: near-black canvas, signature red, high-contrast text.
export const colors = {
  bg: "#141414",
  surface: "#181818",
  surfaceAlt: "#2A2A2A",
  border: "#333333",
  text: "#FFFFFF",
  textMuted: "#B3B3B3",
  textFaint: "#808080",
  primary: "#E50914", // Netflix red — CTAs, active states
  primaryDim: "#7A0A10",
  accent: "#E5A00D",
  success: "#46D369",
  star: "#E5A00D",
  overlay: "rgba(0,0,0,0.55)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const typography = {
  h1: { fontSize: 28, fontWeight: "800" as const, color: colors.text },
  h2: { fontSize: 22, fontWeight: "700" as const, color: colors.text },
  h3: { fontSize: 17, fontWeight: "700" as const, color: colors.text },
  body: { fontSize: 15, fontWeight: "400" as const, color: colors.text },
  bodyMuted: { fontSize: 14, fontWeight: "400" as const, color: colors.textMuted },
  caption: { fontSize: 12, fontWeight: "500" as const, color: colors.textFaint },
} as const;

// Standard book-cover aspect ratio (2:3).
export const COVER_ASPECT = 2 / 3;
