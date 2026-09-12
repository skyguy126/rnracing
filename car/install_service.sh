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
SERVICE_USER="rnracing"
# shellcheck source=pyenv_python.sh
source "${SCRIPT_DIR}/pyenv_python.sh"

PYTHON_VERSION_FILE=""
PYTHON_VERSION_NAME=""
PYTHON="$(resolve_python)"
case "${PYTHON}" in
  *'&'*|*'\'*|'|'*)
    echo "[-] Refusing unusual python path: ${PYTHON}" >&2
    exit 1
    ;;
esac
if ! [[ -x "${PYTHON}" ]]; then
  echo "[-] Python is not executable: ${PYTHON}" >&2
  exit 1
fi
if id "${SERVICE_USER}" >/dev/null 2>&1 && ! sudo -u "${SERVICE_USER}" test -x "${PYTHON}"; then
  echo "[-] ${SERVICE_USER} cannot execute ${PYTHON}" >&2
  exit 1
fi

install_unit() {
  local name="$1"
  local src="${SCRIPT_DIR}/systemd/${name}"
  local dst="/etc/systemd/system/${name}"
  # rnr-car.service execs pyenv_python.sh, which resolves .python-version at start.
  sed -e "s|${DEFAULT_CAR}|${REPO_CAR}|g" "${src}" >"${dst}"
  chmod 644 "${dst}"
}

run_as_python_owner() {
  local owner=""
  if [[ "${PYTHON}" == /usr/bin/python3 ]]; then
    "$@"
    return
  fi
  owner="$(stat -c '%U' "${PYTHON}")"
  if [[ "${owner}" == "root" || "${owner}" == "$(id -un)" ]]; then
    "$@"
  else
    sudo -u "${owner}" -H "$@"
  fi
}

chmod +x "${SCRIPT_DIR}/bind_obd_bluetooth.sh" "${SCRIPT_DIR}/pair_obd_bluetooth.sh" "${SCRIPT_DIR}/pyenv_python.sh" "${SCRIPT_DIR}/uninstall_service.sh"

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

if [[ -n "${PYTHON_VERSION_FILE}" ]]; then
  echo "Python: ${PYTHON} (${PYTHON_VERSION_NAME} from ${PYTHON_VERSION_FILE})"
else
  echo "Python: ${PYTHON} (no .python-version in repo root)"
fi
if ! run_as_python_owner "${PYTHON}" -m pip --version >/dev/null 2>&1; then
  run_as_python_owner "${PYTHON}" -m ensurepip --upgrade
fi
run_as_python_owner "${PYTHON}" -m pip install --upgrade -r "${SCRIPT_DIR}/requirements.txt"

install_unit rnr-obd-bluetooth.service
install_unit rnr-car.service

systemctl daemon-reload
systemctl enable bluetooth.service 2>/dev/null || true
systemctl enable rnr-obd-bluetooth.service
systemctl enable rnr-car.service

# bluetoothctl power on never returns, even when hci0 is already powered.
# A oneshot then waits forever (TimeoutStartSec defaults to infinity).
echo "Starting Bluetooth OBD bind..."
if timeout 50 systemctl start rnr-obd-bluetooth.service; then
  echo "Bluetooth OBD bind: ok"
else
  echo "Bluetooth OBD bind did not finish in time."
  echo "  journalctl -u rnr-obd-bluetooth.service -n 30 --no-pager"
  echo "  sudo bash ${SCRIPT_DIR}/pair_obd_bluetooth.sh"
fi

echo "Starting rnr-car..."
if ! timeout 60 systemctl restart rnr-car.service; then
  echo "rnr-car did not finish starting — check: journalctl -u rnr-car.service -n 40 --no-pager"
fi
systemctl --no-pager --full status rnr-obd-bluetooth.service rnr-car.service || true

echo
echo "Installed. Python: ${PYTHON}"
echo "LoRa is auto-detected (the single CH343)."
echo "  GPS is optional — add --gps (the other USB serial, not the LoRa CH343):"
echo "    sudo systemctl edit --full rnr-car.service"
echo "  OBD logs:  journalctl -u rnr-obd-bluetooth.service -f"
echo "  Car logs:  journalctl -u rnr-car.service -f"
echo "  First-time OBD pair (once): sudo bash ${SCRIPT_DIR}/pair_obd_bluetooth.sh"
echo "  Uninstall:                 sudo bash ${SCRIPT_DIR}/uninstall_service.sh"
