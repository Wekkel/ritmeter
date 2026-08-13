"use strict";
/* ── statische teksten & instellingen-UI ─────────────────── */
function applyLang(){
  document.documentElement.lang = lang;
  $("lblAlt").textContent = t("alt"); $("lblHdg").textContent = t("hdg");
  $("setTitle").textContent = t("set_title");
  $("lblLang").textContent = t("lang");         $("dscLang").textContent = t("lang_d");
  $("lblUnit").textContent = t("unit");         $("dscUnit").textContent = t("unit_d");
  $("lblVeh").textContent = t("vehicle");       $("dscVeh").textContent = t("vehicle_d");
  /* Patch 29/30: de rit-dropdown kent geen snorfiets — die valt onder
     bromfiets. De instellingenknoppen (hieronder, bij de p_*-labels)
     wél. Labels komen uit dezelfde p_*-sleutels als het navigatiemenu:
     één bron, anders loopt het uiteen. */
  $("vehSel").innerHTML = VEH_LOG.map(v =>
    `<option value="${v}">${vehLabel(v)}</option>`).join("");
  $("vehSel").value = tripVeh;
  $("tabRides").textContent = t("tab_rides");
  $("tabStats").textContent = t("tab_stats");
  $("statWeeksTitle").textContent   = t("st_weeks");
  $("statRecordsTitle").textContent = t("st_records");
  $("lblCompass").textContent = t("compass");   $("dscCompass").textContent = t("compass_d");
  $("lblSpeedVis").textContent = t("speedvis"); $("dscSpeedVis").textContent = t("speedvis_d");
  $("lblAltitude").textContent = t("altitude"); $("dscAltitude").textContent = t("altitude_d");
  $("lblAltCal").textContent = t("altcal");     $("dscAltCal").textContent = t("altcal_d");
  $("altCalBtn").textContent = t("alt_ijk");    $("altCalReset").textContent = t("alt_std");
  $("lblColor").textContent = t("color");       $("dscColor").textContent = t("color_d");
  $("lblMirror").textContent = t("mirror");     $("dscMirror").textContent = t("mirror_d");
  $("lblAP").textContent = t("apause");         $("dscAP").textContent = t("apause_d");
  $("lblTheme").textContent = t("theme");       $("dscTheme").textContent = t("theme_d");
  $("thDay").textContent   = t("th_day");
  $("thNight").textContent = t("th_night");
  $("thAuto").textContent  = t("th_auto");
  $("lblDiag").textContent = t("diag");         $("dscDiag").textContent = t("diag_d");
  $("diagShareBtn").textContent = t("diag_share");
  $("diagClearBtn").textContent = t("diag_clear");
  $("setClose").textContent = t("close");       $("ntcBtn").textContent = t("retry");
  $("unitKm").textContent = I18N[lang].unit_kmh;
  $("unitMi").textContent = I18N[lang].unit_mph;
  $("histTitle").textContent = t("hist");
  $("lblProfile").textContent = t("profile");
  $("shareBtn").textContent = t("share_gpx");   $("delBtn").textContent = t("del");
  $("bakBtn").textContent = t("backup");        $("resBtn").textContent = t("restore");
  $("gpxAllBtn").textContent = t("gpx_all");
  const cd = t("cards");
  $("rN").textContent = cd[0]; $("rE").textContent = cd[2];
  $("rS").textContent = cd[4]; $("rW").textContent = cd[6];
  $("navSearch").placeholder = t("nav_search");
  $("navStart").textContent  = t("nav_start");
  /* Patch 30: foot ontbrak hier, waardoor de knop "Te voet" leeg bleef.
     Nu uit VEH zodat een nieuw voertuig niet opnieuw kan worden vergeten. */
  document.querySelectorAll("#vehSeg button").forEach(b => {
    b.textContent = vehLabel(b.dataset.p);
  });
  if (typeof renderFavs === "function") renderFavs();
  syncSettingsUI(); render();
}
function syncSettingsUI(){
  $("langNL").classList.toggle("on", lang === "nl");
  $("langEN").classList.toggle("on", lang === "en");
  $("unitKm").classList.toggle("on", !useMph);
  $("unitMi").classList.toggle("on",  useMph);
  $("compassSw").classList.toggle("on", showCompass);
  $("speedSw").classList.toggle("on", speedAlways);
  $("altSw").classList.toggle("on", showAltitude);
  $("mirrorSw").classList.toggle("on", state.mirror);
  $("apSw").classList.toggle("on", autoPause);
  $("colAmber").classList.toggle("on", digitColor === "amber");
  $("colWhite").classList.toggle("on", digitColor === "white");
  $("colGreen").classList.toggle("on", digitColor === "green");
  $("thDay").classList.toggle("on",   themeMode === "day");
  $("thNight").classList.toggle("on", themeMode === "night");
  $("thAuto").classList.toggle("on",  themeMode === "auto");
  document.querySelectorAll("#vehSeg button").forEach(b => b.classList.toggle("on", b.dataset.p === vehicle));
}

