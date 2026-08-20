/* RitMeter service worker
   - index.html            : network-first (altijd nieuwste versie, cache = offline-fallback)
   - overige eigen shell   : cache-first, geversioneerd (ververst bij VERSION-bump)
   - kaarttegels/glyphs/sprite (OpenFreeMap): cache-first met
       * leeftijd-refresh : tile ouder dan TILE_MAX_AGE wordt op de achtergrond ververst
       * plafond          : tile-cache blijft onder TILE_MAX_BYTES (oudste eruit, FIFO)
   - fonts e.d. (overige externe origins): gewoon via het netwerk */

const VERSION = "1.3.8";                 // per-trip vehicle, discard option and statistics dashboard
const CACHE      = "ritmeter-v" + VERSION;   // shell: wordt per versie ververst
const TILE_CACHE = "ritmeter-tiles";         // tiles: NIET geversioneerd → overleeft app-updates

const TILE_HOSTS    = ["tiles.openfreemap.org"];          // tiles + style + glyphs + sprite
const TILE_MAX_BYTES = 400 * 1024 * 1024;                 // 400 MB plafond
const TILE_MAX_AGE   = 30 * 24 * 60 * 60 * 1000;          // 30 dagen → daarna verversen

/* App-shell. Alles wat de app nodig heeft om zonder netwerk te starten.
   LET OP: deze lijst moet gelijk lopen met de <link>- en <script>-tags in
   index.html. Voeg je daar een bestand toe, voeg het hier dan ook toe —
   anders start de app online prima en offline niet. */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./src/css/00-tokens.css",
  "./src/css/10-map.css",
  "./src/css/20-ui-grid.css",
  "./src/css/30-regions.css",
  "./src/css/40-visibility.css",
  "./src/css/50-layout-portrait.css",
  "./src/css/60-layout-landscape.css",
  "./src/css/70-panels.css",
  "./src/css/80-toast.css",
  "./src/css/90-layout-c.css",
  "./src/js/00-state.js",
  "./src/js/05-i18n.js",
  "./src/js/10-trip.js",
  "./src/js/15-helpers.js",
  "./src/js/20-diag.js",
  "./src/js/25-storage.js",
  "./src/js/30-render.js",
  "./src/js/35-map-theme.js",
  "./src/js/40-motion.js",
  "./src/js/45-camera.js",
  "./src/js/50-map-init.js",
  "./src/js/55-gps.js",
  "./src/js/60-clock.js",
  "./src/js/65-history.js",
  "./src/js/70-settings.js",
  "./src/js/75-handlers.js",
  "./src/js/80-nav.js",
  "./src/js/90-boot.js"
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
      // verwijder oude shell-caches, maar bewaar de tile-cache
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => caches.open(TILE_CACHE))
      .then(c => trimTiles(c).catch(() => {}))   // plafond bewaken na een update
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // kaarttegels/style/glyphs/sprite → eigen cache-strategie
  if (TILE_HOSTS.includes(url.hostname)) { e.respondWith(handleTile(e)); return; }

  // overige externe origins (fonts e.d.) → gewoon netwerk
  if (url.origin !== location.origin) return;

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
    // cache-first voor statische shell-bestanden
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

/* ── tiles: cache-first, leeftijd-refresh, plafond ─────────────────── */
async function handleTile(e){
  const req = e.request;
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(req);

  if (hit){
    const ts = +(hit.headers.get("x-rm-ts") || 0);
    // te oud → op de achtergrond verversen, ondertussen meteen de cache teruggeven
    if (Date.now() - ts > TILE_MAX_AGE)
      e.waitUntil(fetchAndStore(cache, req).catch(() => {}));
    return hit;
  }
  // niet in cache → ophalen, opslaan met tijdstempel, plafond bewaken
  try { return await fetchAndStore(cache, req); }
  catch (_) { return fetch(req); }      // val terug op kaal netwerk
}

async function fetchAndStore(cache, req){
  const res = await fetch(req);
  if (res && res.ok){
    // tijdstempel meebakken zodat we de leeftijd kennen zonder aparte opslag
    const headers = new Headers(res.headers);
    headers.set("x-rm-ts", String(Date.now()));
    const body = await res.clone().blob();
    await cache.put(req, new Response(body, {
      status: res.status, statusText: res.statusText, headers
    }));
    maybeTrim(cache);                   // niet awaiten: loopt op de achtergrond
  }
  return res;
}

/* opruimen pas na een aantal nieuwe tiles (de byte-telling is relatief duur) */
let sinceTrim = 0;
function maybeTrim(cache){
  if (++sinceTrim < 120) return;
  sinceTrim = 0;
  trimTiles(cache).catch(() => {});
}

/* houd de tile-cache onder TILE_MAX_BYTES; gooi de oudste (eerst gecachte) eruit.
   Content-Length is een CORS-veilige header en blijft leesbaar, dus meestal
   hoeven we de body niet te lezen om de grootte te kennen. */
async function trimTiles(cache){
  const keys = await cache.keys();      // cache.keys() = insertievolgorde (FIFO)
  if (keys.length < 200) return;        // goedkope vangrail: klein → niets te doen

  const entries = [];
  let total = 0;
  for (const k of keys){
    const r = await cache.match(k);
    if (!r) continue;
    let sz = +(r.headers.get("content-length"));
    if (!(sz > 0)) sz = (await r.clone().blob()).size;
    entries.push({ k, sz });
    total += sz;
  }
  let i = 0;
  while (total > TILE_MAX_BYTES && i < entries.length){
    await cache.delete(entries[i].k);
    total -= entries[i].sz;
    i++;
  }
}
