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
};

let lastData = null;
let lastStatus = { link: "offline", serialPath: null, lastRxAt: null };

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
