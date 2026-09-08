# RN Racing — Car (Pi)

Headless Raspberry Pi transmitter: GPS + OBD → **Waveshare USB-TO-LoRa (SX1262)** stream mode.

## Setup

```bash
cd car
sudo bash install_service.sh
```

That installs Python deps and enables `rnr-car.service`. Edit the unit `ExecStart=` flags for your ports (prefer `/dev/serial/by-id/...`):

```bash
sudo systemctl edit --full rnr-car.service
```

```text
ExecStart=/usr/bin/python3 .../transmit.py --freq 915 \
  --lora-port /dev/serial/by-id/...-LoRa \
  --gps-port /dev/serial/by-id/...-GPS \
  --obd-port /dev/serial/by-id/...-OBD
```

```bash
journalctl -u rnr-car.service -f
```

## Flags

```bash
python3 transmit.py --help
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--freq` | `915` | `868` or `915` — programs LoRa via AT |
| `--lora-port` | auto CH343 | USB-TO-LoRa device |
| `--gps-port` | off | GPS serial device |
| `--obd-port` | auto | OBD adapter (ignored with `--sim`) |
| `--sim` | off | Use `obd_sim` instead of a real OBD adapter |
| `--interval` | `1` | TX period (seconds) |

## Power-loss hardening

```bash
sudo bash harden_sdcard.sh && sudo reboot
# before updates:
sudo bash unharden_sdcard.sh && sudo reboot
```

## Laptop dual-radio test

```bash
python3 car/list_ports.py
python3 car/transmit.py --sim --freq 915 --lora-port /dev/ttyUSB0
cd base_station && npm start -- --freq 915 --lora-port /dev/ttyUSB1
```
