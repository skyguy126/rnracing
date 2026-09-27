/**
 * Race Monitor live timing for one car.
 * Discovery: GET /Info/WebRaceList, then WebSocket $JOIN.
 * Lap history stays on the client across reconnects.
 */

const MAX_EARLY = 2000;
const MAX_PENDING_G = 40;

export function parseCsvFields(line) {
  const fields = [];
  let cur = "";
  let quoted = false;
  const text = String(line ?? "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ",") {
      fields.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  fields.push(cur);
  return fields;
}

export function parseLapTimeMs(value) {
  const s = clean(value);
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length < 1 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d+(\.\d+)?$/.test(part))) return null;
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    hours = Number(parts[0]);
    minutes = Number(parts[1]);
    seconds = Number(parts[2]);
  } else if (parts.length === 2) {
    minutes = Number(parts[0]);
    seconds = Number(parts[1]);
  } else {
    seconds = Number(parts[0]);
  }
  if (seconds >= 60) return null;
  if (parts.length === 3 && minutes >= 60) return null;
  const ms = Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  return Number.isFinite(ms) ? ms : null;
}

export function fastestLapMs(laps) {
  let best = null;
  for (const lap of laps) {
    if (lap?.lapTimeMs == null) continue;
    if (best == null || lap.lapTimeMs < best) best = lap.lapTimeMs;
  }
  return best;
}

export function formatLapDelta(lapTimeMs, bestMs) {
  if (lapTimeMs == null || bestMs == null) return "—";
  if (lapTimeMs === bestMs) return "BEST";
  const diff = (lapTimeMs - bestMs) / 1000;
  const sign = diff > 0 ? "+" : "-";
  return sign + Math.abs(diff).toFixed(3);
}

export function createTimingSession({ carNumber = "711", maxLaps = 10 } = {}) {
  const targetCar = clean(carNumber);
  const limit = Math.max(1, maxLaps);
  let racerId = null;
  let carSeen = false;
  let lastPosition = null;
  let seq = 0;
  let rows = [];
  let early = [];
  const byTotal = new Map();
  const pendingG = new Map();

  function noteCompetitor(fields) {
    const racer = clean(fields[1]);
    const car = clean(fields[2]);
    if (!racer || !car || car !== targetCar) return;
    racerId = racer;
    carSeen = true;
  }

  function applyTiming(msg) {
    const fields = msg.fields;
    if (msg.type === "$H") {
      // Race-best from $H can sit outside the retained window. Delta uses
      // the laps still in this session, so $H is acknowledged and not shown.
      return;
    }
    if (msg.type === "$J") {
      const racer = clean(fields[1]);
      const lapTime = clean(fields[2]);
      const totalTime = clean(fields[3]);
      if (!racer || racer !== racerId || !lapTime || !totalTime) return;
      if (byTotal.has(totalTime)) return;
      const pending = pendingG.get(totalTime);
      const row = {
        seq: ++seq,
        lap: pending && pending.lap != null ? pending.lap : null,
        lapTime,
        lapTimeMs: parseLapTimeMs(lapTime),
        position:
          pending && pending.position != null ? pending.position : lastPosition,
        totalTime,
      };
      pendingG.delete(totalTime);
      byTotal.set(totalTime, row);
      rows.push(row);
      return;
    }
    if (msg.type === "$G") {
      const position = parseIntField(fields[1]);
      const racer = clean(fields[2]);
      const lap = parseIntField(fields[3]);
      const totalTime = clean(fields[4]);
      if (!racer || racer !== racerId || !totalTime) return;
      if (position != null) lastPosition = position;
      const row = byTotal.get(totalTime);
      if (row) {
        if (lap != null) row.lap = lap;
        if (position != null) row.position = position;
        return;
      }
      if (lap != null) {
        pendingG.set(totalTime, { lap, position });
        while (pendingG.size > MAX_PENDING_G) {
          const oldest = pendingG.keys().next().value;
          pendingG.delete(oldest);
        }
      }
    }
  }

  function flushEarly() {
    if (!early.length) return;
    const queued = early;
    early = [];
    for (const msg of queued) {
      try {
        applyTiming(msg);
      } catch {
        /* ignore one bad buffered line */
      }
    }
  }

  function handleLine(line) {
    const msg = parseRaceLine(line);
    if (!msg) return;
    if (msg.type === "$COMP" || msg.type === "$A") {
      const wasKnown = racerId != null;
      noteCompetitor(msg.fields);
      if (!wasKnown && racerId) flushEarly();
      return;
    }
    if (msg.type !== "$G" && msg.type !== "$J" && msg.type !== "$H") return;
    if (!racerId) {
      if (early.length >= MAX_EARLY) early.shift();
      early.push(msg);
      return;
    }
    applyTiming(msg);
  }

  function trimRows() {
    if (rows.length <= limit) return;
    rows = [...rows].sort(compareNewestFirst).slice(0, limit);
  }

  function getState() {
    return {
      carSeen,
      racerId,
      laps: [...rows]
        .sort(compareNewestFirst)
        .slice(0, limit)
        .map((row) => ({
          lap: row.lap,
          lapTime: row.lapTime,
          lapTimeMs: row.lapTimeMs,
          position: row.position,
        })),
    };
  }

  function ingest(chunk) {
    const text = chunk == null ? "" : String(chunk);
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        handleLine(line);
      } catch {
        /* malformed / unknown line */
      }
    }
    trimRows();
    return getState();
  }

  return { ingest, getState };
}

export function createRaceMonitorClient({
  raceId = "170275",
  carNumber = "711",
  maxLaps = 10,
  reconnectMs = 3000,
  onUpdate,
} = {}) {
  const session = createTimingSession({ carNumber, maxLaps });
  let status = "CONNECTING";
  let stopped = false;
  let connectGen = 0;
  let retryTimer = null;
  let abortFetch = null;
  let ws = null;
  let lastKey = "";

  function publish() {
    const state = { status, ...session.getState() };
    const key = `${status}\n${state.carSeen ? "1" : "0"}\n${JSON.stringify(state.laps)}`;
    if (key === lastKey) return;
    lastKey = key;
    try {
      onUpdate?.(state);
    } catch {
      console.error("[live-timing] render failed");
    }
  }

  function setStatus(next) {
    status = next;
    publish();
  }

  function closeSocket() {
    const sock = ws;
    ws = null;
    if (!sock) return;
    sock.onopen = null;
    sock.onmessage = null;
    sock.onerror = null;
    sock.onclose = null;
    try {
      sock.close();
    } catch {
      /* already closed */
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      connect();
    }, reconnectMs);
  }

  function openSocket(sessionInfo, gen) {
    const url = `wss://${sessionInfo.host}/instance/${sessionInfo.instance}/${sessionInfo.token}`;
    let sock;
    try {
      sock = new WebSocket(url);
    } catch {
      setStatus("DISCONNECTED");
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      if (stopped || gen !== connectGen || ws !== sock) return;
      try {
        sock.send(`$JOIN,${sessionInfo.instance}`);
      } catch {
        try {
          sock.close();
        } catch {
          /* ignore */
        }
        return;
      }
      setStatus("LIVE");
    };
    sock.onmessage = (ev) => {
      if (stopped || gen !== connectGen || ws !== sock) return;
      readPayload(ev.data, (text) => {
        if (stopped || gen !== connectGen) return;
        try {
          session.ingest(text);
        } catch {
          /* keep the socket; one bad frame is not fatal */
        }
        publish();
      });
    };
    sock.onerror = () => {
      /* close follows */
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      if (stopped || gen !== connectGen) return;
      setStatus("DISCONNECTED");
      scheduleReconnect();
    };
  }

  async function connect() {
    if (stopped) return;
    const gen = ++connectGen;
    clearTimeout(retryTimer);
    closeSocket();
    abortFetch?.abort();
    const ac = new AbortController();
    abortFetch = ac;
    setStatus("CONNECTING");
    const kill = setTimeout(() => ac.abort(), 12000);
    try {
      const sessionInfo = await loadSession(raceId, ac.signal);
      if (stopped || gen !== connectGen) return;
      openSocket(sessionInfo, gen);
    } catch {
      if (stopped || gen !== connectGen) return;
      console.error("[live-timing] live timing connection failed");
      setStatus("DISCONNECTED");
      scheduleReconnect();
    } finally {
      clearTimeout(kill);
    }
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    connectGen += 1;
    clearTimeout(retryTimer);
    abortFetch?.abort();
    closeSocket();
  }

  connect();
  return { stop };
}

function parseRaceLine(line) {
  const trimmed = String(line ?? "").trim();
  if (!trimmed.startsWith("$")) return null;
  const fields = parseCsvFields(trimmed);
  const type = fields[0];
  if (!type || !type.startsWith("$")) return null;
  return { type, fields };
}

async function loadSession(raceId, signal) {
  const url =
    "https://api.race-monitor.com/Info/WebRaceList?accountID=&seriesID=&raceID=" +
    encodeURIComponent(raceId) +
    "&t=" +
    Date.now();
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) throw new Error("race list request failed");
  const data = await res.json();
  const races = Array.isArray(data?.CurrentRaces) ? data.CurrentRaces : [];
  const race = races.find((item) => item && String(item.ID) === String(raceId));
  const host = typeof data?.LiveTimingHost === "string" ? data.LiveTimingHost.trim() : "";
  const token = typeof data?.LiveTimingToken === "string" ? data.LiveTimingToken.trim() : "";
  const instance = race && race.Instance != null ? String(race.Instance).trim() : "";
  if (!race || !isHost(host) || !isPathToken(token) || !isPathToken(instance)) {
    throw new Error("live timing session unavailable");
  }
  return { host, token, instance };
}

function readPayload(data, done) {
  try {
    if (typeof data === "string") {
      done(data);
      return;
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
      data.text().then(done).catch(() => {});
      return;
    }
    if (data instanceof ArrayBuffer) done(new TextDecoder().decode(data));
  } catch {
    /* ignore undecodable frames */
  }
}

function compareNewestFirst(a, b) {
  if (a.lap == null && b.lap != null) return -1;
  if (b.lap == null && a.lap != null) return 1;
  if (a.lap != null && b.lap != null && a.lap !== b.lap) return b.lap - a.lap;
  return b.seq - a.seq;
}

function parseIntField(value) {
  const s = clean(value);
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

function clean(value) {
  if (value == null) return "";
  return String(value).trim();
}

function isHost(host) {
  return (
    /^[A-Za-z0-9.-]+$/.test(host) &&
    host.includes(".") &&
    !host.startsWith(".") &&
    !host.endsWith(".")
  );
}

function isPathToken(value) {
  return /^[A-Za-z0-9._~-]+$/.test(value);
}
