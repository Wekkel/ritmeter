"use strict";
/* ── vloeiende visuele positie (30 fps, dead reckoning + foutuitmiddeling) ──
   De ruwe GPS-fix blijft leidend voor ritafstand, logging en off-route-detectie.
   Alleen marker + camera gebruiken deze voorspellende weergavelaag. */
const MOTION_FPS = 30;
const MOTION_FRAME_MS = 1000 / MOTION_FPS;
   
/* Marker en kaartcamera hebben bewust een verschillend tempo.
   De marker blijft vloeiend op maximaal 30 fps bewegen.
   De camera volgt rustiger op maximaal 15 fps en wordt volledig
   geblokkeerd tijdens gebruikersinteractie en knop-zoom. */
const CAMERA_FPS = 15;
const CAMERA_FRAME_MS = 1000 / CAMERA_FPS;
const CAMERA_GESTURE_GRACE_MS = 220;
const CAMERA_BUTTON_ZOOM_BLOCK_MS = 420;

/* ═══ PATCH 27 — VLOEIEND TERUGVLIEGEN ════════════════════
   resumeFollow() sprong met jumpTo() in één frame terug naar de
   driehoek. easeTo() maakt daar een korte vlucht van.

   Er is geen extra camerablokkade nodig: cameraWriteBlocked() ziet
   map.isEasing() al als blokkade, dus de follow-camera onderbreekt de
   animatie niet. En de dragstart-handler negeert bewegingen zonder
   originalEvent, dus de animatie zet follow niet zelf weer op pauze.

   De duur schaalt licht mee met de afstand op het scherm: een klein
   zetje voelt direct, een grote verplaatsing krijgt iets meer tijd. */
const FOLLOW_EASE_MS         = 420;   // basisduur bij ~1 schermbreedte
const FOLLOW_EASE_MAX_MS     = 650;   // bovengrens
const FOLLOW_EASE_MAX_SCREENS = 4;    // verder weg: animeren is beeldruis

/* ── stationary lock ────────────────────────────────────────
   GPS-fixes van een stilstaand toestel vormen meestal geen exact punt,
   maar een kleine wolk. Na overtuigende stilstand vergrendelen we alleen
   de visuele positie. Ruwe GPS blijft leidend voor logging en navigatie. */
const STATIONARY_WINDOW_MS = 6500;
const STATIONARY_MIN_SPAN_MS = 4800;
const STATIONARY_ENTER_CONFIRM_MS = 2200;

const STATIONARY_SPEED_MAX_MS = 1.15;       // kandidaat stilstand: ~4,1 km/u
const STATIONARY_EXIT_SPEED_MS = 1.65;      // duidelijke beweging: ~5,9 km/u

const STATIONARY_RADIUS_MIN_M = 4.5;
const STATIONARY_RADIUS_MAX_M = 11;

const STATIONARY_EXIT_DIST_MIN_M = 7;
const STATIONARY_EXIT_DIST_MAX_M = 18;
const STATIONARY_EXIT_CONFIRM_FIXES = 2;
/* ── bearing / horizon smoothing ────────────────────────────
   Positie, markerkoers en camerakoers hebben bewust verschillende
   filters. Vooral bij wandelen is een koers uit enkele meters GPS-
   verplaatsing te ruisachtig om direct de 3D-camera te draaien. */

/* Minimale snelheid voor betrouwbare koersverwerking. */
const BEARING_MIN_SPEED_MS = 0.9;

/* Bewegingsbasis voor GPS-afgeleide koers.
   Bij lage snelheid gebruiken we een veel langere basis. */
const BEARING_WALK_BASE_MIN_M = 9;
const BEARING_WALK_BASE_MAX_M = 22;
const BEARING_VEHICLE_BASE_MIN_M = 5;

/* Kleine koerswijzigingen worden niet direct doorgegeven. */
const BEARING_MARKER_DEADBAND_LOW_DEG = 5;
const BEARING_MARKER_DEADBAND_HIGH_DEG = 2;

const BEARING_CAMERA_DEADBAND_LOW_DEG = 7;
const BEARING_CAMERA_DEADBAND_HIGH_DEG = 3;

/* Tijdconstanten: hoger = rustiger/langzamer. */
const BEARING_MARKER_TAU_WALK_S = 1.15;
const BEARING_MARKER_TAU_MID_S = 0.65;
const BEARING_MARKER_TAU_FAST_S = 0.38;

const BEARING_CAMERA_TAU_WALK_S = 2.4;
const BEARING_CAMERA_TAU_MID_S = 1.25;
const BEARING_CAMERA_TAU_FAST_S = 0.72;
   
const MOTION_HARD_SNAP_MIN_M = 40;
const MOTION_HARD_SNAP_MAX_M = 120;
/* ── stale GPS / dead reckoning ─────────────────────────────
   Vrij rijden is conservatiever dan actieve navigatie.
   Tijd én afstand worden begrensd, zodat een oude snelheid niet
   tientallen of honderden meters fictief blijft doorlopen. */

const GPS_STALE_AFTER_MS = 3200;

/* Vrij rijden */
const DR_FREE_HOLD_S = 2.5;
const DR_FREE_DECAY_S = 3.5;
const DR_FREE_MAX_AGE_S = 8;
const DR_FREE_MAX_DIST_M = 28;

/* Actieve route */
const DR_ROUTE_HOLD_S = 4.5;
const DR_ROUTE_DECAY_S = 6;
const DR_ROUTE_MAX_AGE_S = 14;
const DR_ROUTE_MAX_DIST_M = 120;

/* Na zeer lange fixuitval stopt visuele voorspelling volledig. */
const DR_ABSOLUTE_MAX_AGE_S = 18;

const motion = {
  pos:null,
  bearing:null,

  anchor:null,
  anchorBearing:null,
  anchorPerf:0,

  speed:0,
  acc:999,

  routeAlong:null,
  routeMode:false,

  /* Laatste echte GPS-gebaseerde motion update. */
  lastFixPerf:0,

  /* Bewaakt één stale episode. */
  staleActive:false,
  staleStartPerf:0,

  raf:0,
  lastDraw:0
};

/* Visuele stilstandstoestand.
   lockPos is uitsluitend een renderpositie; raw GPS blijft onaangetast. */
const stationary = {
  active:false,
  candidateSince:0,
  lockPos:null,
  lockBearing:null,
  exitEvidence:0
};

/* Marker- en camerakoers worden apart gefilterd.
   measured is de laatst geaccepteerde koersmeting.
   marker is de visuele richting van de driehoek.
   camera is de rustigere richting van de 3D-kaart. */
const bearingState = {
  measured:null,
  marker:null,
  camera:null,
  lastMarkerPerf:0,
  lastCameraPerf:0
};

function stationaryRadiusLimit(acc){
  const a = Number.isFinite(acc) ? acc : 999;

  return Math.max(
    STATIONARY_RADIUS_MIN_M,
    Math.min(
      STATIONARY_RADIUS_MAX_M,
      a * 0.85
    )
  );
}

function stationaryExitDistance(acc){
  const a = Number.isFinite(acc) ? acc : 999;

  return Math.max(
    STATIONARY_EXIT_DIST_MIN_M,
    Math.min(
      STATIONARY_EXIT_DIST_MAX_M,
      a * 1.4
    )
  );
}

/* Bepaal een robuust middelpunt van recente fixes.
   We gebruiken het gemiddelde van lat/lon; uitschieters beïnvloeden
   de radiuscontrole vervolgens vanzelf negatief en verhinderen dan
   een te snelle stationary lock. */
function recentFixCluster(ts){
  const fixes = fixBuf.filter(f => ts - f.t <= STATIONARY_WINDOW_MS);

  if (fixes.length < 3) return null;

  const spanMs = fixes[fixes.length - 1].t - fixes[0].t;
  if (spanMs < STATIONARY_MIN_SPAN_MS) return null;

  let lat = 0;
  let lon = 0;

  for (const f of fixes){
    lat += f.lat;
    lon += f.lon;
  }

  const center = {
    lat:lat / fixes.length,
    lon:lon / fixes.length
  };

  let maxRadius = 0;

  for (const f of fixes){
    maxRadius = Math.max(maxRadius, hv(center, f));
  }

  return {
    center,
    maxRadius,
    spanMs,
    count:fixes.length
  };
}

function clearStationaryCandidate(){
  stationary.candidateSince = 0;
}

/* Wordt per GPS-fix aangeroepen.
   rawSpeed is de actuele GPS-/afgeleide snelheid vóór visuele filtering. */
function updateStationaryState(ts, rawSpeed, acc){
  const here = {
    lat:lastLat,
    lon:lastLon
  };

  if (here.lat == null || here.lon == null) return;

  /* ── reeds vergrendeld: alleen loslaten bij overtuigende beweging ── */
  if (stationary.active){
    const distFromLock = stationary.lockPos
      ? hv(stationary.lockPos, here)
      : 0;

    const fastEnough =
      rawSpeed != null &&
      Number.isFinite(rawSpeed) &&
      rawSpeed >= STATIONARY_EXIT_SPEED_MS;

    const farEnough =
      distFromLock >= stationaryExitDistance(acc);

    if (fastEnough || farEnough){
      stationary.exitEvidence++;
    } else {
      stationary.exitEvidence = 0;
    }

        if (stationary.exitEvidence >= STATIONARY_EXIT_CONFIRM_FIXES){
      stationary.active = false;
      stationary.candidateSince = 0;
      stationary.lockPos = null;
      stationary.lockBearing = null;
      stationary.exitEvidence = 0;

      /* Na echte stilstand moeten marker en camera niet eerst vanaf
         een mogelijk oude koers minutenlang terugfilteren. De eerstvolgende
         betrouwbare bewegingskoers mag een nieuwe basis vormen. */
      bearingState.measured = null;
      bearingState.marker = null;
      bearingState.camera = null;
      bearingState.lastMarkerPerf = 0;
      bearingState.lastCameraPerf = 0;
    }

    return;
  }

  /* ── nog bewegend: onderzoeken of fixes een compacte cluster vormen ── */
  const cluster = recentFixCluster(ts);

  const slowEnough =
    rawSpeed == null ||
    !Number.isFinite(rawSpeed) ||
    rawSpeed <= STATIONARY_SPEED_MAX_MS;

  const compactEnough =
    cluster &&
    cluster.maxRadius <= stationaryRadiusLimit(acc);

  if (!slowEnough || !compactEnough){
    clearStationaryCandidate();
    return;
  }

  if (!stationary.candidateSince){
    stationary.candidateSince = Date.now();
    return;
  }

  if (
    Date.now() - stationary.candidateSince <
    STATIONARY_ENTER_CONFIRM_MS
  ){
    return;
  }

  /* Overtuigende stilstand: vergrendel de visuele positie op het
     middelpunt van de recente GPS-cluster, niet op één willekeurige fix. */
  stationary.active = true;
  stationary.lockPos = {
    lat:cluster.center.lat,
    lon:cluster.center.lon
  };
  stationary.lockBearing =
    motion.bearing ??
    lastBearing ??
    null;

  stationary.exitEvidence = 0;
}

