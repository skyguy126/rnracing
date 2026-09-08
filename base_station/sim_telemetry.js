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

  return {
    type: "tel",
    seq,
    ts: Math.floor(Date.now() / 1000),
    lat: Number(lat.toFixed(6)),
    lon: Number(lon.toFixed(6)),
    speed: Number(rand(40, 160).toFixed(2)),
    rpm: Number(rand(1500, 7000).toFixed(2)),
    coolant_temp: Number(rand(75, 105).toFixed(2)),
    throttle: Number(rand(5, 95).toFixed(2)),
    engine_load: Number(rand(20, 90).toFixed(2)),
    fuel_level: Number(Math.max(5, 80 - t / 90 + rand(-1, 1)).toFixed(2)),
  };
}
