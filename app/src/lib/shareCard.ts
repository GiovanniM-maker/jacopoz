// =====================================================================
// Shareable image cards — the growth loop. A user taps "Condividi" and gets
// a branded Tomo image (magazine-cover style) to post to IG/WhatsApp; every
// share is free reach that links back to the app. Web-only (uses canvas +
// Web Share API); a no-op elsewhere.
// =====================================================================
import { Platform } from "react-native";

const SITE = "jacopoz.vercel.app";
// A fixed, elegant palette so every share looks the same brand regardless of
// the sharer's active theme.
const CREAM = "#F6F1E6";
const INK = "#141414";
const BRASS = "#C49A2B";
const BANDS = ["#B23A2E", "#21447A", "#216F60", "#7A2E4A", "#C49A2B", "#2E2A26"];

function bandFor(seed: string): { band: string; number: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return { band: BANDS[h % BANDS.length], number: String((h % 99) + 1).padStart(2, "0") };
}

function esc(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Greedy word-wrap into at most `maxLines` lines of ~`perLine` chars.
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const words = (text || "").trim().split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > perLine) {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length === maxLines - 1) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  const used = lines.join(" ").split(/\s+/).length;
  if (used < words.length && lines.length) lines[lines.length - 1] += "…";
  return lines;
}

const STATUS_LABEL: Record<string, string> = {
  read: "L'ho letto",
  reading: "Lo sto leggendo",
  want_to_read: "Voglio leggerlo",
  dnf: "Non l'ho finito",
};

export interface ShareCardData {
  title: string;
  author?: string | null;
  rating?: number | null; // 1..5
  status?: string | null;
  note?: string | null; // a short review/quote
}

function buildSvg(d: ShareCardData): string {
  const W = 1080, H = 1920;
  const { band, number } = bandFor(d.title);
  const bandOnLight = luminance(band) > 0.6;
  const bandInk = bandOnLight ? INK : CREAM;
  const topH = 700;

  const titleLines = wrap(d.title.toUpperCase(), 15, 3);
  const titleSize = titleLines.length > 2 ? 96 : 116;
  const titleSvg = titleLines
    .map((l, i) => `<tspan x="90" dy="${i === 0 ? 0 : titleSize + 8}">${esc(l)}</tspan>`)
    .join("");

  const rating = Math.max(0, Math.min(5, Math.round(d.rating ?? 0)));
  const diamonds = rating
    ? Array.from({ length: 5 }, (_, i) => (i < rating ? "◆" : "◇")).join(" ")
    : "";

  const label = d.status ? STATUS_LABEL[d.status] ?? "" : "";
  const noteLines = d.note ? wrap(`“${d.note}”`, 40, 3) : [];
  const noteSvg = noteLines
    .map((l, i) => `<tspan x="90" dy="${i === 0 ? 0 : 54}">${esc(l)}</tspan>`)
    .join("");

  const serif = "Georgia, 'Times New Roman', serif";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${CREAM}"/>
  <!-- top colour block: the magazine masthead -->
  <rect x="0" y="0" width="${W}" height="${topH}" fill="${band}"/>
  <text x="90" y="150" font-family="${serif}" font-size="34" letter-spacing="6" fill="${bandInk}" opacity="0.85">PERIODICO DI LETTURE · N°${number}</text>
  <text x="90" y="430" font-family="${serif}" font-weight="bold" font-size="300" fill="${bandInk}">Tomo</text>
  ${label ? `<text x="90" y="580" font-family="${serif}" font-size="52" font-style="italic" fill="${bandInk}" opacity="0.92">${esc(label)}</text>` : ""}
  <!-- book -->
  <text x="90" y="900" font-family="${serif}" font-weight="bold" font-size="${titleSize}" fill="${INK}">${titleSvg}</text>
  ${d.author ? `<text x="90" y="${900 + titleLines.length * (titleSize + 6) + 40}" font-family="${serif}" font-style="italic" font-size="52" fill="#5A5A5A">${esc(d.author)}</text>` : ""}
  ${diamonds ? `<text x="90" y="${900 + titleLines.length * (titleSize + 6) + 150}" font-family="${serif}" font-size="90" letter-spacing="14" fill="${BRASS}">${diamonds}</text>` : ""}
  ${noteSvg ? `<text x="90" y="${diamonds ? 1560 : 1440}" font-family="${serif}" font-style="italic" font-size="44" fill="${INK}">${noteSvg}</text>` : ""}
  <!-- footer -->
  <line x1="90" y1="1780" x2="${W - 90}" y2="1780" stroke="${INK}" stroke-width="3" opacity="0.25"/>
  <text x="90" y="1850" font-family="${serif}" font-size="40" fill="${INK}">Scopri libri con gli amici</text>
  <text x="${W - 90}" y="1850" text-anchor="end" font-family="${serif}" font-weight="bold" font-size="40" fill="${BRASS}">${SITE}</text>
</svg>`;
}

function luminance(hex: string): number {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

async function svgToPng(svg: string, w: number, h: number): Promise<Blob> {
  const url = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
  const img = new Image();
  img.decoding = "async";
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error("svg load failed"));
    img.src = url;
  });
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png", 0.95));
}

/** Generate and share (or download) a Tomo card for a book. Web only. */
export async function shareBookCard(d: ShareCardData): Promise<void> {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const blob = await svgToPng(buildSvg(d), 1080, 1920);
  const file = new File([blob], "tomo.png", { type: "image/png" });
  const text = `${d.title}${d.author ? ` — ${d.author}` : ""} · su Tomo`;
  const nav = navigator as any;
  try {
    if (nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: "Tomo", text });
      return;
    }
  } catch {
    // fall through to download
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "tomo.png";
  a.click();
  URL.revokeObjectURL(a.href);
}
