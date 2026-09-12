# RN Racing — Car (Pi)

OBD (+ optional GPS) → **Waveshare USB-TO-LoRa (SX1262)** stream mode.

## Setup (once on the Pi)

`install_service.sh` **enables and starts** `rnr-obd-bluetooth` + `rnr-car`. They also **auto-start on every reboot**. On boot, `rnr-car` starts after the Bluetooth bind, then waits 15s so the LoRa dongle and OBD adapter can enumerate. A later restart in the same boot does not wait. You do not manually run `transmit.py` for normal car use.

```bash
cd car
pip install -r requirements.txt
sudo bash pair_obd_bluetooth.sh
python3 list_bluetooth.py                  # scan ~20s, print nearby Bluetooth devices
sudo bash install_service.sh               # LoRa is the only CH343; no port to set
# optional GPS — the other USB serial (not the LoRa CH343)
sudo systemctl edit --full rnr-car.service   # add --gps
sudo systemctl restart rnr-car.service
journalctl -u rnr-obd-bluetooth.service -u rnr-car.service -f
```

```text
ExecStart=.../pyenv_python.sh .../transmit.py --freq 915
# optional GPS:  --gps
```

LoRa is discovered on each connect (do not pin `/dev/serial/by-id` — the CH343 serial string is not stable). OBD is always `/dev/obd`, a symlink the Bluetooth bind service creates onto `/dev/rfcomm0`. GPS, if `--gps` is set, is the other USB serial adapter (not the CH343, not `/dev/obd`). Omit `--gps` to run without GPS; `lat`/`lon` stay in the packet at a typical fix width. If `--gps` is set and that adapter is missing, transmit retries and does not send.


### Bluetooth OBD

| | |
|------|------|
| Scan | `python3 list_bluetooth.py` (optional seconds, default 20) |
| Once | `sudo bash pair_obd_bluetooth.sh` (adapter powered and discoverable) |
| Boot | `rnr-obd-bluetooth.service` → `/dev/rfcomm0` and symlink `/dev/obd` |
| Runtime | `transmit.py` opens `/dev/obd` (retries when the adapter powers up) |

## Flags

```bash
python3 transmit.py --help
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--freq` | `915` | `868` or `915` |
| `--gps` | off | bind the other USB serial adapter as GPS; error if it is missing |
| `--sim` | off | fake OBD (no `/dev/obd`) |
| `--interval` | `2.5` | min TX period (s) |

## Power-loss hardening

```bash
sudo bash harden_sdcard.sh && sudo reboot
# before updates:
sudo bash unharden_sdcard.sh && sudo reboot
```

## Laptop dual-radio test

Two dongles, same `--freq`. Transmit opens the only CH343 it sees, so start it with just the TX dongle plugged in, then plug in RX. Base station still takes a port (Windows: `COMx`).

```bash
python3 car/transmit.py --sim --freq 915
cd base_station && npm start -- --freq 915 --lora-port /dev/serial/by-id/...
```
