"use strict";
/* ── helpers ─────────────────────────────────────────────── */
const R = 6371000;
function haversine(a, b){
  const toR = x => x * Math.PI / 180;
  const dLat = toR(b.latitude - a.latitude), dLon = toR(b.longitude - a.longitude);
  const s = Math.sin(dLat/2)**2 +
            Math.cos(toR(a.latitude)) * Math.cos(toR(b.latitude)) * Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
const hv = (p, q) => haversine({latitude:p.lat, longitude:p.lon}, {latitude:q.lat, longitude:q.lon});
const unitLbl  = () => useMph ? t("unit_mph") : t("unit_kmh");
const fmtSpeed = ms => Math.round(ms * (useMph ? 2.23694 : 3.6));
const fmtDist  = m  => {
  const v = useMph ? (m/1609.344).toFixed(2) : (m/1000).toFixed(2);
  return lang === "nl" ? v.replace(".", ",") : v;
};
function fmtTime(ms){
  const s = Math.floor(ms/1000), h = Math.floor(s/3600), m = Math.floor(s%3600/60);
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`
           : `${m}:${String(s%60).padStart(2,"0")}`;
}
const cardinal = deg => t("cards")[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
function toast(msg){
  $("toast").textContent = msg;
  $("toast").classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $("toast").classList.remove("show"), 2000);
}

