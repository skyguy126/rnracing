import {
  createRaceMonitorClient,
  fastestLapMs,
  formatLapDelta,
} from "./race-monitor.js";

const statusEl = document.getElementById("liveTimingStatus");
const waitEl = document.getElementById("liveTimingWait");
const tableEl = document.getElementById("liveTimingTable");
const rowsEl = document.getElementById("liveTimingRows");

const STATUS_CLASS = {
  LIVE: "live",
  CONNECTING: "connecting",
  DISCONNECTED: "offline",
};

if (statusEl && waitEl && tableEl && rowsEl) {
  const client = createRaceMonitorClient({
    raceId: "170275",
    carNumber: "711",
    maxLaps: 10,
    onUpdate: render,
  });

  window.addEventListener("pagehide", () => {
    client.stop();
  });
}

function render(state) {
  const status = STATUS_CLASS[state.status] ? state.status : "DISCONNECTED";
  statusEl.textContent = status;
  statusEl.classList.remove("live", "connecting", "offline");
  statusEl.classList.add(STATUS_CLASS[status]);

  const laps = Array.isArray(state.laps) ? state.laps.slice(0, 10) : [];
  if (!laps.length) {
    tableEl.hidden = true;
    waitEl.hidden = false;
    rowsEl.replaceChildren();
    waitEl.textContent = state.carSeen
      ? "Car #711 is in the session. Waiting for a completed lap."
      : "Waiting for car #711 in the live timing feed.";
    return;
  }

  waitEl.hidden = true;
  tableEl.hidden = false;
  const best = fastestLapMs(laps);
  const frag = document.createDocumentFragment();
  for (const lap of laps) frag.appendChild(makeRow(lap, best));
  rowsEl.replaceChildren(frag);
}

function makeRow(lap, bestMs) {
  const delta = formatLapDelta(lap.lapTimeMs, bestMs);
  const row = document.createElement("div");
  row.className = delta === "BEST" ? "live-timing-row is-best" : "live-timing-row";
  row.setAttribute("role", "row");
  appendCell(row, "lt-lap", lap.lap == null ? "—" : String(lap.lap));
  appendCell(row, "lt-time", lap.lapTime || "—");
  appendCell(row, "lt-delta", delta);
  appendCell(row, "lt-pos", lap.position == null ? "—" : String(lap.position));
  return row;
}

function appendCell(row, className, text) {
  const cell = document.createElement("span");
  cell.className = className;
  cell.setAttribute("role", "cell");
  cell.textContent = text;
  row.appendChild(cell);
}
