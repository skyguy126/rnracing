#!/usr/bin/env node
/**
 * Windows serial port listing for the base station.
 * Use the COMx path with: npm start -- --lora-port COMx
 * If no ports appear for a Waveshare dongle, install the WCH CH343 driver.
 */
import { SerialPort } from "serialport";

const CH343_VID = 0x1a86;

const ports = await SerialPort.list();
if (!ports.length) {
  console.log("No serial ports found.");
  console.log("If a Waveshare USB-TO-LoRa is plugged in, install the WCH CH343 driver, then replug.");
  process.exit(0);
}

for (const p of ports) {
  const vid = p.vendorId ? parseInt(p.vendorId, 16) : 0;
  const hay = `${p.manufacturer || ""} ${p.friendlyName || ""} ${p.pnpId || ""}`.toUpperCase();
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
