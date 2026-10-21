// Service worker: makes the website installable like a real app + works offline
const CACHE = "cnuo-stores-v1";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    "./", "index.html", "styles.css", "app.js", "manifest.webmanifest",
    "icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"
  ])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.includes("/api/")) return; // never touch API calls
  // network first = always fresh code; cache = fallback when offline
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
