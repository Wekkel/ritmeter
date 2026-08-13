"use strict";
/* ── IndexedDB ───────────────────────────────────────────── */
let dbP = null;
function db(){
  if (!dbP) dbP = new Promise((res, rej) => {
    const rq = indexedDB.open("ritmeter", 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore("trips", { keyPath:"id" });
    rq.onsuccess = () => res(rq.result);
    rq.onerror   = () => rej(rq.error);
  });
  return dbP;
}
const txs = (d, mode) => d.transaction("trips", mode).objectStore("trips");
const idbPut = rec => db().then(d => new Promise((res, rej) => {
  const r = txs(d, "readwrite").put(rec); r.onsuccess = res; r.onerror = () => rej(r.error);
}));
const idbAll = () => db().then(d => new Promise((res, rej) => {
  const r = txs(d, "readonly").getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
const idbGet = id => db().then(d => new Promise((res, rej) => {
  const r = txs(d, "readonly").get(id); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
}));
/* Patch 8a: idbDel ontbrak volledig in het bestand, terwijl
   clearPersistedRoute() en het verwijderen van een rit in de
   historie hem wél aanroepen (ReferenceError). */
const idbDel = id => db().then(d => new Promise((res, rej) => {
  const r = txs(d, "readwrite").delete(id); r.onsuccess = res; r.onerror = () => rej(r.error);
}));
/* ── robuuste route-persistentie (Patch 7) ──────────────────
   localStorage is op iOS beperkt (~5 MB origin-totaal). Lange
   ritten schakelen automatisch en permanent (per rit) over op
   IndexedDB. Een mislukte save mag nooit stil blijven of de
   app breken. */
const ROUTE_LS_MAX_CHARS = 1500000;   // ~1,5 MB: ruim onder het iOS-quotum
const ROUTE_IDB_ID = "rm_route_inprogress";
let routePersistLast = 0;
/* Patch 8b: transactionele LS→IDB-migratie.
   - routeSaveSeq: volgnummer per gestarte save; commit-side-effects
     (rm_route wissen) gebeuren alleen voor de nieuwste save.
   - routeSaveChain: serialiseert alle IDB-writes zodat een trage,
     oudere write nooit een nieuwere route kan overschrijven. */
let routeSaveSeq = 0;
let routeSaveChain = Promise.resolve();

function persistRoute(force=false){
  const now = Date.now();

  /* Grote routes niet vaker dan eens per 60 s serialiseren;
     kleine routes en geforceerde flushes (stop/pagehide) altijd. */
  if (!force && route.length > 4000 && now - routePersistLast < 60000) return;
  routePersistLast = now;

  if (LS.getItem("rm_route_idb") !== "1"){
    const json = JSON.stringify(route);

    if (json.length <= ROUTE_LS_MAX_CHARS){
      try{
        LS.setItem("rm_route", json);
        return;
      } catch(e){
        diagAdd("route.ls_failed", { chars:json.length, points:route.length });
      }
    } else {
      diagAdd("route.idb_switch", { chars:json.length, points:route.length });
    }
    /* Belangrijk: hier NIET de vlag zetten en NIET rm_route wissen.
       Dat gebeurt pas hieronder, nadat de IDB-write is bevestigd.
       Tot die tijd blijft de laatste LS-kopie het herstelpunt. */
  }

  /* Snapshot op dit moment: de async write mag niet afhangen van
     latere mutaties van `route` (ondiepe kopie; punten muteren niet). */
  const seq = ++routeSaveSeq;
  const snapshot = route.slice();

  routeSaveChain = routeSaveChain
    .then(() => idbPut({ id:ROUTE_IDB_ID, points:snapshot, savedAt:now }))
    .then(() => {
      /* COMMIT: write is bevestigd. Alleen de nieuwste save mag
         zijeffecten uitvoeren; een verouderde write (er is intussen
         een nieuwere gestart, of clearPersistedRoute() draaide) mag
         de vlag niet (opnieuw) zetten of LS opruimen. Overslaan is
         veilig: de nieuwere save in de keten commit direct hierna. */
      if (seq !== routeSaveSeq) return;
      if (LS.getItem("rm_route_idb") !== "1"){
        try{ LS.setItem("rm_route_idb", "1"); } catch(e){
          /* Vlag zetten mislukt: LS-kopie blijft staan; bij herstart
             wordt dan de (iets oudere) LS-route geladen — geen verlies
             van de vlagloze toestand, alleen van dit ene interval. */
        }
        diagAdd("route.idb_committed", { points:snapshot.length });
      }
      /* Oude LS-kopie pas na bevestigde write opruimen. */
      try{ LS.removeItem("rm_route"); } catch(e){}
    })
    .catch(err => {
      diagAdd("route.idb_failed", {
        points:snapshot.length,
        error: err && err.name ? String(err.name) : String(err)
      });
      /* Fallback: als de migratie nog niet gecommit is, probeer de
         actuele route alsnog in localStorage te zetten — ook boven de
         soft-limiet; het echte quotum ligt hoger. Beter een geslaagde
         te-grote LS-write dan niets. */
      if (seq === routeSaveSeq && LS.getItem("rm_route_idb") !== "1"){
        try{
          LS.setItem("rm_route", JSON.stringify(route));
          diagAdd("route.ls_fallback_ok", { points:route.length });
        } catch(e){
          diagAdd("route.ls_fallback_failed", { points:route.length });
        }
      }
    });
}

function clearPersistedRoute(){
  /* Maak eventueel nog lopende writes "oud" zodat hun commit-stap
     geen zijeffecten meer heeft… */
  routeSaveSeq++;
  try{ LS.removeItem("rm_route"); } catch(e){}
  try{ LS.removeItem("rm_route_idb"); } catch(e){}
  /* …en hang de delete ACHTER de write-keten, zodat een trage write
     het record niet ná de delete opnieuw kan aanmaken. */
  routeSaveChain = routeSaveChain
    .catch(()=>{})
    .then(() => idbDel(ROUTE_IDB_ID))
    .catch(err => diagAdd("route.idb_clear_failed", {
      error: err && err.name ? String(err.name) : String(err)
    }));
}

/* Herstel van een lopende grote rit na PWA-herstart (Patch 8b).
   De vlag rm_route_idb="1" wordt sinds Patch 8b pas gezet ná een
   bevestigde IDB-write, maar oudere installaties of IDB-evictie
   door het OS kunnen alsnog een inconsistente toestand opleveren:
   vlag staat, record ontbreekt. Dan vallen we terug op een
   eventueel nog aanwezige localStorage-kopie. */
function restoreRouteFromLS(reason){
  try{
    const parsed = JSON.parse(LS.getItem("rm_route") || "[]");
    if (Array.isArray(parsed) && parsed.length){
      route = parsed.concat(route);
      diagAdd("route.restore_ls_fallback", { reason, points:parsed.length });
      /* Migratiestatus terugdraaien: de route leeft weer in LS,
         persistRoute() migreert vanzelf opnieuw zodra dat nodig is. */
      try{ LS.removeItem("rm_route_idb"); } catch(e){}
      return true;
    }
  } catch(e){}
  diagAdd("route.restore_none", { reason });
  return false;
}
if (trip.ms > 0 && LS.getItem("rm_route_idb") === "1"){
  idbGet(ROUTE_IDB_ID).then(rec => {
    if (rec && Array.isArray(rec.points) && rec.points.length){
      route = rec.points.concat(route);
      diagAdd("route.restore_idb", { points:rec.points.length });
      /* Eventuele verweesde (oudere) LS-kopie opruimen: IDB is nieuwer. */
      try{ LS.removeItem("rm_route"); } catch(e){}
    } else {
      restoreRouteFromLS("idb_record_missing");
    }
  }).catch(err => {
    diagAdd("route.restore_idb_error", {
      error: err && err.name ? String(err.name) : String(err)
    });
    restoreRouteFromLS("idb_open_failed");
  });
}

