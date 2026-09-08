# RN Racing — Car (Pi)

Headless Raspberry Pi transmitter: GPS + OBD → **Waveshare USB-TO-LoRa (SX1262)** stream mode.

## Setup

```bash
cd car
sudo bash install_service.sh
```

That installs Python deps and enables `rnr-car.service` (auto-restart on boot / crash).

Set serial paths (recommended via `/dev/serial/by-id/...`) by editing the unit or dropping an env file:

```bash
sudo systemctl edit rnr-car.service
```

```ini
[Service]
Environment=LORA_PORT=/dev/serial/by-id/usb-...-LoRa
Environment=GPS_PORT=/dev/serial/by-id/usb-...-GPS
Environment=OBD_PORT=/dev/serial/by-id/usb-...-OBD
```

Logs:

```bash
journalctl -u rnr-car.service -f
```

## Power-loss hardening

After the service is working, harden the SD card:

```bash
sudo bash harden_sdcard.sh
sudo reboot
```

## LoRa notes

Module is TX-only from software’s perspective. Configure AT parameters once to match the base station (see `base_station/README.md`). Default stream mode at 115200 baud; payload is one JSON line per second, kept ≤240 bytes when possible (SX1262 single-packet size).
