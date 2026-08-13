"use strict";
/* ═══ PATCH 23 — STARTZOOM PER WEERGAVE ════════════════
   Twee tabellen, want 2D en 3D horen bij verschillende voertuigen:
   2D in de auto (portrait), 3D op de fiets en de brommer. In 3D kijk
   je door de kanteling veel verder vooruit, dus daar mag hetzelfde
   zoomgetal krapper staan.

   Elke tabel heeft éigen drempels. Dat is de kern: een brommer van
   45 km/u hoort in 3D nog bij "stad" (dus 17), terwijl 45 km/u in de
   2D-tabel al buitenweg is. Zo krijgt fiets/brommer 17 en de auto in
   3D 14, zonder dat de app hoeft te weten wat voor voertuig het is.
   Tunable: alles hieronder. */
const START_ZOOM = {
  "2d": {                                   /* auto, portrait */
    niveaus: { stil:17, stad:16, buitenweg:15.5, snelweg:9 },
    grenzen: { stad:10, buitenweg:25, snelweg:85 },
    onbekend:16
  },
  "3d": {                                   /* fiets / brommer, auto bij snelheid */
    niveaus: { stil:17, stad:17, buitenweg:17, snelweg:14 },
    grenzen: { stad:10, buitenweg:25, snelweg:50 },
    onbekend:16
  }
};
const START_ZOOM_SETTLE_MS = 10000;

function zoomTabel(mode){ return START_ZOOM[mode === "3d" ? "3d" : "2d"]; }

function zoomForSpeed(kmh, mode){
  const t = zoomTabel(mode), n = t.niveaus, g = t.grenzen;
  if (!Number.isFinite(kmh) || kmh < g.stad) return n.stil;
  if (kmh < g.buitenweg) return n.stad;
  if (kmh < g.snelweg)   return n.buitenweg;
  return n.snelweg;
}

function initMap(lon, lat, speedMs){
  /* Patch 20: lastLat/lastLon staan al → de zonberekening klopt.
     Hebben we de gewenste stijl al in cache, dan start de kaart er
     direct in (geen witte flits bij een avondstart). Zo niet, dan
     starten we in de bewezen dagstijl en wisselt applyMapTheme()
     zodra de stijl binnen is — nooit een blanco kaart door een koude
     start zonder netwerk. */
  applyTheme();
  const bootStyle = themedStyle(themeNow);

  /* Patch 22: snelheid van de eerste fix → startzoom. */
  const startKmh = (speedMs != null && !isNaN(speedMs) && speedMs >= 0)
    ? speedMs * 3.6 : NaN;
 /* Patch 25: een bewaarde zoomstand wint van de snelheidskeuze.
     viewMode staat al vast (uit localStorage), dus de terugval kiest
     meteen het niveau dat bij deze weergave hoort. */
  const bewaard = laatsteZoom();
  const startZoom = bewaard != null ? bewaard
    : (Number.isFinite(startKmh)
        ? zoomForSpeed(startKmh, viewMode) : zoomTabel(viewMode).onbekend);
  diagAdd("zoom.start", {
    kmh: Number.isFinite(startKmh) ? +startKmh.toFixed(1) : null,
    view:viewMode, zoom:startZoom, bron: bewaard != null ? "bewaard" : "snelheid" });

  map = new maplibregl.Map({
    container:"map", style: bootStyle || STYLE_DAY,
    center:[lon,lat], zoom:startZoom, pitch:viewMode === "3d" ? 60 : 0, bearing:0,
    attributionControl:{compact:true}, fadeDuration:0
  });
  mapStyleApplied = bootStyle ? themeNow : "day";

  /* Gaf de eerste fix geen snelheid (koude start, sommige toestellen),
     dan één keer herzien zodra dispSpeed is ingelopen — en alleen als de
     gebruiker de kaart nog niet heeft aangeraakt. Nooit vaker dan dit:
     zoom die tijdens het rijden uit zichzelf verspringt is hinderlijk. */
  if (!Number.isFinite(startKmh) && bewaard == null){
    /* dispSpeed is een EMA en loopt vanaf 0 in; op t+6 s stond hij bij
       119 km/u nog pas rond 45. Daarom 10 s én de PIEK over dat venster,
       niet de momentwaarde — anders kies je een te krappe zoom. */
    let peakKmh = 0;
    const sampler = setInterval(() => {
      peakKmh = Math.max(peakKmh, dispSpeed * 3.6);
    }, 500);
    setTimeout(() => {
      clearInterval(sampler);
      if (!map || !mapReady || !following) return;
      if (cameraControl.interactionActive) return;
     const kmh = Math.max(peakKmh, dispSpeed * 3.6);
      /* viewMode hier opnieuw lezen: heb je in die 10 s van 2D naar 3D
         gewisseld, dan telt de weergave waarin je nu staat. */
      const want = zoomForSpeed(kmh, viewMode);
      if (Math.abs(map.getZoom() - want) < .1) return;
      blockCameraForButtonZoom();
      map.easeTo({ zoom:want, duration:300 });
      diagAdd("zoom.start_settled", {
        kmh:+kmh.toFixed(1), view:viewMode, zoom:want });
    }, START_ZOOM_SETTLE_MS);
  }
  map.touchZoomRotate.disableRotation();

  /* Patch 25: elke afgeronde zoomwijziging bewaren, gedebounced zodat
     een pinch één schrijfactie oplevert in plaats van tientallen. */
  map.on("zoomend", bewaarZoom);

  /* ── Patch 11: vroege camerablokkade ─────────────────────────
     dragstart/zoomstart vuren pas nádat MapLibre de gesture herkend
     heeft; in dat herkenningsvenster overschreef de follow-camera
     elke ~67 ms de opgebouwde pan-delta (jumpTo), waardoor een veeg
     of pinch niet "pakte". Daarom blokkeren we camera-writes al bij
     het eerste rauwe touchcontact op het canvas — dezelfde
     blauwdruk als blockCameraForButtonZoom(): blokkade vóór de
     camera-actie in plaats van erna.
     Bewust GEEN suspendFollow() hier: het 10 s pauzeren van follow
     blijft exclusief aan een echte drag gekoppeld (dragstart-pad).
     Listeners staan op het canvas zelf; fabs en panelen boven de
     kaart raken dit pad nooit. Passief: geen preventDefault nodig. */
  const canvas = map.getCanvas();

  const onCanvasPointerDown = e => {
    cameraControl.pointers.add(e.pointerId);
    /* Gethrottlede diagnose: verifieerbaar op de Carluex dat het
       vroege pad actief wordt. Alleen loggen bij de overgang
       (blokkade nog niet actief) en max. 1× per 5 s. */
    if (following && !cameraControl.interactionActive){
      const now = Date.now();
      if (now - cameraControl.lastTouchBlockLog > 5000){
        cameraControl.lastTouchBlockLog = now;
        diagAdd("camera.touch_block", {
          pointers:cameraControl.pointers.size
        });
      }
    }
    beginCameraInteraction();
  };

  const onWindowPointerEnd = e => {
    /* Alleen reageren op pointers die wij zelf volgen; pointerups
       van fabs/panelen (nooit toegevoegd) worden hier genegeerd.
       Window-niveau vangt ook een vinger die buiten het canvas
       loslaat. */
    if (!cameraControl.pointers.delete(e.pointerId)) return;
    if (cameraControl.pointers.size === 0) endCameraInteraction();
  };

  if (window.PointerEvent){
    canvas.addEventListener("pointerdown", onCanvasPointerDown, { passive:true });
    window.addEventListener("pointerup", onWindowPointerEnd, { passive:true });
    window.addEventListener("pointercancel", onWindowPointerEnd, { passive:true });
  } else {
    /* Fallback voor WebViews zonder Pointer Events (Carluex-
       verzekering). Door de feature-check kan nooit dubbel worden
       afgehandeld. Touch events hebben geen pointerId; we houden de
       blokkade simpelweg aan tot álle vingers los zijn
       (e.touches.length === 0) en maken dan de set leeg — lekvrij,
       want all-fingers-up ruimt altijd volledig op. */
    canvas.addEventListener("touchstart", () => {
      cameraControl.pointers.add("touch");
      beginCameraInteraction();
    }, { passive:true });
    const onWindowTouchEnd = e => {
      if (e.touches && e.touches.length) return;
      cameraControl.pointers.clear();
      endCameraInteraction();
    };
    window.addEventListener("touchend", onWindowTouchEnd, { passive:true });
    window.addEventListener("touchcancel", onWindowTouchEnd, { passive:true });
  }

  map.setPadding({ top: Math.round(innerHeight * .58) });
   
  const el = document.createElement("div");
  el.className = "me";
  el.innerHTML = `<svg viewBox="0 0 30 30"><path d="M15 3 L25 27 L15 21 L5 27 Z" fill="#FFB300" stroke="#0B0F14" stroke-width="1.5"/></svg>`;
    marker = new maplibregl.Marker({element:el, rotationAlignment:"map"})
            .setLngLat([lon,lat]).addTo(map);

  map.on("load", () => {
    mapReady = true;
    applyMapPadding();
    if (nav.coords.length) drawNavRoute();
    applyTheme();          /* Patch 20: correctie als het thema intussen wisselde */
  });

  /* Slepen betekent bewust: gebruiker wil de kaart bekijken.
     Daarom pauzeren we follow zoals voorheen gedurende 10 s. */
  map.on("dragstart", e => {
    if (!e.originalEvent) return;
    beginCameraInteraction();
    suspendFollow();
  });

  map.on("dragend", e => {
    if (!e.originalEvent) return;
    endCameraInteraction();
  });

  /* Pinch-zoom krijgt tijdelijk volledige cameracontrole,
     maar schakelt position-follow niet 10 seconden uit.
     Na afloop hervat de bestaande motion-loop automatisch. */
  map.on("zoomstart", e => {
    if (!e.originalEvent) return;
    beginCameraInteraction();
  });

  map.on("zoomend", e => {
    if (!e.originalEvent) return;
    endCameraInteraction();
  });

   /* Patch 9: zoomlevel-indicator bijwerken bij elke zoomwijziging,
     ongeacht de bron (knoppen, pinch, dubbeltik). */
  map.on("zoom", showZoomLevel);
}
function updateCamera(lon, lat, bearing, acc=999, routeProj=null){
  const snapped = routeProj && routeProj.d <= routeSnapLimit(acc);
  setMotionTarget({
    lat: snapped ? routeProj.lat : lat,
    lon: snapped ? routeProj.lon : lon,
    bearing: snapped ? routeProj.bearing : bearing,
    routeAlong: snapped ? routeProj.along : null
  }, acc, dispSpeed);
}
function suspendFollow(){
  following = false;
  clearTimeout(followTimer);
  followTimer = setTimeout(resumeFollow, 10000);
  render();
}
function resumeFollow(){
  clearTimeout(followTimer);

  /* Een expliciete recenter-actie van de gebruiker beëindigt
     eventuele oude gesture-/zoomblokkades. */
  clearTimeout(cameraControl.gestureEndTimer);
  clearTimeout(cameraControl.buttonZoomTimer);
  cameraControl.interactionActive = false;
  cameraControl.buttonZoomUntil = 0;
  cameraControl.lastDraw = 0;

  following = true;

  if (marker && mapReady && state.presentation === "map"){
    const p = motion.pos || (() => {
      const q = marker.getLngLat();
      return {lat:q.lat, lon:q.lng};
    })();

       const resumeBearing = northLocked() ? 0 :
      (bearingState.camera ??
      bearingState.marker ??
      motion.bearing ??
      lastBearing ??
      map.getBearing());

   /* Patch 27: geanimeerd terug i.p.v. omspringen. Geldt ook voor de
       recenter-knop, die dezelfde functie aanroept.
       Tunables: de drie FOLLOW_EASE-constanten en de easing-regel. */
    let px = 0;
    try{
      const a = map.project([p.lon, p.lat]);
      const b = map.project(map.getCenter());
      px = Math.hypot(a.x - b.x, a.y - b.y);
    }catch(err){ px = 0; }
    const canvas  = map.getCanvas();
    const breedte = (canvas && canvas.clientWidth) || 400;
    const schermen = px / breedte;

    if (schermen > FOLLOW_EASE_MAX_SCREENS){
      /* Zo ver weggepand dat een vlucht alleen maar geflikker oplevert. */
      map.jumpTo({ center:[p.lon,p.lat], bearing:resumeBearing });
    } else {
      map.easeTo({
        center:[p.lon,p.lat],
        bearing:resumeBearing,
        duration: Math.round(Math.min(FOLLOW_EASE_MAX_MS,
          FOLLOW_EASE_MS * (0.55 + 0.45 * Math.min(3, schermen)))),
        easing: t => t * (2 - t)      /* vlot weg, zacht aan; weglaten =
                                         MapLibre's eigen ease-curve */
      });
    }
  }

  ensureMotionLoop();
  render();
}

