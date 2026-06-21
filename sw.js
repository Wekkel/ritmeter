/* RitMeter service worker
   - index.html: network-first (altijd nieuwste versie, cache alleen als offline-fallback)
   - overige eigen bestanden: cache-first voor snelle start
   - kaarttegels en fonts: altijd via het netwerk */

const VERSION = "18";                 // ← alleen dit nog bijwerken
const CACHE = "ritmeter-v" + VERSION;
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("message", e => {
  if (e.data === "version" && e.ports[0]) e.ports[0].postMessage(VERSION);
});

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // cache:"reload" = haal vers van de server, negeer de http-cache
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;   // extern: gewoon netwerk

  const isPage = e.request.mode === "navigate" || url.pathname.endsWith("index.html");

  if (isPage) {
    // network-first: nieuwste app-versie zodra die online staat
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match("./index.html")))
    );
  } else {
    // cache-first voor statische bestanden
    e.respondWith(
      caches.match(e.request).then(hit =>
        hit || fetch(e.request).then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
          return res;
        })
      )
    );
  }
});
