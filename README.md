# RN Racing — Season 2

LoRa telemetry from the car (Raspberry Pi) to a laptop base station using **Waveshare USB-TO-LoRa (SX1262)**.

| Side | Path | Role |
|------|------|------|
| Car | [`car/`](car/) | GPS + OBD → LoRa TX |
| Base | [`base_station/`](base_station/) | LoRa RX → Node dashboard |

Car and base must use the **same** `--freq`. List ports with `python3 car/list_ports.py` or `npm run list-ports` in `base_station/`. Both ends reconnect after power-cycle. Tire-pressure / OCR from Season 1 is **not** included.

## Car

### First-time setup

```bash
cd car
pip install -r requirements.txt
# Pi only — enables rnr-car.service; edit ExecStart for ports/--freq/--pwr
sudo bash install_service.sh
```

Optional on the Pi: `sudo bash harden_sdcard.sh && sudo reboot` (run `unharden_sdcard.sh` before updates). More detail in [`car/README.md`](car/README.md).

### Running

```bash
# Sim (fake OBD; laptop dual-dongle or bench test)
python3 transmit.py --sim --freq 915 --pwr 22 --lora-port /dev/ttyUSB0

# Regular (real GPS + OBD)
python3 transmit.py --freq 915 --pwr 22 \
  --lora-port /dev/serial/by-id/...-LoRa \
  --gps-port /dev/serial/by-id/...-GPS \
  --obd-port /dev/serial/by-id/...-OBD
```

On the Pi after `install_service.sh`: `journalctl -u rnr-car.service -f`

## Base station

### First-time setup

```bash
cd base_station
cp .env.example .env   # set MAPBOX_TOKEN=pk…
npm install
```

### Running

```bash
# Sim (no USB dongle; fake telemetry)
npm run sim

# Regular (USB-TO-LoRa RX)
npm start -- --freq 915 --pwr 22 --lora-port /dev/ttyUSB1
```

Open http://localhost:3000 — more detail in [`base_station/README.md`](base_station/README.md).

## Protocol

Newline-delimited JSON over LoRa stream mode, 115200 8N1:

```json
{"type":"tel","seq":42,"ts":1725800000,"lat":38.16123,"lon":-122.45456,"speed":75,"rpm":6500,"coolant_temp":92,"throttle":55,"engine_load":70,"fuel_level":40,"mil":true,"dtcs":[{"code":"P0301","desc":"Cylinder 1 Misfire Detected"}]}
```

`speed` is mph (converted on the car). `mil` / `dtcs` from OBD, polled ~every 5s. Unavailable fields are omitted.

## Link rate (SF10 / 125 kHz / 4/5)

TX period is `max(--interval, airtime×1.75 + guard)` (default `--interval` 2.5 s).

| Packet | Size | On-air | Host period | Rate |
|--------|------|--------|-------------|------|
| Typical telemetry | ~206 B | ~1.9 s | ~3.8 s | ~0.26 pkt/s |
| Capped w/ DTCs | ≤240 B | ~2.2 s | ~4.3 s | ~0.23 pkt/s |
