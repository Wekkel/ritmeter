"use strict";
/* Camera-control staat los van de marker-smoothing.
   Daardoor kan de driehoek blijven bewegen terwijl MapLibre
   tijdelijk volledige controle krijgt over pinch, drag of zoom. */
const cameraControl = {
  interactionActive:false,
  buttonZoomUntil:0,
  lastDraw:0,
  gestureEndTimer:0,
  buttonZoomTimer:0,
  /* Patch 11: actieve pointers op het kaartcanvas. Zolang deze set
     niet leeg is, mag de camerablokkade niet worden opgeheven. */
  pointers:new Set(),
  lastTouchBlockLog:0
};
   
function beginCameraInteraction(){
  clearTimeout(cameraControl.gestureEndTimer);
  cameraControl.interactionActive = true;
}

function endCameraInteraction(){
  /* Patch 11: zolang er nog ten minste één vinger op het kaartcanvas
     staat, blijft de blokkade staan. Dit dekt zowel een pinch waarbij
     één vinger eerder loslaat, als dragend/zoomend-events die vóór de
     laatste pointerup binnenkomen. De release volgt dan vanzelf via
     de laatste pointerup/pointercancel op window. */
  if (cameraControl.pointers.size > 0) return;

  clearTimeout(cameraControl.gestureEndTimer);

  /* Korte grace period voorkomt dat de follow-camera al in hetzelfde
     touch-einde terugschrijft terwijl MapLibre de gesture afrondt. */
   cameraControl.gestureEndTimer = setTimeout(() => {
    cameraControl.interactionActive = false;
    cameraControl.lastDraw = 0;
    ensureMotionLoop();
  }, CAMERA_GESTURE_GRACE_MS);
}

function blockCameraForButtonZoom(){
  clearTimeout(cameraControl.buttonZoomTimer);

  cameraControl.buttonZoomUntil =
    performance.now() + CAMERA_BUTTON_ZOOM_BLOCK_MS;

  cameraControl.buttonZoomTimer = setTimeout(() => {
    cameraControl.buttonZoomUntil = 0;
    cameraControl.lastDraw = 0;
    ensureMotionLoop();
  }, CAMERA_BUTTON_ZOOM_BLOCK_MS + 20);
}

function cameraWriteBlocked(now){
  if (!map || !mapReady) return true;
  if (cameraControl.interactionActive) return true;
  if (now < cameraControl.buttonZoomUntil) return true;

  /* Extra vangnet: ook programmatic MapLibre-animaties mogen niet
     door onze follow-camera met jumpTo() worden afgebroken. */
  if (typeof map.isEasing === "function" && map.isEasing()) return true;
  if (typeof map.isZooming === "function" && map.isZooming()) return true;

  return false;
}

function drawFollowCamera(now){
  if (!mapReady || !map || !following || !motion.pos) return;
  if (cameraWriteBlocked(now)) return;

  if (
    cameraControl.lastDraw &&
    now - cameraControl.lastDraw < CAMERA_FRAME_MS
  ){
    return;
  }

  const prevDraw = cameraControl.lastDraw;
  cameraControl.lastDraw = now;

  /* Noord-vast (alleen 2D): bearing hard op 0. De smoothing-state
     wordt meegezet zodat het loslaten van de lock later zonder
     sprong vanaf 0° verder filtert. Gaat bewust vóór stationary. */
  if (northLocked()){
    bearingState.camera = 0;
    bearingState.lastCameraPerf = now;
    map.jumpTo({
      center:[motion.pos.lon, motion.pos.lat],
      bearing:0
    });
    return;
  }

  /* Camerakoers is bewust rustiger dan markerkoers.
     De driehoek mag dus een bocht eerder tonen terwijl de horizon
     pas volgt wanneer de koerswijziging stabiel genoeg is. */
  const cameraTargetBearing = stationary.active
    ? stationary.lockBearing
    : (
        bearingState.marker ??
        bearingState.measured ??
        motion.bearing ??
        lastBearing
      );

  let cameraBearing = map.getBearing();

  if (cameraTargetBearing != null){
    if (bearingState.camera == null){
      bearingState.camera = normBearing(cameraTargetBearing);
      bearingState.lastCameraPerf = now;
    } else {
      const dtS = bearingState.lastCameraPerf
        ? Math.min(
            0.35,
            Math.max(
              0,
              (now - bearingState.lastCameraPerf) / 1000
            )
          )
        : (
            prevDraw
              ? Math.min(0.35, Math.max(0, (now - prevDraw) / 1000))
              : 0
          );

      bearingState.lastCameraPerf = now;

      const delta = Math.abs(
        shortestBearingDelta(
          bearingState.camera,
          cameraTargetBearing
        )
      );

      if (
        stationary.active ||
        delta >= cameraBearingDeadband(dispSpeed)
      ){
        const alpha = stationary.active
          ? 1
          : expAlpha(
              dtS,
              cameraBearingTau(dispSpeed)
            );

        bearingState.camera = bearingLerp(
          bearingState.camera,
          cameraTargetBearing,
          alpha
        );
      }
    }

    cameraBearing = bearingState.camera;
  }

  map.jumpTo({
    center:[
      motion.pos.lon,
      motion.pos.lat
    ],
    bearing:cameraBearing
  });
}

const normBearing = deg => ((deg % 360) + 360) % 360;

function shortestBearingDelta(fromDeg, toDeg){
  if (fromDeg == null || toDeg == null) return 0;

  return (
    (toDeg - fromDeg + 540) % 360
  ) - 180;
}

function bearingLerp(fromDeg, toDeg, alpha){
  if (fromDeg == null) return normBearing(toDeg);
  if (toDeg == null) return normBearing(fromDeg);

  const d = shortestBearingDelta(fromDeg, toDeg);

  return normBearing(
    fromDeg + d * Math.max(0, Math.min(1, alpha))
  );
}

function expAlpha(dtS, tauS){
  if (!Number.isFinite(dtS) || dtS <= 0) return 1;
  if (!Number.isFinite(tauS) || tauS <= 0) return 1;

  return 1 - Math.exp(-dtS / tauS);
}

function markerBearingTau(speed){
  const v = Math.max(0, speed || 0);

  if (v < 3){
    return BEARING_MARKER_TAU_WALK_S;
  }

  if (v < 8){
    return BEARING_MARKER_TAU_MID_S;
  }

  return BEARING_MARKER_TAU_FAST_S;
}

function cameraBearingTau(speed){
  const v = Math.max(0, speed || 0);

  if (v < 3){
    return BEARING_CAMERA_TAU_WALK_S;
  }

  if (v < 8){
    return BEARING_CAMERA_TAU_MID_S;
  }

  return BEARING_CAMERA_TAU_FAST_S;
}

function markerBearingDeadband(speed){
  return (speed || 0) < 3
    ? BEARING_MARKER_DEADBAND_LOW_DEG
    : BEARING_MARKER_DEADBAND_HIGH_DEG;
}

function cameraBearingDeadband(speed){
  return (speed || 0) < 3
    ? BEARING_CAMERA_DEADBAND_LOW_DEG
    : BEARING_CAMERA_DEADBAND_HIGH_DEG;
}

/* Kies voor GPS-afgeleide koers een referentiefix op voldoende afstand.
   Bij wandelen is afstand belangrijker dan alleen tijd: enkele seconden
   kunnen anders slechts 2–4 meter basis geven, wat veel hoekruis oplevert. */
function derivedBearingFromFixes(ts, lat, lon, acc, speed){
  if (!fixBuf || fixBuf.length < 2) return null;

  const here = {lat, lon};
  const v = Math.max(0, speed || 0);

  /* Bij wandelen streven we naar ongeveer 9–22 m meetbasis.
     Bij hogere snelheid mag de basis korter zijn voor responsie. */
  let minBaseM;

  if (v < 3){
    minBaseM = Math.max(
      BEARING_WALK_BASE_MIN_M,
      Math.min(
        BEARING_WALK_BASE_MAX_M,
        Math.max(0, Number.isFinite(acc) ? acc : 0) * 1.15
      )
    );
  } else {
    minBaseM = BEARING_VEHICLE_BASE_MIN_M;
  }

  let best = null;

  /* Zoek van nieuw naar oud de eerste fix die voldoende ruimtelijke
     basis geeft. Zo blijft de koers relatief actueel. */
  for (let i = fixBuf.length - 2; i >= 0; i--){
    const f = fixBuf[i];

    if (ts - f.t < 1200){
      continue;
    }

    const moved = hv(f, here);

    if (moved >= minBaseM){
      best = f;
      break;
    }
  }

  if (!best){
    return null;
  }

  return routeBearing(best, here);
}
   
function angleDelta(from, to){ return ((to - from + 540) % 360) - 180; }
function routeBearing(a, b){
  const lat1 = a.lat*Math.PI/180, lat2 = b.lat*Math.PI/180;
  const dLon = (b.lon-a.lon)*Math.PI/180;
  const y = Math.sin(dLon)*Math.cos(lat2);
  const x = Math.cos(lat1)*Math.sin(lat2) - Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon);
  return normBearing(Math.atan2(y,x)*180/Math.PI);
}
function moveGeo(p, bearing, distM){
  if (!(distM > 0) || bearing == null) return { lat:p.lat, lon:p.lon };
  const br = bearing*Math.PI/180, d = distM/R;
  const lat1 = p.lat*Math.PI/180, lon1 = p.lon*Math.PI/180;
  const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d) + Math.cos(lat1)*Math.sin(d)*Math.cos(br));
  const lon2 = lon1 + Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(lat1),
                                Math.cos(d)-Math.sin(lat1)*Math.sin(lat2));
  return { lat:lat2*180/Math.PI, lon:((lon2*180/Math.PI+540)%360)-180 };
}
function deadReckoningLimits(routeMode){
  return routeMode
    ? {
        holdS:DR_ROUTE_HOLD_S,
        decayS:DR_ROUTE_DECAY_S,
        maxAgeS:DR_ROUTE_MAX_AGE_S,
        maxDistM:DR_ROUTE_MAX_DIST_M
      }
    : {
        holdS:DR_FREE_HOLD_S,
        decayS:DR_FREE_DECAY_S,
        maxAgeS:DR_FREE_MAX_AGE_S,
        maxDistM:DR_FREE_MAX_DIST_M
      };
}

function staleSpeed(ageS, baseSpeed, routeMode = motion.routeMode){
  const speed = Math.max(0, baseSpeed || 0);
  const limits = deadReckoningLimits(routeMode);

  if (ageS <= 0){
    return speed;
  }

  if (
    ageS >= limits.maxAgeS ||
    ageS >= DR_ABSOLUTE_MAX_AGE_S
  ){
    return 0;
  }

  if (ageS <= limits.holdS){
    return speed;
  }

  const decayAge = ageS - limits.holdS;

  return speed * Math.exp(
    -decayAge / limits.decayS
  );
}

function deadReckoningTravel(ageS, baseSpeed, routeMode = motion.routeMode){
  const speed = Math.max(0, baseSpeed || 0);
  const limits = deadReckoningLimits(routeMode);

  const cappedAgeS = Math.max(
    0,
    Math.min(
      ageS,
      limits.maxAgeS,
      DR_ABSOLUTE_MAX_AGE_S
    )
  );

  let distM;

  if (cappedAgeS <= limits.holdS){
    distM = speed * cappedAgeS;
  } else {
    const decayAge = cappedAgeS - limits.holdS;

    distM =
      speed * limits.holdS +
      speed * limits.decayS *
        (1 - Math.exp(-decayAge / limits.decayS));
  }

  return Math.min(
    limits.maxDistM,
    Math.max(0, distM)
  );
}

function beginStaleEpisode(now){
  if (motion.staleActive) return;

  motion.staleActive = true;
  motion.staleStartPerf = motion.lastFixPerf
    ? Math.min(
        now,
        motion.lastFixPerf + GPS_STALE_AFTER_MS
      )
    : now;
}

function clearStaleEpisode(){
  motion.staleActive = false;
  motion.staleStartPerf = 0;
}

function invalidateRouteDeadReckoning(){
  const wasRouteMode = motion.routeMode;

  motion.routeMode = false;
  motion.routeAlong = null;

  if (
    !wasRouteMode ||
    !motion.staleActive ||
    !motion.pos
  ){
    return;
  }

  /* Een routewissel of nav-stop tijdens stale GPS mag de marker
     niet terugtrekken naar een oude vrije anchor. Bevries daarom
     op de actuele visuele positie tot een nieuwe echte GPS-fix komt. */
  motion.anchor = {
    lat:motion.pos.lat,
    lon:motion.pos.lon
  };
  motion.anchorBearing = motion.bearing;
  motion.anchorPerf = performance.now();
  motion.speed = 0;
}
   
function blendGeo(cur, target, a){
  const dLon = ((target.lon-cur.lon+540)%360)-180;
  cur.lat += (target.lat-cur.lat)*a;
  cur.lon = ((cur.lon + dLon*a + 540)%360)-180;
}
function predictMotion(now){
  if (!motion.anchor){
    return null;
  }

  const ageS = Math.max(
    0,
    (now - motion.anchorPerf) / 1000
  );

  /* Na enkele seconden zonder echte fix begint een stale episode.
     De starttijd wordt teruggelegd op het echte stale-moment, zodat
     achtergrond/big-mode geen nieuwe volledige extrapolatieperiode krijgt. */
  if (
    motion.lastFixPerf &&
    now - motion.lastFixPerf >= GPS_STALE_AFTER_MS
  ){
    beginStaleEpisode(now);
  }

  const staleAgeS = motion.staleActive
    ? Math.max(
        0,
        (now - motion.staleStartPerf) / 1000
      )
    : 0;

  const routeMode =
    motion.routeMode &&
    motion.routeAlong != null &&
    nav.coords &&
    nav.coords.length > 1;

  const baseSpeed = Math.max(
    0,
    motion.speed || 0
  );

  const liveSpeed = motion.staleActive
    ? staleSpeed(
        staleAgeS,
        baseSpeed,
        routeMode
      )
    : baseSpeed;

  /* Afstand wordt geïntegreerd, niet berekend als actuele snelheid × totale tijd.
     Daardoor kan de voorspelde positie tijdens speed-decay nooit teruglopen. */
  const travelM = motion.staleActive
    ? (
        baseSpeed * Math.min(
          ageS,
          GPS_STALE_AFTER_MS / 1000
        ) +
        deadReckoningTravel(
          staleAgeS,
          baseSpeed,
          routeMode
        )
      )
    : baseSpeed * ageS;

  let predicted;

  /* ── route-aware extrapolatie ─────────────────────────── */
  if (routeMode){
    const along = Math.max(
      0,
      motion.routeAlong + travelM
    );

    const rp = pointAtRouteAlong(along);

    if (rp){
      predicted = {
        lat:rp.lat,
        lon:rp.lon,
        bearing:
          rp.bearing ??
          motion.anchorBearing ??
          motion.bearing,
        ageS,
        liveSpeed,
        routeAlong:rp.along
      };
    }
  }

  /* ── vrije extrapolatie ───────────────────────────────── */
  if (!predicted){
    const p = moveGeo(
      motion.anchor,
      motion.anchorBearing ?? motion.bearing,
      travelM
    );

    predicted = {
      lat:p.lat,
      lon:p.lon,
      bearing:
        motion.anchorBearing ??
        motion.bearing,
      ageS,
      liveSpeed,
      routeAlong:null
    };
  }

  return predicted;
}
   
function setMotionTarget(target, acc, speed){
  const now = performance.now();
     /* Elke call naar setMotionTarget komt uit een nieuwe GPS-fix.
     Daarmee eindigt een eventuele stale/dead-reckoning episode. */
  clearStaleEpisode();
  motion.lastFixPerf = now;
  const mapVisible = document.visibilityState === "visible" && state.presentation === "map";
    /* Kies één consistente koersbron voor de motion predictor.
     Tijdens stationary wint de vergrendelde koers.
     Tijdens beweging prefereren we de nieuwe gefilterde koersmeting;
     alleen als die ontbreekt vallen we terug op de targetbearing. */
  const targetBearing = stationary.active
    ? stationary.lockBearing
    : (
        bearingState.measured ??
        target.bearing ??
        lastBearing ??
        motion.bearing
      );

  if (!motion.pos || !mapVisible){
    /* Als de kaart verborgen is (groot getal / achtergrond), bestaat er geen
       visuele overgang om te behouden. Houd de interne positie dan actueel. */
    motion.pos = {
      lat:target.lat,
      lon:target.lon
    };

    if (targetBearing != null){
      motion.bearing = normBearing(targetBearing);
    }

  } else {
    const err = hv(motion.pos, target);

    const hard = Math.max(
      MOTION_HARD_SNAP_MIN_M,
      Math.min(
        MOTION_HARD_SNAP_MAX_M,
        3 * Math.max(1, acc || 999)
      )
    );

    if (err > hard){
      motion.pos = {
        lat:target.lat,
        lon:target.lon
      };

      if (targetBearing != null){
        motion.bearing = normBearing(targetBearing);
      }
    }
  }

  motion.anchor = {
    lat:target.lat,
    lon:target.lon
  };

  motion.anchorBearing = targetBearing == null
    ? motion.bearing
    : normBearing(targetBearing);

  motion.anchorPerf = now;

  /* Tijdens stationary lock is visuele extrapolatie expliciet nul.
     De ruwe snelheid elders in de app blijft onaangetast. */
  motion.speed = stationary.active
    ? 0
    : Math.max(0, speed || 0);

  motion.acc = acc || 999;

  motion.routeAlong = stationary.active
    ? null
    : (target.routeAlong == null ? null : target.routeAlong);

  motion.routeMode =
    !stationary.active &&
    target.routeAlong != null;

  ensureMotionLoop();
}
   
function drawMotionFrame(now){
  motion.raf = 0;
  if (document.visibilityState !== "visible" || state.presentation !== "map" || !marker) return;
  if (motion.lastDraw && now-motion.lastDraw < MOTION_FRAME_MS){
    motion.raf = requestAnimationFrame(drawMotionFrame);
    return;
  }
  const dt = motion.lastDraw ? Math.min(.12, (now-motion.lastDraw)/1000) : 1/MOTION_FPS;
  motion.lastDraw = now;
  const desired = predictMotion(now);
  if (!desired || !motion.pos) return;

  /* Exponentiële foutcorrectie: nauwkeurige fixes trekken sneller bij dan grove fixes. */
  const tau = motion.acc <= 8 ? .34 : motion.acc <= 20 ? .52 : .75;
  const aPos = 1-Math.exp(-dt/tau);
  blendGeo(motion.pos, desired, aPos);

  if (desired.bearing != null){
    if (motion.bearing == null) motion.bearing = normBearing(desired.bearing);
    const aBear = 1-Math.exp(-dt/.38);
    motion.bearing = normBearing(motion.bearing + angleDelta(motion.bearing, desired.bearing)*aBear);
  }

  /* Markerpositie blijft op de volledige motion-frequentie bewegen. */
  marker.setLngLat([
    motion.pos.lon,
    motion.pos.lat
  ]);

  /* Markerkoers krijgt een eigen snelheidsafhankelijk filter.
     Tijdens stationary lock blijft de eerder vastgezette koers staan. */
  const markerTargetBearing = stationary.active
    ? stationary.lockBearing
    : motion.staleActive
      ? (
          motion.bearing ??
          bearingState.measured ??
          lastBearing
        )
      : (
          bearingState.measured ??
          motion.bearing ??
          lastBearing
        );

  if (markerTargetBearing != null){
    if (bearingState.marker == null){
      bearingState.marker = normBearing(markerTargetBearing);
      bearingState.lastMarkerPerf = now;
    } else {
      const dtS = bearingState.lastMarkerPerf
        ? Math.min(0.25, Math.max(0, (now - bearingState.lastMarkerPerf) / 1000))
        : 0;

      bearingState.lastMarkerPerf = now;

      const delta = Math.abs(
        shortestBearingDelta(
          bearingState.marker,
          markerTargetBearing
        )
      );

      if (
        stationary.active ||
        delta >= markerBearingDeadband(dispSpeed)
      ){
        const alpha = stationary.active
          ? 1
          : expAlpha(
              dtS,
              markerBearingTau(dispSpeed)
            );

        bearingState.marker = bearingLerp(
          bearingState.marker,
          markerTargetBearing,
          alpha
        );
      }
    }

    marker.setRotation(bearingState.marker);
  } else {
    marker.setRotation(0);
  }

  /* Camera volgt apart, rustiger en minder vaak. */
  drawFollowCamera(now);

  const err = hv(motion.pos, desired);
  const bErr = desired.bearing == null || motion.bearing == null ? 0
    : Math.abs(angleDelta(motion.bearing, desired.bearing));
  const liveSpeed = Math.max(0, desired.liveSpeed || 0);
  if (liveSpeed > .15 || err > .12 || bErr > .25 || desired.ageS < 1.2)
    motion.raf = requestAnimationFrame(drawMotionFrame);
}
   
function ensureMotionLoop(){
  if (motion.raf || !motion.anchor || !marker) return;
  if (document.visibilityState !== "visible" || state.presentation !== "map") return;
  motion.lastDraw = 0;
  motion.raf = requestAnimationFrame(drawMotionFrame);
}

