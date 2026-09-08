#!/usr/bin/env python3
"""List serial ports (highlight likely Waveshare USB-TO-LoRa / CH343)."""

from serial.tools import list_ports

CH343_VID = 0x1A86

for p in list_ports.comports():
    vid = p.vid or 0
    hay = f"{p.description or ''} {p.manufacturer or ''}".upper()
    tag = "  <-- LoRa?" if vid == CH343_VID or "CH343" in hay or "CH340" in hay or "WCH" in hay else ""
    bits = [
        p.device,
        f"vid={vid:04X}" if p.vid else None,
        p.manufacturer,
        p.description,
    ]
    print("  ".join(x for x in bits if x) + tag)
