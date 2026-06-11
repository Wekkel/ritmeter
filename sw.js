/* RitMeter service worker — app-shell cachen voor snelle start & offline gebruik.
   Kaarttegels en fonts gaan altijd via het netwerk (die zijn te groot/dynamisch). */

const CACHE = "ritmeter-v3";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
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

  // Alleen eigen bestanden uit de cache serveren (cache-first, met netwerk-fallback)
  if (url.origin === location.origin) {
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
  // Externe verzoeken (MapLibre, tiles, fonts): gewoon doorlaten naar het netwerk
});
