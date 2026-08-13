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
let vehicle      = LS.getItem("rm_vehicle") || "bike";    // ALLEEN routeprofiel
let speedAlways  = LS.getItem("rm_speedvis") !== "0";     // Patch 18: default AAN    // ALLEEN routeprofiel
let lang         = LS.getItem("rm_lang")    || "nl";
/* ── Patch 10: 2D/3D-weergave + noord-vast ──────────────────
   3D = pitch 60, altijd rijrichting-omhoog.
   2D = pitch 0; noord-vast is optioneel en alleen in 2D effectief. */
let viewMode  = LS.getItem("rm_viewmode") === "2d" ? "2d" : "3d";   // default 3D
let northLock = LS.getItem("rm_northlock") === "1";
const northLocked = () => viewMode === "2d" && northLock;

let mapReady = false, firstFix = false, following = true, followTimer = null;

