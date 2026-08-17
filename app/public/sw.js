// Tomo service worker — makes repeat loads instant and the app installable.
// Strategy:
//   • /_expo/static/* and image/font assets → cache-first (hashed, immutable)
//   • navigations (HTML) → network-first, fall back to cached shell offline
//   • Supabase API and auth → never cached (always network)
// __BUILD_ID__ is replaced at build time (scripts/inject-pwa.mjs) so every
// deploy gets a fresh cache name → the activate handler purges the old one and
// stale assets never linger.
const CACHE = "tomo-__BUILD_ID__";
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

// ---- Web Push ---------------------------------------------------------
// Payload shape (from the send-push Edge Function):
//   { title, body, url, tag }
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_e) {
    data = { title: "Tomo", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Tomo";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "tomo",
      data: { url: data.url || "/" },
    }),
  );
});

// Focus an existing tab (or open one) and route to the notification's target.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never intercept API / auth / cross-origin data calls.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/rest/") || url.pathname.startsWith("/auth/")) return;

  if (req.mode === "navigate") {
    // Network-first: fresh HTML when online, cached shell when offline. Only
    // cache a genuine 2xx response; never overwrite the shell with an error.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || fetch(req))),
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
            // Guard against caching a fallback page: after an atomic deploy a
            // stale asset URL returns 200 text/html (the SPA rewrite), which
            // cached under a .js URL would execute as HTML → permanent blank
            // screen. Only cache real, non-HTML, same-name assets.
            const ct = res.headers.get("content-type") || "";
            if (res.ok && !ct.includes("text/html")) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
  }
});
