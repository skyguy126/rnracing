/**
 * Base-station telemetry harness (no USB LoRa required).
 * Circular GPS around Sonoma Raceway + noisy OBD fields.
 */

const CENTER_LAT = 38.1612;
const CENTER_LON = -122.4546;
/** ~220 m radius at this latitude */
const RADIUS_LAT = 0.002;
const CIRCLE_PERIOD_S = 60;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * @param {number} seq
 * @param {number} t0  epoch ms when sim started
 */
export function nextSimTelemetry(seq, t0) {
  const t = (Date.now() - t0) / 1000;
  const angle = (t / CIRCLE_PERIOD_S) * Math.PI * 2;
  const lat = CENTER_LAT + RADIUS_LAT * Math.cos(angle);
  const lon =
    CENTER_LON +
    (RADIUS_LAT * Math.sin(angle)) / Math.cos((CENTER_LAT * Math.PI) / 180);
  // DTCs: off until 10s, then 15s on / 60s off
  let mil = false;
  let dtcs = [];
  if (t >= 10) {
    const u = (t - 10) % 75;
    if (u < 15) {
      mil = true;
      dtcs = [
        { code: "P0301", desc: "Cylinder 1 Misfire Detected" },
        { code: "P0420", desc: "Catalyst System Efficiency Below Threshold" },
      ];
    }
  }

  return {
    type: "tel",
    seq,
    ts: Math.floor(Date.now() / 1000),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    speed: Number(rand(25, 100).toFixed(2)),
    rpm: Number(rand(1500, 7000).toFixed(2)),
    coolant_temp: Number(rand(75, 105).toFixed(2)),
    throttle: Number(rand(5, 95).toFixed(2)),
    engine_load: Number(rand(20, 90).toFixed(2)),
    fuel_level: Number(Math.max(5, 80 - t / 90 + rand(-1, 1)).toFixed(2)),
    mil,
    dtcs,
  };
}
