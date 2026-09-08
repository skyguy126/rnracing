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

let lastData = null;
let lastStatus = { link: "offline", serialPath: null, lastRxAt: null };

let capturing = false;
let captureRows = [];
let captureStartedAt = 0;

function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toFixed(digits);
}

function setLink(link) {
  els.link.textContent = link;
  els.link.className = `link ${link}`;
}

function renderTelemetry(data) {
  lastData = data;
  els.speed.textContent = fmt(data.speed, 0);
  els.rpm.textContent = fmt(data.rpm, 0);
  els.coolant_temp.textContent = fmt(data.coolant_temp, 0);
  els.throttle.textContent = fmt(data.throttle, 0);
  els.engine_load.textContent = fmt(data.engine_load, 0);
  els.fuel_level.textContent = fmt(data.fuel_level, 0);
  els.seq.textContent = data.seq != null ? String(data.seq) : "—";
  if (data.lat != null && data.lon != null) {
    els.gps.textContent = `${Number(data.lat).toFixed(5)}, ${Number(data.lon).toFixed(5)}`;
  } else {
    els.gps.textContent = "—";
  }

  if (capturing) appendCaptureRow(data);
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

els.captureBtn.addEventListener("click", () => {
  if (capturing) stopCapture();
  else startCapture();
});

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
setInterval(tickAge, 200);
setInterval(() => {
  if (capturing) updateCaptureUi();
}, 250);
updateCaptureUi();
