#!/usr/bin/env python3
"""
Car-side telemetry transmitter for Waveshare USB-TO-LoRa (SX1262).

Collects GPS + OBD and writes newline-delimited JSON into the LoRa module's
USB serial port (stream / transparent mode). TX-only — no RX path.

  python3 transmit.py --freq 915 --lora-port /dev/ttyUSB0 --gps-port /dev/ttyUSB1
  python3 transmit.py --sim --freq 915 --lora-port /dev/ttyUSB0
"""

from __future__ import annotations

import argparse
import json
import math
import time
from typing import Optional

import serial
from serial.tools import list_ports

# Waveshare USB-TO-LoRa uses a WCH CH343 USB-UART (VID 0x1A86).
CH343_VID = 0x1A86

# HF modules: freq_MHz = 850 + channel  →  868→18, 915→65 (915 is in US 902–928)
FREQ_CHANNELS = {868: 18, 915: 65}

# Fixed air settings (Waveshare AT): SF10, BW 125 kHz, CR 4/5
LORA_SF = 10
LORA_BW_AT = 0  # 0 = 125 kHz
LORA_CR_AT = 1  # 1 = 4/5
LORA_BW_HZ = 125_000
LORA_PWR_DEFAULT = 22

# Waveshare stream mode holds a fixed 960-byte UART→RF cache (~6–10 of our lines).
# Host writes must stay ≤1 in-flight LoRa frame or RX seq lags after kill.
LORA_STREAM_CACHE_BYTES = 960
AIRTIME_MARGIN = 1.25  # module overhead vs Semtech formula

# Protocol `speed` is mph. python-obd SPEED is km/h; NMEA RMC speed is knots.
KMH_TO_MPH = 0.621371
KNOTS_TO_MPH = 1.852 * KMH_TO_MPH


def log(msg: str) -> None:
    print(f"[car] {msg}", flush=True)


def find_ch343_port(exclude: Optional[set] = None) -> Optional[str]:
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


def _drain(ser: serial.Serial, wait_s: float = 0.2) -> str:
    time.sleep(wait_s)
    chunks = []
    while ser.in_waiting:
        chunks.append(ser.read(ser.in_waiting))
        time.sleep(0.05)
    return b"".join(chunks).decode("ascii", errors="ignore")


def configure_lora_freq(ser: serial.Serial, mhz: int, pwr: int = LORA_PWR_DEFAULT) -> None:
    """Enter AT mode; set channel + fixed SF/BW/CR and TX power (HF SX1262)."""
    ch = FREQ_CHANNELS[mhz]
    log(f"programming LoRa {mhz} MHz ch={ch} SF={LORA_SF} BW=125k CR=4/5 PWR={pwr}dBm")
    time.sleep(1.2)
    ser.reset_input_buffer()
    ser.reset_output_buffer()
    ser.write(b"+++\r\n")
    ser.flush()
    _drain(ser, 0.5)
    for cmd in (
        "AT+MODE=1",
        f"AT+SF={LORA_SF}",
        f"AT+BW={LORA_BW_AT}",
        f"AT+CR={LORA_CR_AT}",
        f"AT+PWR={pwr}",
        f"AT+TXCH={ch}",
        f"AT+RXCH={ch}",
        "AT+EXIT",
    ):
        ser.write(f"{cmd}\r\n".encode("ascii"))
        ser.flush()
        _drain(ser, 0.35)
    time.sleep(2.0)
    ser.reset_input_buffer()
    ser.reset_output_buffer()
    log(f"LoRa configured: {mhz} MHz stream mode")


def clear_lora_stream_cache(ser: serial.Serial) -> None:
    """Bounce AT mode to drop the Waveshare 960-byte stream TX cache."""
    log(f"clearing LoRa stream cache (≤{LORA_STREAM_CACHE_BYTES}B)")
    time.sleep(1.2)
    ser.reset_input_buffer()
    ser.reset_output_buffer()
    ser.write(b"+++\r\n")
    ser.flush()
    _drain(ser, 0.5)
    ser.write(b"AT+EXIT\r\n")
    ser.flush()
    _drain(ser, 0.35)
    time.sleep(0.3)
    ser.reset_input_buffer()
    ser.reset_output_buffer()


def estimate_payload_bytes() -> int:
    """Typical full telemetry line length (sensors + empty MIL fields)."""
    sample = {
        "type": "tel",
        "seq": 999999,
        "ts": 1725800000,
        "lat": 38.161234,
        "lon": -122.454567,
        "speed": 120.55,
        "rpm": 6500.25,
        "coolant_temp": 92.25,
        "throttle": 55.55,
        "engine_load": 70.25,
        "fuel_level": 40.15,
        "mil": False,
        "dtcs": [],
    }
    return len(json.dumps(sample, separators=(",", ":")) + "\n")


def estimate_payload_bytes_with_dtcs(n_codes: int = 6) -> int:
    """Worst-case line after packing: all sensors + mil + code-only DTCs."""
    sample = {
        "type": "tel",
        "seq": 999999,
        "ts": 1725800000,
        "lat": 38.161234,
        "lon": -122.454567,
        "speed": 120.55,
        "rpm": 6500.25,
        "coolant_temp": 92.25,
        "throttle": 55.55,
        "engine_load": 70.25,
        "fuel_level": 40.15,
        "mil": True,
        "dtcs": [{"code": f"P0{i:03d}"} for i in range(n_codes)],
    }
    return len(pack_telemetry_line(sample).encode("utf-8"))


def pack_telemetry_line(payload: dict, max_bytes: int = 240) -> str:
    """
    Build a LoRa JSON line ≤ max_bytes.

    DTC descriptions are never sent over the air (codes only). If still over
    budget, drop secondary OBD fields, then cap the DTC list.
    """
    body = dict(payload)
    if "dtcs" in body:
        codes = []
        for item in body.get("dtcs") or []:
            if isinstance(item, dict) and item.get("code"):
                codes.append({"code": str(item["code"])})
            elif isinstance(item, str) and item:
                codes.append({"code": item})
        body["dtcs"] = codes

    def dumps(obj: dict) -> str:
        return json.dumps(obj, separators=(",", ":")) + "\n"

    line = dumps(body)
    if len(line) <= max_bytes:
        return line

    # Drop secondary sensors; keep core drive + MIL/codes
    for key in ("coolant_temp", "throttle", "engine_load", "fuel_level"):
        body.pop(key, None)
        line = dumps(body)
        if len(line) <= max_bytes:
            return line

    # Cap DTC count
    if body.get("dtcs"):
        for n in (4, 2, 1, 0):
            body["dtcs"] = body["dtcs"][:n]
            if n == 0:
                body.pop("dtcs", None)
            line = dumps(body)
            if len(line) <= max_bytes:
                return line

    # Last resort: core fields only
    core = {k: body[k] for k in ("type", "seq", "ts", "lat", "lon", "speed", "rpm", "mil") if k in body}
    return dumps(core)


def lora_airtime_s(payload_bytes: int, sf: int = LORA_SF, bw_hz: int = LORA_BW_HZ) -> float:
    """Semtech LoRa time-on-air (explicit header, CRC on, CR 4/5, 8-symbol preamble)."""
    crc, ih, de, cr, n_preamble = 1, 0, 0, 1, 8  # DE off: Tsym @ SF10/125k < 16 ms
    t_sym = (2**sf) / bw_hz
    num = 8 * payload_bytes - 4 * sf + 28 + 16 * crc - 20 * ih
    den = 4 * (sf - 2 * de)
    n_payload = 8 + max(math.ceil(num / den) * (cr + 4), 0)
    return (n_preamble + 4.25) * t_sym + n_payload * t_sym


def tx_guard_s() -> float:
    """Quiet time after TX so the next host write cannot refill the stream cache."""
    t_sym = (2**LORA_SF) / LORA_BW_HZ
    return (8 + 4.25) * t_sym + 0.25  # preamble + stream packetize / USB settle


def tx_slot_s(payload_bytes: int) -> float:
    """Minimum host gap between USB writes (1 in-flight LoRa frame)."""
    return lora_airtime_s(payload_bytes) * AIRTIME_MARGIN + tx_guard_s()


def log_link_budget(pwr: int, interval: float) -> None:
    pl = estimate_payload_bytes()
    pl_dtc = estimate_payload_bytes_with_dtcs(6)
    t_air = lora_airtime_s(pl)
    t_air_dtc = lora_airtime_s(pl_dtc)
    min_period = tx_slot_s(pl)
    min_period_dtc = tx_slot_s(pl_dtc)
    period = max(interval, min_period)
    period_dtc = max(interval, min_period_dtc)
    max_pps = 1.0 / t_air
    sust_pps = 1.0 / min_period
    log(
        f"link SF{LORA_SF}/125k/4/5 pwr={pwr}dBm | payload≈{pl}B "
        f"(with DTCs≤{pl_dtc}B after pack) | cache={LORA_STREAM_CACHE_BYTES}B | "
        f"airtime={t_air * 1000:.0f}ms / {t_air_dtc * 1000:.0f}ms w/ DTCs | "
        f"max≈{max_pps:.2f} pkt/s | sustainable≈{sust_pps:.2f} pkt/s "
        f"(margin×{AIRTIME_MARGIN}) | "
        f"tx period≥{period:.2f}s (DTCs≥{period_dtc:.2f}s, 1 in-flight)"
    )


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
        if len(parts) > 7 and parts[7]:
            try:
                out["gps_speed"] = round(float(parts[7]) * KNOTS_TO_MPH, 1)
            except ValueError:
                pass
        return out
    return out


def _load_obd():
    """Import python-obd or raise (no silent fallback)."""
    try:
        import obd
    except ImportError as exc:
        raise ImportError(
            "python-obd is required for live OBD. Install with: pip install obd"
        ) from exc
    return obd


def connect_obd(*, sim: bool, obd_port: Optional[str], obd_baud: Optional[int]):
    if sim:
        from obd_sim import OBD as SimOBD

        conn = SimOBD()
        log(f"OBD connected ({conn.protocol_name()})")
        return conn

    obd = _load_obd()
    try:
        if obd_port:
            conn = obd.OBD(obd_port, baudrate=obd_baud, fast=False, timeout=2)
        else:
            conn = obd.OBD(fast=False, timeout=2)
        if conn.is_connected():
            log(f"OBD connected ({conn.protocol_name()})")
            return conn
        conn.close()
    except Exception as exc:
        log(f"OBD connect failed: {exc}")
    return None


def read_obd(conn, *, sim: bool, include_dtc: bool = False) -> dict:
    data = {}
    if conn is None or not conn.is_connected():
        return data

    if sim:
        from obd_sim import commands
    else:
        commands = _load_obd().commands

    mapping = [
        ("speed", commands.SPEED),
        ("rpm", commands.RPM),
        ("coolant_temp", commands.COOLANT_TEMP),
        ("throttle", commands.THROTTLE_POS),
        ("engine_load", commands.ENGINE_LOAD),
        ("fuel_level", commands.FUEL_LEVEL),
    ]
    for key, cmd in mapping:
        try:
            resp = conn.query(cmd)
            if resp.value is not None:
                val = float(resp.value.magnitude)
                if key == "speed":
                    val *= KMH_TO_MPH  # python-obd / obd_sim: km/h → mph
                data[key] = round(val, 2)
        except Exception:
            pass

    if include_dtc:
        mil = False
        dtcs = []
        try:
            st = conn.query(commands.STATUS)
            if st.value is not None:
                mil = bool(getattr(st.value, "MIL", False))
        except Exception:
            pass
        try:
            resp = conn.query(commands.GET_DTC)
            if resp.value:
                for item in resp.value:
                    if isinstance(item, (list, tuple)) and item:
                        code = str(item[0])
                        desc = str(item[1]) if len(item) > 1 else ""
                        dtcs.append({"code": code, "desc": desc})
                    elif item:
                        dtcs.append({"code": str(item), "desc": ""})
        except Exception:
            pass
        if mil or dtcs:
            data["mil"] = True
            data["dtcs"] = dtcs
        else:
            data["mil"] = False
            data["dtcs"] = []

    return data


def main(args: argparse.Namespace) -> None:
    mode = "SIM OBD" if args.sim else "live OBD"
    log(f"starting TX ({mode}, {args.freq} MHz)")
    log_link_budget(args.pwr, args.interval)

    lora: Optional[serial.Serial] = None
    gps: Optional[serial.Serial] = None
    obd_conn = None
    next_obd_try = 0.0
    next_dtc_poll = 0.0
    cached_dtc = {"mil": False, "dtcs": []}
    seq = 0
    lora_programmed_port: Optional[str] = None
    next_tx_at = 0.0

    while True:
        loop_start = time.time()
        payload = {"type": "tel", "seq": seq, "ts": int(loop_start)}

        if lora is None or not lora.is_open:
            exclude = {args.gps_port, args.obd_port} - {None}
            port = args.lora_port or find_ch343_port(exclude=exclude)
            if not port:
                log("LoRa port not found; retrying")
                time.sleep(args.reconnect)
                continue
            try:
                lora = open_serial(port, args.lora_baud)
                log(f"LoRa open on {port} @ {args.lora_baud}")
                if lora_programmed_port != port:
                    configure_lora_freq(lora, args.freq, args.pwr)
                    lora_programmed_port = port
                else:
                    # Re-open after kill/disconnect: drop any leftover stream cache
                    clear_lora_stream_cache(lora)
                next_tx_at = 0.0
            except Exception as exc:
                log(f"LoRa open/config failed: {exc}")
                try:
                    if lora is not None:
                        lora.close()
                except Exception:
                    pass
                lora = None
                lora_programmed_port = None
                time.sleep(args.reconnect)
                continue

        if args.gps_port:
            if gps is None or not gps.is_open:
                try:
                    gps = open_serial(args.gps_port, args.gps_baud)
                    log(f"GPS open on {args.gps_port}")
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

        if obd_conn is None or not obd_conn.is_connected():
            if loop_start >= next_obd_try:
                obd_conn = connect_obd(
                    sim=args.sim, obd_port=args.obd_port, obd_baud=args.obd_baud
                )
                next_obd_try = loop_start + (5.0 if obd_conn is None else 0.0)

        if obd_conn is not None:
            try:
                want_dtc = loop_start >= next_dtc_poll
                payload.update(read_obd(obd_conn, sim=args.sim, include_dtc=want_dtc))
                if want_dtc:
                    cached_dtc = {
                        "mil": bool(payload.get("mil", False)),
                        "dtcs": payload.get("dtcs") or [],
                    }
                    next_dtc_poll = loop_start + 5.0
                else:
                    payload["mil"] = cached_dtc["mil"]
                    payload["dtcs"] = cached_dtc["dtcs"]
            except Exception as exc:
                log(f"OBD read error: {exc}")
                try:
                    obd_conn.close()
                except Exception:
                    pass
                obd_conn = None
                next_obd_try = loop_start + 5.0

        if "speed" not in payload and "gps_speed" in payload:
            payload["speed"] = payload.pop("gps_speed")
        else:
            payload.pop("gps_speed", None)

        line = pack_telemetry_line(payload)

        try:
            line_bytes = line.encode("utf-8")
            # Keep ≤1 frame in the module's 960B stream cache: never write early.
            wait = next_tx_at - time.time()
            if wait > 0:
                time.sleep(wait)
            wrote_at = time.time()
            lora.write(line_bytes)
            lora.flush()
            log(f"tx seq={seq} bytes={len(line_bytes)}")
            seq = (seq + 1) & 0xFFFFFFFF
            next_tx_at = wrote_at + tx_slot_s(len(line_bytes))
        except serial.SerialException as exc:
            log(f"LoRa write failed: {exc}")
            try:
                lora.close()
            except Exception:
                pass
            lora = None
            lora_programmed_port = None
            next_tx_at = 0.0
            time.sleep(args.reconnect)
            continue

        # Also honor --interval from loop start (airtime gate usually dominates at SF10)
        delay = max(next_tx_at, loop_start + args.interval) - time.time()
        if delay > 0:
            time.sleep(delay)


def parse_args(argv: Optional[list] = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="RN Racing car LoRa telemetry TX")
    p.add_argument("--sim", action="store_true", help="Use obd_sim instead of a real OBD adapter")
    p.add_argument("--freq", type=int, choices=sorted(FREQ_CHANNELS), default=915,
                   help="LoRa band MHz; programs module via AT (default: 915)")
    p.add_argument("--pwr", type=int, default=LORA_PWR_DEFAULT, choices=range(10, 23),
                   metavar="DBM",
                   help=f"LoRa TX power dBm 10–22 (default: {LORA_PWR_DEFAULT})")
    p.add_argument("--lora-port", default=None, help="USB-TO-LoRa serial device (default: auto CH343)")
    p.add_argument("--lora-baud", type=int, default=115200, help="LoRa USB baud (default: 115200)")
    p.add_argument("--gps-port", default=None, help="GPS serial device (optional)")
    p.add_argument("--gps-baud", type=int, default=9600, help="GPS baud (default: 9600)")
    p.add_argument("--obd-port", default=None, help="OBD serial device (default: auto-detect)")
    p.add_argument("--obd-baud", type=int, default=None, help="OBD baud (optional)")
    p.add_argument("--interval", type=float, default=1.0,
                   help="Minimum TX period seconds (raised automatically for SF10 airtime)")
    p.add_argument("--reconnect", type=float, default=2.0, help="Serial reconnect delay seconds")
    return p.parse_args(argv)


if __name__ == "__main__":
    main(parse_args())
