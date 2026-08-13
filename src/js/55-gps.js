"use strict";
/* ── GPS & snelheidsfilter (hergebruikt) ─────────────────── */
/* ── GPS-watchdog (Patch 8c) ────────────────────────────────
   Doel: een gestorven geolocation-watch tijdens een zeer lange
   rit (10–12 u) gecontroleerd herstarten, zonder restart-loops
   of gestapelde watches. Eén watch-ID, één herstartpad, één
   cooldown. De watchdog kijkt naar het uitblijven van ÁLLE
   callbacks (fix én error): een stroom TIMEOUT-errors betekent
   dat de watch nog leeft (slechte ontvangst) — dan niet
   herstarten. Tijdelijk slechte accuracy raakt de watchdog
   evenmin: accuracy-afhandeling blijft volledig bij de
   bestaande tripfilters/Patch 6. */
const gpsWd = {
  watchId: null,     // actieve watchPosition-ID (null = geen watch)
  lastCallback: 0,   // laatste levensteken: onFix óf onErr
  lastRestart: 0,    // voor cooldown
  restarts: 0,
  errStreak: 0,      // opeenvolgende errors (code 2/3) zonder fix
  awaitingFix: false,// true tussen herstart en eerstvolgende fix
  denied: false,     // permissie geweigerd: nooit auto-herstarten
  foregroundAt: 0,   // laatste terugkeer naar foreground
  lastSuppressLog: 0
};
const GPS_WD_STALE_MS   = 45000;  // geen enkele callback in 45 s ⇒ stale
const GPS_WD_COOLDOWN   = 60000;  // max. 1 auto-herstart per minuut
const GPS_WD_FG_GRACE   = 15000;  // na foreground: watch 15 s de kans geven
const GPS_WD_ERR_STREAK = 4;      // pas na 4 errors op rij herstarten

function startGPS(reason="manual"){
  if (!("geolocation" in navigator)){
    diagAdd("gps.unsupported");
    showNotice(t("ntc_nogps"), t("ntc_nogps_t"));
    return;
  }

  /* Altijd eerst de oude watch opruimen: dit maakt startGPS()
     idempotent en sluit gestapelde watches uit. */
  if (gpsWd.watchId != null){
    try{ navigator.geolocation.clearWatch(gpsWd.watchId); } catch(e){}
    gpsWd.watchId = null;
  }

  diagAdd("gps.watch_start", {
    reason,
    restarts:gpsWd.restarts,
    enableHighAccuracy:true,
    maximumAge:1000,
    timeout:15000
  });

  gpsWd.lastCallback = Date.now(); // vers krediet voor de nieuwe watch
  gpsWd.errStreak = 0;
  gpsWd.denied = false;            // handmatige retry mag opnieuw proberen
  gpsWd.awaitingFix = reason !== "initial";

  gpsWd.watchId = navigator.geolocation.watchPosition(onFix, onErr,
    { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
}

/* Enige toegestane pad voor automatische herstarts; bewaakt de
   cooldown centraal zodat watchdog- en error-pad elkaar niet
   kunnen opjagen. */
function gpsWatchRestart(reason){
  const now = Date.now();
  if (now - gpsWd.lastRestart < GPS_WD_COOLDOWN){
    if (now - gpsWd.lastSuppressLog > GPS_WD_COOLDOWN){
      gpsWd.lastSuppressLog = now;
      diagAdd("gps.restart_suppressed", {
        reason, sinceRestartMs: now - gpsWd.lastRestart
      });
    }
    return false;
  }
  gpsWd.lastRestart = now;
  gpsWd.restarts++;
  diagAdd("gps.watch_restart", {
    reason,
    restarts:gpsWd.restarts,
    lastCallbackAgeMs: gpsWd.lastCallback ? now - gpsWd.lastCallback : null,
    lastFixAgeMs: lastFixTime ? now - lastFixTime : null,
    visibility: document.visibilityState
  });
  startGPS(reason);
  return true;
}

/* Wordt elke seconde aangeroepen vanuit de bestaande kloktimer.
   Bewust conservatief: alleen tijdens een lopende rit, alleen in
   de foreground, en alleen als de watch echt zwijgt. */
function gpsWatchdogTick(now){
  if (!trip.running) return;                              // alleen tijdens rit
  if (document.visibilityState !== "visible") return;     // background: OS mag GPS pauzeren
  if (gpsWd.watchId == null || gpsWd.denied) return;      // nooit gestart / permissie geweigerd
  if (gpsWd.foregroundAt && now - gpsWd.foregroundAt < GPS_WD_FG_GRACE) return; // net terug: geduld
  if (now - gpsWd.lastCallback <= GPS_WD_STALE_MS) return; // watch leeft nog

  diagAdd("gps.watchdog_stale", {
    lastCallbackAgeMs: now - gpsWd.lastCallback,
    lastFixAgeMs: lastFixTime ? now - lastFixTime : null
  });
  /* Binnen 2 min na foreground-terugkeer loggen we de herstart als
     foreground-gerelateerd; dat maakt iOS-suspend-patronen zichtbaar. */
  const reason = (gpsWd.foregroundAt && now - gpsWd.foregroundAt < 120000)
    ? "foreground_stale" : "stale";
  gpsWatchRestart(reason);
}
function alphaFor(acc, v){
  let a = acc <= 5 ? .60 : acc <= 10 ? .45 : acc <= 20 ? .30 : .20;
  if (v < 3) a *= .8;
  return a;
}
function onFix(pos){
  hideNotice();
  const c = pos.coords, ts = pos.timestamp;
  lastFixTime = Date.now();
  /* Patch 8c: levensteken voor de watchdog */
  gpsWd.lastCallback = lastFixTime;
  gpsWd.errStreak = 0;
  gpsWd.denied = false;
  if (gpsWd.awaitingFix){
    gpsWd.awaitingFix = false;
    diagAdd("gps.fix_after_restart", { restarts:gpsWd.restarts });
  }
  lastLat = c.latitude; lastLon = c.longitude;
  if (!firstFix){
    firstFix = true;

    stationary.active = false;
    stationary.candidateSince = 0;
    stationary.lockPos = null;
    stationary.lockBearing = null;
    stationary.exitEvidence = 0;

    initMap(c.longitude, c.latitude, c.speed);
  }

    const acc = c.accuracy ?? 999;
  $("gpsDot").className = acc <= 8 ? "ok" : acc <= 25 ? "mid" : "";
  $("gpsTxt").textContent = `±${Math.round(acc)} m`;

  diagGpsFix(c, ts, acc);

  if (c.altitude != null && !isNaN(c.altitude)){
    const va = (c.altitudeAccuracy != null && !isNaN(c.altitudeAccuracy)) ? c.altitudeAccuracy : 30;
    if (va <= 30){
      const w = va <= 8 ? .25 : va <= 15 ? .15 : .08;
      lastAltRaw = lastAltRaw == null ? c.altitude : lastAltRaw + w * (c.altitude - lastAltRaw);
    }
  }

  fixBuf.push({ t:ts, lat:c.latitude, lon:c.longitude, acc });
  while (fixBuf.length && ts - fixBuf[0].t > 12000) fixBuf.shift();

 /* ── Patch 12: plausibiliteitsfilter snelheid ──────────────
     Incidentele Doppler-glitches (multipath: viaducten, geluids-
     schermen) tilden via de EMA (alpha tot 0,60) dispSpeed en
     daarmee trip.max naar fysiek onmogelijke waarden. Drie lagen,
     bewust VÓÓR de EMA — alphaFor en de EMA zelf blijven ongemoeid:
     laag 2 (kruisvalidatie Doppler↔positie) en laag 1
     (versnellingsclamp) hier; laag 3 (bevestigingseis trip.max)
     in het tripafstand-blok. */
  let m = (c.speed != null && !isNaN(c.speed) && c.speed >= 0) ? c.speed : null;

  /* Positie-afgeleide snelheid over de bestaande ≥3 s-basislijn.
     Voorheen alleen fallback; nu altijd berekend zodat hij ook
     als kruisvalidatie naast native speed kan dienen. Alleen
     "reliable" met voldoende basis: ≥2,5 s, ≥3 bufferpunten en
     een referentiefix met acc ≤ 30 m (dekt net-gestart, na
     accuracy-bridging en dunne buffers). */
  let mPos = null, mPosReliable = false;
  if (fixBuf.length > 1){
    let ref = fixBuf[0];
    for (const f of fixBuf) if (ts - f.t >= 3000) ref = f;
    const dtBase = (ts - ref.t) / 1000;
    if (dtBase > 0.8){
      mPos = hv(ref, {lat:c.latitude, lon:c.longitude}) / dtBase;
      mPosReliable = dtBase >= 2.5 && fixBuf.length >= 3 &&
                     Number.isFinite(ref.acc) && ref.acc <= 30;
    }
  }

  if (m === null){
    m = mPos;                                  // bestaand fallbackgedrag
  } else if (mPosReliable && m > 1.3 * mPos && m - mPos > 3){
    /* Laag 2 — Doppler wantrouwen: native speed die de positie-
       afgeleide snelheid ruim overschrijdt is vrijwel zeker een
       multipath-glitch. Adoptie van mPos is per constructie altijd
       neerwaarts (voorwaarde impliceert mPos < m), dus een door
       een positieshift opgeblazen mPos kan m nooit verhógen. */
    if (Date.now() - spdF.lastDiagAt >= 10000){
      spdF.lastDiagAt = Date.now();
      diagAdd("speed.doppler_distrust", {
        native:+m.toFixed(2), positional:+mPos.toFixed(2)
      });
    }
    m = mPos;
  }

  /* Laag 1 — fysische versnellingsclamp t.o.v. de vorige
     geaccepteerde sample. Omhoog max. 4 m/s², omlaag 10 m/s²
     (noodstops zijn echt). Clampen i.p.v. verwerpen: bij echte
     aanhoudende snelheid haalt de meter binnen 1–2 fixes in.
     De dt-schaling maakt lange fix-gaten vanzelf clamp-vrij. */
  if (m !== null && spdF.lastM != null){
    const dtRef = (ts - spdF.lastTs) / 1000;
    if (dtRef > 0){
      const up   = spdF.lastM + 4  * dtRef;
      const down = spdF.lastM - 10 * dtRef;
      if (m > up || m < down){
        const clamped = Math.max(0, Math.min(up, Math.max(down, m)));
        if (Date.now() - spdF.lastDiagAt >= 10000){
          spdF.lastDiagAt = Date.now();
          diagAdd("speed.clamped", {
            raw:+m.toFixed(2), clamped:+clamped.toFixed(2),
            dt:+dtRef.toFixed(2)
          });
        }
        m = clamped;
      }
    }
  }

  /* Laag 3 (voorbereiding) — bevestigde snelheid: het minimum van
     de twee laatste geaccepteerde samples. trip.max kan daardoor
     alleen stijgen als twee opeenvolgende fixes boven het oude
     maximum liggen; één spike-fix haalt het per constructie nooit. */
  let mConfirmed = null;
  if (m !== null){
    mConfirmed = spdF.lastM == null ? null : Math.min(spdF.lastM, m);
    spdF.lastM = m;
    spdF.lastTs = ts;
  }

   /* Stationary state wordt bepaald uit meerdere recente fixes.
     Dit beïnvloedt alleen de visuele stilstandsmodus en de weergegeven
     snelheid; ruwe GPS blijft elders beschikbaar voor logging/nav. */
  updateStationaryState(ts, m, acc);

  if (stationary.active){
    /* Terwijl de visuele positie vergrendeld is, laat de weergegeven
       snelheid snel maar niet abrupt naar nul zakken. */
    dispSpeed *= .22;

    if (dispSpeed < .35){
      dispSpeed = 0;
    }

    /* Patch 12: tijdens bevestigde stilstand een verse nul-
       referentie voor de versnellingsclamp, zodat wegrijden niet
       tegen een verouderde snelheid wordt geclampt. 4 m/s² vanaf 0
       geeft de eerstvolgende fix ruim voldoende snelheid (≈14 km/u
       bij 1 Hz) om ook de stationary-exit (1,65 m/s) te halen. */
    spdF.lastM = 0;
    spdF.lastTs = ts;
  } else if (m !== null){
     if (m < .6){
      m = 0;
    }

    dispSpeed += alphaFor(acc, m) * (m - dispSpeed);

    if (dispSpeed < .45 && m < .7){
      dispSpeed = 0;
    }
  }
  
  /* ── koersmeting ─────────────────────────────────────────
     Stationary lock blijft dominant. Tijdens beweging kiezen we
     een gemeten koers, maar geven die nog niet rechtstreeks aan
     marker of camera door. */
  if (!stationary.active && dispSpeed >= BEARING_MIN_SPEED_MS){
    let measuredBearing = null;

    /* Native heading is bij hogere snelheid doorgaans bruikbaar.
       Bij wandelen prefereren we bewust de langere ruimtelijke GPS-basis,
       omdat instant heading dan vaak nerveus is. */
    if (
      dispSpeed >= 3 &&
      c.heading != null &&
      !isNaN(c.heading)
    ){
      measuredBearing = normBearing(c.heading);
    }

    if (measuredBearing == null){
      measuredBearing = derivedBearingFromFixes(
        ts,
        c.latitude,
        c.longitude,
        acc,
        dispSpeed
      );
    }

    /* Als afgeleide koers nog geen voldoende lange basis heeft,
       mag native heading als fallback dienen. */
    if (
      measuredBearing == null &&
      c.heading != null &&
      !isNaN(c.heading) &&
      dispSpeed >= 1.3
    ){
      measuredBearing = normBearing(c.heading);
    }

    if (measuredBearing != null){
      bearingState.measured = measuredBearing;

      /* lastBearing blijft de app-brede, gefilterde koersbron.
         De daadwerkelijke marker- en camerafilters volgen hieronder
         in hun eigen renderpaden. */
      if (lastBearing == null){
        lastBearing = measuredBearing;
      } else {
        const d = Math.abs(
          shortestBearingDelta(lastBearing, measuredBearing)
        );

        const deadband = markerBearingDeadband(dispSpeed);

        if (d >= deadband){
          /* GPS-fixes komen niet exact periodiek. Gebruik daarom
             een bescheiden per-fix alpha, afhankelijk van snelheid. */
          const alpha =
            dispSpeed < 3 ? 0.22 :
            dispSpeed < 8 ? 0.36 :
                            0.52;

          lastBearing = bearingLerp(
            lastBearing,
            measuredBearing,
            alpha
          );
        }
      }
    }
  }

 /* tripafstand + routepunten (hoogte altijd NAP-gecorrigeerd geregistreerd) */
 if (trip.running && acc <= ACC_GATE){
    trip.accSum += acc; trip.accN++;
    const here = { lat:c.latitude, lon:c.longitude };

    if (tripLoss.lastBadPos){
      /* Einde slechte-accuracy-episode: de koorde vanaf de bevroren
         lastPos wordt hieronder via het normale pad geteld. */
      diagAdd("trip.bridge", {
        bridgeM: lastPos ? +hv(lastPos, here).toFixed(0) : null,
        badPathM: +tripLoss.accDropM.toFixed(0),
        badFixN: tripLoss.accDropN
      });
      tripLoss.lastBadPos = null;
    }
    if (lastPos){
      const d  = hv(lastPos, here);
      const dt = (ts - lastPos.t) / 1000;
      if (d > Math.min(acc, 12) * .6 && (dt <= 0 || d/dt < 70)){
        trip.dist += d;
        /* Patch 12 (laag 3): trip.max alleen verhogen wanneer twee
           opeenvolgende geaccepteerde, gefilterde samples boven het
           oude maximum liggen (mConfirmed = min van beide). Bewust
           op basis van m i.p.v. dispSpeed: de EMA draagt een spike
           anders nog 2–3 fixes mee het maximum in. */
        if (mConfirmed != null && mConfirmed > trip.max) trip.max = mConfirmed;
        lastPos = { ...here, t:ts };
      } else if (d > 200){
        tripLoss.glitchDropM += d;
        tripLoss.glitchN++;
        lastPos = { ...here, t:ts };
      } else {
        tripLoss.gateSkipN++;
      }
    } else lastPos = { ...here, t:ts };

    /* Snelheidsadaptieve routesampling (Patch 7): boven ~54 km/u is
       3 s / 25 m onnodig dicht. 10 s / 100 m houdt een lange autorit
       compact zonder merkbaar geometrieverlies; fiets-, brom- en
       bootgedrag blijft exact ongewijzigd. */
    const sampleFast = dispSpeed >= 15;
    const sampleMs = sampleFast ? 10000 : 3000;
    const sampleM  = sampleFast ? 100 : 25;
    if (!lastSample || ts - lastSample.t >= sampleMs || hv(lastSample, here) >= sampleM){
      route.push({ t:ts, lat:+c.latitude.toFixed(6), lon:+c.longitude.toFixed(6),
                   v:+dispSpeed.toFixed(2),
                   alt: lastAltRaw == null ? null : +(lastAltRaw - altOffset).toFixed(1),
                   acc: Math.round(acc) });
      lastSample = { ...here, t:ts };
    }

    if (Date.now() - tripLoss.lastLogAt >= 60000){
      tripLoss.lastLogAt = Date.now();
      diagAdd("trip.loss", {
        phase:"interval",
        distM:+trip.dist.toFixed(0),
        accDropM:+tripLoss.accDropM.toFixed(0),
        accDropN:tripLoss.accDropN,
        gateSkipN:tripLoss.gateSkipN,
        softN:tripLoss.softN,
        glitchDropM:+tripLoss.glitchDropM.toFixed(0),
        glitchN:tripLoss.glitchN,
        acc:Math.round(acc)
      });
    }
 } else if (trip.running){
    /* Patch 6b: bij acc > ACC_GATE schuift lastPos NIET meer op.
       De werkelijk gereden afstand over dit segment wordt bij de
       eerstvolgende goede fix als koorde alsnog geteld, beveiligd
       door de bestaande d/dt < 70-poort. De tellers meten het
       segment alleen nog ter verificatie. */
    const hereBad = { lat:c.latitude, lon:c.longitude };
    const badRef = tripLoss.lastBadPos ||
      (lastPos ? { lat:lastPos.lat, lon:lastPos.lon } : null);
    if (badRef) tripLoss.accDropM += hv(badRef, hereBad);
    tripLoss.accDropN++;
    tripLoss.lastBadPos = hereBad;

    /* Patch 26: zachte poort — alleen de routelijn, niet de afstand.
       De sprong sinds het vorige routepunt moet een geloofwaardige
       snelheid opleveren, anders laten we het punt liever vallen:
       een gat is beter dan een uitschieter van een kilometer. */
    if (acc <= ACC_GATE_SOFT){
      const refS = lastSample || lastPos;
      const dtS  = refS ? (ts - refS.t) / 1000 : 0;
      const dS   = refS ? hv(refS, hereBad) : 0;
      const plausibel = !refS || dtS <= 0 || (dS / dtS) < SOFT_MAX_MS;
      if (plausibel && (!lastSample || ts - lastSample.t >= 3000 || dS >= 25)){
        route.push({ t:ts, lat:+c.latitude.toFixed(6), lon:+c.longitude.toFixed(6),
                     v:+dispSpeed.toFixed(2),
                     alt: lastAltRaw == null ? null : +(lastAltRaw - altOffset).toFixed(1),
                     acc: Math.round(acc), soft:1 });
        lastSample = { ...hereBad, t:ts };
        tripLoss.softN++;
      }
    }
  } else {
    lastPos = { lat:c.latitude, lon:c.longitude, t:ts };
  }

   /* Navigatieberekeningen blijven altijd op de ruwe GPS-fix draaien.
     Stationary lock mag dus geen aankomst-, off-route- of reroute-logica
     kunstmatig beïnvloeden. */
  const routeProj = navOnFix(c);

  if (stationary.active && stationary.lockPos){
    /* Alleen de visuele laag krijgt het vergrendelde clustercentrum.
       Geen route-snap tijdens stationary lock: een reeds stilstaande
       marker moet niet alsnog langs de routelijn gaan schuiven. */
    updateCamera(
      stationary.lockPos.lon,
      stationary.lockPos.lat,
      stationary.lockBearing,
      acc,
      null
    );
  } else {
    updateCamera(
      c.longitude,
      c.latitude,
      lastBearing,
      acc,
      routeProj
    );
  }

  render();
}
   
function onErr(e){
  diagAdd("gps.error", {
    code:e && Number.isFinite(e.code)
      ? e.code
      : null,
    message:e && e.message
      ? String(e.message)
      : null,
    visibility:document.visibilityState,
    lastFixAgeMs:lastFixTime
      ? Math.max(0, Date.now() - lastFixTime)
      : null
  });

  /* Patch 8c: een error is óók een levensteken van de watch. */
  gpsWd.lastCallback = Date.now();

  if (e && e.code === 1){
    /* Permissie geweigerd: automatische herstarts zijn zinloos en
       zouden alleen ruis geven. Handmatige retry (ntcBtn) reset dit. */
    gpsWd.denied = true;
    gpsWd.errStreak = 0;
    showNotice(t("ntc_deny"), t("ntc_deny_t"));
  } else {
    $("gpsTxt").textContent = t("nofix");
    /* POSITION_UNAVAILABLE/TIMEOUT: pas na een reeks errors op rij
       (zonder tussenliggende fix) gecontroleerd herstarten. Eén losse
       timeout in een tunnel is geen reden voor een restart. */
    gpsWd.errStreak++;
    if (trip.running &&
        document.visibilityState === "visible" &&
        gpsWd.errStreak >= GPS_WD_ERR_STREAK){
      if (gpsWatchRestart("error_streak")) gpsWd.errStreak = 0;
    }
  }
}

