const els = {
  link: document.getElementById("link"),
  speed: document.getElementById("speed"),
  rpm: document.getElementById("rpm"),
  coolant_temp: document.getElementById("coolant_temp"),
  throttle: document.getElementById("throttle"),
  engine_load: document.getElementById("engine_load"),
  fuel_level: document.getElementById("fuel_level"),
  gps: document.getElementById("gps"),
  seq: document.getElementById("seq"),
  age: document.getElementById("age"),
  port: document.getElementById("port"),
  captureBtn: document.getElementById("captureBtn"),
  captureLabel: document.getElementById("captureLabel"),
  captureRows: document.getElementById("captureRows"),
  captureElapsed: document.getElementById("captureElapsed"),
  resetBtn: document.getElementById("resetBtn"),
  interpToggle: document.getElementById("interpToggle"),
  resetViewBtn: document.getElementById("resetViewBtn"),
  map: document.getElementById("map"),
  mapNote: document.getElementById("mapNote"),
  clock12: document.getElementById("clock12"),
  clock24: document.getElementById("clock24"),
  weatherMain: document.getElementById("weatherMain"),
  weatherSub: document.getElementById("weatherSub"),
  weatherIcon: document.getElementById("weatherIcon"),
  weatherHum: document.getElementById("weatherHum"),
  weatherPrecip: document.getElementById("weatherPrecip"),
  milIcon: document.getElementById("milIcon"),
  dtcList: document.getElementById("dtcList"),
  lapDisplay: document.getElementById("lapDisplay"),
  lapList: document.getElementById("lapList"),
  lapStartBtn: document.getElementById("lapStartBtn"),
  lapStopBtn: document.getElementById("lapStopBtn"),
  lapLapBtn: document.getElementById("lapLapBtn"),
  lapResetBtn: document.getElementById("lapResetBtn"),
};

const CSV_COLUMNS = [
  "iso_time",
  "rx_ms",
  "seq",
  "ts",
  "lat",
  "lon",
  "speed",
  "rpm",
  "coolant_temp",
  "throttle",
  "engine_load",
  "fuel_level",
];

const DEFAULT_CENTER = [-122.4546, 38.1612]; // [lon, lat] Sonoma
const MAX_PATH_POINTS = 5000;

const WMO = {
  0: "Clear",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent showers",
  95: "Thunderstorm",
  96: "Thunderstorm",
  99: "Thunderstorm",
};

let lastData = null;
let lastStatus = { link: "offline", serialPath: null, lastRxAt: null };

let capturing = false;
let captureRows = [];
let captureStartedAt = 0;

/** @type {[number, number][]} lon,lat */
let pathCoords = [];
let map = null;
let mapReady = false;
let carMarker = null;
let followMap = true;

let weatherLat = DEFAULT_CENTER[1];
let weatherLon = DEFAULT_CENTER[0];
let weatherFetchedFor = "";
let weatherTimer = null;

function pad(n, width = 2) {
  return String(n).padStart(width, "0");
}

function tickClock() {
  const d = new Date();
  const h24 = d.getHours();
  const m = d.getMinutes();
  const s = d.getSeconds();
  const ms = d.getMilliseconds();
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const ampm = h24 >= 12 ? "PM" : "AM";
  els.clock12.textContent = `${h12}:${pad(m)}:${pad(s)} ${ampm}`;
  els.clock24.textContent = `${pad(h24)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}`;
}

function wmoLabel(code) {
  return WMO[code] || `Code ${code}`;
}

/** Inline SVG for Open-Meteo WMO weather codes. */
function wmoIconSvg(code) {
  const n = Number(code);
  // sun
  const clear =
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>';
  // sun behind cloud
  const partly =
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="9" r="3.2"/><path d="M9 3.2v1.6M3.2 9h1.6M5.1 5.1l1.1 1.1" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/><path d="M8.2 16.5a4.2 4.2 0 0 1 .4-8.4 5.2 5.2 0 0 1 10.1 1.6A3.6 3.6 0 0 1 18 16.5H8.2z"/></svg>';
  const cloudy =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.8 17.2a4.4 4.4 0 0 1 .5-8.7 5.5 5.5 0 0 1 10.6 1.7A3.8 3.8 0 0 1 18.2 17.2H7.8z"/></svg>';
  const fog =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 9h16M5 12.5h14M6 16h12"/><path d="M8 6.5a4 4 0 0 1 7.5-1.2A3.2 3.2 0 0 1 17 11" opacity=".55"/></svg>';
  const rain =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 13.2a4 4 0 0 1 .4-8 5 5 0 0 1 9.7 1.5A3.4 3.4 0 0 1 17 13.2H7.5z"/><path d="M9 15.2l-1 3.2M12.2 15.2l-1 3.2M15.4 15.2l-1 3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>';
  const snow =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 13.2a4 4 0 0 1 .4-8 5 5 0 0 1 9.7 1.5A3.4 3.4 0 0 1 17 13.2H7.5z"/><path d="M9.2 15.5l.8.8-.8.8M12 15.2v1.6M14.8 15.5l-.8.8.8.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/></svg>';
  const storm =
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 12.5a4 4 0 0 1 .4-8 5 5 0 0 1 9.7 1.5A3.4 3.4 0 0 1 17 12.5H7.5z"/><path d="M13 12.8l-2.8 4.2h2.2L11 20.5l3.4-4.6h-2.1L13 12.8z"/></svg>';

  if (n === 0 || n === 1) return clear;
  if (n === 2) return partly;
  if (n === 3) return cloudy;
  if (n === 45 || n === 48) return fog;
  if (n >= 71 && n <= 77) return snow;
  if (n >= 95 && n <= 99) return storm;
  if ((n >= 51 && n <= 67) || (n >= 80 && n <= 82)) return rain;
  return cloudy;
}

async function fetchTodayWeather(lat, lon) {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  if (key === weatherFetchedFor) return;
  weatherFetchedFor = key;
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max` +
    `&forecast_days=1&timezone=auto&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch` +
    `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    const daily = data.daily || {};
    const cur = data.current || {};
    const code = daily.weather_code?.[0] ?? cur.weather_code;
    const hi = daily.temperature_2m_max?.[0];
    const lo = daily.temperature_2m_min?.[0];
    const precipDay = daily.precipitation_sum?.[0];
    const precipProb = daily.precipitation_probability_max?.[0];
    const wind = daily.wind_speed_10m_max?.[0];
    const now = cur.temperature_2m;
    const humidity = cur.relative_humidity_2m;

    els.weatherIcon.innerHTML = wmoIconSvg(code);
    els.weatherMain.textContent = `${wmoLabel(code)}${now != null ? `  ${Math.round(now)}°F` : ""}`;

    els.weatherHum.textContent = humidity != null ? `${Math.round(humidity)}%` : "—";
    if (precipDay != null) {
      const inch = Number(precipDay);
      els.weatherPrecip.textContent =
        precipProb != null ? `${inch.toFixed(2)} in · ${Math.round(precipProb)}%` : `${inch.toFixed(2)} in`;
    } else {
      els.weatherPrecip.textContent = "—";
    }

    const bits = [];
    if (lo != null && hi != null) bits.push(`H ${Math.round(hi)}° / L ${Math.round(lo)}°`);
    if (wind != null) bits.push(`${Math.round(wind)} mph`);
    els.weatherSub.textContent = bits.join("  ·  ") || "Today";
  } catch {
    weatherFetchedFor = "";
    els.weatherIcon.innerHTML = "";
    els.weatherMain.textContent = "Weather unavailable";
    els.weatherHum.textContent = "—";
    els.weatherPrecip.textContent = "—";
    els.weatherSub.textContent = "retrying…";
  }
}

function scheduleWeather(lat, lon) {
  weatherLat = lat;
  weatherLon = lon;
  clearTimeout(weatherTimer);
  weatherTimer = setTimeout(() => fetchTodayWeather(weatherLat, weatherLon), 400);
}

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function setLink(link) {
  els.link.textContent = link;
  els.link.className = `link ${link}`;
}

function clearMetrics() {
  els.speed.textContent = "—";
  els.rpm.textContent = "—";
  els.coolant_temp.textContent = "—";
  els.throttle.textContent = "—";
  els.engine_load.textContent = "—";
  els.fuel_level.textContent = "—";
  els.gps.textContent = "—";
  els.seq.textContent = "—";
  els.age.textContent = "—";
}

/** Frontend DTC cache — once seen, codes stay until session Reset. */
/** @type {Map<string, { code: string, desc: string, arrivedAt: number }>} */
const cachedDtcs = new Map();

function formatArrivedHm(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return "";
  const d = new Date(Number(ms));
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function makeDtcRow({ code = "", desc = "", arrived = null } = {}) {
  const row = document.createElement("div");
  row.className = "dtc-row";
  const c = document.createElement("span");
  c.className = "code";
  c.textContent = code;
  const d = document.createElement("span");
  d.className = "desc";
  d.textContent = desc;
  const t = document.createElement("span");
  t.className = "arrived";
  t.textContent = formatArrivedHm(arrived);
  row.append(c, d, t);
  return row;
}

function paintDtcs() {
  const list = [...cachedDtcs.values()];
  els.milIcon.classList.toggle("active", list.length > 0);
  els.dtcList.replaceChildren();
  for (const item of list) {
    els.dtcList.appendChild(makeDtcRow(item));
  }
}

function ingestDtcs(data) {
  if (!("mil" in data) && !("dtcs" in data)) {
    paintDtcs();
    return;
  }
  const list = Array.isArray(data.dtcs) ? data.dtcs : [];
  const now = Date.now();
  for (const item of list) {
    const code = typeof item === "string" ? item : item?.code;
    if (!code) continue;
    const desc = typeof item === "string" ? "" : item?.desc || "";
    const arrived = typeof item === "string" ? null : item?.arrivedAt;
    const prev = cachedDtcs.get(code);
    cachedDtcs.set(code, {
      code,
      desc: desc || prev?.desc || "",
      arrivedAt: prev?.arrivedAt || arrived || now,
    });
  }
  // Empty mil/dtcs from telemetry or sim must not wipe the cache
  paintDtcs();
}

function clearDtcCache() {
  cachedDtcs.clear();
  paintDtcs();
}

/* --- Lap timer --- */
let lapRunning = false;
let lapStartedAt = 0;
let lapAccumMs = 0;
let lapLastMarkAt = 0;
let lapSplits = [];
let lapRaf = 0;

function formatLapTime(ms) {
  const total = Math.max(0, Math.floor(ms));
  const m = Math.floor(total / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const cs = Math.floor((total % 1000) / 10);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function lapElapsedMs() {
  if (!lapRunning) return lapAccumMs;
  return lapAccumMs + (performance.now() - lapStartedAt);
}

function makeLapRow({ n = "", split = "", total = "" } = {}) {
  const row = document.createElement("div");
  row.className = "lap-row";
  const num = document.createElement("span");
  num.className = "lap-n";
  num.textContent = n;
  const sp = document.createElement("span");
  sp.className = "lap-split";
  sp.textContent = split;
  const tot = document.createElement("span");
  tot.className = "lap-total";
  tot.textContent = total;
  row.append(num, sp, tot);
  return row;
}

function renderLapList() {
  els.lapList.replaceChildren();
  for (let i = lapSplits.length - 1; i >= 0; i--) {
    const split = lapSplits[i];
    els.lapList.appendChild(
      makeLapRow({
        n: `L${i + 1}`,
        split: formatLapTime(split.splitMs),
        total: formatLapTime(split.totalMs),
      })
    );
  }
}

function tickLapDisplay() {
  els.lapDisplay.textContent = formatLapTime(lapElapsedMs());
  if (lapRunning) lapRaf = requestAnimationFrame(tickLapDisplay);
}

function updateLapButtons() {
  els.lapStartBtn.classList.toggle("active", lapRunning);
  els.lapStartBtn.textContent = lapRunning ? "Running" : lapAccumMs > 0 ? "Resume" : "Start";
}

function startLapTimer() {
  if (lapRunning) return;
  lapRunning = true;
  lapStartedAt = performance.now();
  if (lapAccumMs === 0) lapLastMarkAt = 0;
  updateLapButtons();
  cancelAnimationFrame(lapRaf);
  lapRaf = requestAnimationFrame(tickLapDisplay);
}

function stopLapTimer() {
  if (!lapRunning) return;
  lapAccumMs += performance.now() - lapStartedAt;
  lapRunning = false;
  cancelAnimationFrame(lapRaf);
  els.lapDisplay.textContent = formatLapTime(lapAccumMs);
  updateLapButtons();
}

function markLap() {
  const total = lapElapsedMs();
  if (total <= 0 && !lapRunning) return;
  const splitMs = total - lapLastMarkAt;
  lapLastMarkAt = total;
  lapSplits.push({ splitMs, totalMs: total });
  renderLapList();
}

function resetLapTimer() {
  lapRunning = false;
  lapStartedAt = 0;
  lapAccumMs = 0;
  lapLastMarkAt = 0;
  lapSplits = [];
  cancelAnimationFrame(lapRaf);
  els.lapDisplay.textContent = formatLapTime(0);
  renderLapList();
  updateLapButtons();
}

function pathGeoJson() {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: pathCoords.length ? pathCoords : [DEFAULT_CENTER, DEFAULT_CENTER],
    },
  };
}

function updateMapPath() {
  if (!mapReady || !map) return;
  const src = map.getSource("car-path");
  if (src) src.setData(pathGeoJson());
}

function setCarMarker(lon, lat) {
  if (!mapReady || !map) return;

  if (!carMarker) {
    const root = document.createElement("div");
    root.className = "car-marker-root";
    const inner = document.createElement("div");
    inner.className = "car-marker";
    root.appendChild(inner);
    carMarker = new mapboxgl.Marker({ element: root }).setLngLat([lon, lat]).addTo(map);
  }

  carMarker.setLngLat([lon, lat]);
}

function fitMapToPath(opts = {}) {
  if (!mapReady || !map || !pathCoords.length) return;
  if (pathCoords.length === 1) {
    map.flyTo({ center: pathCoords[0], zoom: 15, essential: true, ...opts });
    return;
  }
  const bounds = pathCoords.reduce(
    (b, c) => b.extend(c),
    new mapboxgl.LngLatBounds(pathCoords[0], pathCoords[0])
  );
  map.fitBounds(bounds, { padding: 48, maxZoom: 17, duration: 400, ...opts });
}

function appendPathPoint(lat, lon) {
  const pt = [Number(lon), Number(lat)];
  if (Number.isNaN(pt[0]) || Number.isNaN(pt[1])) return;
  const last = pathCoords[pathCoords.length - 1];
  const moved = !(last && last[0] === pt[0] && last[1] === pt[1]);
  if (moved) {
    pathCoords.push(pt);
    if (pathCoords.length > MAX_PATH_POINTS) pathCoords.shift();
    updateMapPath();
    if (followMap) fitMapToPath();
  }
  setCarMarker(pt[0], pt[1]);
}

function clearPath() {
  pathCoords = [];
  updateMapPath();
  if (carMarker) {
    carMarker.remove();
    carMarker = null;
  }
  followMap = true;
  if (mapReady && map) {
    map.easeTo({ center: DEFAULT_CENTER, zoom: 14, duration: 400 });
  }
}

function resetMapView() {
  followMap = true;
  if (pathCoords.length) fitMapToPath();
  else if (mapReady && map) {
    map.easeTo({ center: DEFAULT_CENTER, zoom: 14, duration: 400 });
  }
}

async function initMap() {
  let token = null;
  try {
    const res = await fetch("/api/config");
    const cfg = await res.json();
    token = cfg.mapboxToken;
  } catch {
    /* ignore */
  }

  if (!token || typeof mapboxgl === "undefined") {
    els.mapNote.hidden = false;
    els.mapNote.textContent = token
      ? "Mapbox GL failed to load."
      : "Set MAPBOX_TOKEN in base_station/.env to enable the track map.";
    return;
  }

  mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/dark-v11",
    center: DEFAULT_CENTER,
    zoom: 14,
    attributionControl: true,
  });
  map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

  map.on("movestart", (e) => {
    if (e.originalEvent) followMap = false;
  });

  map.on("load", () => {
    map.addSource("car-path", { type: "geojson", data: pathGeoJson() });
    map.addLayer({
      id: "car-path-line",
      type: "line",
      source: "car-path",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#3b82f6",
        "line-width": 3.5,
        "line-opacity": 0.9,
      },
    });
    mapReady = true;
    updateMapPath();
  });
}

function renderTelemetry(data) {
  lastData = data;
  els.coolant_temp.textContent = fmt(data.coolant_temp, 0);
  els.engine_load.textContent = fmt(data.engine_load, 0);
  els.fuel_level.textContent = fmt(data.fuel_level, 0);
  els.seq.textContent = data.seq != null ? String(data.seq) : "—";
  if ("mil" in data || "dtcs" in data) ingestDtcs(data);
  if (data.lat != null && data.lon != null) {
    els.gps.textContent = `${Number(data.lat).toFixed(5)}, ${Number(data.lon).toFixed(5)}`;
    appendPathPoint(data.lat, data.lon);
    scheduleWeather(Number(data.lat), Number(data.lon));
  } else {
    els.gps.textContent = "—";
  }

  pushInterpSample(data);
  if (!interpOn) {
    els.speed.textContent = fmt(data.speed, 0);
    els.rpm.textContent = fmt(data.rpm, 0);
    els.throttle.textContent = fmt(data.throttle, 0);
  }

  if (capturing) appendCaptureRow(data);
}

/* --- Linear interpolation for speed / rpm / throttle @ ~60 FPS --- */
let interpOn = false;
let interpRaf = 0;
/** @type {{ t: number, speed: number|null, rpm: number|null, throttle: number|null } | null} */
let interpFrom = null;
/** @type {{ t: number, speed: number|null, rpm: number|null, throttle: number|null } | null} */
let interpTo = null;
let interpAnimStart = 0;
let interpAnimDur = 0;

function sampleTimeMs(data) {
  if (data?._rxAt != null) return Number(data._rxAt);
  if (data?.ts != null) {
    const t = Number(data.ts);
    return t < 1e12 ? t * 1000 : t;
  }
  return Date.now();
}

function takeInterpSample(data) {
  return {
    t: sampleTimeMs(data),
    speed: data.speed != null && !Number.isNaN(Number(data.speed)) ? Number(data.speed) : null,
    rpm: data.rpm != null && !Number.isNaN(Number(data.rpm)) ? Number(data.rpm) : null,
    throttle:
      data.throttle != null && !Number.isNaN(Number(data.throttle)) ? Number(data.throttle) : null,
  };
}

function lerp(a, b, u) {
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * u;
}

function paintInterpFields(speed, rpm, throttle) {
  els.speed.textContent = speed == null ? "—" : fmt(speed, 0);
  els.rpm.textContent = rpm == null ? "—" : fmt(rpm, 0);
  els.throttle.textContent = throttle == null ? "—" : fmt(throttle, 0);
}

function interpTick() {
  if (!interpOn) return;
  const now = performance.now();
  let u = 1;
  if (interpAnimDur > 0) u = Math.min(1, Math.max(0, (now - interpAnimStart) / interpAnimDur));
  const from = interpFrom || interpTo;
  const to = interpTo || interpFrom;
  if (!from && !to) {
    paintInterpFields(null, null, null);
  } else {
    paintInterpFields(
      lerp(from?.speed ?? null, to?.speed ?? null, u),
      lerp(from?.rpm ?? null, to?.rpm ?? null, u),
      lerp(from?.throttle ?? null, to?.throttle ?? null, u)
    );
  }
  interpRaf = requestAnimationFrame(interpTick);
}

function stopInterpLoop() {
  cancelAnimationFrame(interpRaf);
  interpRaf = 0;
}

function startInterpLoop() {
  if (interpRaf) return;
  interpRaf = requestAnimationFrame(interpTick);
}

function pushInterpSample(data) {
  const sample = takeInterpSample(data);
  if (!interpOn) {
    interpFrom = sample;
    interpTo = sample;
    return;
  }
  if (!interpTo) {
    interpFrom = sample;
    interpTo = sample;
    interpAnimStart = performance.now();
    interpAnimDur = 0;
    startInterpLoop();
    return;
  }
  // New segment: previous packet → this packet (linear over their timestamp delta)
  interpFrom = interpTo;
  interpTo = sample;
  const dt = Math.max(0, interpTo.t - interpFrom.t);
  interpAnimDur = Math.min(5000, Math.max(50, dt || 1000));
  interpAnimStart = performance.now();
  startInterpLoop();
}

function setInterpolate(on) {
  interpOn = Boolean(on);
  els.interpToggle.checked = interpOn;
  if (!interpOn) {
    stopInterpLoop();
    if (lastData) {
      els.speed.textContent = fmt(lastData.speed, 0);
      els.rpm.textContent = fmt(lastData.rpm, 0);
      els.throttle.textContent = fmt(lastData.throttle, 0);
    }
    return;
  }
  if (lastData) {
    const s = takeInterpSample(lastData);
    interpFrom = s;
    interpTo = s;
    interpAnimStart = performance.now();
    interpAnimDur = 0;
  }
  startInterpLoop();
}


function renderStatus(st) {
  lastStatus = st;
  setLink(st.link || "offline");
  els.port.textContent = st.serialPath || "—";
}

function tickAge() {
  if (!lastStatus.lastRxAt) {
    els.age.textContent = "—";
    return;
  }
  const age = Math.max(0, Date.now() - lastStatus.lastRxAt);
  els.age.textContent = `${(age / 1000).toFixed(1)}s`;
}

function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function updateCaptureUi() {
  els.captureBtn.classList.toggle("recording", capturing);
  els.captureBtn.setAttribute("aria-pressed", capturing ? "true" : "false");
  els.captureLabel.textContent = capturing ? "Stop capture" : "Start capture";
  els.captureRows.textContent = `${captureRows.length} row${captureRows.length === 1 ? "" : "s"}`;
  if (capturing) {
    els.captureElapsed.textContent = formatElapsed(Date.now() - captureStartedAt);
  } else if (captureRows.length === 0) {
    els.captureElapsed.textContent = "00:00";
  }
}

function csvEscape(value) {
  if (value == null || value === "") return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function appendCaptureRow(data) {
  const rxMs = data._rxAt || Date.now();
  captureRows.push({
    iso_time: new Date(rxMs).toISOString(),
    rx_ms: rxMs,
    seq: data.seq ?? "",
    ts: data.ts ?? "",
    lat: data.lat ?? "",
    lon: data.lon ?? "",
    speed: data.speed ?? "",
    rpm: data.rpm ?? "",
    coolant_temp: data.coolant_temp ?? "",
    throttle: data.throttle ?? "",
    engine_load: data.engine_load ?? "",
    fuel_level: data.fuel_level ?? "",
  });
  updateCaptureUi();
}

function buildCsv(rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((col) => csvEscape(row[col])).join(","));
  }
  return lines.join("\n") + "\n";
}

function downloadCsv(rows) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rnracing-telemetry-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function startCapture() {
  capturing = true;
  captureRows = [];
  captureStartedAt = Date.now();
  updateCaptureUi();
}

function stopCapture() {
  capturing = false;
  const rows = captureRows.slice();
  updateCaptureUi();
  if (rows.length > 0) downloadCsv(rows);
  captureRows = [];
  updateCaptureUi();
}

function resetSession() {
  capturing = false;
  captureRows = [];
  captureStartedAt = 0;
  lastData = null;
  lastStatus = { ...lastStatus, lastRxAt: null };
  clearPath();
  clearMetrics();
  clearDtcCache();
  resetLapTimer();
  interpFrom = null;
  interpTo = null;
  stopInterpLoop();
  if (interpOn) startInterpLoop();
  els.port.textContent = lastStatus.serialPath || "—";
  updateCaptureUi();
}

els.captureBtn.addEventListener("click", () => {
  if (capturing) stopCapture();
  else startCapture();
});

els.resetBtn.addEventListener("click", resetSession);
els.interpToggle.addEventListener("change", () => setInterpolate(els.interpToggle.checked));
els.resetViewBtn.addEventListener("click", resetMapView);
els.lapStartBtn.addEventListener("click", startLapTimer);
els.lapStopBtn.addEventListener("click", stopLapTimer);
els.lapLapBtn.addEventListener("click", markLap);
els.lapResetBtn.addEventListener("click", resetLapTimer);

function connect() {
  const es = new EventSource("/events");
  es.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "telemetry" && msg.data) renderTelemetry(msg.data);
    else if (msg.type === "status") renderStatus(msg);
  };
  es.onerror = () => {
    setLink("offline");
  };
}

connect();
initMap();
tickClock();
setInterval(tickClock, 50);
fetchTodayWeather(weatherLat, weatherLon);
setInterval(() => {
  weatherFetchedFor = "";
  fetchTodayWeather(weatherLat, weatherLon);
}, 30 * 60 * 1000);
setInterval(tickAge, 200);
setInterval(() => {
  if (capturing) updateCaptureUi();
}, 250);
updateCaptureUi();
updateLapButtons();
paintDtcs();
renderLapList();
