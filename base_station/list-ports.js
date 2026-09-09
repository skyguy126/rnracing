#!/usr/bin/env node
import { SerialPort } from "serialport";

const CH343_VID = 0x1a86;

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
  console.log(
    [
      p.path,
      p.vendorId ? `vid=${p.vendorId}` : null,
      p.productId ? `pid=${p.productId}` : null,
      p.manufacturer || null,
      p.friendlyName || p.serialNumber || null,
    ]
      .filter(Boolean)
      .join("  ") + tag
  );
}
