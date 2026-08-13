"use strict";
/* ── klok, auto-pauze & persistentie ─────────────────────── */
/* ── klok, auto-pauze & persistentie ─────────────────────── */
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const delta = now - lastTick;
  lastTick = now;

  if (firstFix && now - lastFixTime > 4000){
    dispSpeed *= .5; if (dispSpeed < .4) dispSpeed = 0;
  }
  if (dispSpeed > 1.2) lastMotion = now;
  if (dispSpeed < .55){
    if (zeroSince === null) zeroSince = now;
    isPaused = autoPause && (now - zeroSince > 5000);
  } else { zeroSince = null; isPaused = false; }
  
  if (trip.running && !(autoPause && isPaused)){ trip.ms += delta; }

  gpsWatchdogTick(now);   /* Patch 8c: stale-detectie GPS-watch */

  if (trip.running || dispSpeed > 0) render();
}, 1000);
setInterval(() => {
  try{ LS.setItem("rm_trip", JSON.stringify(trip)); } catch(e){}
  if (trip.running) persistRoute();
}, 15000);
addEventListener("pagehide", () => {
  try{ LS.setItem("rm_trip", JSON.stringify(trip)); } catch(e){}
  if (trip.running) persistRoute(true);
});

/* ── meten: start/stop/reset ─────────────────────────────── */
function toggleTrip(){
  trip.running = !trip.running;
  if (trip.running){
    if (!trip.start) trip.start = Date.now();
    if (!trip.ms) resetTripLoss();
    lastPos = null; lastSample = null;
 } else {
    persistRoute(true);
    diagAdd("trip.loss", {
      phase:"stop",
      distM:+trip.dist.toFixed(0),
      accDropM:+tripLoss.accDropM.toFixed(0),
      accDropN:tripLoss.accDropN,
      gateSkipN:tripLoss.gateSkipN,
      glitchDropM:+tripLoss.glitchDropM.toFixed(0),
      glitchN:tripLoss.glitchN
    });
  }
 LS.setItem("rm_trip", JSON.stringify(trip));
  render();
  setTimeout(applyMapPadding, 60);   // Patch 14: balkhoogte wijzigt bij start/stop
}
   
function tripName(start){
  const d = new Date(start || Date.now());
  return d.toLocaleDateString(loc(), { day:"numeric", month:"short" }) + " " +
         d.toLocaleTimeString(loc(), { hour:"2-digit", minute:"2-digit" });
}
/* Patch 28: dezelfde opruiming als saveAndReset(), maar zonder opslaan.
   Voor de korte proefritjes die je anders daarna uit de geschiedenis
   moet gaan wissen. */
function discardTrip(){
  if (!confirm(t("discard_ask"))) return;
  Object.assign(trip, { running:false, dist:0, ms:0, max:0, start:0, accSum:0, accN:0 });
  route = []; lastSample = null;
  resetTripLoss();
  try{ LS.setItem("rm_trip", JSON.stringify(trip)); } catch(e){}
  clearPersistedRoute();
  clearTimeout(chromeTimer);
  toast(t("discarded"));
  render();
  setTimeout(applyMapPadding, 60);
}

async function saveAndReset(){
  if (trip.dist >= 100){
    const rec = {
      id: trip.start || Date.now(), name: tripName(trip.start),
      start: trip.start || Date.now(), end: Date.now(),
      ms: trip.ms, dist: trip.dist, max: trip.max,
      accAvg: trip.accN ? trip.accSum / trip.accN : null, points: route,
      veh: logVeh(tripVeh) || "bike"     /* Patch 28/29: expliciet gekozen,
                                            altijd een log-categorie */
    };
    try { await idbPut(rec); toast(t("saved")); } catch(e){ console.error(e); }
  } else toast(t("cleared"));
 Object.assign(trip, { running:false, dist:0, ms:0, max:0, start:0, accSum:0, accN:0 });
  route = []; lastSample = null;
  resetTripLoss();
  try{ LS.setItem("rm_trip", JSON.stringify(trip)); } catch(e){}
  clearPersistedRoute();
  /* Patch 18: chrome uit vóór de padding-hermeting, anders wordt de
     tijdelijk zichtbare Start rit-strook meegemeten. */
  clearTimeout(chromeTimer);
  state.chrome = "off";
  render();
  setTimeout(applyMapPadding, 60);   // Patch 14: terug naar idle
}

