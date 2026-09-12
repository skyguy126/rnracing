# RN Racing — Base Station

LoRa RX from the car → live dashboard (**Waveshare USB-TO-LoRa SX1262**).

## Start

```bash
cd base_station
cp .env.example .env   # MAPBOX_TOKEN=pk…
npm install
npm run list-ports
npm run sim            # no dongle; fake telemetry
```

```bash
# Linux — use by-id from list-ports
npm start -- --freq 915 --lora-port /dev/serial/by-id/...

# Windows — use COMx from list-ports (WCH CH343 driver if none show up)
npm start -- --freq 915 --lora-port COM5
```

Open http://localhost:3000

| Flag | Default | Meaning |
|------|---------|---------|
| `--sim` | off | fake telemetry; no USB LoRa |
| `--freq` | `915` | `868` or `915` |
| `--lora-port` | auto | Linux: `/dev/serial/by-id/...`; Windows: `COMx` |
| `--port` | `3000` | HTTP port |
| `--lora-baud` | `115200` | USB baud |

`npm run list-ports` picks Windows (`list-ports-windows.js` → `COMx`) or Linux (by-id). Pi car listing stays in `car/list_ports.py`.

Car and base must share `--freq` (`868`→ch 18, `915`→ch 65).

## Behaviour

- Car → base only; serial blackouts reconnect automatically
- Each radio frame is logged like the car TX line: `rx seq=… bytes=…` (plus gap/junk)
- Dashboard: `listening` / `live` / `stale` / `offline`
- **Start / Stop capture** → CSV; **Reset** clears map path and session values

## Dual-dongle laptop test

```bash
# Linux
python3 ../car/list_ports.py
python3 ../car/transmit.py --sim --freq 915 --lora-port /dev/serial/by-id/...
npm start -- --freq 915 --lora-port /dev/serial/by-id/...

# Windows (base RX; car TX also on Windows if testing both)
npm run list-ports
npm start -- --freq 915 --lora-port COM5
```