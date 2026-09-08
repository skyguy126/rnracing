#!/usr/bin/env python3
"""
Laptop harness: fake OBD + GPS → one Waveshare USB-TO-LoRa (SX1262) dongle.

Plug both radios into the laptop. Point this script at the TX dongle and the
base station at the RX dongle.

  python3 car/list_ports.py
  LORA_PORT=/dev/ttyUSB0 python3 car/sim_transmit.py
  LORA_PORT=/dev/ttyUSB1 npm start   # in base_station/
"""

from __future__ import annotations

import json
import math
import os
import time

import serial
from serial.tools import list_ports

LORA_PORT = os.getenv("LORA_PORT")
LORA_BAUD = int(os.getenv("LORA_BAUD", "115200"))
TX_INTERVAL_SEC = float(os.getenv("TX_INTERVAL_SEC", "1.0"))
RECONNECT_SEC = float(os.getenv("RECONNECT_SEC", "2.0"))
CH343_VID = 0x1A86

# Sonoma Raceway-ish starting point; drifts slowly so the GPS line changes.
BASE_LAT = 38.1612
BASE_LON = -122.4546


def log(msg: str) -> None:
    print(f"[sim] {msg}", flush=True)


def ch343_ports():
    out = []
    for p in list_ports.comports():
        vid = p.vid or 0
        hay = f"{p.description or ''} {p.manufacturer or ''}".upper()
        if vid == CH343_VID or "CH343" in hay or "CH340" in hay or "WCH" in hay:
            out.append(p.device)
    return out


def fake_telemetry(seq: int, t0: float) -> dict:
    t = time.time() - t0
    # Smooth sweep so you can see the dashboard update
    speed = 80 + 40 * math.sin(t / 8.0)
    rpm = 2500 + 2000 * (0.5 + 0.5 * math.sin(t / 3.0))
    throttle = 30 + 40 * (0.5 + 0.5 * math.sin(t / 4.0))
    return {
        "type": "tel",
        "seq": seq,
        "ts": int(time.time()),
        "lat": round(BASE_LAT + 0.00015 * math.sin(t / 20.0), 6),
        "lon": round(BASE_LON + 0.0002 * math.cos(t / 25.0), 6),
        "speed": round(speed, 1),
        "rpm": round(rpm, 0),
        "coolant_temp": round(85 + 8 * math.sin(t / 60.0), 1),
        "throttle": round(throttle, 1),
        "engine_load": round(40 + 30 * (0.5 + 0.5 * math.sin(t / 5.0)), 1),
        "fuel_level": round(max(5.0, 70 - t / 120.0), 1),
    }


def main() -> None:
    port = LORA_PORT
    if not port:
        found = ch343_ports()
        if not found:
            log("no LoRa serial port found; set LORA_PORT")
            raise SystemExit(1)
        if len(found) > 1:
            log(f"multiple CH343 ports {found} — set LORA_PORT to the TX dongle")
            raise SystemExit(1)
        port = found[0]

    log(f"TX on {port} @ {LORA_BAUD} (fake OBD/GPS)")
    t0 = time.time()
    seq = 0
    ser = None

    while True:
        try:
            if ser is None or not ser.is_open:
                ser = serial.Serial(port, LORA_BAUD, timeout=0.5, write_timeout=2)
                ser.reset_output_buffer()
                log(f"open {port}")

            payload = fake_telemetry(seq, t0)
            line = json.dumps(payload, separators=(",", ":")) + "\n"
            ser.write(line.encode("utf-8"))
            ser.flush()
            log(
                f"tx seq={seq} speed={payload['speed']} rpm={payload['rpm']} "
                f"lat={payload['lat']} lon={payload['lon']}"
            )
            seq = (seq + 1) & 0xFFFFFFFF
            time.sleep(TX_INTERVAL_SEC)
        except serial.SerialException as exc:
            log(f"serial error: {exc}")
            try:
                if ser is not None:
                    ser.close()
            except Exception:
                pass
            ser = None
            time.sleep(RECONNECT_SEC)
        except KeyboardInterrupt:
            log("stop")
            break


if __name__ == "__main__":
    main()
