"use strict";
/* ═══ HET RENDER-CONTRACT ══════════════════════════════════
   1) body-data-attributen uit state  2) inhoud  3) kaart-padding
   Niets anders in de app raakt zichtbaarheid aan.            */
function render(){
  const b = document.body;
  b.dataset.presentation = state.presentation;
  b.dataset.mirror       = state.mirror ? "on" : "off";
  b.dataset.nav          = state.nav;          /* CSS gate't dit achter data-presentation="map" */
  b.dataset.measuring    = measuring();
  b.dataset.overlay      = state.overlay;
  b.dataset.compass      = showCompass  ? "on" : "off";
  b.dataset.altitude     = showAltitude ? "on" : "off";
  b.dataset.dragged      = following ? "no" : "yes";
  b.dataset.viewmode     = viewMode;
  b.dataset.northlock    = northLocked() ? "on" : "off";
 b.dataset.controls     = state.controls;
  b.dataset.chrome       = state.chrome;
  b.dataset.speedvis     = speedAlways ? "on" : "off";
  b.dataset.speedpos     = state.speedPos;   /* Patch 19 */
  b.dataset.theme        = themeNow;         /* Patch 20: 'day' | 'night' */
  $("viewBtn").textContent = viewMode === "3d" ? "3D" : "2D";
  document.documentElement.style.setProperty("--digit", COLORS[digitColor]);

  /* snelheid */
  const sv = $("speedVal");
  sv.textContent = firstFix ? fmtSpeed(dispSpeed) : "--";
  sv.classList.toggle("moving", dispSpeed > .4);
  $("unitBtn").textContent = unitLbl();

  /* trip-cijfers */
  $("stDist").textContent = fmtDist(trip.dist);
  $("stTime").textContent = fmtTime(trip.ms);
  const avg = trip.ms > 3000 ? trip.dist / (trip.ms/1000) : 0;
  $("stAvg").textContent  = fmtSpeed(avg);
  $("stMax").textContent  = fmtSpeed(trip.max);
  $("stDistU").textContent = useMph ? "mi" : "km";
  $("stTimeU").textContent = t("time") + (trip.running && isPaused && autoPause ? " ⏸" : "");
  $("stAvgU").textContent  = t("avg") + " " + unitLbl();
  $("stMaxU").textContent  = t("max") + " " + unitLbl();
  $("startBtn").textContent = trip.running ? t("stop") : (trip.ms ? t("resume") : t("start"));
  $("startBtn").className   = "btn " + (trip.running ? "halt" : "go");
  /* Patch 31: met een weggooiknop ernaast spreekt de reset vanzelf, dus
     "Opslaan & reset" mag inkorten tot "Opslaan". Scheelt ~90px in een
     rij die anders over de rand van het eiland loopt. */
  $("resetBtn").textContent = trip.dist >= 100 ? t("save") : t("reset");
  $("resetBtn").disabled    = trip.running || !trip.ms;
  /* Patch 28: weggooien is alleen zinvol als er iets te bewaren viel;
     onder de 100 m doet Reset dat al.
     Patch 31: de knop is een icoon geworden — textContent zou de SVG
     wissen, dus het label zit nu in aria-label en title. */
  $("discardBtn").title      = t("discard");
  $("discardBtn").setAttribute("aria-label", t("discard"));
  $("discardBtn").hidden     = trip.running || trip.dist < 100;
  $("vehSel").hidden          = trip.running;
  if ($("vehSel").value !== tripVeh) $("vehSel").value = tripVeh;

  /* hoogte & koers (uitlezing) */
  const napAlt = lastAltRaw == null ? null : lastAltRaw - altOffset;
  $("lblAlt").textContent = lastLat == null ? t("alt")
    : inNL(lastLat, lastLon) ? t("alt_nap") : t("alt_msl");
  $("altVal").textContent = napAlt == null ? "—"
    : useMph ? Math.round(napAlt * 3.28084) + " ft" : Math.round(napAlt) + " m";
    const displayBearing =
    bearingState.marker ??
    lastBearing;

  $("hdgVal").textContent = displayBearing == null ? "—"
    : Math.round(displayBearing) + "° " + cardinal(displayBearing);

  if (displayBearing != null){
    $("roseG").style.transform =
      `rotate(${-displayBearing}deg)`;
  }

  /* nav-info-regel (resterende afstand + rijtijd + aankomsttijd) */
  if (state.nav === "route" && nav.coords.length){
    $("navInfoTxt").innerHTML =
      `<b>${fmtNavDist(nav.remM)}</b> &middot; ${fmtEta(nav.remEtaS)}` +
      ` &middot; ${t("eta")} <b>${fmtArrival(nav.remEtaS)}</b>`;
  }

  /* groot-getal-hint */
  $("exitHint").textContent = t("exit_hint");
}

/* kaart-padding uit de werkelijke hoogte van het zichtbare onderpaneel */
function applyMapPadding(){
  if (!map || !mapReady) return;
  const headUnit = matchMedia(
    "(min-width:700px) and (min-height:460px) and (max-resolution:1.5dppx)").matches;
  const land = matchMedia("(orientation: landscape)").matches;
  const tripH = state.presentation === "map" ? ($("r-trip").offsetHeight || 0) : 0;
  const panelOpen = state.presentation === "map" && state.nav === "search";
  let pad;
 if (headUnit){
    /* Patch 16 (Layout C v2): het eiland zit linksonder en het
       nav-eiland rechtsonder-opgetild — het bodemmidden is vrij,
       dus de bottom-padding kan laag en hoeft de eilandhoogte niet
       meer te volgen. 3D/koersmodus: marker iets ónder het midden
       (meer kaart vóór je); de bestaande noord-vast-regel onderaan
       (pad.top = pad.bottom) centreert in 2D+noord-vast vanzelf
       exact, conform gewenst. Tunables: 0.28 (hoe lager de marker
       in 3D, hoe hoger deze factor) en 64 (bodemmarge). */
    pad = {
      top: Math.round(innerHeight * 0.28),
      bottom: 64,
      left: panelOpen ? Math.min(380, Math.round(innerWidth*0.44)) + 20 : 110,
      right: 78
    };
  } else if (land){
    const left = panelOpen ? Math.min(380, Math.round(innerWidth*0.44)) + 20 : 130;
    pad = { top: Math.round(innerHeight*0.42), bottom: tripH ? tripH + 22 : 60, left, right:60 };
 } else {
    const top = Math.round((state.presentation === "map" ? 0.58 : 0.45) * innerHeight);
    /* tijdens navigatie telt de navinfo-balk mee + extra marge, zodat de
       positiedriehoek hoger komt te staan en er meer kaart onder zichtbaar is */
    const navH = (state.presentation === "map" && state.nav === "route")
      ? ($("r-navinfo").offsetHeight || 0) + 34 : 0;
    const bottom = panelOpen ? Math.round(innerHeight*0.40) : (tripH ? tripH + navH + 22 : navH + 120);
    pad = { top, bottom, left:24, right:24 };
  }
  /* Patch 10b: bij noord-vast staat de marker gecentreerd in het
     zichtbare kaartvlak i.p.v. onderin, zodat er bij zuidwaarts
     rijden ook kaart vóór je zichtbaar blijft. */
  if (state.presentation === "map" && northLocked()){
    pad.top = pad.bottom;
  }
  map.setPadding(pad);
}

