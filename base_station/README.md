# RN Racing — Base Station

Receives car telemetry over a **Waveshare USB-TO-LoRa (SX1262)** dongle and serves a simple live dashboard.

## Start

```bash
cd base_station
cp .env.example .env   # paste MAPBOX_TOKEN=pk…
npm install
npm start -- --freq 915 --lora-port /dev/ttyUSB1
# Windows: npm start -- --freq 915 --lora-port COM5

# no USB dongle — fake telemetry (GPS walks in a circle)
npm run sim
```

Open **http://localhost:3000**

```bash
node server.js --help
npm run list-ports
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--sim` | off | Fake telemetry; no USB LoRa (GPS circle) |
| `--freq` | `915` | `868` or `915` — programs LoRa via AT |
| `--lora-port` | auto | USB-TO-LoRa device (`/dev/ttyUSB*` or `COMx`) |
| `--port` | `3000` | HTTP dashboard port |
| `--lora-baud` | `115200` | USB baud |

Mapbox: set `MAPBOX_TOKEN` in `.env` (see `.env.example`).

Car and base must use the **same** `--freq` (`868`→ch 18, `915`→ch 65).

## Behaviour

- Car → base only.
- Serial blackouts reconnect automatically.
- Dashboard: `listening` / `live` / `stale` / `offline`.
- **Start / Stop capture** downloads a CSV of buffered telemetry.
- **Reset** clears the map path, capture buffer, and on-screen session values.
- Mapbox path map needs `MAPBOX_TOKEN` in `.env`.

## Dual-dongle laptop test

Two USB-TO-LoRa dongles, same `--freq`. Pass explicit ports (auto-detect is ambiguous with two CH343s).

```bash
# Linux
python3 ../car/list_ports.py
python3 ../car/transmit.py --sim --freq 915 --lora-port /dev/ttyUSB0
npm start -- --freq 915 --lora-port /dev/ttyUSB1

# Windows — COMx from list_ports / npm run list-ports (WCH CH343 driver if needed)
python ../car/list_ports.py
python ../car/transmit.py --sim --freq 915 --lora-port COM3
npm start -- --freq 915 --lora-port COM5
npm run list-ports
```