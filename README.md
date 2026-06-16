# RitMeter 🏍️

A fast GPS speedometer as a PWA: a 3D map oriented to your direction of travel, a large
speed readout (km/h or mph), a trip meter with start/stop, and point-to-point navigation.
Works on Android and iPhone, no app store required.

## Files

| File | Purpose |
|---|---|
| `index.html` | The complete app (HTML + CSS + JavaScript) |
| `manifest.json` | Makes the app installable |
| `sw.js` | Service worker: fast start and offline app shell |
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

## Controls

- **Tap the unit** below the big number to switch between km/h and mph (also possible via settings).
- **Gear icon, top left**: settings — language (Dutch/English), unit, altitude & compass on/off, and starting HUD mode.
- **Altitude & compass**: optional panel showing GPS altitude and heading (degrees + cardinal direction).
- **HUD mode**: mirrored, extra-large speed number — lay the phone flat on the dashboard so the image reflects in the windscreen. Tap the screen to return.
- **Button top left** (meter icon): toggles between map mode and focus mode (just a large speed number — lower power and more readable in bright light).
- **Navigation** (compass button): search for a destination, pick a vehicle profile (car, bicycle, moped, light moped), and get a route on the map with a simple turn-by-turn bar at the top. Save up to five favourite destinations for quick access. If you drift off the route it recalculates automatically.
- **Start trip / Stop / Resume / Reset**: trip meter with distance, driving time, average and top speed. The trip is preserved even if the app closes.
- **Trip history**: completed trips are stored and can be reviewed afterwards on their own map, and exported as a GPX file to use in other apps.
- **Dot, top right**: GPS quality (green = sharp, orange = moderate, red = poor/no fix).
- The screen stays on automatically as long as the app is open (Wake Lock).

## Good to know

- GPS only works over **https** — GitHub Pages handles that automatically.
- Outdoors and in motion, GPS speed is accurate; indoors or while standing still the value can drift briefly. The app filters out stationary noise.
- iPhone: keeping the screen awake (Wake Lock) works from iOS 16.4 onward in an installed PWA.
- The map needs internet (tiles from OpenFreeMap, free and without a key); the speedometer and trip meter also work **without** internet.
- Navigation needs internet: destination search uses Photon (Komoot) and routing uses BRouter. These are free public services with fair-use limits — fine for personal use.

## Roadmap (ideas for later)

- Cache map regions for fully offline map use.
- Speed-limit overlay and a gentle warning when exceeding it.
- Voice guidance for navigation instructions.
- A statistics dashboard across all saved trips (distance per week, etc.).
- Light/dark theme, or automatic switching based on time of day.
- More export formats and easy trip sharing.
- A full code overhaul / review once Claude Fable 5 is back online — tidy up the single-file structure, recheck the navigation logic end-to-end, and look for simplifications.
