# RN Racing — Car (Pi)

Headless Raspberry Pi transmitter: GPS + OBD → **Waveshare USB-TO-LoRa (SX1262)** stream mode.

## Setup

```bash
cd car
pip install -r requirements.txt
# One-time Bluetooth OBD pair (adapter powered / in pairing mode)
sudo bash pair_obd_bluetooth.sh
sudo bash install_service.sh
```

`install_service.sh` enables `rnr-obd-bluetooth.service` (binds OBD to `/dev/obd` on boot) and `rnr-car.service`. Edit LoRa/GPS paths if needed:

```bash
sudo systemctl edit --full rnr-car.service
```

```text
ExecStart=/usr/bin/python3 .../transmit.py --freq 915 \
  --lora-port /dev/serial/by-id/...-LoRa \
  --gps-port /dev/serial/by-id/...-GPS \
  --obd-port /dev/obd
```

```bash
journalctl -u rnr-obd-bluetooth.service -u rnr-car.service -f
```

### Bluetooth OBD

Classic SPP adapters (ELM327-class). Config: `obd_bluetooth.conf` (`OBD_BT_MAC`, optional `OBD_BT_NAME` for pairing scan, default `OBDII`).

| When | What |
|------|------|
| Once | `sudo bash pair_obd_bluetooth.sh` — scan, pair, trust, write MAC, bind |
| Every boot | `rnr-obd-bluetooth.service` → `/dev/rfcomm0` + symlink `/dev/obd` |
| Runtime | `transmit.py` opens `/dev/obd` (reconnects when the adapter powers up with ignition) |

If the advertised name is not `OBDII`, set `OBD_BT_NAME` before pairing, or set `OBD_BT_MAC` by hand and run `sudo bash bind_obd_bluetooth.sh`.

## Flags

```bash
python3 transmit.py --help
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--freq` | `915` | `868` or `915` — programs LoRa via AT |
| `--lora-port` | auto CH343 | USB-TO-LoRa device |
| `--gps-port` | required* | GPS serial device (*optional with `--sim`) |
| `--obd-port` | auto | OBD serial device (`/dev/obd` on the Pi; ignored with `--sim`) |
| `--sim` | off | Fake OBD; GPS optional |
| `--interval` | `2.5` | Min TX period seconds (raised for SF10 airtime) |

## Power-loss hardening

```bash
sudo bash harden_sdcard.sh && sudo reboot
# before updates:
sudo bash unharden_sdcard.sh && sudo reboot
```

## Laptop dual-radio test

Two USB-TO-LoRa dongles + `--sim` OBD. Same `--freq` on car and base; pass explicit ports.

```bash
# Linux
python3 car/list_ports.py
python3 car/transmit.py --sim --freq 915 --lora-port /dev/ttyUSB0
cd base_station && npm start -- --freq 915 --lora-port /dev/ttyUSB1

# Windows — COMx from list_ports (install WCH CH343 driver if ports missing)
python car/list_ports.py
python car/transmit.py --sim --freq 915 --lora-port COM3
cd base_station && npm start -- --freq 915 --lora-port COM5
```
