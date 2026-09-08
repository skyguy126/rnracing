# RN Racing — Base Station

Receives car telemetry over a **Waveshare USB-TO-LoRa (SX1262)** dongle and serves a simple live dashboard.

## Start

```bash
cd base_station
npm install
npm start -- --freq 915 --lora-port /dev/ttyUSB1
# Windows: npm start -- --freq 915 --lora-port COM5
```

Open **http://localhost:3000**

```bash
node server.js --help
npm run list-ports
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--freq` | `915` | `868` or `915` — programs LoRa via AT |
| `--lora-port` | auto | USB-TO-LoRa device |
| `--port` | `3000` | HTTP dashboard port |
| `--lora-baud` | `115200` | USB baud |

Car and base must use the **same** `--freq` (`868`→ch 18, `915`→ch 65).

## Behaviour

- Car → base only.
- Serial blackouts reconnect automatically.
- Dashboard: `listening` / `live` / `stale` / `offline`.
- **Start / Stop capture** downloads a CSV of buffered telemetry.

## Dual-dongle laptop test

```bash
python3 ../car/list_ports.py
python3 ../car/transmit.py --sim --freq 915 --lora-port /dev/ttyUSB0
npm start -- --freq 915 --lora-port /dev/ttyUSB1
```
