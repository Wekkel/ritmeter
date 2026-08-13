"use strict";
/* ── trip-toestand (afgeleid: measuring) ─────────────────── */
const trip = Object.assign(
  { running:false, dist:0, ms:0, max:0, start:0, accSum:0, accN:0 },
  JSON.parse(LS.getItem("rm_trip") || "{}"),
  { running:false }
);

let route = [];
if (trip.ms > 0 && LS.getItem("rm_route_idb") !== "1") {
  try{
    const parsedRoute = JSON.parse(LS.getItem("rm_route") || "[]");
    route = Array.isArray(parsedRoute) ? parsedRoute : [];
  } catch(e){ route = []; }
}
function measuring(){
  if (trip.running) return (autoPause && isPaused) ? "paused" : "running";
  return trip.ms ? "paused" : "idle";
}

let lastPos = null, lastSample = null, fixBuf = [], dispSpeed = 0;
let lastBearing = null, lastAltRaw = null, lastFixTime = 0, lastLat = null, lastLon = null;
/* ── diagnose kilometerverlies (Patch 6) ─────────────────────
   Telt per rit hoeveel meters de bestaande tripfilters verwerpen.
   Alleen tellers + één diag-event per minuut; geen invloed op
   trip.dist, routelogging of persistence. */
const tripLoss = {
  accDropM:0,    // meters gereden tijdens acc > ACC_GATE (wordt overbrugd, niet verworpen)
  accDropN:0,
  gateSkipN:0,   // fixes die de bewegingsdrempel niet haalden
  glitchDropM:0, // meters verworpen via de d > 200-glitchtak
  glitchN:0,
  softN:0,       // Patch 26: fixes via de zachte poort in de route gelogd
  lastBadPos:null, // laatste slechte-accuracy-fix, alleen voor meting
  lastLogAt:0
};

/* ═══ PATCH 26 — TWEETRAPS NAUWKEURIGHEIDSPOORT ══════════
   ACC_GATE (hard): zoals altijd. Telt mee voor trip.dist, trip.max,
   lastPos en de routelijn. Hier verandert niets aan.

   ACC_GATE_SOFT (zacht): fixes tussen de twee drempels gaan alléén de
   routelijn in, met soft:1 gemarkeerd. Ze raken trip.dist niet — dat
   pad blijft de koorde-overbrugging van Patch 6b, die al klopte. Zo
   valt er geen gat van honderden meters in de lijn terwijl de
   kilometerstand onaangetast blijft.

   Aanleiding: op de iPhone springt de gemelde nauwkeurigheid
   episodisch naar 40-56 m waar de S24 op 3,8 m blijft. Een drempel
   die met het toestel meebeweegt helpt daar niet tegen — de mediaan
   van de iPhone is gewoon 3,5 m. Vandaar een tweede vaste trap.
   Tunables: beide drempels en SOFT_MAX_MS. */
const ACC_GATE      = 35;
const ACC_GATE_SOFT = 60;
const SOFT_MAX_MS   = 70;   // m/s; zelfde plausibiliteitsgrens als het hoofdpad
function resetTripLoss(){
  tripLoss.accDropM = 0; tripLoss.accDropN = 0;
 tripLoss.gateSkipN = 0;
  tripLoss.glitchDropM = 0; tripLoss.glitchN = 0;
  tripLoss.softN = 0;
  tripLoss.lastBadPos = null;
  tripLoss.lastLogAt = 0;
}
let lastMotion = 0;
const GEOID_NL = 43;
let altOffset = parseFloat(LS.getItem("rm_altoff"));
if (!isFinite(altOffset)) altOffset = GEOID_NL;
const NL_BOX = { latMin:50.6, latMax:53.7, lonMin:3.2, lonMax:7.4 };
const inNL = (lat, lon) => lat != null && lat >= NL_BOX.latMin && lat <= NL_BOX.latMax
                                       && lon >= NL_BOX.lonMin && lon <= NL_BOX.lonMax;
let isPaused = false, zeroSince = null;
/* ── Patch 12: plausibiliteitsfilter snelheid ────────────────
   lastM/lastTs: laatste geaccepteerde (gefilterde) snelheids-
   sample, referentie voor de versnellingsclamp (laag 1) én de
   bevestigingseis voor trip.max (laag 3). lastDiagAt: gedeelde
   throttle voor de diagnose-events van dit filter. */
const spdF = { lastM:null, lastTs:0, lastDiagAt:0 };

