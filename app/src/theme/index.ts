// =====================================================================
// Design tokens. A single dark theme for the beta (the app is styled
// dark-first, Netflix-like). Centralized so screens never hardcode hex.
// =====================================================================

export const colors = {
  bg: "#0B0B0F",
  surface: "#16161D",
  surfaceAlt: "#1F1F29",
  border: "#2A2A36",
  text: "#F5F5F7",
  textMuted: "#9A9AA8",
  textFaint: "#63636F",
  primary: "#E63946", // jacopoz red — CTAs, active states
  primaryDim: "#7A1F26",
  accent: "#F4A261",
  success: "#2A9D8F",
  star: "#F4C430",
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
