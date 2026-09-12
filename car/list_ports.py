#!/usr/bin/env python3
"""List serial ports with stable /dev/serial/by-id paths when available."""

from pathlib import Path

from serial.tools import list_ports

CH343_VID = 0x1A86
BY_ID_DIR = Path("/dev/serial/by-id")
# Always present on the Pi with GPS unplugged. A new line is the GPS module.
IGNORE = {"ttyS0", "ttyAMA0", "serial0"}


def by_id_for(device: str) -> str | None:
    if not BY_ID_DIR.is_dir():
        return None
    try:
        target = Path(device).resolve()
    except OSError:
        return None
    for link in sorted(BY_ID_DIR.iterdir()):
        try:
            if link.resolve() == target:
                return str(link)
        except OSError:
            continue
    return None


for p in list_ports.comports():
    vid = p.vid or 0
    name = Path(p.device).name
    hay = f"{p.description or ''} {p.manufacturer or ''}".upper()
    if vid == CH343_VID or "CH343" in hay or "CH340" in hay or "WCH" in hay:
        tag = "  <-- LoRa"
    elif name.startswith("rfcomm") or name in IGNORE or p.device == "/dev/obd":
        tag = ""
    else:
        tag = "  <-- GPS"
    stable = by_id_for(p.device)
    primary = stable or p.device
    bits = [
        primary,
        f"({p.device})" if stable else None,
        f"vid={vid:04X}" if p.vid else None,
        p.manufacturer,
        p.description,
    ]
    print("  ".join(x for x in bits if x) + tag)
