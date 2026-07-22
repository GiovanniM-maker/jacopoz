// Post-export: inject PWA head tags + service-worker registration into the
// single-output index.html (Expo's "single" web output does not run +html).
import { readFileSync, writeFileSync } from "node:fs";

const path = "dist/index.html";
let html = readFileSync(path, "utf8");

if (html.includes("manifest.webmanifest")) {
  console.log("inject-pwa: already injected");
  process.exit(0);
}

const head = `
    <link rel="manifest" href="/manifest.webmanifest" />
    <meta name="theme-color" content="#ECE1C8" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Tomo" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <script>if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}</script>
  </head>`;

// viewport-fit=cover for iOS safe areas.
html = html.replace(
  'content="width=device-width, initial-scale=1, shrink-to-fit=no"',
  'content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"',
);
html = html.replace("</head>", head);

writeFileSync(path, html);
console.log("inject-pwa: injected PWA tags into", path);
