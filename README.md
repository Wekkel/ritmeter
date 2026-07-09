# RitMeter 🏍️

A fast GPS speedometer as a PWA: a 3D map oriented to your direction of travel, a large
speed readout (km/h or mph), a trip meter with start/stop, and point-to-point navigation.
Works on Android and iPhone — and on Android-based car head units — no app store required.

## Files

| File | Purpose |
|---|---|
| `index.html` | The complete app (HTML + CSS + JavaScript) |
| `manifest.json` | Makes the app installable |
| `sw.js` | Service worker: fast start, offline app shell and map-tile caching |
| `icon-*.png` | App icons |

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
