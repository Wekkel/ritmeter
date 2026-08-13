"use strict";
/* ── kaart ───────────────────────────────────────────────── */
const STYLE_DAY   = "https://tiles.openfreemap.org/styles/liberty";
const STYLE_NIGHT = "https://tiles.openfreemap.org/styles/dark";
const STYLE = STYLE_DAY;                 /* behouden voor terugvalpaden */
let map, marker;

/* ═══ PATCH 20 — DAG/NACHT ═══════════════════════════════════
   Beide OpenFreeMap-stijlen delen dezelfde vector-tilesource
   (tiles.openfreemap.org/planet), dus een stijlwissel kost alleen
   de stijl-JSON + sprite — je tegelcache blijft volledig geldig.

   Offline-vangnet: de stijl-JSON wordt als object opgehaald,
   gevalideerd en in localStorage bewaard. Mislukt dat, dan blijft de
   huidige stijl gewoon staan (zichtbaar in het diagnoselog). Nooit
   een zwarte kaart door een mislukte setStyle. */
function getSunTimes(lat, lon, date, altitudeDeg){
  const rad = Math.PI / 180, dayMs = 86400000, J1970 = 2440588, J2000 = 2451545;
  const toJulian   = d => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = j => new Date((j + 0.5 - J1970) * dayMs);
  const e = rad * 23.4397;
  const eclipticLongitude = M =>
    M + rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
      + rad * 102.9372 + Math.PI;
  const J0 = 0.0009;
  const solarTransitJ = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

  const lw = rad * -lon, phi = rad * lat, d = toJulian(date) - J2000;
  const n  = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M  = rad * (357.5291 + 0.98560028 * ds);
  const L  = eclipticLongitude(M);
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const Jnoon = solarTransitJ(ds, M, L);
  const cosW = (Math.sin(rad * altitudeDeg) - Math.sin(phi) * Math.sin(dec))
             / (Math.cos(phi) * Math.cos(dec));
  if (!(cosW >= -1 && cosW <= 1)) return null;      // poolnacht of pooldag
  const w = Math.acos(cosW);
  const Jset = solarTransitJ(J0 + (w + lw) / (2 * Math.PI) + n, M, L);
  return { sunrise: fromJulian(Jnoon - (Jset - Jnoon)), sunset: fromJulian(Jset) };
}

function effectiveTheme(){
  if (themeMode === "day" || themeMode === "night") return themeMode;
  if (lastLat != null && lastLon != null){
    const d = new Date();
    /* twee aparte berekeningen: de avonddrempel bepaalt wanneer het
       nacht wordt, de ochtenddrempel wanneer het weer dag wordt. */
    const dusk = getSunTimes(lastLat, lastLon, d, SUN_ALT_DUSK);
    const dawn = getSunTimes(lastLat, lastLon, d, SUN_ALT_DAWN);
    if (dusk && dawn){
      const now = d.getTime();
      return (now < dawn.sunrise.getTime() || now > dusk.sunset.getTime())
        ? "night" : "day";
    }
  }
  /* geen fix (of poolgebied): volg het systeemthema van de head unit */
  return matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day";
}

const styleJSON = { day:null, night:null };
const styleKey  = which => which === "night" ? "rm_style_night" : "rm_style_day";
const styleUrl  = which => which === "night" ? STYLE_NIGHT : STYLE_DAY;

/* Synchroon uit geheugen of localStorage; null als we hem niet hebben. */
function cachedStyle(which){
  if (styleJSON[which]) return styleJSON[which];
  try{
    const c = JSON.parse(LS.getItem(styleKey(which)));
    if (c && c.version === 8 && Array.isArray(c.layers) && c.layers.length){
      styleJSON[which] = c;
      return c;
    }
  }catch(err){}
  return null;
}

/* ═══ PATCH 21 — NACHTPALET ═════════════════════════
   dark-matter is bijna zwart en heeft — anders dan liberty — geen
   fill-extrusion-laag, dus 's nachts verdween de 3D-bebouwing volledig.
   We hertinten de stijl naar het Google-Maps-nachtpalet en voegen
   building-3d toe, bóven de wegen en ónder de labels.

   De hertinting gebeurt op het stijl-OBJECT vóór setStyle, niet met
   setPaintProperty erna: geen flits van bijna-zwart. In localStorage
   staat de RUWE stijl, dus een paletwijziging hieronder werkt direct
   bij de volgende start — geen cache wissen.

   Alles hieronder is tunable. Wil je grijs in plaats van blauw: haal de
   blauwcomponent uit de hexwaarden (bijv. land #2A2A2A, road #3E3E3E). */
const NIGHT = {
  land:         "#242F3E",   /* landachtergrond              */
  water:        "#17263C",
  park:         "#263C3F",
  residential:  "#27313F",
  buildFlat:    "#3A4A63",   /* 2D-footprint  1.5:1 t.o.v. land   */
  buildEdge:    "#586D92",   /* contourlijn   2.6:1               */
  build3dLow:   "#445674",   /* 3D, laag pand   1.8:1 t.o.v. land */
  build3dHigh:  "#5F759C",   /* 3D, hoog pand   2.9:1            */
  road:         "#38414E",
  roadEdge:     "#212A37",
  motorway:     "#746855",   /* snelweg, Google-okergeel     */
  motorwayEdge: "#1F2835",
  rail:         "#2F3948",
  roadText:     "#9CA5B3",
  motorwayText: "#F3D19C",
  placeText:    "#C9D1DC",
  waterText:    "#5D7A99",
  border:       "#4B5563",
  halo:         "#1B2433"
};

/* laag-id → paint-overschrijvingen. Alleen kleuren; breedtes, filters en
   zoomstops blijven van de upstream-stijl. */
const NIGHT_PAINT = {
  background:               { "background-color":NIGHT.land },
  water:                    { "fill-color":NIGHT.water },
  waterway:                 { "line-color":NIGHT.water },
  landcover_ice_shelf:      { "fill-color":NIGHT.land },
  landcover_glacier:        { "fill-color":NIGHT.land },
  landuse_residential:      { "fill-color":NIGHT.residential },
  landcover_wood:           { "fill-color":NIGHT.park },
  landuse_park:             { "fill-color":NIGHT.park },
  water_name:               { "text-color":NIGHT.waterText, "text-halo-color":NIGHT.water },
  building:                 { "fill-color":NIGHT.buildFlat, "fill-outline-color":NIGHT.buildEdge },
  "aeroway-taxiway":        { "line-color":NIGHT.road },
  "aeroway-runway-casing":  { "line-color":NIGHT.roadEdge },
  "aeroway-area":           { "fill-color":NIGHT.land },
  "aeroway-runway":         { "line-color":NIGHT.road },
  road_area_pier:           { "fill-color":NIGHT.land },
  road_pier:                { "line-color":NIGHT.land },
  highway_path:             { "line-color":NIGHT.rail },
  highway_minor:            { "line-color":NIGHT.road },
  highway_major_casing:     { "line-color":NIGHT.roadEdge },
  highway_major_inner:      { "line-color":NIGHT.road },
  highway_major_subtle:     { "line-color":NIGHT.road },
  highway_motorway_casing:  { "line-color":NIGHT.motorwayEdge },
  highway_motorway_inner:   { "line-color":NIGHT.motorway },
  highway_motorway_subtle:  { "line-color":NIGHT.motorway },
  railway_transit:          { "line-color":NIGHT.rail },
  railway_transit_dashline: { "line-color":NIGHT.land },
  railway_minor:            { "line-color":NIGHT.rail },
  railway_minor_dashline:   { "line-color":NIGHT.land },
  railway:                  { "line-color":NIGHT.rail },
  railway_dashline:         { "line-color":NIGHT.land },
  highway_name_other:       { "text-color":NIGHT.roadText, "text-halo-color":NIGHT.halo },
  highway_name_motorway:    { "text-color":NIGHT.motorwayText,
                              "text-halo-color":NIGHT.motorwayEdge, "text-halo-width":1 },
  boundary_state:           { "line-color":NIGHT.border },
  "boundary_country_z0-4":  { "line-color":NIGHT.border },
  "boundary_country_z5-":   { "line-color":NIGHT.border },
  place_other:              { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_suburb:             { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_village:            { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_town:               { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_city:               { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_city_large:         { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_state:              { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_country_other:      { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_country_minor:      { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo },
  place_country_major:      { "text-color":NIGHT.placeText, "text-halo-color":NIGHT.halo }
};

/* Zelfde vorm als liberty's building-3d, maar met nachtkleuren en een
   hoogteramp zodat hoge panden oplichten. minzoom 15 i.p.v. 14 houdt het
   licht voor de head unit; verhoog naar 16 als het gaat schokken. */
function night3dLayer(){
  return {
    id:"building-3d", type:"fill-extrusion",
    source:"openmaptiles", "source-layer":"building",
    minzoom:15,
    /* has-check plus coalesce: zonder render_height zou de interpolate
       een null binnenkrijgen en een expressiefout geven. */
    filter:["all", ["!=", ["get","hide_3d"], true], ["has","render_height"]],
    paint:{
      "fill-extrusion-color":["interpolate", ["linear"],
        ["coalesce", ["get","render_height"], 0],
        0, NIGHT.build3dLow, 60, NIGHT.build3dHigh],
      "fill-extrusion-height":["coalesce", ["get","render_height"], 0],
      "fill-extrusion-base":["coalesce", ["get","render_min_height"], 0],
      "fill-extrusion-opacity":.85
    }
  };
}

/* Patch 22: een eigen contourlijn. fill-outline-color van de building-
   laag is altijd exact 1 device-pixel en verdrinkt op een hoge-dpi
   scherm; een echte line-laag schaalt met de zoom en leest daardoor
   ook in 2D. Blijft bewust dun en halftransparant — contour, geen
   markering. Tunables: line-width en line-opacity. */
function nightBuildingOutline(){
  return {
    id:"building-outline-night", type:"line",
    source:"openmaptiles", "source-layer":"building",
    minzoom:14,
    filter:["match", ["geometry-type"], ["MultiPolygon","Polygon"], true, false],
    paint:{
      "line-color":NIGHT.buildEdge,
      "line-width":["interpolate", ["linear"], ["zoom"], 14,.4, 16,.7, 19,1.2],
      "line-opacity":["interpolate", ["linear"], ["zoom"], 14,.35, 16,.75]
    }
  };
}

function nightify(style){
  const s = JSON.parse(JSON.stringify(style));       // cache nooit muteren
  for (const layer of s.layers){
    const ov = NIGHT_PAINT[layer.id];
    if (ov) layer.paint = Object.assign({}, layer.paint, ov);
  }
  /* contour direct boven de footprint-vulling */
  const bi = s.layers.findIndex(l => l.id === "building");
  if (bi >= 0 && !s.layers.some(l => l.id === "building-outline-night"))
    s.layers.splice(bi + 1, 0, nightBuildingOutline());
  if (!s.layers.some(l => l.type === "fill-extrusion")){
    /* boven de wegen, onder de labels: highway_name_other is in
       dark-matter de eerste weglabel-laag. Ontbreekt die, dan achteraan
       (dan staan panden boven de labels — lelijk, niet fataal). */
    let at = s.layers.findIndex(l => l.id === "highway_name_other");
    if (at < 0) at = s.layers.length;
    s.layers.splice(at, 0, night3dLayer());
  }
  return s;
}

/* Gebruiksklare stijl: dag = ruw, nacht = hertint. null als niet gecached. */
function themedStyle(which){
  const raw = cachedStyle(which);
  if (!raw) return null;
  return which === "night" ? nightify(raw) : raw;
}

function loadStyleJSON(which){
  const hit = cachedStyle(which);
  if (hit) return Promise.resolve(hit);
  return fetch(styleUrl(which))
    .then(res => { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
    .then(json => {
      if (!json || json.version !== 8 || !Array.isArray(json.layers) || !json.layers.length)
        throw new Error("ongeldige stijl");
      styleJSON[which] = json;
      try{ LS.setItem(styleKey(which), JSON.stringify(json)); }catch(err){}
      return json;
    });
}

let mapStyleApplied = null, styleSwitchBusy = false;
function applyMapTheme(){
  if (!map || !mapReady) return;
  const want = themeNow;
  if (mapStyleApplied === want || styleSwitchBusy) return;
  styleSwitchBusy = true;
  loadStyleJSON(want).then(json => {
    map.setStyle(want === "night" ? nightify(json) : json, { diff:false });
    mapStyleApplied = want;
    diagAdd("theme.style_applied", { theme:want });
    /* De route zit in een eigen source die setStyle weggooit. Pollen
       i.p.v. op styledata vertrouwen: addSource vóór een volledig
       geladen stijl gooit een fout. DOM-markers (positie, bestemming)
       overleven een stijlwissel wel. */
    let tries = 0;
    const restore = () => {
      if (!map) return;
      if (!map.isStyleLoaded()){
        if (++tries > 60){ diagAdd("theme.style_slow", { theme:want }); return; }
        setTimeout(restore, 120); return;
      }
      if (nav.coords.length && !map.getSource("nav-route")) drawNavRoute();
      applyMapPadding();
    };
    setTimeout(restore, 120);
  }).catch(err => {
    diagAdd("theme.style_failed", {
      theme:want, error:String((err && err.message) || err) });
  }).finally(() => { styleSwitchBusy = false; });
}

function applyTheme(){
  const next = effectiveTheme();
  if (next !== themeNow){
    themeNow = next;
    diagAdd("theme.switch", { theme:next, mode:themeMode });
    render();
  }
  applyMapTheme();          /* idempotent: doet niets als de stijl al klopt */
}

