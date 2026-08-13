"use strict";
/* ── bediening (alle handlers: muteer state/voorkeur → render) ── */
/* ── controlstrip (Patch 13) ─────────────────────────────────
   Auto-inklap na 10 s zonder actie (zelfde patroon als
   suspendFollow). Overlay-openende acties klappen direct in;
   kaartschakelaars (2D/3D, noord-vast) herstarten alleen de
   timer zodat je meerdere schakelingen achtereen kunt doen. */
let controlsTimer = 0;
function restartControlsTimer(){
  clearTimeout(controlsTimer);
  if (state.controls === "open")
    controlsTimer = setTimeout(() => setControls("min"), 10000);
}
function setControls(mode){
  state.controls = mode;
  restartControlsTimer();
  render();
}
$("moreBtn").onclick = () => setControls(state.controls === "min" ? "open" : "min");

/* ── tap-chrome (Patch 18) ──────────────────────────────────
   Eén tik op de kaart maakt zoomknoppen + Start rit 7 s zichtbaar.
   Listener op de #map-container (niet het canvas): werkt al vóór
   de eerste GPS-fix, taps op fabs/panelen raken hem nooit, en een
   pinch begint met pointerdown zodat de zoomknoppen/-indicator er
   al staan vóór het zoom-event. Los van de camerablokkade (P11). */
let chromeTimer = 0;
function chromePoke(){
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => { state.chrome = "off"; render(); }, 7000);
  if (state.chrome !== "on"){ state.chrome = "on"; render(); }
}
$("map").addEventListener("pointerdown", chromePoke, { passive:true });

$("modeBtn").onclick = () => {
  clearTimeout(controlsTimer); state.controls = "min";   // groot getal verbergt de rail toch
  state.presentation = "big"; render(); if (map) setTimeout(() => map.resize(), 60);
};
$("r-exit").onclick  = () => { state.presentation = "map"; render(); ensureMotionLoop(); if (map) setTimeout(() => { map.resize(); applyMapPadding(); ensureMotionLoop(); }, 60); };
$("startBtn").onclick   = toggleTrip;
$("resetBtn").onclick   = saveAndReset;
$("discardBtn").onclick = discardTrip;

/* Patch 28: voertuigkeuze voor DEZE rit. Raakt de instelling (en dus het
   routeprofiel) bewust niet — je kunt met de fiets rijden terwijl de
   navigatie op auto staat. */
$("vehSel").onchange = e => {
  tripVeh = logVeh(e.target.value) || logVeh(vehicle) || "bike";
  LS.setItem("rm_tripveh", tripVeh);
  render();
};

$("tabRides").onclick = () => showHistTab("rides");
$("tabStats").onclick = () => showHistTab("stats");
/* Patch 21: de km/u- en mph-knoppen in de instellingen hadden nooit een
   handler — daar zat de bug. #unitBtn in het eiland is nu alleen nog een
   label. Standaard blijft km/u: useMph is false tenzij rm_unit "mph" is. */
$("unitKm").onclick = () => setUnit(false);
$("unitMi").onclick = () => setUnit(true);
function setUnit(mph){ useMph = mph; LS.setItem("rm_unit", useMph ? "mph" : "kmh"); syncSettingsUI(); render(); }

/* ── Patch 19: tik op het snelheidseiland klapt het in/uit ──────
   Alleen portret-smal en alleen in kaart-stand. Buiten dat bereik
   heeft #r-speed geen pointer-events en komt deze handler nooit aan
   bod; de media-check is de expliciete grendel. */
$("r-speed").addEventListener("click", e => {
  if (state.presentation !== "map") return;
  if (!matchMedia("(orientation:portrait) and (max-width:699px)").matches) return;
  state.speedPos = state.speedPos === "compact" ? "full" : "compact";
  LS.setItem("rm_speedpos", state.speedPos);
  chromePoke();                                     // eiland verdwijnt niet onder je vinger
  render();
  applyMapPadding();
});

/* Patch 21: de tijdelijke resolutiemeting is eruit. #appVer wordt bij
   het opstarten door de service worker gevuld ("RitMeter v" + versie) en
   blijft nu staan. Zie ook diagExportObject(), die appVersion hieruit
   leest. Staat er alleen "RitMeter", dan antwoordt sw.js niet op het
   "version"-bericht. */
$("setBtn").onclick   = () => { setControls("min"); state.overlay = "settings"; render(); };
$("setClose").onclick = () => { state.overlay = "none"; render(); };
$("settings").onclick = e => { if (e.target === $("settings")){ state.overlay = "none"; render(); } };

$("diagShareBtn").onclick = async () => {
  const btn = $("diagShareBtn");
  const oldDisabled = btn.disabled;

  btn.disabled = true;

  try{
    const result = await diagShare();

    if (result.method === "shared"){
      toast(t("diag_shared"));
    } else if (result.method === "download"){
      toast(t("diag_downloaded"));
    }
  } catch(e){
    diagAdd("diag.share_error", {
      name:e && e.name
        ? String(e.name)
        : null,
      message:e && e.message
        ? String(e.message)
        : null
    });

    toast(t("diag_failed"));
  } finally {
    btn.disabled = oldDisabled;
  }
};

$("diagClearBtn").onclick = () => {
  if (!confirm(t("diag_clear_q"))){
    return;
  }

  RitMeterDiag.clear();
  toast(t("diag_cleared"));
};

$("langNL").onclick = () => { lang = "nl"; LS.setItem("rm_lang", lang); applyLang(); };
$("langEN").onclick = () => { lang = "en"; LS.setItem("rm_lang", lang); applyLang(); };
$("compassSw").onclick = () => { showCompass = !showCompass; LS.setItem("rm_compass", showCompass?"1":"0"); syncSettingsUI(); render(); };
$("speedSw").onclick = () => { speedAlways = !speedAlways; LS.setItem("rm_speedvis", speedAlways?"1":"0"); syncSettingsUI(); render(); };
$("altSw").onclick = () => { showAltitude = !showAltitude; LS.setItem("rm_altitude", showAltitude?"1":"0"); syncSettingsUI(); render(); };
$("mirrorSw").onclick = () => { state.mirror = !state.mirror; LS.setItem("rm_mirror", state.mirror?"1":"0"); syncSettingsUI(); render(); };
$("apSw").onclick = () => { autoPause = !autoPause; LS.setItem("rm_apause", autoPause?"1":"0"); syncSettingsUI(); render(); };
$("colAmber").onclick = () => setColor("amber");
$("colWhite").onclick = () => setColor("white");
$("colGreen").onclick = () => setColor("green");
function setColor(c){ digitColor = c; LS.setItem("rm_color", c); syncSettingsUI(); render(); }
function setTheme(mode){
  themeMode = mode; LS.setItem("rm_theme", mode);
  syncSettingsUI(); applyTheme(); render();
}
$("thDay").onclick   = () => setTheme("day");
$("thNight").onclick = () => setTheme("night");
$("thAuto").onclick  = () => setTheme("auto");
$("altCalBtn").onclick = () => {
  if (lastAltRaw == null){ toast(t("alt_nofix")); return; }
  const inp = prompt(t("alt_prompt"), String(Math.round(lastAltRaw - altOffset)));
  if (inp == null) return;
  const known = parseFloat(String(inp).replace(",", "."));
  if (!isFinite(known)) return;
  altOffset = lastAltRaw - known; LS.setItem("rm_altoff", String(altOffset));
  toast(t("alt_done")); render();
};
$("altCalReset").onclick = () => { altOffset = GEOID_NL; LS.removeItem("rm_altoff"); toast(t("alt_reset")); render(); };

$("histBtn").onclick = () => { setControls("min"); openHist(); };
$("histClose").onclick = closeHist;
$("bakBtn").onclick = backup;
$("gpxAllBtn").onclick = gpxAll;
$("resBtn").onclick = () => $("resFile").click();
$("resFile").onchange = e => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; };
$("detBack").onclick = closeDetail;
$("shareBtn").onclick = shareGPX;
$("delBtn").onclick = async () => {
  if (!confirm(t("confirm_del"))) return;
  await idbDel(detId); closeDetail(); openHist();
};
$("r-recenter").onclick = resumeFollow;

   /* ── zoomlevel-indicator (Patch 9) ──────────────────────────
   Toont bij élke zoomwijziging (knoppen, pinch, dubbeltik) het
   actuele zoomniveau in het witte rondje naast de zoomknoppen
   en vervaagt 1,5 s na de laatste wijziging. Eén luisteraar op
   het map-"zoom"-event dekt alle invoerbronnen; de follow-
   camera schrijft nooit zoom, dus die triggert dit niet.
   Puur presentatie: raakt camera-, follow- en motionlogica niet. */
const ZOOM_BTN_MIN = 4, ZOOM_BTN_MAX = 20;

/* ═══ PATCH 25 — LAATSTE ZOOMSTAND ONTHOUDEN ═══════════════
   Eén waarde voor 2D en 3D samen, zoals gevraagd. Wordt bij het
   starten boven de snelheidskeuze verkozen; alleen als er niets
   bewaard is (eerste start, of na wissen) bepaalt de snelheid het
   niveau.

   De follow-camera schrijft nooit zoom (jumpTo zet alleen center en
   bearing), dus "zoomend" vuurt uitsluitend bij de zoomknoppen, een
   pinch en de eenmalige nameting — precies wat we willen bewaren.
   Tunable: ZOOM_SAVE_MS. */
const ZOOM_SAVE_MS = 1200;
let zoomSaveTimer = 0;

/* null als er niets bruikbaars staat: elke lezer moet zelf beslissen
   wat de terugval is, en een kapotte of buitenissige waarde uit een
   oude versie mag de kaart nooit onbruikbaar maken. */
function laatsteZoom(){
  const z = parseFloat(LS.getItem("rm_zoom"));
  if (!Number.isFinite(z)) return null;
  if (z < ZOOM_BTN_MIN || z > ZOOM_BTN_MAX) return null;
  return z;
}

function bewaarZoom(){
  if (!map) return;
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => {
    if (!map) return;
    const z = map.getZoom();
    if (!Number.isFinite(z)) return;
    try{ LS.setItem("rm_zoom", z.toFixed(2)); }catch(err){}
  }, ZOOM_SAVE_MS);
}
let zoomLvlTimer = 0;
function showZoomLevel(){
  if (!map) return;
  const z = Math.round(map.getZoom());
  $("zoomLvlNum").textContent = z;
  $("zoomLvlSub").textContent =
    z <= ZOOM_BTN_MIN ? "min" : z >= ZOOM_BTN_MAX ? "max" : "";
  const el = $("zoomLvl");
  el.classList.add("show");
  clearTimeout(zoomLvlTimer);
  zoomLvlTimer = setTimeout(() => el.classList.remove("show"), 1500);
}
   
function zoomMapBy(delta){
  if (!map || !mapReady) return;

  /* Bescherm de volledige 300 ms zoomanimatie plus een kleine marge
     tegen follow-camera writes vanuit de motion-loop. */
  blockCameraForButtonZoom();

  const targetZoom = Math.max(
   ZOOM_BTN_MIN,
    Math.min(ZOOM_BTN_MAX, map.getZoom() + delta)
  );

  map.zoomTo(targetZoom, {
    duration:300
  });
}

$("zoomIn").onclick  = () => { chromePoke(); zoomMapBy(1); };
$("zoomOut").onclick = () => { chromePoke(); zoomMapBy(-1); };

/* ── Patch 10: 2D/3D-wissel & noord-vast ────────────────────
   Eenmalige overgangsanimatie; het doorlopende bearinggedrag zit
   volledig in drawFollowCamera()/resumeFollow() via northLocked(). */
function applyViewMode(){
  if (!map || !mapReady) return;

  /* easeTo beschermen tegen de follow-camera: cameraWriteBlocked()
     ziet isEasing(); de button-zoom-blokkade dekt de aanloop. */
  blockCameraForButtonZoom();

  const pitch = viewMode === "3d" ? 60 : 0;
  const bearing = northLocked()
    ? 0
    : (
        bearingState.camera ??
        bearingState.marker ??
        motion.bearing ??
        lastBearing ??
        map.getBearing()
      );

  if (northLocked()){
    bearingState.camera = 0;
  }

  map.easeTo({ pitch, bearing, duration:400 });
}

/* Volgorde is essentieel: setPadding() is intern een jumpTo en zou
   een direct daarna gestarte easeTo NIET storen, maar andersom wél —
   dus eerst padding, dan de pitch/bearing-animatie. */
$("viewBtn").onclick = () => {
  restartControlsTimer();                                // rail open houden bij schakelen
  viewMode = viewMode === "3d" ? "2d" : "3d";
  LS.setItem("rm_viewmode", viewMode);
  applyMapPadding();
  applyViewMode();
  render();
};

$("northBtn").onclick = () => {
  restartControlsTimer();                                // rail open houden bij schakelen
  northLock = !northLock;
  LS.setItem("rm_northlock", northLock ? "1" : "0");
  applyMapPadding();
  applyViewMode();
  render();
};

/* ── scherm aanhouden ────────────────────────────────────── */
/* ── scherm aanhouden ────────────────────────────────────────
   Android/desktop: native Wake Lock API (werkt daar betrouwbaar).
   iOS: de API rapporteert wel "actief" maar dwingt niets af, dus
   draaien we daar een onzichtbaar lussend filmpje — zolang iOS
   denkt dat er video speelt, blijft het scherm wakker.
   Alleen actief wanneer het ertoe doet: in beweging, of tijdens
   een rit of navigatie, met een ruime nalooptijd zodat een
   stoplicht het scherm niet laat doven.                         */
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const KEEP_GRACE = 180000;   // 3 min nalooptijd na laatste beweging

/* onzichtbaar fallback-filmpje (zelfvoorzienend, geen CDN) */
let keepVid = null;
function keepVideo(){
  if (keepVid) return keepVid;
  const v = document.createElement("video");
  v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
  v.setAttribute("playsinline",""); v.setAttribute("muted",""); v.setAttribute("webkit-playsinline","");
  v.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;bottom:0";
  v.src = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMQbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAjp0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAAAAABAAAAAAGybWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAAAQABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABXW1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAR1zdGJsAAAAuXN0c2QAAAAAAAAAAQAAAKlhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAAL2F2Y0MBQsAe/+EAF2dCwB7ZBCbARAAAAwAEAAADAAg8WLkgAQAFaMuDyyAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAAAUkAAAFJAAAAAYc3R0cwAAAAAAAAABAAAAAQAAQAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAACkgAAAAEAAAAUc3RjbwAAAAAAAAABAAADQAAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAAKabWRhdAAAAnAGBf//bNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0wIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDE6MHgxMTEgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTAgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MCB3ZWlnaHRwPTAga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAaZYiEBX///w9FAAFC3ycnJ1111111111114A=";
  document.body.appendChild(v);
  keepVid = v;
  return v;
}

/* native Wake Lock API (Android/desktop) */
let wakeLock = null;
async function acquireWake(){
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  if (wakeLock && !wakeLock.released) return;
  try{
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch(e){ wakeLock = null; }
}
function releaseWake(){
  if (wakeLock){ try { wakeLock.release(); } catch(e){} wakeLock = null; }
}

/* moet het scherm nú wakker blijven? */
function shouldStayAwake(){
  if (trip.running || state.nav === "route") return true;
  return (Date.now() - lastMotion) < KEEP_GRACE;
}
function applyKeepAwake(){
  if (document.visibilityState !== "visible") return;
  const want = shouldStayAwake();
  if (want){
    acquireWake();
    if (IS_IOS){ const v = keepVideo(); if (v.paused) v.play().catch(()=>{}); }
  } else {
    releaseWake();
    if (IS_IOS && keepVid && !keepVid.paused) keepVid.pause();
  }
}

/* iOS vereist dat het filmpje één keer vanuit een aanraking start;
   daarna mogen we het programmatisch sturen. */
document.addEventListener("pointerdown", () => {
  if (IS_IOS){ const v = keepVideo(); v.play().then(() => { if (!shouldStayAwake()) v.pause(); }).catch(()=>{}); }
  applyKeepAwake();
}, { once:false });

setInterval(applyKeepAwake, 5000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible"){
    /* Patch 8c: markeer terugkeer; de watchdog geeft de bestaande
       watch eerst GPS_WD_FG_GRACE de kans om zelf te hervatten
       (iOS hervat een gesuspendeerde watch vaak vanzelf). */
    gpsWd.foregroundAt = Date.now();
    applyKeepAwake();
    ensureMotionLoop();
  } else {
    if (motion.raf){
      cancelAnimationFrame(motion.raf);
      motion.raf = 0;
    }
    motion.lastDraw = 0;

    /* Patch 11: een touch die middenin door een app-switch wordt
       afgebroken mag nooit een permanent geblokkeerde camera
       achterlaten. pointercancel dekt de meeste OS-afbrekingen;
       dit is het vangnet voor de rest. De set eerst legen zodat de
       release-guard in endCameraInteraction() niet blokkeert. */
    cameraControl.pointers.clear();
    endCameraInteraction();
  }
});
   
/* ── rotatie vergrendelen op portret ─────────────────────── */
async function lockPortrait(){
  try{ if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("portrait"); }
  catch(e){}
}
if (screen.orientation) screen.orientation.addEventListener("change", lockPortrait);
document.addEventListener("pointerdown", lockPortrait, { once:true });

/* ── meldingen ───────────────────────────────────────────── */
function showNotice(title, text){
  $("ntcTitle").textContent = title; $("ntcText").textContent = text;
  $("notice").classList.add("show");
}
function hideNotice(){ $("notice").classList.remove("show"); }
$("ntcBtn").onclick = () => { hideNotice(); startGPS("manual_retry"); };

/* ── service worker ──────────────────────────────────────── */
if ("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(()=>{});
  navigator.serviceWorker.ready.then(reg => {
    const sw = reg.active; if (!sw) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = e => { if (e.data) $("appVer").textContent = "RitMeter v" + e.data; };
    sw.postMessage("version", [ch.port2]);
  }).catch(()=>{});
}

