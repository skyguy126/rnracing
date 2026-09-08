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

## TLDR

```bash
# dual-radio laptop test
python3 car/list_ports.py
python3 car/transmit.py --sim --freq 915 --pwr 22 --lora-port /dev/ttyUSB0
cd base_station && npm install && npm start -- --freq 915 --pwr 22 --lora-port /dev/ttyUSB1
# open http://localhost:3000

# car (Pi)
cd car && sudo bash install_service.sh   # then edit ExecStart ports/--freq/--pwr
journalctl -u rnr-car.service -f
sudo bash harden_sdcard.sh && sudo reboot
sudo bash unharden_sdcard.sh && sudo reboot   # before updates
```
