# RN Racing — Season 2

## TLDR

```bash
# --- car ---
cd car
pip install -r requirements.txt   # includes: pip install obd
python3 list_ports.py
python3 transmit.py --sim --freq 915 --pwr 22 --lora-port /dev/ttyUSB0
# Pi install: sudo bash install_service.sh   # edit ExecStart for ports/--freq/--pwr
#           journalctl -u rnr-car.service -f
#           sudo bash harden_sdcard.sh && sudo reboot
#           sudo bash unharden_sdcard.sh && sudo reboot   # before updates

# --- base_station ---
cd base_station
npm install
npm start -- --freq 915 --pwr 22 --lora-port /dev/ttyUSB1
npm run sim
# put MAPBOX_TOKEN=pk… in base_station/.env (see .env.example)
# open http://localhost:3000
```

### Dual-radio laptop harness (Linux / Windows)

Plug in **two** Waveshare USB-TO-LoRa dongles. List ports, then run car TX + base RX in separate terminals (same `--freq`).

```bash
# Linux
python3 car/list_ports.py
python3 car/transmit.py --sim --freq 915 --pwr 22 --lora-port /dev/ttyUSB0
cd base_station && npm start -- --freq 915 --pwr 22 --lora-port /dev/ttyUSB1

# Windows (COMx from list_ports / npm run list-ports; install WCH CH343 driver if ports missing)
python car/list_ports.py
python car/transmit.py --sim --freq 915 --pwr 22 --lora-port COM3
cd base_station && npm start -- --freq 915 --pwr 22 --lora-port COM5
```

LoRa telemetry between the car (Raspberry Pi) and a laptop base station using **Waveshare USB-TO-LoRa Data Transfer Module (SX1262)**.

| Side | Path | Role |
|------|------|------|
| Car | `car/` | Collect GPS + OBD, transmit over LoRa (TX only) |
| Base | `base_station/` | Receive over LoRa, Node service + simple dashboard |

Tire-pressure / OCR gauge support from Season 1 plans is **not** included.

## Protocol

Newline-delimited JSON over LoRa **stream (transparent) mode**, 115200 8N1. Example:

```json
{"type":"tel","seq":42,"ts":1725800000,"lat":38.16123,"lon":-122.45456,"speed":75,"rpm":6500,"coolant_temp":92,"throttle":55,"engine_load":70,"fuel_level":40,"mil":true,"dtcs":[{"code":"P0301","desc":"Cylinder 1 Misfire Detected"}]}
```

`speed` is mph (OBD km/h and GPS knots are converted on the car before TX). `mil` / `dtcs` come from OBD `STATUS` + `GET_DTC` (polled every ~5s on the car). Fields are omitted when a sensor is temporarily unavailable. Either side may power-cycle at any time; both ends reconnect without exiting.
