#!/usr/bin/env python3
"""
Car-side telemetry transmitter for Waveshare USB-TO-LoRa (SX1262).

Collects GPS + OBD and writes newline-delimited JSON into the LoRa module's
USB serial port (stream / transparent mode). TX-only — no RX path.

Handles intermittent power / USB blackouts by reopening serial devices
in the main loop instead of exiting.
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional

import serial
from serial.tools import list_ports

try:
    import obd
except ImportError:  # allow GPS-only bring-up without python-obd installed
    obd = None


# --- config (override via env) ------------------------------------------------

LORA_PORT = os.getenv("LORA_PORT")  # e.g. /dev/ttyUSB0 or by-id path
LORA_BAUD = int(os.getenv("LORA_BAUD", "115200"))

GPS_PORT = os.getenv("GPS_PORT")
GPS_BAUD = int(os.getenv("GPS_BAUD", "9600"))

OBD_PORT = os.getenv("OBD_PORT")  # None = auto / skip if unavailable
OBD_BAUD = os.getenv("OBD_BAUD")  # optional int as string

TX_INTERVAL_SEC = float(os.getenv("TX_INTERVAL_SEC", "1.0"))
RECONNECT_SEC = float(os.getenv("RECONNECT_SEC", "2.0"))

# Waveshare USB-TO-LoRa uses a WCH CH343 USB-UART (VID 0x1A86).
CH343_VID = 0x1A86


# --- helpers ------------------------------------------------------------------

def log(msg: str) -> None:
    print(f"[car] {msg}", flush=True)


def find_ch343_port(exclude: Optional[set] = None) -> Optional[str]:
    """Pick the first CH343 / Waveshare-looking USB serial device."""
    exclude = exclude or set()
    for p in list_ports.comports():
        if p.device in exclude:
            continue
        vid = p.vid or 0
        desc = (p.description or "").upper()
        mfg = (p.manufacturer or "").upper()
        if vid == CH343_VID or "CH343" in desc or "CH340" in desc or "WCH" in mfg:
            return p.device
    return None


def open_serial(path: str, baud: int) -> serial.Serial:
    ser = serial.Serial(path, baud, timeout=0.5, write_timeout=2)
    ser.reset_input_buffer()
    ser.reset_output_buffer()
    return ser


def nmea_to_decimal(coord_str: str, direction: str) -> Optional[float]:
    if not coord_str or not direction or len(coord_str) < 4:
        return None
    deg_len = 2 if direction in ("N", "S") else 3
    try:
        degrees = int(coord_str[:deg_len])
        minutes = float(coord_str[deg_len:])
    except ValueError:
        return None
    decimal = degrees + minutes / 60.0
    if direction in ("S", "W"):
        decimal = -decimal
    return decimal


def read_gps_fix(ser: serial.Serial, deadline: float) -> dict:
    """Read until a valid RMC fix or deadline. Returns lat/lon keys if found."""
    out = {}
    while time.time() < deadline:
        try:
            raw = ser.readline()
        except serial.SerialException:
            raise
        if not raw:
            continue
        line = raw.decode("ascii", errors="ignore").strip()
        if not (line.startswith("$GPRMC") or line.startswith("$GNRMC")):
            continue
        parts = line.split(",")
        if len(parts) < 7 or parts[2] != "A":
            continue
        lat = nmea_to_decimal(parts[3], parts[4])
        lon = nmea_to_decimal(parts[5], parts[6])
        if lat is None or lon is None:
            continue
        out["lat"] = round(lat, 6)
        out["lon"] = round(lon, 6)
        # optional ground speed (knots -> km/h) if present
        if len(parts) > 7 and parts[7]:
            try:
                out["gps_speed"] = round(float(parts[7]) * 1.852, 1)
            except ValueError:
                pass
        return out
    return out


def connect_obd():
    if obd is None:
        return None
    baud = int(OBD_BAUD) if OBD_BAUD else None
    try:
        if OBD_PORT:
            conn = obd.OBD(OBD_PORT, baudrate=baud, fast=False, timeout=2)
        else:
            conn = obd.OBD(fast=False, timeout=2)
        if conn.is_connected():
            log(f"OBD connected ({conn.protocol_name()})")
            return conn
        conn.close()
    except Exception as exc:
        log(f"OBD connect failed: {exc}")
    return None


def read_obd(conn) -> dict:
    data = {}
    if conn is None or not conn.is_connected():
        return data

    mapping = [
        ("speed", obd.commands.SPEED),
        ("rpm", obd.commands.RPM),
        ("coolant_temp", obd.commands.COOLANT_TEMP),
        ("throttle", obd.commands.THROTTLE_POS),
        ("engine_load", obd.commands.ENGINE_LOAD),
        ("fuel_level", obd.commands.FUEL_LEVEL),
    ]
    for key, cmd in mapping:
        try:
            resp = conn.query(cmd)
            if resp.value is not None:
                data[key] = round(float(resp.value.magnitude), 2)
        except Exception:
            pass
    return data


# --- main loop ----------------------------------------------------------------

def main() -> None:
    log("starting TX (SX1262 USB-TO-LoRa stream mode)")

    lora: Optional[serial.Serial] = None
    gps: Optional[serial.Serial] = None
    obd_conn = None
    next_obd_try = 0.0
    seq = 0

    while True:
        loop_start = time.time()
        payload = {"type": "tel", "seq": seq, "ts": int(loop_start)}

        # --- LoRa open --------------------------------------------------------
        if lora is None or not lora.is_open:
            exclude = {GPS_PORT, OBD_PORT} - {None}
            port = LORA_PORT or find_ch343_port(exclude=exclude)
            if not port:
                log("LoRa port not found; retrying")
                time.sleep(RECONNECT_SEC)
                continue
            try:
                lora = open_serial(port, LORA_BAUD)
                log(f"LoRa open on {port} @ {LORA_BAUD}")
            except serial.SerialException as exc:
                log(f"LoRa open failed: {exc}")
                lora = None
                time.sleep(RECONNECT_SEC)
                continue

        # --- GPS open / read --------------------------------------------------
        if GPS_PORT:
            if gps is None or not gps.is_open:
                try:
                    gps = open_serial(GPS_PORT, GPS_BAUD)
                    log(f"GPS open on {GPS_PORT}")
                except serial.SerialException as exc:
                    log(f"GPS open failed: {exc}")
                    gps = None

            if gps is not None:
                try:
                    fix = read_gps_fix(gps, deadline=loop_start + 0.4)
                    payload.update(fix)
                except serial.SerialException as exc:
                    log(f"GPS read error: {exc}")
                    try:
                        gps.close()
                    except Exception:
                        pass
                    gps = None

        # --- OBD (backoff so a missing adapter cannot stall TX) ---------------
        if obd_conn is None or not obd_conn.is_connected():
            if loop_start >= next_obd_try:
                obd_conn = connect_obd()
                next_obd_try = loop_start + (5.0 if obd_conn is None else 0.0)

        if obd_conn is not None:
            try:
                payload.update(read_obd(obd_conn))
            except Exception as exc:
                log(f"OBD read error: {exc}")
                try:
                    obd_conn.close()
                except Exception:
                    pass
                obd_conn = None
                next_obd_try = loop_start + 5.0

        # Prefer OBD road speed; fall back to GPS-derived if present
        if "speed" not in payload and "gps_speed" in payload:
            payload["speed"] = payload.pop("gps_speed")
        else:
            payload.pop("gps_speed", None)

        # --- TX ---------------------------------------------------------------
        line = json.dumps(payload, separators=(",", ":")) + "\n"
        if len(line) > 240:
            # SX1262 firmware auto-splits >240B; keep single air packet when possible
            line = json.dumps(
                {k: payload[k] for k in ("type", "seq", "ts", "lat", "lon", "speed", "rpm") if k in payload},
                separators=(",", ":"),
            ) + "\n"

        try:
            lora.write(line.encode("utf-8"))
            lora.flush()
            log(f"tx seq={seq} bytes={len(line)-1}")
            seq = (seq + 1) & 0xFFFFFFFF
        except serial.SerialException as exc:
            log(f"LoRa write failed: {exc}")
            try:
                lora.close()
            except Exception:
                pass
            lora = None
            time.sleep(RECONNECT_SEC)
            continue

        # pace the loop
        elapsed = time.time() - loop_start
        delay = TX_INTERVAL_SEC - elapsed
        if delay > 0:
            time.sleep(delay)


if __name__ == "__main__":
    main()
