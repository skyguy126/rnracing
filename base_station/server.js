#!/usr/bin/env node
/**
 * Base station: read Waveshare USB-TO-LoRa (SX1262) stream mode, serve a
 * simple live dashboard. Car → base is TX-only; this process only receives.
 *
 * Serial blackouts (car or dongle power cycles) are handled by reconnecting.
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const LORA_PORT = process.env.LORA_PORT || "";
const LORA_BAUD = Number(process.env.LORA_BAUD || 115200);
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 2000);
const STALE_MS = Number(process.env.STALE_MS || 5000);
const CH343_VID = 0x1a86;

/** @type {import('express').Response[]} */
const sseClients = [];
let latest = null;
let lastRxAt = 0;
let serialPath = null;
let serialOpen = false;

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
    lastRxAt: lastRxAt || null,
    ageMs: latest ? now - lastRxAt : null,
  };
}

async function findLoraPort() {
  if (LORA_PORT) return LORA_PORT;
  const ports = await SerialPort.list();
  const hit = ports.find((p) => {
    const vid = p.vendorId ? parseInt(p.vendorId, 16) : 0;
    const hay = `${p.manufacturer || ""} ${p.friendlyName || ""} ${p.path || ""}`.toUpperCase();
    return vid === CH343_VID || hay.includes("CH343") || hay.includes("CH340") || hay.includes("WCH");
  });
  return hit?.path || null;
}

function handleLine(line) {
  const text = String(line || "").trim();
  if (!text) return;
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return; // noise / partial / AT echo — ignore
  }
  if (!msg || typeof msg !== "object") return;

  lastRxAt = Date.now();
  latest = { ...msg, _rxAt: lastRxAt };
  broadcast({ type: "telemetry", data: latest });
  broadcast(statusSnapshot());
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
          autoOpen: true,
        });

        const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

        const cleanup = () => {
          serialOpen = false;
          try {
            port.removeAllListeners();
            parser.removeAllListeners();
            if (port.isOpen) port.close(() => {});
          } catch {
            /* ignore */
          }
        };

        port.on("open", () => {
          serialOpen = true;
          serialPath = pathName;
          console.log(`[base] LoRa open ${pathName} @ ${LORA_BAUD}`);
          broadcast(statusSnapshot());
        });

        parser.on("data", handleLine);

        port.on("error", (err) => {
          console.log(`[base] serial error: ${err.message}`);
          cleanup();
          reject(err);
        });

        port.on("close", () => {
          console.log("[base] serial closed");
          cleanup();
          resolve();
        });
      });
    } catch (err) {
      console.log(`[base] reconnect after: ${err?.message || err}`);
    }

    serialOpen = false;
    broadcast(statusSnapshot());
    await sleep(RECONNECT_MS);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- HTTP --------------------------------------------------------------------

const app = express();
app.use(express.static(path.join(__dirname, "public")));

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

app.listen(PORT, () => {
  console.log(`[base] dashboard http://localhost:${PORT}`);
  serialLoop();
  setInterval(() => broadcast(statusSnapshot()), 1000);
});
