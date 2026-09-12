#!/usr/bin/env bash
# Install car telemetry + Bluetooth OBD bind systemd units (run on the Pi with sudo).
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Usage: sudo bash $0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_CAR="${SCRIPT_DIR}"
DEFAULT_CAR="/home/rnracing/rnracing/car"

install_unit() {
  local name="$1"
  local src="${SCRIPT_DIR}/systemd/${name}"
  local dst="/etc/systemd/system/${name}"
  sed -e "s|${DEFAULT_CAR}|${REPO_CAR}|g" "${src}" >"${dst}"
  chmod 644 "${dst}"
}

chmod +x "${SCRIPT_DIR}/bind_obd_bluetooth.sh" "${SCRIPT_DIR}/pair_obd_bluetooth.sh"

# Serial + BlueZ access for the service user
if id rnracing >/dev/null 2>&1; then
  usermod -aG dialout,bluetooth rnracing || true
fi

# Ensure classic BT can come up on boot (Pi OS / BlueZ)
mkdir -p /etc/bluetooth
if [[ -f /etc/bluetooth/main.conf ]]; then
  if grep -q '^[[:space:]]*AutoEnable=' /etc/bluetooth/main.conf; then
    sed -i 's/^[[:space:]]*AutoEnable=.*/AutoEnable=true/' /etc/bluetooth/main.conf
  elif grep -q '^\[Policy\]' /etc/bluetooth/main.conf; then
    sed -i '/^\[Policy\]/a AutoEnable=true' /etc/bluetooth/main.conf
  else
    printf '\n[Policy]\nAutoEnable=true\n' >>/etc/bluetooth/main.conf
  fi
else
  printf '[Policy]\nAutoEnable=true\n' >/etc/bluetooth/main.conf
fi

python3 -m pip install --upgrade -r "${SCRIPT_DIR}/requirements.txt"

install_unit rnr-obd-bluetooth.service
install_unit rnr-car.service

systemctl daemon-reload
systemctl enable bluetooth.service 2>/dev/null || true
systemctl enable rnr-obd-bluetooth.service
systemctl enable rnr-car.service

# Bind now if MAC is configured; otherwise leave it for pair_obd_bluetooth.sh
if systemctl start rnr-obd-bluetooth.service; then
  echo "Bluetooth OBD bind: ok"
else
  echo "Bluetooth OBD bind not ready yet — pair first:"
  echo "  sudo bash ${SCRIPT_DIR}/pair_obd_bluetooth.sh"
fi

systemctl restart rnr-car.service
systemctl --no-pager --full status rnr-obd-bluetooth.service rnr-car.service || true

echo
echo "Installed."
echo "  Set the LoRa by-id path in the unit (from: python3 ${SCRIPT_DIR}/list_ports.py):"
echo "    sudo systemctl edit --full rnr-car.service"
echo "    replace REPLACE_LORA with /dev/serial/by-id/..."
echo "    GPS is optional — add --gps-port /dev/serial/by-id/... to enable"
echo "  OBD logs:  journalctl -u rnr-obd-bluetooth.service -f"
echo "  Car logs:  journalctl -u rnr-car.service -f"
echo "  First-time OBD pair (once): sudo bash ${SCRIPT_DIR}/pair_obd_bluetooth.sh"
