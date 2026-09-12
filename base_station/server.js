#!/usr/bin/env node
/**
 * Base station: read Waveshare USB-TO-LoRa (SX1262) stream mode, serve a
 * simple live dashboard. Car → base is TX-only; this process only receives.
 *
 *   npm run list-ports   # copy /dev/serial/by-id/... (Linux) or COMx (Windows)
 *   node server.js --freq 915 --lora-port /dev/serial/by-id/...
 *   npm start -- --freq 868 --lora-port COM5 --port 3000
 */

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";
import { nextSimTelemetry } from "./sim_telemetry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i < 0) continue;
      const key = line.slice(0, i).trim();
      let val = line.slice(i + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* no .env is fine */
  }
}

loadEnvFile(path.join(__dirname, ".env"));

/** HF: freq_MHz = 850 + channel → 868→18, 915→65 (915 is in US 902–928) */
const FREQ_CHANNELS = { 868: 18, 915: 65 };
const LORA_SF = 10;
const LORA_BW_AT = 0; // 125 kHz
const LORA_CR_AT = 1; // 4/5
const LORA_PWR_DEFAULT = 22;

function parseArgs(argv) {
  const out = {
    sim: false,
    freq: 915,
    pwr: LORA_PWR_DEFAULT,
    port: 3000,
    loraPort: null,
    loraBaud: 115200,
    reconnectMs: 2000,
    staleMs: 5000,
    intervalMs: 1000,
  };

  const take = (i) => {
    if (i + 1 >= argv.length) {
      console.error(`[base] missing value after ${argv[i]}`);
      process.exit(1);
    }
    return argv[i + 1];
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sim") out.sim = true;
    else if (a === "--freq") out.freq = Number(take(i++));
    else if (a === "--pwr") out.pwr = Number(take(i++));
    else if (a === "--lora-port") out.loraPort = take(i++);
    else if (a === "--lora-baud") out.loraBaud = Number(take(i++));
    else if (a === "--port") out.port = Number(take(i++));
    else if (a === "--reconnect-ms") out.reconnectMs = Number(take(i++));
    else if (a === "--stale-ms") out.staleMs = Number(take(i++));
    else if (a === "--interval-ms") out.intervalMs = Number(take(i++));
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: node server.js [options]
  --sim                Fake telemetry (no USB LoRa); GPS walks in a circle
  --freq 868|915       LoRa band (default: 915)
  --pwr 10-22          TX power dBm (default: 22); SF=10 BW=125k CR=4/5 fixed
  --lora-port PATH     USB-TO-LoRa path (prefer /dev/serial/by-id/...; default: auto)
  --lora-baud N        USB baud (default: 115200)
  --port N             HTTP dashboard port (default: 3000)
  --interval-ms N      Sim tick ms (default: 1000)
  --reconnect-ms N     Serial reopen delay (default: 2000)
  --stale-ms N         UI stale threshold (default: 5000)
  Mapbox token: set MAPBOX_TOKEN in base_station/.env`);
      process.exit(0);
    } else {
      console.error(`[base] unknown argument: ${a}`);
      process.exit(1);
    }
  }

  if (![868, 915].includes(out.freq)) {
    console.error(`[base] --freq must be 868 or 915 (got ${out.freq})`);
    process.exit(1);
  }
  if (!Number.isInteger(out.pwr) || out.pwr < 10 || out.pwr > 22) {
    console.error(`[base] --pwr must be 10–22 (got ${out.pwr})`);
    process.exit(1);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const HTTP_PORT = args.port;
const LORA_PORT = args.loraPort;
const LORA_BAUD = args.loraBaud;
const RECONNECT_MS = args.reconnectMs;
const STALE_MS = args.staleMs;
const SIM_INTERVAL_MS = args.intervalMs;
const SIM_MODE = args.sim;
const FREQ_MHZ = args.freq;
const FREQ_CH = FREQ_CHANNELS[FREQ_MHZ];
const LORA_PWR = args.pwr;
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || "";
const CH343_VID = 0x1a86;
const BY_ID_DIR = "/dev/serial/by-id";

function stableSerialPath(devicePath) {
  if (!devicePath || !fs.existsSync(BY_ID_DIR)) return devicePath;
  if (devicePath.includes("/serial/by-id/") || devicePath.includes("\\serial\\by-id\\")) {
    return devicePath;
  }
  let target;
  try {
    target = fs.realpathSync(devicePath);
  } catch {
    return devicePath;
  }
  for (const name of fs.readdirSync(BY_ID_DIR).sort()) {
    const link = path.join(BY_ID_DIR, name);
    try {
      if (fs.realpathSync(link) === target) return link;
    } catch {
      /* skip */
    }
  }
  return devicePath;
}

/** @type {import('express').Response[]} */
const sseClients = [];
let latest = null;
let lastRxAt = 0;
let serialPath = null;
let serialOpen = false;
let programmedPath = null;
/** Last radio seq, for gap logs. Independent of sticky dashboard state. */
let lastRxSeq = null;

/** Last-known MIL / DTCs; survive packets that omit these fields. */
let stickyMil = false;
/** @type {{ code: string, desc: string, arrivedAt: number }[]} */
let stickyDtcs = [];

function normalizeDtcItem(item) {
  if (typeof item === "string") return { code: item, desc: "" };
  if (!item || typeof item !== "object") return null;
  const code = item.code != null ? String(item.code) : "";
  if (!code) return null;
  return { code, desc: item.desc != null ? String(item.desc) : "" };
}

function applyStickyDtcs(msg) {
  const hasMil = Object.prototype.hasOwnProperty.call(msg, "mil");
  const hasDtcs = Object.prototype.hasOwnProperty.call(msg, "dtcs");

  if (!hasMil && !hasDtcs) {
    if (!stickyMil && stickyDtcs.length === 0) return msg;
    return { ...msg, mil: stickyMil, dtcs: stickyDtcs };
  }

  const rawList = hasDtcs && Array.isArray(msg.dtcs) ? msg.dtcs : [];
  const parsed = rawList.map(normalizeDtcItem).filter(Boolean);
  const milOn = (hasMil ? Boolean(msg.mil) : false) || parsed.length > 0;

  if (!milOn) {
    // Keep sticky codes even when the car/sim reports clear
    return { ...msg, mil: stickyMil, dtcs: stickyDtcs };
  }

  const prev = new Map(stickyDtcs.map((d) => [d.code, d]));
  const now = Date.now();
  for (const d of parsed) {
    const old = prev.get(d.code);
    prev.set(d.code, {
      code: d.code,
      desc: d.desc || old?.desc || "",
      arrivedAt: old?.arrivedAt || now,
    });
  }
  stickyDtcs = [...prev.values()];
  stickyMil = true;
  return { ...msg, mil: true, dtcs: stickyDtcs };
}

function broadcast(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(payload);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

function statusSnapshot() {
  const now = Date.now();
  let link = "offline";
  if (serialOpen && latest && now - lastRxAt < STALE_MS) link = "live";
  else if (serialOpen && latest) link = "stale";
  else if (serialOpen) link = "listening";
  return {
    type: "status",
    link,
    serialOpen,
    serialPath,
    freqMhz: FREQ_MHZ,
    lastRxAt: lastRxAt || null,
    ageMs: latest ? now - lastRxAt : null,
  };
}

async function findLoraPort() {
  if (LORA_PORT) return stableSerialPath(LORA_PORT);
  const ports = await SerialPort.list();
  const hit = ports.find((p) => {
    const vid = p.vendorId ? parseInt(p.vendorId, 16) : 0;
    const hay = `${p.manufacturer || ""} ${p.friendlyName || ""} ${p.path || ""}`.toUpperCase();
    return vid === CH343_VID || hay.includes("CH343") || hay.includes("CH340") || hay.includes("WCH");
  });
  return hit ? stableSerialPath(hit.path) : null;
}

function handleLine(line) {
  const text = String(line || "").trim();
  if (!text) return;
  // Car TX logs include the trailing newline written onto the radio.
  const bytes = Buffer.byteLength(text, "utf8") + 1;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    const preview = text.length > 120 ? `${text.slice(0, 120)}…` : text;
    console.log(`[base] rx junk bytes=${bytes} ${preview}`);
    return;
  }
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    console.log(`[base] rx junk bytes=${bytes} not an object`);
    return;
  }

  const seq = Number.isInteger(msg.seq) ? msg.seq >>> 0 : null;
  if (seq != null && lastRxSeq != null && seq !== ((lastRxSeq + 1) >>> 0)) {
    const expected = (lastRxSeq + 1) >>> 0;
    const missed = (seq - expected) >>> 0;
    if (missed > 0 && missed < 10000) {
      console.log(`[base] rx gap expected=${expected} got=${seq} missed=${missed}`);
    } else {
      console.log(`[base] rx seq jump expected=${expected} got=${seq}`);
    }
  }
  if (seq != null) lastRxSeq = seq;
  console.log(`[base] rx seq=${seq ?? "?"} bytes=${bytes}`);
  ingestTelemetry(msg);
}

function ingestTelemetry(msg) {
  lastRxAt = Date.now();
  latest = { ...applyStickyDtcs(msg), _rxAt: lastRxAt };
  broadcast({ type: "telemetry", data: latest });
  broadcast(statusSnapshot());
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function simLoop() {
  serialOpen = true;
  serialPath = "sim";
  broadcast(statusSnapshot());
  console.log(`[base] sim harness on (circular GPS, random OBD) every ${SIM_INTERVAL_MS}ms`);
  const t0 = Date.now();
  let seq = 0;
  for (;;) {
    ingestTelemetry(nextSimTelemetry(seq, t0));
    seq = (seq + 1) >>> 0;
    await sleep(SIM_INTERVAL_MS);
  }
}

function writeLine(port, line) {
  return new Promise((resolve, reject) => {
    port.write(`${line}\r\n`, (err) => {
      if (err) reject(err);
      else port.drain((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function drain(port, waitMs = 200) {
  await sleep(waitMs);
  try {
    const n = port.readableLength ?? 0;
    if (n > 0) port.read(n);
  } catch {
    /* ignore */
  }
}

async function configureLoraFreq(port, pathName) {
  if (programmedPath === pathName) return;
  console.log(`[base] programming LoRa ${FREQ_MHZ} MHz ch=${FREQ_CH} SF=${LORA_SF} BW=125k CR=4/5 PWR=${LORA_PWR}dBm`);

  await sleep(1200);
  try {
    port.flush();
  } catch {
    /* ignore */
  }

  await writeLine(port, "+++");
  await drain(port, 500);

  for (const cmd of [
    "AT+MODE=1",
    `AT+SF=${LORA_SF}`,
    `AT+BW=${LORA_BW_AT}`,
    `AT+CR=${LORA_CR_AT}`,
    `AT+PWR=${LORA_PWR}`,
    `AT+TXCH=${FREQ_CH}`,
    `AT+RXCH=${FREQ_CH}`,
    "AT+EXIT",
  ]) {
    await writeLine(port, cmd);
    await drain(port, 350);
  }

  await sleep(2000);
  try {
    port.flush();
  } catch {
    /* ignore */
  }
  programmedPath = pathName;
  console.log(`[base] LoRa configured: ${FREQ_MHZ} MHz stream mode`);
}

async function serialLoop() {
  for (;;) {
    let pathName = null;
    try {
      pathName = await findLoraPort();
      if (!pathName) {
        serialOpen = false;
        serialPath = null;
        broadcast(statusSnapshot());
        await sleep(RECONNECT_MS);
        continue;
      }

      await new Promise((resolve, reject) => {
        const port = new SerialPort({
          path: pathName,
          baudRate: LORA_BAUD,
          autoOpen: false,
        });

        let parser = null;
        let settled = false;

        const cleanup = () => {
          serialOpen = false;
          try {
            port.removeAllListeners();
            if (parser) parser.removeAllListeners();
            if (port.isOpen) port.close(() => {});
          } catch {
            /* ignore */
          }
        };

        const fail = (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        };

        port.open(async (err) => {
          if (err) return fail(err);
          try {
            console.log(`[base] LoRa open ${pathName} @ ${LORA_BAUD}`);
            await configureLoraFreq(port, pathName);
            parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));
            parser.on("data", handleLine);
            serialOpen = true;
            serialPath = pathName;
            broadcast(statusSnapshot());
          } catch (e) {
            programmedPath = null;
            return fail(e);
          }
        });

        port.on("error", (e) => {
          console.log(`[base] serial error: ${e.message}`);
          programmedPath = null;
          fail(e);
        });

        port.on("close", () => {
          console.log("[base] serial closed");
          programmedPath = null;
          if (!settled) {
            settled = true;
            cleanup();
            resolve();
          }
        });
      });
    } catch (err) {
      console.log(`[base] reconnect after: ${err?.message || err}`);
      programmedPath = null;
    }

    serialOpen = false;
    broadcast(statusSnapshot());
    await sleep(RECONNECT_MS);
  }
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (_req, res) => {
  res.json({ mapboxToken: MAPBOX_TOKEN || null });
});

app.get("/api/status", (_req, res) => {
  res.json({ ...statusSnapshot(), latest });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  sseClients.push(res);
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  res.write(`data: ${JSON.stringify(statusSnapshot())}\n\n`);
  if (latest) {
    res.write(`data: ${JSON.stringify({ type: "telemetry", data: latest })}\n\n`);
  }

  req.on("close", () => {
    const i = sseClients.indexOf(res);
    if (i >= 0) sseClients.splice(i, 1);
  });
});

app.listen(HTTP_PORT, () => {
  if (SIM_MODE) {
    console.log(`[base] dashboard http://localhost:${HTTP_PORT}  mode=sim`);
    simLoop();
  } else {
    console.log(`[base] dashboard http://localhost:${HTTP_PORT}  freq=${FREQ_MHZ} MHz (ch ${FREQ_CH}) SF=${LORA_SF} pwr=${LORA_PWR}dBm`);
    serialLoop();
  }
  setInterval(() => broadcast(statusSnapshot()), 1000);
});
