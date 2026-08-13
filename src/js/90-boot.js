"use strict";
/* ── start ───────────────────────────────────────────────── */
applyTheme();  // Patch 20: vóór applyLang, zodat de eerste render het thema al kent
applyLang();   // zet teksten + roept syncSettingsUI() + render() aan
render();
chromePoke();  // Patch 18: chrome zichtbaar bij start, fadet na 7 s

/* Patch 20: elke minuut herijken (alleen in auto), en meeliften op een
   systeemthemawissel van de head unit zolang er nog geen GPS-fix is. */
setInterval(() => { if (themeMode === "auto") applyTheme(); }, 60000);
try{
  matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => { if (themeMode === "auto") applyTheme(); });
}catch(err){}

/* Patch 20: de andere stijl vóórladen terwijl er nog netwerk is, zodat
   de wissel onderweg (tunnel, geen bereik) uit localStorage kan komen. */
setTimeout(() => {
  loadStyleJSON(themeNow === "night" ? "day" : "night").catch(() => {});
}, 8000);
applyKeepAwake();
lockPortrait();
startGPS("initial");


