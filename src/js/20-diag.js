"use strict";
/* ── begrensde diagnostische ringbuffer ─────────────────────
   Alleen compacte diagnose-events in geheugen.
   Geen invloed op tripdata, route logging of persistence. */
const DIAG_MAX_EVENTS = 240;
const DIAG_GPS_SAMPLE_MS = 5000;
const DIAG_PERSIST_MS = 5000;
const DIAG_STORAGE_KEY = "rm_diag_v1";

const diagState = {
  events:[],
  seq:0,
  lastGpsSampleAt:0,
  transitions:Object.create(null),
  persistTimer:0,
  persistDirty:false,
  restored:false
};

function diagSafeValue(value, depth = 0){
  if (depth > 3) return "[Max Depth]";

  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ){
    return value;
  }

  if (value instanceof Error){
    return {
      name:value.name || "Error",
      message:String(value.message || value),
      stack:value.stack
        ? String(value.stack).slice(0, 1600)
        : null
    };
  }

  if (Array.isArray(value)){
    return value
      .slice(0, 20)
      .map(v => diagSafeValue(v, depth + 1));
  }

  if (typeof value === "object"){
    const out = {};
    let n = 0;

    for (const [key, item] of Object.entries(value)){
      if (n >= 30) break;

      try{
        out[key] = diagSafeValue(item, depth + 1);
      } catch(e){
        out[key] = "[unavailable]";
      }

      n++;
    }

    return out;
  }

  return String(value);
}

function diagIsCriticalType(type){
  return (
    type === "js.error" ||
    type === "promise.unhandled" ||
    type === "gps.error" ||
    type === "gps.unsupported" ||
    type === "state.stale" ||
    type === "state.stationary" ||
    type === "state.visibility"
  );
}

function diagPersistNow(){
  if (diagState.persistTimer){
    clearTimeout(diagState.persistTimer);
    diagState.persistTimer = 0;
  }

  if (!diagState.persistDirty){
    return true;
  }

  try{
    const payload = {
      version:1,
      savedAt:new Date().toISOString(),
      seq:diagState.seq,
      events:diagState.events.slice(-DIAG_MAX_EVENTS)
    };

    LS.setItem(
      DIAG_STORAGE_KEY,
      JSON.stringify(payload)
    );

    diagState.persistDirty = false;
    return true;
  } catch(e){
    /* Diagnose-opslag mag de app nooit verstoren. */
    return false;
  }
}

function diagSchedulePersist(immediate=false){
  diagState.persistDirty = true;

  if (immediate){
    diagPersistNow();
    return;
  }

  if (diagState.persistTimer){
    return;
  }

  diagState.persistTimer = setTimeout(() => {
    diagState.persistTimer = 0;
    diagPersistNow();
  }, DIAG_PERSIST_MS);
}

function diagRestore(){
  let parsed;

  try{
    const raw = LS.getItem(DIAG_STORAGE_KEY);
    if (!raw) return 0;

    parsed = JSON.parse(raw);
  } catch(e){
    try{
      LS.removeItem(DIAG_STORAGE_KEY);
    } catch(ignore){}
    return 0;
  }

  if (
    !parsed ||
    !Array.isArray(parsed.events)
  ){
    return 0;
  }

  const restored = parsed.events
    .slice(-DIAG_MAX_EVENTS)
    .filter(event =>
      event &&
      typeof event === "object" &&
      typeof event.type === "string"
    )
    .map(event => diagSafeValue(event));

  diagState.events = restored;

  const maxSeq = restored.reduce(
    (max, event) => {
      const seq = Number(event.seq);
      return Number.isFinite(seq)
        ? Math.max(max, seq)
        : max;
    },
    0
  );

  diagState.seq = Math.max(
    Number(parsed.seq) || 0,
    maxSeq
  );

  diagState.restored = restored.length > 0;

  return restored.length;
}

function diagRemovePersisted(){
  if (diagState.persistTimer){
    clearTimeout(diagState.persistTimer);
    diagState.persistTimer = 0;
  }

  diagState.persistDirty = false;

  try{
    LS.removeItem(DIAG_STORAGE_KEY);
  } catch(e){}
}

function diagAdd(type, data=null){
  const eventType = String(type);

  const event = {
    seq:++diagState.seq,
    at:new Date().toISOString(),
    perf:+performance.now().toFixed(1),
    type:eventType
  };

  if (data != null){
    event.data = diagSafeValue(data);
  }

  diagState.events.push(event);

  if (diagState.events.length > DIAG_MAX_EVENTS){
    diagState.events.splice(
      0,
      diagState.events.length - DIAG_MAX_EVENTS
    );
  }

  diagSchedulePersist(
    diagIsCriticalType(eventType)
  );

  return event;
}

function diagTransition(key, value, data=null){
  const next = String(value);

  if (diagState.transitions[key] === next){
    return false;
  }

  const prev = Object.prototype.hasOwnProperty.call(
    diagState.transitions,
    key
  )
    ? diagState.transitions[key]
    : null;

  diagState.transitions[key] = next;

  diagAdd("state." + key, {
    from:prev,
    to:next,
    ...(data || {})
  });

  return true;
}

function diagGpsFix(c, ts, acc){
  const now = Date.now();

  if (
    diagState.lastGpsSampleAt &&
    now - diagState.lastGpsSampleAt < DIAG_GPS_SAMPLE_MS
  ){
    return;
  }

  diagState.lastGpsSampleAt = now;

  diagAdd("gps.fix", {
    ts,
    lat:Number.isFinite(c.latitude)
      ? +c.latitude.toFixed(5)
      : null,
    lon:Number.isFinite(c.longitude)
      ? +c.longitude.toFixed(5)
      : null,
    acc:Number.isFinite(acc)
      ? +acc.toFixed(1)
      : null,
    speed:Number.isFinite(c.speed)
      ? +c.speed.toFixed(2)
      : null,
    heading:Number.isFinite(c.heading)
      ? +c.heading.toFixed(1)
      : null,
    dispSpeed:Number.isFinite(dispSpeed)
      ? +dispSpeed.toFixed(2)
      : null,
    presentation:state.presentation,
    nav:state.nav
  });
}

function diagSnapshot(){
  return {
    at:new Date().toISOString(),
    visibility:document.visibilityState,
    presentation:state.presentation,
    nav:state.nav,
    overlay:state.overlay,
    following,
    firstFix,
    lastFixAgeMs:lastFixTime
      ? Math.max(0, Date.now() - lastFixTime)
      : null,
    dispSpeed:Number.isFinite(dispSpeed)
      ? +dispSpeed.toFixed(2)
      : null,
    stationary:typeof stationary !== "undefined"
      ? {
          active:stationary.active,
          candidateSince:stationary.candidateSince,
          exitEvidence:stationary.exitEvidence
        }
      : null,
    motion:typeof motion !== "undefined"
      ? {
          hasPos:!!motion.pos,
          hasAnchor:!!motion.anchor,
          bearing:motion.bearing == null
            ? null
            : +motion.bearing.toFixed(1),
          speed:Number.isFinite(motion.speed)
            ? +motion.speed.toFixed(2)
            : null,
          acc:Number.isFinite(motion.acc)
            ? +motion.acc.toFixed(1)
            : null,
          routeMode:motion.routeMode,
          routeAlong:motion.routeAlong == null
            ? null
            : +motion.routeAlong.toFixed(1),
          staleActive:motion.staleActive,
          anchorAgeMs:motion.anchorPerf
            ? Math.max(
                0,
                Math.round(
                  performance.now() - motion.anchorPerf
                )
              )
            : null,
          lastFixPerfAgeMs:motion.lastFixPerf
            ? Math.max(
                0,
                Math.round(
                  performance.now() - motion.lastFixPerf
                )
              )
            : null
        }
      : null
  };
}

function diagFileStamp(date=new Date()){
  return date
    .toISOString()
    .replace(/[:.]/g, "-");
}

function diagExportObject(){
  return {
    format:"RitMeter diagnostics",
    version:1,
    exportedAt:new Date().toISOString(),
    appVersion:$("appVer")
      ? $("appVer").textContent
      : "RitMeter",
    userAgent:navigator.userAgent || null,
    snapshot:diagSnapshot(),
    recoveredFromPreviousSession:diagState.restored,
    maxEvents:DIAG_MAX_EVENTS,
    eventCount:diagState.events.length,
    events:diagState.events.slice(-DIAG_MAX_EVENTS)
  };
}

function diagExportText(){
  return JSON.stringify(
    diagExportObject(),
    null,
    2
  );
}

function diagExportFile(){
  const filename =
    `RitMeter-diagnose-${diagFileStamp()}.json`;

  const file = new File(
    [diagExportText()],
    filename,
    {
      type:"application/json"
    }
  );

  return {
    file,
    filename
  };
}

function diagDownload(){
  const text = diagExportText();

  const blob = new Blob(
    [text],
    {
      type:"application/json"
    }
  );

  const filename =
    `RitMeter-diagnose-${diagFileStamp()}.json`;

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";

  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);

  return filename;
}

async function diagShare(){
  /* Neem ook de laatste nog niet geflushte RAM-events mee
     en zet vooraf een recovery-copy veilig. */
  diagPersistNow();

  const { file, filename } = diagExportFile();

  const shareData = {
    title:"RitMeter diagnose",
    text:"RitMeter diagnostisch logbestand",
    files:[file]
  };

  try{
    if (
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function" &&
      navigator.canShare(shareData)
    ){
      await navigator.share(shareData);

      diagAdd("diag.shared", {
        method:"native-file",
        filename
      });

      return {
        method:"shared",
        filename
      };
    }
  } catch(e){
    if (
      e &&
      e.name === "AbortError"
    ){
      return {
        method:"cancelled",
        filename
      };
    }

    diagAdd("diag.share_error", {
      name:e && e.name
        ? String(e.name)
        : null,
      message:e && e.message
        ? String(e.message)
        : null
    });
  }

  const downloaded = diagDownload();

  diagAdd("diag.shared", {
    method:"download",
    filename:downloaded
  });

  return {
    method:"download",
    filename:downloaded
  };
}
   
function diagPollTransitions(){
  diagTransition(
    "visibility",
    document.visibilityState
  );

  diagTransition(
    "presentation",
    state.presentation
  );

  diagTransition(
    "nav",
    state.nav
  );

  diagTransition(
    "following",
    following ? "on" : "off"
  );

  if (typeof stationary !== "undefined"){
    diagTransition(
      "stationary",
      stationary.active ? "on" : "off"
    );
  }

  if (typeof motion !== "undefined"){
    diagTransition(
      "stale",
      motion.staleActive ? "on" : "off",
      motion.staleActive
        ? {
            speed:Number.isFinite(motion.speed)
              ? +motion.speed.toFixed(2)
              : null,
            routeMode:motion.routeMode
          }
        : null
    );
  }
}

window.addEventListener("error", event => {
  diagAdd("js.error", {
    message:event.message || "Unknown error",
    source:event.filename || null,
    line:event.lineno || null,
    column:event.colno || null,
    error:event.error || null
  });
});

window.addEventListener("unhandledrejection", event => {
  diagAdd("promise.unhandled", {
    reason:event.reason instanceof Error
      ? event.reason
      : diagSafeValue(event.reason)
  });
});

const RitMeterDiag = Object.freeze({
  get(){
    return diagState.events.map(event => ({
      ...event,
      data:event.data == null
        ? event.data
        : diagSafeValue(event.data)
    }));
  },

  latest(count=20){
    const n = Math.max(
      0,
      Math.min(
        DIAG_MAX_EVENTS,
        Math.floor(Number(count) || 0)
      )
    );

    return diagState.events
      .slice(-n)
      .map(event => ({
        ...event,
        data:event.data == null
          ? event.data
          : diagSafeValue(event.data)
      }));
  },

  state(){
    return diagSnapshot();
  },

  export(){
    return diagExportObject();
  },

  persist(){
    return diagPersistNow();
  },

  async share(){
    return diagShare();
  },

  download(){
    return diagDownload();
  },

  clear(){
    diagState.events.length = 0;
    diagState.seq = 0;
    diagState.lastGpsSampleAt = 0;
    diagState.transitions = Object.create(null);
    diagState.restored = false;

    diagRemovePersisted();
  },

  async copy(){
    const text = diagExportText();

    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ){
      await navigator.clipboard.writeText(text);
      return true;
    }

    return text;
  }
});

window.RitMeterDiag = RitMeterDiag;

const diagRestoredCount = diagRestore();

diagAdd("app.diag_ready", {
  maxEvents:DIAG_MAX_EVENTS,
  gpsSampleMs:DIAG_GPS_SAMPLE_MS,
  persistMs:DIAG_PERSIST_MS,
  restoredEvents:diagRestoredCount
});

setInterval(diagPollTransitions, 1000);

document.addEventListener("visibilitychange", () => {
  diagTransition(
    "visibility",
    document.visibilityState
  );

  if (document.visibilityState === "hidden"){
    diagPersistNow();
  }
});

window.addEventListener("pagehide", () => {
  diagPersistNow();
});

