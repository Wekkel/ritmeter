"use strict";
/* ═══════════════════════════════════════════════════════════
   RitMeter — navigatiemodule
   - Photon geocoding + BRouter routing (GeoJSON)
   - geen turn-by-turn-afslaginstructies
   - resterende afstand + ETA via projectie op de routelijn
   - visuele route-snap met confidence-poort; ruwe GPS blijft meetbron
   - off-route-detectie + gedebounceerde auto-reroute
   - favorieten in localStorage (rm_fav_nav, max 5)
   - alle zichtbaarheid loopt via state.nav → render()
   ═══════════════════════════════════════════════════════════ */
const PHOTON  = "https://photon.komoot.io/api/";
const BROUTER = "https://brouter.de/brouter";

/* km/u: cap = realistische bovengrens, def = vaste schatting bij onbruikbare API-tijd */
const SPEED = { car:{cap:140,def:60}, bike:{cap:35,def:18},
                moped:{cap:50,def:40}, snor:{cap:30,def:25},
                foot:{cap:12,def:5} };
function profileFor(mode){
  if (mode === "foot") return "hiking-beta";   /* staat op brouter.de/brouter/profiles2/ */
  if (mode === "bike" || mode === "snor") return "trekking";
  return mode === "moped" ? "moped" : "car-fast";        // brom = moped, auto = car-fast
}

const nav = {
  profile: vehicle, dest: null,
  coords: [], cum: [], distM: 0, etaS: 0, vAvg: 8,
  remM: 0, remEtaS: 0,
  destMarker: null, lastNear: null,
  offSince: null, rerouting: false, lastReroute: 0,
  doneFrac: 0                    /* Patch 24: fractie van de route die al
                                    gereden is, 0..1 */
};
let navHere = null;                  // laatst bekende GPS-positie {lat,lon}
let geoTimer = null, geoSeq = 0;

/* ── geo-helpers ─────────────────────────────────────────── */
/* punt→lijnsegment-projectie (meters), lokaal vlak rond p */
function segProject(p, a, b){
  const latR = p.lat*Math.PI/180, mLat = 111320;
  const mLon = 111320*Math.max(1e-6, Math.abs(Math.cos(latR)));
  const ax=(a.lon-p.lon)*mLon, ay=(a.lat-p.lat)*mLat;
  const bx=(b.lon-p.lon)*mLon, by=(b.lat-p.lat)*mLat;
  const dx=bx-ax, dy=by-ay, L2=dx*dx+dy*dy;
  let tt = L2>0 ? -((ax*dx+ay*dy)/L2) : 0;
  tt = Math.max(0, Math.min(1, tt));
  const px=ax+tt*dx, py=ay+tt*dy;
  return {
    d:Math.hypot(px,py), t:tt,
    lat:p.lat + py/mLat,
    lon:p.lon + px/mLon,
    bearing:routeBearing(a,b)
  };
}
function segDist(p, a, b){
  const q = segProject(p,a,b);
  return { d:q.d, t:q.t };
}

/* dichtstbijzijnde routeprojectie, gevensterd rond de vorige match.
   Bij een grote afwijking volgt één volledige scan om weer te herstellen. */
function nearestRouteProjection(here){
  const n = nav.coords.length;
  if (n < 2) return null;

  function scan(lo, hi){
    let best = null;
    for (let i=lo; i<hi; i++){
      const q = segProject(here, nav.coords[i], nav.coords[i+1]);
      if (!best || q.d < best.d){
        const segLen = (nav.cum[i+1] || 0) - (nav.cum[i] || 0);
        best = { ...q, seg:i, along:(nav.cum[i] || 0) + q.t*segLen };
      }
    }
    return best;
  }

  let lo=0, hi=n-1;
  if (nav.lastNear != null){
    lo=Math.max(0, nav.lastNear-30);
    hi=Math.min(n-1, nav.lastNear+120);
  }
  let best = scan(lo,hi);
  if (nav.lastNear != null && best && best.d > 150) best = scan(0,n-1);
  if (best) nav.lastNear = best.seg;
  return best;
}

/* Confidence-poort voor visueel snappen. Bij slechte GPS groeit de tolerantie,
   maar nooit verder dan 35 m: water/vrij terrein blijft daardoor vrij. */
function routeSnapLimit(acc){
  const a = Number.isFinite(acc) ? acc : 25;
  return Math.min(35, Math.max(12, 1.5*a));
}

/* Punt + routebearing op een cumulatieve afstand vanaf het begin van de route. */
function pointAtRouteAlong(along){
  const n = nav.coords.length;
  if (n < 2 || nav.cum.length !== n) return null;
  const total = nav.cum[n-1] || 0;
  const s = Math.max(0, Math.min(total, along || 0));
  let lo=0, hi=n-1;
  while (lo+1<hi){
    const mid=(lo+hi)>>1;
    if ((nav.cum[mid] || 0) <= s) lo=mid; else hi=mid;
  }
  const a=nav.coords[lo], b=nav.coords[Math.min(lo+1,n-1)];
  const d0=nav.cum[lo] || 0, d1=nav.cum[Math.min(lo+1,n-1)] || d0;
  const tt=d1>d0 ? (s-d0)/(d1-d0) : 0;
  const dLon=((b.lon-a.lon+540)%360)-180;
  return {
    lat:a.lat + (b.lat-a.lat)*tt,
    lon:((a.lon + dLon*tt + 540)%360)-180,
    bearing:routeBearing(a,b), along:s, seg:lo
  };
}

/* ── favorieten (localStorage, max 5) ────────────────────── */
function favGet(){ try { return JSON.parse(LS.getItem("rm_fav_nav") || "[]"); } catch { return []; } }
function favSave(list){ LS.setItem("rm_fav_nav", JSON.stringify(list.slice(0,5))); renderFavs(); updateFavStar(); }
function favIndexOf(d){
  if (!d) return -1;
  return favGet().findIndex(f => Math.abs(f.lat-d.lat)<1e-5 && Math.abs(f.lon-d.lon)<1e-5);
}
function updateFavStar(){ $("navSaveFav").classList.toggle("on", favIndexOf(nav.dest) >= 0); }
function favToggle(d){
  if (!d) return;
  const i = favIndexOf(d);
  if (i >= 0) favDel(i); else favAdd(d);
  updateFavStar();
}
function favAdd(item){
  let list = favGet().filter(f => !(Math.abs(f.lat-item.lat)<1e-5 && Math.abs(f.lon-item.lon)<1e-5));
  if (list.length >= 5){ toast(t("nav_fav_full")); list = list.slice(0,4); }
  list.unshift({ name:item.name, lat:item.lat, lon:item.lon });
  favSave(list);
  toast(t("nav_fav_saved"));
}
function favDel(idx){ const list = favGet(); list.splice(idx,1); favSave(list); }
function renderFavs(){
  const box = $("navFavs"); if (!box) return;
  const list = favGet();
  box.innerHTML = "";
  if (!list.length){ const m=document.createElement("div"); m.className="navMsg";
    m.textContent = t("nav_no_favs"); box.appendChild(m); return; }
  list.forEach((f, idx) => {
    const chip = document.createElement("div"); chip.className = "navChip";
    const go = document.createElement("button"); go.className = "navChipGo";
    go.textContent = f.name.split(",")[0]; go.onclick = () => selectDest(f);
    const del = document.createElement("button"); del.className = "navChipX";
    del.textContent = "\u00D7"; del.setAttribute("aria-label", t("del"));
    del.onclick = e => { e.stopPropagation(); favDel(idx); };
    chip.append(go, del); box.appendChild(chip);
  });
}

/* ── geocoding (Photon) ──────────────────────────────────── */
function photonLabel(p){
  const a = [];
  if (p.name) a.push(p.name);
  const street = p.street ? p.street + (p.housenumber ? " "+p.housenumber : "") : null;
  if (street && street !== p.name) a.push(street);
  const city = p.city || p.town || p.village || p.county;
  if (city) a.push(city + (p.postcode ? " "+p.postcode : ""));
  if (p.state && !city) a.push(p.state);
  if (p.country) a.push(p.country);
  return a.filter(Boolean).join(", ") || (p.osm_value || "?");
}
async function geoSearch(q){
  const seq = ++geoSeq;
  const box = $("navResults");
  box.innerHTML = `<div class="navMsg">${t("nav_calc")}</div>`;
  let url = `${PHOTON}?q=${encodeURIComponent(q)}&limit=6`;
  if (navHere) url += `&lat=${navHere.lat.toFixed(4)}&lon=${navHere.lon.toFixed(4)}`;
  try{
    const res = await fetch(url);
    const j = await res.json();
    if (seq !== geoSeq) return;                 // verouderd antwoord
    const items = (j.features || [])
      .filter(f => f.geometry && f.geometry.coordinates)
      .map(f => ({ name: photonLabel(f.properties || {}),
                   lat: +f.geometry.coordinates[1], lon: +f.geometry.coordinates[0] }));
    renderResults(items);
  } catch(e){
    if (seq === geoSeq){ box.innerHTML = `<div class="navMsg">${t("nav_err")}</div>`; }
  }
}
function renderResults(items){
  const box = $("navResults"); box.innerHTML = "";
  if (!items.length){ box.innerHTML = `<div class="navMsg">${t("nav_none")}</div>`; return; }
  items.forEach(it => {
    const b = document.createElement("button"); b.className = "navRes";
    const nm = document.createElement("b"); nm.textContent = it.name.split(",")[0];
    const sub = document.createElement("span");
    sub.textContent = it.name.split(",").slice(1).join(",").trim();
    b.append(nm, sub); b.onclick = () => selectDest(it);
    box.appendChild(b);
  });
}

/* ── routing (BRouter) ───────────────────────────────────── */
function computeEta(distM, apiTimeS, mode){
  const s = SPEED[mode] || SPEED.bike;
  if (mode === "snor") return distM / (25/3.6);          // altijd vaste 25 km/u
  if (!(apiTimeS > 0)) return distM / (s.def/3.6);        // geen API-tijd
  const v = distM / apiTimeS * 3.6;                       // km/u volgens API
  if (v > s.cap || v < 3) return distM / (s.def/3.6);     // onrealistisch → vaste schatting
  return apiTimeS;
}
async function fetchRoute(o, d, mode){
  const prof = profileFor(mode);
  const lonlats = `${o.lon.toFixed(6)},${o.lat.toFixed(6)}|${d.lon.toFixed(6)},${d.lat.toFixed(6)}`;
  const url = `${BROUTER}?lonlats=${lonlats}&profile=${prof}&alternativeidx=0&format=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("brouter " + res.status);
  const j = await res.json();
  const feat = (j.features || []).find(f => f.geometry && f.geometry.type === "LineString");
  if (!feat || !feat.geometry.coordinates.length) throw new Error("geen route");
  const coords = feat.geometry.coordinates.map(c => ({ lon:+c[0], lat:+c[1] }));
  const p = feat.properties || {};
  let distM = parseFloat(p["track-length"]);
  if (!(distM > 0)){ distM = 0; for (let i=1;i<coords.length;i++) distM += hv(coords[i-1], coords[i]); }
  return { coords, distM, etaS: computeEta(distM, parseFloat(p["total-time"]), mode) };
}
function applyRoute(r){
  /* Een nieuwe route maakt een eventuele oude route-dead-reckoning ongeldig.
     Vanaf de eerstvolgende GPS-fix wordt opnieuw geprojecteerd en gesnapt. */
  invalidateRouteDeadReckoning();
  nav.coords = r.coords;
  nav.cum = [0];
  for (let i = 1; i < r.coords.length; i++) nav.cum[i] = nav.cum[i-1] + hv(r.coords[i-1], r.coords[i]);
  nav.distM = r.distM; nav.etaS = r.etaS;
  nav.vAvg = r.etaS > 0 ? r.distM / r.etaS : (SPEED[nav.profile].def/3.6);
  nav.remM = r.distM; nav.remEtaS = r.etaS;
  nav.lastNear = null;
  nav.doneFrac = 0;              /* Patch 24: nieuwe of herberekende route
                                    begint bij nul */
}

/* route ophalen voor de huidige bestemming; toont preview in het paneel */
async function navComputeRoute(){
  if (!nav.dest) return;
  if (!navHere){ $("navInfoPanel").textContent = t("nav_wait_gps"); return; }
  $("navInfoPanel").textContent = t("nav_calc");
  $("navStart").disabled = true;
  try{
    applyRoute(await fetchRoute(navHere, nav.dest, nav.profile));
    $("navInfoPanel").innerHTML =
      `<b>${fmtNavDist(nav.distM)}</b> &middot; ${fmtEta(nav.etaS)}` +
      ` &middot; ${t("eta")} ${fmtArrival(nav.etaS)}`;
    $("navStart").disabled = false;
    if (state.nav === "route"){ drawNavRoute(); render(); }   // actieve route herberekend
  } catch(e){
    console.error(e);
    nav.coords = []; nav.cum = [];
    clearNavRoute();
    $("navInfoPanel").textContent = t("nav_err");
    $("navStart").disabled = true;
  }
}

/* ── route + bestemmingspin op de hoofdkaart ─────────────── */
/* ═══ PATCH 24 — GEREDEN DEEL GRIJS ══════════════════════════
   Één bronlijn met een line-gradient, niet twee losse features. De
   overgang is dan een paint-property die per fix wordt bijgesteld,
   zonder de geometrie opnieuw op te bouwen.

   Vereist lineMetrics:true op de source; zonder dat kan MapLibre
   line-progress niet berekenen. line-color blijft als vangnet staan:
   mocht de gradient niet evalueren, dan is de lijn gewoon weer egaal
   paars in plaats van zwart.
   Tunable: de vier kleuren hieronder. */
const ROUTE_KLEUR = {
  restLijn:   "#E000FF",   /* nog te rijden */
  restCasing: "#3A0A33",
  doneLijn:   "#7C8794",   /* al gereden — leesbaar op licht én donker */
  doneCasing: "#2B2F36"
};

/* Alles vóór doneFrac krijgt de done-kleur, daarna de rest-kleur.
   De klem houdt beide takken bestaan; een stop op exact 0 of 1 zou
   één van de twee onbereikbaar maken. */
function routeGradient(done, kleurDone, kleurRest){
  const p = Math.max(.0001, Math.min(.9999, done || 0));
  return ["step", ["line-progress"], kleurDone, p, kleurRest];
}

/* Voortgang op beide lijnlagen zetten. Ook aangeroepen vanuit
   drawNavRoute(), want een stijlwissel (dag/nacht) gooit de lagen weg
   en bouwt ze opnieuw op. */
function applyNavProgress(){
  if (!map || !mapReady) return;
  if (!map.getLayer("nav-route-line") || !map.getLayer("nav-route-casing")) return;
  const f = nav.doneFrac || 0;
  map.setPaintProperty("nav-route-casing", "line-gradient",
    routeGradient(f, ROUTE_KLEUR.doneCasing, ROUTE_KLEUR.restCasing));
  map.setPaintProperty("nav-route-line", "line-gradient",
    routeGradient(f, ROUTE_KLEUR.doneLijn, ROUTE_KLEUR.restLijn));
}

function drawNavRoute(){
  if (!map || !mapReady || !nav.coords.length) return;
  const data = { type:"Feature", properties:{},
    geometry:{ type:"LineString", coordinates: nav.coords.map(p => [p.lon, p.lat]) } };
  if (map.getSource("nav-route")) map.getSource("nav-route").setData(data);
  else {
    map.addSource("nav-route", { type:"geojson", data, lineMetrics:true });
    map.addLayer({ id:"nav-route-casing", type:"line", source:"nav-route",
      layout:{ "line-cap":"round", "line-join":"round" },
      paint:{ "line-color":ROUTE_KLEUR.restCasing, "line-width":11, "line-opacity":.95,
        "line-gradient":routeGradient(nav.doneFrac,
          ROUTE_KLEUR.doneCasing, ROUTE_KLEUR.restCasing) } });
    map.addLayer({ id:"nav-route-line", type:"line", source:"nav-route",
      layout:{ "line-cap":"round", "line-join":"round" },
      paint:{ "line-color":ROUTE_KLEUR.restLijn, "line-width":6, "line-opacity":.95,
        "line-gradient":routeGradient(nav.doneFrac,
          ROUTE_KLEUR.doneLijn, ROUTE_KLEUR.restLijn) } });
  }
  applyNavProgress();
  if (nav.dest){
    if (!nav.destMarker){
      const el = document.createElement("div"); el.className = "navDest";
      el.innerHTML = `<svg width="30" height="38" viewBox="0 0 24 30"><path d="M12 0a10 10 0 0 0-10 10c0 7 10 20 10 20s10-13 10-20A10 10 0 0 0 12 0z" fill="#E000FF" stroke="#0B0F14" stroke-width="1.5"/><circle cx="12" cy="10" r="4" fill="#0B0F14"/></svg>`;
      nav.destMarker = new maplibregl.Marker({ element:el, anchor:"bottom" })
        .setLngLat([nav.dest.lon, nav.dest.lat]).addTo(map);
    } else nav.destMarker.setLngLat([nav.dest.lon, nav.dest.lat]).addTo(map);
  }
}
function clearNavRoute(){
  if (map){
    for (const id of ["nav-route-line","nav-route-casing"]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource("nav-route")) map.removeSource("nav-route");
  }
  if (nav.destMarker){ nav.destMarker.remove(); nav.destMarker = null; }
}

/* ── opmaak afstand & ETA ────────────────────────────────── */
function fmtNavDist(m){
  if (useMph){
    const ft = m*3.28084;
    if (ft < 1000) return (Math.round(ft/10)*10) + " ft";
    const mi = m/1609.344;
    return (lang === "nl" ? mi.toFixed(1).replace(".",",") : mi.toFixed(1)) + " mi";
  }
  if (m < 1000) return (Math.round(m/10)*10) + " m";
  const km = m/1000;
  return (lang === "nl" ? km.toFixed(1).replace(".",",") : km.toFixed(1)) + " km";
}
function fmtEta(s){
  s = Math.round(s);
  const h = Math.floor(s/3600), m = Math.round((s % 3600)/60);
  return h ? `${h} ${t("eta_hr")} ${m} ${t("eta_min")}` : `${Math.max(1, m)} ${t("eta_min")}`;
}
function fmtArrival(remS){
  return new Date(Date.now() + remS*1000)
    .toLocaleTimeString(loc(), { hour:"2-digit", minute:"2-digit" });
}

/* automatisch herberekenen vanaf de huidige positie wanneer je van de route bent */
async function navReroute(){
  if (!navHere || !nav.dest || nav.rerouting) return;
  nav.rerouting = true;
  try{
    applyRoute(await fetchRoute(navHere, nav.dest, nav.profile));
    drawNavRoute();
    nav.offSince = null; nav.lastReroute = Date.now();
    toast(t("nav_rerouted"));
    render();
  } catch(e){ /* netwerk/BRouter faalt: oude route laten staan, later opnieuw proberen */ }
  finally{ nav.rerouting = false; }
}

/* ── per GPS-fix aangeroepen vanuit onFix() (vóór render) ── */
function navOnFix(c){
  navHere = { lat:c.latitude, lon:c.longitude };
  if (state.nav !== "route" || !nav.coords.length) return null;
  if (map && mapReady && !map.getSource("nav-route")) drawNavRoute();

  const proj = nearestRouteProjection(navHere);
  if (!proj) return null;
  nav.remM = Math.max(0, nav.distM - proj.along);
  nav.remEtaS = nav.remM / (nav.vAvg || 8);

  /* Patch 24: voortgang bijwerken. Drempel in meters i.p.v. in fractie,
     zodat een rit van 5 km en één van 500 km zich hetzelfde gedragen. */
  if (nav.distM > 0){
    const f = Math.max(0, Math.min(1, proj.along / nav.distM));
    if (Math.abs(f - (nav.doneFrac || 0)) * nav.distM > 20){
      nav.doneFrac = f;
      applyNavProgress();
    }
  }
  /* aankomst: pas melden bij échte nabijheid van de bestemming (niet op projectie) */
  if (nav.dest && hv(navHere, nav.dest) < 30){
    toast(t("nav_arrived"));
    navStop();
    return null;
  }

  /* off-route gebruikt bewust de ruwe GPS→route-afstand. De visuele snap kan
     deze detectie dus nooit maskeren; >60 m gedurende >10 s → herbereken. */
  if (proj.d > 60){
    if (nav.offSince === null) nav.offSince = Date.now();
    else if (Date.now() - nav.offSince > 10000 && !nav.rerouting
             && Date.now() - nav.lastReroute > 15000) navReroute();
  } else nav.offSince = null;

  return proj;
}

/* ── selecteren & paneelbediening (muteren state → render) ── */
function selectDest(item){
  nav.dest = item;
  $("navSearch").value = item.name.split(",")[0];
  $("navResults").innerHTML = "";
  $("navSaveFav").classList.add("show");
  updateFavStar();
  navComputeRoute();
}
function openNavPanel(){
  state.nav = "search";
  renderFavs();
  render();
  applyMapPadding();
}
function closeNavPanel(){
  if (state.nav === "route"){ render(); applyMapPadding(); return; }   // route loopt: terug naar route-weergave
  /* alleen-preview → opruimen en terug naar gewone kaart */
  nav.coords = []; nav.cum = []; nav.dest = null;
  nav.remM = 0; nav.remEtaS = 0;
  clearNavRoute();
  $("navInfoPanel").textContent = "";
  $("navStart").disabled = true;
  $("navSaveFav").classList.remove("show");
  state.nav = "off";
  render();
  applyMapPadding();
}
function navStartGuidance(){
  if (!nav.coords.length) return;
  state.nav = "route";
  drawNavRoute();
  render();
  applyMapPadding();
  if (map) setTimeout(() => map.resize(), 60);
}
function navStop(){
  invalidateRouteDeadReckoning();
  nav.coords = []; nav.cum = []; nav.dest = null;
  nav.remM = 0; nav.remEtaS = 0; nav.lastNear = null;
  nav.offSince = null; nav.rerouting = false;
  clearNavRoute();
  $("navInfoPanel").textContent = "";
  $("navStart").disabled = true;
  $("navSaveFav").classList.remove("show");
  state.nav = "off";
  render();
  applyMapPadding();
}

/* ── voertuig = uitsluitend routeprofiel (raakt nooit de layout) ── */
function applyVehicle(){
  nav.profile = vehicle;
  document.querySelectorAll("#vehSeg button").forEach(b => b.classList.toggle("on", b.dataset.p === vehicle));
}
function setVehicle(v){
  vehicle = v; nav.profile = v; LS.setItem("rm_vehicle", v);
  applyVehicle();
  if (nav.dest) navComputeRoute();
}

/* ── event-bindings ──────────────────────────────────────── */
$("navBtn").onclick     = () => { setControls("min"); openNavPanel(); };
$("navClose").onclick   = closeNavPanel;
$("navStart").onclick   = navStartGuidance;
$("navStopBtn").onclick = navStop;
$("navRecalc").onclick  = () => { if (nav.dest) navComputeRoute(); };
$("navSaveFav").onclick = () => favToggle(nav.dest);
$("navSearch").addEventListener("input", e => {
  clearTimeout(geoTimer);
  const q = e.target.value.trim();
  if (q.length < 3){ $("navResults").innerHTML = ""; return; }
  geoTimer = setTimeout(() => geoSearch(q), 350);    // throttle: respecteer Photon fair-use
});
$("navSearch").addEventListener("keydown", e => {
  if (e.key === "Enter"){ clearTimeout(geoTimer);
    const q = e.target.value.trim(); if (q.length >= 2) geoSearch(q); }
});
document.querySelectorAll("#vehSeg button").forEach(b => { b.onclick = () => setVehicle(b.dataset.p); });
applyVehicle();

/* ── oriëntatie-/grootte-wissel: kaart bijwerken, padding herberekenen ── */
window.addEventListener("resize", () => { if (map){ map.resize(); applyMapPadding(); } });
if (screen.orientation)
  screen.orientation.addEventListener("change",
    () => setTimeout(() => { if (map){ map.resize(); applyMapPadding(); } }, 250));

