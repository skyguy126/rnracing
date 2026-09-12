# RN Racing — Car (Pi)

GPS + OBD → **Waveshare USB-TO-LoRa (SX1262)** stream mode.

## Setup

```bash
cd car
pip install -r requirements.txt
sudo bash pair_obd_bluetooth.sh
sudo bash install_service.sh
python3 list_ports.py
sudo systemctl edit --full rnr-car.service   # set REPLACE_LORA / REPLACE_GPS
```

```text
ExecStart=.../transmit.py --freq 915 \
  --lora-port /dev/serial/by-id/... \
  --gps-port /dev/serial/by-id/... \
  --obd-port /dev/obd
```

```bash
journalctl -u rnr-obd-bluetooth.service -u rnr-car.service -f
```

USB LoRa/GPS must use `/dev/serial/by-id/...` (not `/dev/ttyUSB*`). OBD is `/dev/obd` via Bluetooth bind.

### Bluetooth OBD

| Once | `sudo bash pair_obd_bluetooth.sh` (config: `obd_bluetooth.conf`) |
|------|------|
| Boot | `rnr-obd-bluetooth.service` → `/dev/rfcomm0` + `/dev/obd` |
| Runtime | `transmit.py --obd-port /dev/obd` (retries when adapter powers up) |

If the name is not `OBDII`, set `OBD_BT_NAME` or `OBD_BT_MAC` in the conf before pairing/bind.

## Flags

```bash
python3 transmit.py --help
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--freq` | `915` | `868` or `915` |
| `--lora-port` | auto CH343 | prefer `/dev/serial/by-id/...` |
| `--gps-port` | required* | prefer `/dev/serial/by-id/...` (*optional with `--sim`) |
| `--obd-port` | auto | `/dev/obd` on Pi; ignored with `--sim` |
| `--sim` | off | fake OBD; GPS optional |
| `--interval` | `2.5` | min TX period (s) |

## Power-loss hardening

```bash
sudo bash harden_sdcard.sh && sudo reboot
# before updates:
sudo bash unharden_sdcard.sh && sudo reboot
```

## Laptop dual-radio test

Two dongles, same `--freq`. Copy by-id paths from `list_ports.py` (Windows: `COMx`).

```bash
python3 car/list_ports.py
python3 car/transmit.py --sim --freq 915 --lora-port /dev/serial/by-id/...
cd base_station && npm start -- --freq 915 --lora-port /dev/serial/by-id/...
```
