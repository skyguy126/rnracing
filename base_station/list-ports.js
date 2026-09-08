#!/usr/bin/env node
import { SerialPort } from "serialport";

const ports = await SerialPort.list();
if (!ports.length) {
  console.log("No serial ports found.");
  process.exit(0);
}
for (const p of ports) {
  console.log(
    [
      p.path,
      p.vendorId ? `vid=${p.vendorId}` : null,
      p.productId ? `pid=${p.productId}` : null,
      p.manufacturer || null,
      p.friendlyName || p.serialNumber || null,
    ]
      .filter(Boolean)
      .join("  ")
  );
}
