# RitMeter 🏍️

A fast GPS speedometer as a PWA: a 3D map oriented to your direction of travel, a large
speed readout (km/h or mph), a trip meter with start/stop, and point-to-point navigation.
Works on Android and iPhone — and on Android-based car head units — no app store required.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell: loads the CSS and JavaScript from `src/` in a fixed order |
| `src/css/` | Stylesheets, one per concern, loaded in cascade order |
| `src/js/` | Application code, one file per concern, loaded in dependency order |
| `manifest.json` | Makes the app installable |
| `sw.js` | Service worker: fast start, offline app shell and map-tile caching |
| `icon-*.png` | App icons |

## Source layout

RitMeter is a plain static site: no bundler, no build step, no dependencies.
`index.html` is only a shell — it loads the CSS and JavaScript from `src/` with
ordinary `<link>` and `<script src>` tags. Edit a file in `src/`, commit it, bump
`VERSION` in `sw.js`, and your devices pick it up.

### Order matters

The load order in `index.html` is functional, not cosmetic:

* **CSS** — the cascade decides which layout wins (portrait / landscape / head unit).
* **JavaScript** — these are classic scripts, so they share one global scope and a
  `const` declared in one file is visible in the next. But function declarations do
  **not** hoist across file boundaries: a file may only call what was loaded before it.
  `90-boot.js` runs last and starts the app.

The numeric prefixes mirror the load order, so the directory listing reads the same
way the page does.

### Adding a file

Add it in two places: the `<link>`/`<script>` list in `index.html`, **and** `SHELL`
in `sw.js`. Forget the second and the app still works online but no longer starts
offline — which is exactly the kind of failure you discover in a tunnel.

### Releasing

`sw.js` serves `index.html` network-first and everything else cache-first, keyed on
the cache name. Bump `VERSION` in `sw.js` to retire the old cache and push a new
version to your devices.

### Source layout

| Path | Contents |
|---|---|
| `src/css/00-tokens.css` | design tokens, `:root` variables, base reset |
| `src/css/10-map.css` | map layer and position marker |
| `src/css/20-ui-grid.css` | the UI overlay grid and pointer-events policy |
| `src/css/30-regions.css` | per-region appearance (not geometry) |
| `src/css/40-visibility.css` | visibility rules, driven purely by `body[data-*]` |
| `src/css/50-layout-portrait.css` | Layout A + collapsible speed island |
| `src/css/60-layout-landscape.css` | Layout B |
| `src/css/70-panels.css` | search panel, settings, history and trip detail |
| `src/css/80-toast.css` | toasts and notices |
| `src/css/90-layout-c.css` | Layout C — tablet / car head unit |
| `src/js/00-state.js` | the single source of truth, theme and view-mode state |
| `src/js/05-i18n.js` | Dutch and English strings |
| `src/js/10-trip.js` | trip state, loss counters, accuracy gates, speed filter |
| `src/js/15-helpers.js` | small shared utilities |
| `src/js/20-diag.js` | bounded diagnostic ring buffer and export |
| `src/js/25-storage.js` | IndexedDB, route persistence, session recovery |
| `src/js/30-render.js` | the render contract |
| `src/js/35-map-theme.js` | map styles, day/night engine, night palette |
| `src/js/40-motion.js` | position smoothing, stationary lock, bearing, dead reckoning |
| `src/js/45-camera.js` | camera control and the follow camera |
| `src/js/50-map-init.js` | start zoom tables, `initMap`, follow suspend/resume |
| `src/js/55-gps.js` | GPS watchdog and the per-fix pipeline |
| `src/js/60-clock.js` | clock, auto-pause, start/stop/reset |
| `src/js/65-history.js` | history overlay, elevation profile, GPX export |
| `src/js/70-settings.js` | static texts and settings UI sync |
| `src/js/75-handlers.js` | all event handlers, wake lock, service worker |
| `src/js/80-nav.js` | geocoding, routing, route drawing and progress |
| `src/js/90-boot.js` | startup order |

## Installing on your phones

**Samsung S24 Ultra (Chrome or Samsung Internet):**
open the URL → menu (⋮) → **Add to Home screen** / **Install app**.

**iPhone (must be via Safari):**
open the URL → share button (square with arrow) → **Add to Home Screen**.

On first launch the phone asks for location permission — choose **Allow while using the app**.

## Location permission on iPhone (Safari)

Permission works in three layers:

1. **System**: Settings → Privacy & Security → Location Services **on**, and in the list set **Safari Websites** to *While Using the App*.
2. **Per website**: when you open it, Safari shows a prompt — choose **Allow**. Denied it by accident? Tap **aA** in the address bar → **Website Settings** → Location → **Allow** and reload.
3. **Installed app**: after "Add to Home Screen" the app counts as its own app; it asks for permission again and then appears under its own name in Settings → Privacy → Location Services.

## The map view

- The position triangle moves smoothly (dead reckoning between GPS fixes) while the camera
  follows at a calmer pace; pinch, drag and zoom are never fought by the follow camera.
- **Dragging** the map pauses following for 10 seconds; the **centre button** (bottom right)
  resumes it immediately.
- **Zoom buttons** on the right — handy on car screens without pinch gestures.
- When you stand still, the marker locks onto a stable point instead of wandering with
  GPS noise; it releases as soon as you convincingly move again.
- If GPS fixes briefly stop arriving, the marker coasts on for a bounded time and distance
  (further along the route during active navigation), then freezes until real fixes return.

## Controls

- **Tap the unit** below the big number to switch between km/h and mph (also in settings).
- **Expand button, top left**: focus mode — just an extra-large speed number, lower power
  and more readable in bright light. Tap anywhere to return to the map. Combined with the
  **Mirror** setting this doubles as a HUD: lay the phone flat on the dashboard so the
  number reflects in the windscreen.
- **Navigation** (arrow button): search for a destination (Photon), pick a vehicle profile
  (car, bicycle, moped, light moped — this only affects routing), and get a route on the
  map (BRouter). A compact bar shows **remaining distance, driving time and arrival time**
  — deliberately no turn-by-turn voice or lane instructions. Save up to five favourite
  destinations. Drift off the route for a while and it recalculates automatically.
- **Start trip / Stop / Resume / Save & reset**: trip meter with distance, driving time,
  average and top speed. A running trip survives an app or phone restart.
- **Trip history** (clock button): totals for this week, this month and all time; every
  saved trip has its own map, statistics and an elevation profile, and can be shared as
  a GPX file. From here you can also make a **JSON backup** of all trips, **restore** one,
  or export **everything as a single GPX**.
- **Dot, top right**: GPS quality (green = sharp, orange = moderate, red = poor/no fix).
- The screen stays on automatically while it matters (moving, on a trip, or navigating),
  with a generous grace period so a traffic light doesn't dim the screen.

## Settings

- **Language** (Dutch/English) and **units** (km/h / mph).
- **Vehicle**: routing profile only — it never changes the layout or the measurement.
- **Compass rose** and **altitude readout** on/off.
- **Altitude calibration**: GPS reports ellipsoidal height; inside the Netherlands the app
  converts to NAP by default (~43 m offset). Calibrate against a known height (e.g. 0 m
  on the water) for better absolute values; logging always runs regardless of the readout.
- **Digit colour** (amber/white/green) for the speedometer.
- **Mirror** for HUD use in focus mode.
- **Auto-pause**: trip time pauses after 5 s standstill.
- **Night dimmer**: dims the whole display for riding in the dark.
- **Diagnostics**: share or clear a bounded technical log (max 240 events) for
  troubleshooting — includes GPS samples, state transitions and per-trip distance
  accounting. It survives an app restart and can never grow unbounded.

## Car head units (e.g. Carluex)

The layout detects large, low-density screens (like Android head units behind CarPlay/
Android Auto boxes) and scales the controls, trip bar and navigation info up automatically.
Combined with the zoom buttons this makes RitMeter usable as a dashboard app.

## Measurement robustness

- Trip distance is measured from raw GPS fixes; the smooth visual layer never influences it.
- If the phone temporarily reports **poor accuracy** (tunnels, tall buildings — or sometimes
  for no visible reason at all), the trip meter no longer throws that stretch away: it
  bridges the gap as soon as good fixes return, so kilometres are not silently lost.
- **Long trips**: route logging adapts its sampling to speed (finer on a bicycle, coarser
  on the motorway) and automatically switches from localStorage to IndexedDB when a route
  grows large, so an all-day drive cannot hit storage limits or crash the app. Saving in
  stages at longer stops is still the most robust habit for very long journeys.

## Good to know

- GPS only works over **https** — GitHub Pages handles that automatically.
- Outdoors and in motion, GPS speed is accurate; indoors or while standing still the value
  can drift briefly. The app filters out stationary noise.
- iPhone: keeping the screen awake works from iOS 16.4 onward in an installed PWA; on iOS
  the app uses a fallback that reliably keeps the screen on while you move.
- The map needs internet (vector tiles from OpenFreeMap, free and without a key); visited
  tiles are cached, and the speedometer, trip meter and trip logging work fully
  **without** internet.
- Navigation needs internet: destination search uses Photon (Komoot) and routing uses
  BRouter. These are free public services with fair-use limits — fine for personal use.

## Roadmap (ideas for later)

- Pre-download map regions for planned routes (beyond the cache-as-you-go tiles).
- Merge multiple saved trips into one (useful after saving a long journey in stages).
- Speed-limit overlay and a gentle warning when exceeding it.
- A statistics dashboard across all saved trips (distance per week, etc.).
- Light/dark theme, or automatic switching based on time of day.
- More export formats and easy trip sharing.
