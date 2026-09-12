#!/usr/bin/env node
/**
 * List USB-TO-LoRa serial ports for the base station laptop.
 * Windows → COMx via list-ports-windows.js
 * Linux/macOS → /dev/serial/by-id/... when available
 *
 * Pi car ports: python3 ../car/list_ports.py
 */
import fs from "fs";
import path from "path";
import { SerialPort } from "serialport";

if (process.platform === "win32") {
  await import("./list-ports-windows.js");
  process.exit(0);
}

const CH343_VID = 0x1a86;
const BY_ID_DIR = "/dev/serial/by-id";

function byIdFor(devicePath) {
  if (!devicePath || !fs.existsSync(BY_ID_DIR)) return null;
  let target;
  try {
    target = fs.realpathSync(devicePath);
  } catch {
    return null;
  }
  for (const name of fs.readdirSync(BY_ID_DIR).sort()) {
    const link = path.join(BY_ID_DIR, name);
    try {
      if (fs.realpathSync(link) === target) return link;
    } catch {
      /* skip */
    }
  }
  return null;
}

const ports = await SerialPort.list();
if (!ports.length) {
  console.log("No serial ports found.");
  process.exit(0);
}
for (const p of ports) {
  const vid = p.vendorId ? parseInt(p.vendorId, 16) : 0;
  const hay = `${p.manufacturer || ""} ${p.friendlyName || ""} ${p.path || ""}`.toUpperCase();
  const tag =
    vid === CH343_VID || hay.includes("CH343") || hay.includes("CH340") || hay.includes("WCH")
      ? "  <-- LoRa?"
      : "";
  const stable = byIdFor(p.path);
  console.log(
    [
      stable || p.path,
      stable ? `(${p.path})` : null,
      p.vendorId ? `vid=${p.vendorId}` : null,
      p.productId ? `pid=${p.productId}` : null,
      p.manufacturer || null,
      p.friendlyName || p.serialNumber || null,
    ]
      .filter(Boolean)
      .join("  ") + tag
  );
}
