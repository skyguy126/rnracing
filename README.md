# RN Racing — Season 2

LoRa telemetry between the car (Raspberry Pi) and a laptop base station using **Waveshare USB-TO-LoRa Data Transfer Module (SX1262)**.

| Side | Path | Role |
|------|------|------|
| Car | `car/` | Collect GPS + OBD, transmit over LoRa (TX only) |
| Base | `base_station/` | Receive over LoRa, Node service + simple dashboard |

Tire-pressure / OCR gauge support from Season 1 plans is **not** included.

## Protocol

Newline-delimited JSON over LoRa **stream (transparent) mode**, 115200 8N1. Example:

```json
{"type":"tel","seq":42,"ts":1725800000,"lat":38.16123,"lon":-122.45456,"speed":120,"rpm":6500,"coolant_temp":92,"throttle":55,"engine_load":70,"fuel_level":40}
```

Fields are omitted when a sensor is temporarily unavailable. Either side may power-cycle at any time; both ends reconnect without exiting.

## Quick start

**Car (Pi):** see `car/README.md` — install systemd service, then optionally `harden_sdcard.sh`.

**Base station (laptop):** see `base_station/README.md` — `npm install && npm start`, open http://localhost:3000.

**Dual-radio laptop test (no OBD adapter):** `python3 car/transmit.py --sim --freq 915 --lora-port …` + base `npm start -- --freq 915 --lora-port …` — see `car/README.md`.
