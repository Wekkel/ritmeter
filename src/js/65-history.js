"use strict";
/* ── geschiedenis (modale overlay) ───────────────────────── */
/* ═══ PATCH 28 — RITTEN + STATISTIEKEN ══════════════════════
   Eén ophaalactie voert beide panelen. loadTrips() vult ook met
   terugwerkende kracht het voertuig in bij ritten van vóór deze
   patch, en schrijft dat één keer terug naar IndexedDB — daarna is
   het gewoon data en hoeft er nooit meer geraden te worden. */
let histTab = "rides";
let statVehFilter = "all";

async function loadTrips(){
  const trips = (await idbAll().catch(() => []))
    .filter(r => r && typeof r.dist === "number")
    .sort((a,b) => b.id - a.id);

  /* terugvaltoekenning, één keer per rit */
  /* Patch 29: ook een eerder opgeslagen "snor" wordt hier alsnog naar
     "moped" getrokken, zodat de statistiek maar één bromfietsbak kent. */
  const teVullen = trips.filter(r => !isLogVeh(r.veh));
  for (const r of teVullen){
    const collapsed = logVeh(r.veh);          // "snor" -> "moped"
    if (collapsed){
      r.veh = collapsed;                      // was een geldige keuze, niet geraden
    } else {
      r.veh = vehFromMax(r.max);
      r.vehAuto = true;
    }
    try{ await idbPut(r); }catch(e){ /* niet fataal: volgende keer opnieuw */ }
  }
  if (teVullen.length)
    diagAdd("stats.veh_backfill", { n:teVullen.length });

  return trips;
}

function showHistTab(tab){
  histTab = tab;
  $("tabRides").classList.toggle("on", tab === "rides");
  $("tabStats").classList.toggle("on", tab === "stats");
  $("paneRides").hidden = tab !== "rides";
  $("paneStats").hidden = tab !== "stats";
  if (tab === "stats") renderStats();
}

/* maandag 00:00 van de week waarin d valt */
function weekStart(d){
  const x = new Date(d); x.setHours(0,0,0,0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

async function renderStats(){
  const alle = await loadTrips();
  $("statEmpty").style.display = alle.length ? "none" : "block";
  $("statEmpty").textContent = t("st_empty");

  /* voertuigfilter: alleen knoppen tonen waar ook data voor is */
  const aanwezig = VEH_LOG.filter(v => alle.some(r => r.veh === v));
  if (statVehFilter !== "all" && !aanwezig.includes(statVehFilter))
    statVehFilter = "all";
  $("statVeh").innerHTML = ["all", ...aanwezig].map(v =>
    `<button data-v="${v}"${v === statVehFilter ? ' class="on"' : ""}>` +
    `${v === "all" ? t("p_all") : vehLabel(v)}</button>`).join("");
  $("statVeh").querySelectorAll("button").forEach(b => {
    b.onclick = () => { statVehFilter = b.dataset.v; renderStats(); };
  });

  const trips = statVehFilter === "all"
    ? alle : alle.filter(r => r.veh === statVehFilter);

  if (!trips.length){
    $("statTotals").innerHTML = "";
    $("statWeeks").innerHTML = "";
    $("statRecords").innerHTML = "";
    return;
  }

  const now  = new Date();
  const wk0  = weekStart(now);
  const wk1  = new Date(wk0); wk1.setDate(wk1.getDate() - 7);
  const mo0  = new Date(now.getFullYear(), now.getMonth(), 1);
  const yr0  = new Date(now.getFullYear(), 0, 1);
  const sum  = l => ({ n:l.length,
                       d:l.reduce((s,r) => s + r.dist, 0),
                       t:l.reduce((s,r) => s + r.ms, 0) });
  const inRange = (a, b) => trips.filter(r =>
    r.start >= +a && (b == null || r.start < +b));

  const cell = (lbl, s) =>
    `<div class="tot"><span>${lbl}</span><b>${fmtDist(s.d)} ${useMph ? "mi" : "km"}</b>` +
    `<i>${s.n} ${t("st_rides")} · ${fmtTime(s.t)}</i></div>`;

  $("statTotals").innerHTML =
      cell(t("st_week"),     sum(inRange(wk0)))
    + cell(t("st_prevweek"), sum(inRange(wk1, wk0)))
    + cell(t("st_month"),    sum(inRange(mo0)))
    + cell(t("st_year"),     sum(inRange(yr0)))
    + cell(t("st_all"),      sum(trips));

  /* ── 12 weken, oudste links ── */
  const weken = [];
  for (let i = 11; i >= 0; i--){
    const a = new Date(wk0); a.setDate(a.getDate() - i * 7);
    const b = new Date(a);   b.setDate(b.getDate() + 7);
    weken.push({ a, s:sum(inRange(a, b)) });
  }
  const top = Math.max(...weken.map(w => w.s.d), 1);
  $("statWeeks").innerHTML = weken.map(w => {
    const h = Math.round(100 * w.s.d / top);
    const lbl = w.a.toLocaleDateString(loc(), { day:"numeric", month:"short" });
    const km = w.s.d > 0 ? fmtDist(w.s.d) : "";
    return `<div class="wk" title="${lbl}: ${fmtDist(w.s.d)} ${useMph ? "mi" : "km"}">` +
           `<span class="wkv">${km}</span>` +
           `<span class="wkb" style="height:${Math.max(h, w.s.d > 0 ? 3 : 1)}%"></span>` +
           `<span class="wkl">${lbl}</span></div>`;
  }).join("");

  /* ── records ── */
  const langst = trips.reduce((a, r) => r.dist > a.dist ? r : a, trips[0]);
  const metAvg = trips.filter(r => r.ms > 60000);
  const snelst = metAvg.length
    ? metAvg.reduce((a, r) => (r.dist / r.ms) > (a.dist / a.ms) ? r : a, metAvg[0])
    : null;

  /* aaneengesloten weken met minstens één rit, terugtellend vanaf nu */
  let streak = 0;
  for (let i = 0; ; i++){
    const a = new Date(wk0); a.setDate(a.getDate() - i * 7);
    const b = new Date(a);   b.setDate(b.getDate() + 7);
    if (inRange(a, b).length) streak++;
    else if (i > 0) break;          /* deze week nog leeg telt niet als einde */
    else if (i > 52) break;
    if (i > 260) break;             /* vangrail */
  }

  const eerste = Math.min(...trips.map(r => r.start));
  const wekenTotaal = Math.max(1, (Date.now() - eerste) / (7 * 864e5));
  const perWeek = sum(trips).d / wekenTotaal;

  const rec = (lbl, waarde, sub) =>
    `<div class="tot"><span>${lbl}</span><b>${waarde}</b><i>${sub || ""}</i></div>`;
  $("statRecords").innerHTML =
      rec(t("st_longest"), `${fmtDist(langst.dist)} ${useMph ? "mi" : "km"}`, langst.name)
    + (snelst ? rec(t("st_fastest"),
        `${fmtSpeed(snelst.dist / (snelst.ms / 1000))} ${unitLbl()}`, snelst.name) : "")
    + rec(t("st_streak"), String(streak), "")
    + rec(t("st_perweek"), `${fmtDist(perWeek)} ${useMph ? "mi" : "km"}`, "");
}

async function openHist(){
  state.overlay = "history"; render();
  showHistTab(histTab);
  const trips = await loadTrips();
  const list = $("histList");
  list.innerHTML = "";
  $("histEmpty").style.display = trips.length ? "none" : "block";
  $("histEmpty").textContent = t("hist_empty");
  const now = new Date();
  const wk = new Date(now); wk.setHours(0,0,0,0);
  wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
  const mo = new Date(now.getFullYear(), now.getMonth(), 1);
  const sum = l => ({ n:l.length, d:l.reduce((s,r)=>s+r.dist,0), t:l.reduce((s,r)=>s+r.ms,0) });
  const cell = (lbl, s) =>
    `<div class="tot"><span>${lbl}</span><b>${fmtDist(s.d)} ${useMph?"mi":"km"}</b>` +
    `<i>${s.n} ${t("trips")} · ${fmtTime(s.t)}</i></div>`;
  $("histTotals").innerHTML = trips.length
    ? cell(t("week"),  sum(trips.filter(r => r.start >= wk)))
    + cell(t("month"), sum(trips.filter(r => r.start >= mo)))
    + cell(t("total"), sum(trips)) : "";
  for (const r of trips){
    const btn = document.createElement("button");
    btn.className = "hrow";
    const avg = r.ms > 0 ? r.dist / (r.ms/1000) : 0;
    btn.innerHTML =
      `<span class="l"><b>${r.name}</b><span>${isLogVeh(r.veh) ? vehLabel(r.veh) + " · " : ""}${fmtTime(r.ms)} · ${t("avg")} ${fmtSpeed(avg)} ${unitLbl()}</span></span>
       <span class="r"><b>${fmtDist(r.dist)}</b><span>${useMph?"mi":"km"}</span></span>`;
    btn.onclick = () => openDetail(r.id);
    list.appendChild(btn);
  }
}
function closeHist(){ state.overlay = "none"; render(); }

let dmapInst = null, detId = null;
async function openDetail(id){
  const r = await idbGet(id); if (!r) return;
  detId = id;
  state.overlay = "detail"; render();
  $("detTitle").textContent = r.name;
  const avg = r.ms > 0 ? r.dist / (r.ms/1000) : 0;
  const stat = (v,l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  $("detStats").innerHTML =
    stat(fmtDist(r.dist) + " " + (useMph?"mi":"km"), t("dist")) +
    stat(fmtTime(r.ms), t("time")) +
    stat(fmtSpeed(avg) + " " + unitLbl(), t("avg")) +
    stat(fmtSpeed(r.max) + " " + unitLbl(), t("max")) +
    stat(new Date(r.start).toLocaleString(loc(), {dateStyle:"short", timeStyle:"short"}), t("started")) +
    stat(r.accAvg ? "±" + Math.round(r.accAvg) + " m" : "—", t("accuracy"));
  if (dmapInst){ dmapInst.remove(); dmapInst = null; }
  const pts = (r.points || []).filter(p => p.lat && p.lon);
  if (pts.length >= 2){
    setTimeout(() => {
      const coords = pts.map(p => [p.lon, p.lat]);
      const bounds = coords.reduce((b,c) => b.extend(c),
        new maplibregl.LngLatBounds(coords[0], coords[0]));
      dmapInst = new maplibregl.Map({
        container:"dmap",
        style: themedStyle(themeNow) || styleUrl(themeNow),
        bounds, fitBoundsOptions:{ padding:34 },
        attributionControl:{compact:true}, fadeDuration:0
      });
      dmapInst.on("load", () => {
        dmapInst.addSource("route", { type:"geojson",
          data:{ type:"Feature", geometry:{ type:"LineString", coordinates:coords } } });
        dmapInst.addLayer({ id:"route", type:"line", source:"route",
          paint:{ "line-color":"#2D8CFF", "line-width":4, "line-opacity":.9 } });
      });
    }, 60);
    $("dmap").style.display = "block";
  } else $("dmap").style.display = "none";
  drawProfile(pts);
}
function closeDetail(){
  if (dmapInst){ dmapInst.remove(); dmapInst = null; }
  state.overlay = "history"; render();
}

/* ── hoogteprofiel (Canvas) ──────────────────────────────── */
function drawProfile(pts){
  const cv = $("profile"), note = $("profNote");
  const data = []; let cum = 0;
  for (let i = 0; i < pts.length; i++){
    if (i) cum += hv(pts[i-1], pts[i]);
    if (pts[i].alt != null) data.push({ x:cum, y:pts[i].alt });
  }
  if (data.length < 2){
    cv.style.display = "none"; note.style.display = "block"; note.textContent = t("no_alt"); return;
  }
  cv.style.display = "block"; note.style.display = "none";
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 300, H = 140;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext("2d"); g.scale(dpr, dpr);
  const padL = 34, padR = 8, padT = 10, padB = 20;
  const minY0 = Math.min(...data.map(p => p.y)), maxY0 = Math.max(...data.map(p => p.y));
  const span = Math.max(10, maxY0 - minY0);
  const minY = minY0 - (span - (maxY0 - minY0)) / 2;
  const maxX = data[data.length - 1].x || 1;
  const X = x => padL + (x / maxX) * (W - padL - padR);
  const Y = y => padT + (1 - (y - minY) / span) * (H - padT - padB);
  g.clearRect(0, 0, W, H);
  g.beginPath(); g.moveTo(X(data[0].x), Y(data[0].y));
  for (const p of data) g.lineTo(X(p.x), Y(p.y));
  g.lineTo(X(maxX), H - padB); g.lineTo(X(0), H - padB); g.closePath();
  g.fillStyle = "rgba(255,179,0,.12)"; g.fill();
  g.beginPath(); g.moveTo(X(data[0].x), Y(data[0].y));
  for (const p of data) g.lineTo(X(p.x), Y(p.y));
  g.strokeStyle = "#FFB300"; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
  g.fillStyle = "#7E8B98"; g.font = "10px system-ui";
  const aF = m => useMph ? Math.round(m * 3.28084) + " ft" : Math.round(m) + " m";
  g.fillText(aF(maxY0), 2, Y(maxY0) + 3);
  g.fillText(aF(minY0), 2, Y(minY0) + 3);
  g.fillText("0", padL, H - 6);
  const dTxt = fmtDist(maxX) + " " + (useMph ? "mi" : "km");
  g.fillText(dTxt, W - padR - g.measureText(dTxt).width, H - 6);
}

/* ── GPX-export & back-up ────────────────────────────────── */
const gpxDoc = inner => `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RitMeter" xmlns="http://www.topografix.com/GPX/1/1">
${inner}
</gpx>`;
function trkXML(r){
  const pts = (r.points || []).map(p =>
    `      <trkpt lat="${p.lat}" lon="${p.lon}">` +
    (p.alt != null ? `<ele>${p.alt}</ele>` : "") +
    `<time>${new Date(p.t).toISOString()}</time></trkpt>`).join("\n");
  return `  <trk>\n    <name>${r.name}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>`;
}
const toGPX = r => gpxDoc(trkXML(r));
async function shareOrDownload(file, title){
  if (navigator.canShare && navigator.canShare({ files:[file] })){
    try { await navigator.share({ files:[file], title }); return; } catch(e){}
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function shareGPX(){
  const r = await idbGet(detId); if (!r) return;
  const fname = "ritmeter_" + new Date(r.start).toISOString().slice(0,16).replace(/[:T]/g,"-") + ".gpx";
  shareOrDownload(new File([toGPX(r)], fname, { type:"application/gpx+xml" }), r.name);
}
async function gpxAll(){
 const trips = (await idbAll().catch(() => []))
    .filter(r => r && typeof r.dist === "number")
    .sort((a,b) => a.id - b.id);
  if (!trips.length) return;
  shareOrDownload(new File([gpxDoc(trips.map(trkXML).join("\n"))],
    "ritmeter_alle_ritten.gpx", { type:"application/gpx+xml" }), "RitMeter");
}
async function backup(){
 const trips = (await idbAll().catch(() => []))
    .filter(r => r && typeof r.dist === "number");
  const data = JSON.stringify({ app:"ritmeter", v:1, exported:new Date().toISOString(), trips });
  const fname = "ritmeter_backup_" + new Date().toISOString().slice(0,10) + ".json";
  shareOrDownload(new File([data], fname, { type:"application/json" }), "RitMeter back-up");
}
async function restore(file){
  try{
    const data = JSON.parse(await file.text());
    if (!data || data.app !== "ritmeter" || !Array.isArray(data.trips)) throw new Error();
    let n = 0;
    for (const r of data.trips)
      if (r && r.id && typeof r.dist === "number"){ await idbPut(r); n++; }
    toast(n + " " + t("restored")); openHist();
  } catch(e){ toast(t("bad_file")); }
}

