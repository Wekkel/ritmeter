"use strict";
/* ═══════════════════════════════════════════════════════════
   RitMeter — herbouwde UI-laag
   Eén bron van waarheid (state) → één render() → declaratieve CSS.
   Geen enkele andere functie zet zichtbaarheid; handlers muteren
   state en roepen render() aan.
   ═══════════════════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const LS = localStorage;

/* ── ÉÉN bron van waarheid ────────────────────────────────── */
const state = {
  presentation: "map",                       // 'map' | 'big'
  mirror: LS.getItem("rm_mirror") === "1",   // alleen betekenisvol in 'big'
  nav: "off",                                // 'off' | 'search' | 'route' (alleen in map)
  overlay: "none",                           // 'none' | 'settings' | 'history' | 'detail'
  controls: "min",                           // 'min' | 'open' — Patch 13: controlstrip
                                             // (sessie-only, start altijd opgeruimd)
  chrome: "on",                              // 'on' | 'off' — Patch 18: tap-chrome
                                             // (zichtbaar bij start, fadet na 7 s)
  /* Patch 19: positie van het snelheidseiland. Alleen portret-smal
     leest dit; liggend en Layout C negeren het attribuut volledig. */
  speedPos: LS.getItem("rm_speedpos") === "compact" ? "compact" : "full"
};
   
/* persistente voorkeuren (beïnvloeden inhoud, niet de structuur) */
const COLORS = { amber:"#FFB300", white:"#E9EEF3", green:"#34E07A" };
let useMph       = LS.getItem("rm_unit")    === "mph";
let showCompass  = LS.getItem("rm_compass") !== "0";      // default AAN
let showAltitude = LS.getItem("rm_altitude")=== "1";      // default UIT
let autoPause    = LS.getItem("rm_apause")  === "1";
let digitColor   = LS.getItem("rm_color")   || "amber";
/* Patch 20: nachtdimmer vervangen door een dag/nacht-thema.
   themeMode = wat de gebruiker koos; themeNow = wat er nú geldt. */
let themeMode    = (m => (m === "day" || m === "night") ? m : "auto")(LS.getItem("rm_theme"));
let themeNow     = "day";                                 // door applyTheme() gezet
/* Patch 22: aparte drempels voor 's avonds en 's ochtends. Eerder was
   dit één waarde (-6°, burgerschemering) en dat viel in juli pas rond
   22:19 — veel te laat voor in de auto. Hoogte = stand van de zon:
   positief is boven de horizon, dus eerder.

     +2°  21:16      0°  21:31      -2°  21:46      -4°  22:02
     +1°  21:23   -0.8°  21:37      -3°  21:54      -6°  22:19
   (Amstelveen, 30 juli; in december schuift alles mee met de zon.) */
const SUN_ALT_DUSK = 0;     // nacht gaat in rond zonsondergang
const SUN_ALT_DAWN = -1;    // dag gaat in net vóór zonsopkomst
/* ═══ PATCH 28 — VOERTUIG ═══════════════════════════════════
   VEH is de enige waarheid over welke voertuigen bestaan; settings,
   de dropdown in het riteiland en de statistieken lezen hier allemaal
   uit. Volgorde bepaalt de weergavevolgorde.

   'vehicle' = routeprofiel in de instellingen (bestond al).
   'tripVeh' = waarmee JIJ deze rit maakt. Die twee zijn losgekoppeld:
   je kunt met de fiets rijden terwijl de navigatie op auto staat. Bij
   ontbrekende keuze valt tripVeh terug op de instelling.

   Patch 29: twee taxonomieën, bewust verschillend van omvang.
   VEH     = routeprofielen. Snorfiets staat hier apart omdat hij in
             Nederland in beginsel op het fietspad hoort en dus een
             ander profiel nodig heeft dan een bromfiets.
   VEH_LOG = logging en statistiek. Daar is dat onderscheid zinloos:
             het gaat om hoe je je verplaatst, niet over welk asfalt.
             Snorfiets klapt samen met bromfiets.
   logVeh() is de enige brug tussen die twee en geeft null bij iets
   onbekends, zodat elke lezer zelf zijn terugval kiest. */
const VEH     = ["car", "moped", "snor", "bike", "foot"];   /* instellingen */
const VEH_LOG = ["car", "moped", "bike", "foot"];           /* logging      */
const isVeh    = v => VEH.includes(v);
const isLogVeh = v => VEH_LOG.includes(v);
const logVeh   = v => v === "snor" ? "moped" : (isLogVeh(v) ? v : null);
/* Labels komen uit de bestaande p_*-sleutels, dezelfde die het
   navigatiemenu gebruikt. Eén bron voorkomt dat instellingen en
   statistiek verschillende woorden voor hetzelfde voertuig tonen. */
const vehLabel = v => t("p_" + v) || v;

let vehicle      = isVeh(LS.getItem("rm_vehicle")) ? LS.getItem("rm_vehicle") : "bike";
let tripVeh      = logVeh(LS.getItem("rm_tripveh")) || logVeh(vehicle) || "bike";

/* Terugvaltoekenning voor ritten van vóór deze patch. Bewust grof en
   deterministisch: alleen trip.max (m/s) telt, geen gemiddelden.
   >60 km/u = auto, >30 km/u = bromfiets, de rest fiets. Snorfiets en
   te voet komen er nooit uit — die zijn achteraf niet te onderscheiden
   van fiets. Zulke ritten kun je in de geschiedenis handmatig
   bijstellen; een toegekend voertuig krijgt vehAuto:true mee. */
function vehFromMax(maxMs){
  /* Afronden op 1 decimaal vóór de vergelijking: 60/3.6*3.6 is in
     drijvendekomma 60.00000000000001 en zou anders net "auto" worden.
     Zo valt exact 60 km/u op bromfiets en exact 30 op fiets, precies
     zoals de regel bedoeld is. */
  const kmh = Math.round((maxMs || 0) * 36) / 10;
  if (kmh > 60) return "car";
  if (kmh > 30) return "moped";
  return "bike";
}
let speedAlways  = LS.getItem("rm_speedvis") !== "0";     // Patch 18: default AAN    // ALLEEN routeprofiel
let lang         = LS.getItem("rm_lang")    || "nl";
/* ── Patch 10: 2D/3D-weergave + noord-vast ──────────────────
   3D = pitch 60, altijd rijrichting-omhoog.
   2D = pitch 0; noord-vast is optioneel en alleen in 2D effectief. */
let viewMode  = LS.getItem("rm_viewmode") === "2d" ? "2d" : "3d";   // default 3D
let northLock = LS.getItem("rm_northlock") === "1";
const northLocked = () => viewMode === "2d" && northLock;

let mapReady = false, firstFix = false, following = true, followTimer = null;

