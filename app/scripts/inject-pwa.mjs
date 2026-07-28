// Post-export: inject PWA head tags + service-worker registration into the
// single-output index.html (Expo's "single" web output does not run +html),
// and stamp a unique build id into the service worker so each deploy rotates
// its cache.
import { readFileSync, writeFileSync } from "node:fs";

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
