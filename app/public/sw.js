// Tomo service worker — makes repeat loads instant and the app installable.
// Strategy:
//   • /_expo/static/* and image/font assets → cache-first (hashed, immutable)
//   • navigations (HTML) → network-first, fall back to cached shell offline
//   • Supabase API and auth → never cached (always network)
const CACHE = "tomo-v1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

function isStatic(url) {
  return (
    url.pathname.startsWith("/_expo/") ||
    url.pathname.startsWith("/assets/") ||
    /\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|ico|webp)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never intercept API / auth / cross-origin data calls.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/")) return;

  if (req.mode === "navigate") {
    // Network-first: fresh HTML when online, cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL)),
    );
    return;
  }

  if (isStatic(url)) {
    // Cache-first: hashed assets never change under the same name.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            return res;
          }),
      ),
    );
  }
});
