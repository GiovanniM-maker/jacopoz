// Post-export: inject PWA head tags + service-worker registration into the
// single-output index.html (Expo's "single" web output does not run +html),
// and stamp a unique build id into the service worker so each deploy rotates
// its cache.
import { readFileSync, writeFileSync } from "node:fs";

// L'origine di Supabase per il preconnect: si legge dalla stessa variabile che
// usa il client, così non può divergere dal progetto realmente usato.
// Questo script gira come node semplice, non dentro il bundler: `.env` non è
// caricato da solo, quindi va letto.
const SUPABASE_ORIGIN = (() => {
  let raw = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  if (!raw) {
    try {
      const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
      raw = /^EXPO_PUBLIC_SUPABASE_URL=(.+)$/m.exec(env)?.[1]?.trim() ?? "";
    } catch {
      raw = "";
    }
  }
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
})();

// Il primo dato che la app chiede parte solo dopo un handshake TLS con
// Supabase: misurato ~400 ms. Con questi tag il browser apre la connessione
// mentre sta ancora scaricando il bundle, così quando il codice parte il canale
// è già pronto. Senza origine nota è meglio non emettere niente che emettere un
// href vuoto.
const PRECONNECT = SUPABASE_ORIGIN
  ? `    <link rel="preconnect" href="${SUPABASE_ORIGIN}" crossorigin />\n` +
    `    <link rel="dns-prefetch" href="${SUPABASE_ORIGIN}" />`
  : "";

const BUILD_ID = String(Date.now());

// 1. Stamp the build id into the service worker (rotates the cache per deploy).
const swPath = "dist/sw.js";
try {
  let sw = readFileSync(swPath, "utf8");
  if (sw.includes("__BUILD_ID__")) {
    sw = sw.replaceAll("__BUILD_ID__", BUILD_ID);
    writeFileSync(swPath, sw);
    console.log("inject-pwa: stamped sw.js cache -> tomo-" + BUILD_ID);
  }
} catch {
  console.log("inject-pwa: no dist/sw.js to stamp");
}

// 2. Inject PWA head tags + SW registration into index.html.
const path = "dist/index.html";
let html = readFileSync(path, "utf8");

if (html.includes("manifest.webmanifest")) {
  console.log("inject-pwa: already injected");
  process.exit(0);
}

// Register the SW and, whenever the app regains focus, ask the browser to check
// for a newer service worker — so an installed PWA picks up deploys instead of
// running a days-old bundle. (No auto-reload: avoids reload loops on iOS.)
const reg =
  "if('serviceWorker' in navigator){window.addEventListener('load',function(){" +
  "navigator.serviceWorker.register('/sw.js').then(function(r){" +
  "document.addEventListener('visibilitychange',function(){if(!document.hidden)r.update()});" +
  "}).catch(function(){})})}";

const head = `
    <meta name="tomo-build" content="${BUILD_ID}" />
${PRECONNECT}
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#ECE1C8" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Tomo" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <script>${reg}</script>
  </head>`;

// viewport-fit=cover for iOS safe areas.
html = html.replace(
  'content="width=device-width, initial-scale=1, shrink-to-fit=no"',
  'content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"',
);
html = html.replace("</head>", head);

writeFileSync(path, html);
console.log("inject-pwa: injected PWA tags into", path);
