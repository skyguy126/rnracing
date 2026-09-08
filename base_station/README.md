# RN Racing — Base Station

Receives car telemetry over a **Waveshare USB-TO-LoRa (SX1262)** dongle (stream / transparent mode) and serves a simple live dashboard.

## Prerequisites

- Node.js 18+ (20+ recommended)
- USB-TO-LoRa module plugged into this machine (same AT settings as the car module)

## One-time LoRa pairing

Both dongles must share SF / BW / channel / NETID / ADDR (factory defaults usually already match). For North America 915 MHz on HF modules:

```text
+++          (enter AT mode; wait ~1s quiet before/after)
AT+MODE=1
AT+SF=7
AT+BW=0
AT+TXCH=65
AT+RXCH=65
AT+NETID=0
AT+ADDR=0
AT+BAUD=115200
AT+EXIT
```

Use any serial terminal at **115200 8N1**, with CR+LF line endings. See [Waveshare USB-TO-LoRa-xF wiki](https://www.waveshare.com/wiki/USB-TO-LoRa-xF).

## Start

```bash
cd base_station
npm install
npm start
```

Open **http://localhost:3000**

### Optional env vars

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `3000` | HTTP port for the dashboard |
| `LORA_PORT` | auto (CH343) | Serial device path |
| `LORA_BAUD` | `115200` | Must match module UART baud |
| `RECONNECT_MS` | `2000` | Delay between serial reopen attempts |
| `STALE_MS` | `5000` | Age after which UI shows `stale` |

List ports if auto-detect picks the wrong device:

```bash
npm run list-ports
LORA_PORT=/dev/ttyUSB0 npm start          # Linux / macOS
set LORA_PORT=COM5&& npm start            # Windows cmd
```

## Behaviour

- Car → base only (this side never transmits telemetry commands).
- If the car or USB dongle power-cycles, the service keeps running and reopens the serial port.
- Dashboard link states: `listening` → `live` → `stale` → `offline`.
- **Start capture / Stop capture** buffers live telemetry in the browser; stopping downloads a CSV (`iso_time`, seq, GPS, OBD fields).

## Dual-dongle laptop test

With both radios on this machine, set `LORA_PORT` explicitly so TX and RX do not claim the same device. Fake car TX:

```bash
python3 ../car/list_ports.py
LORA_PORT=/dev/ttyUSB0 python3 ../car/sim_transmit.py   # other terminal
LORA_PORT=/dev/ttyUSB1 npm start
```

See `car/README.md` for the full steps.
