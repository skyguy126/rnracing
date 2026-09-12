#!/usr/bin/env bash
# One-time: pair and trust the Bluetooth OBD adapter at OBD_BT_MAC.
# That address is a classic BD_ADDR and does not change for this adapter.
# After this, bind_obd_bluetooth.sh / the systemd unit keep /dev/rfcomm0
# (+ /dev/obd) ready across reboots.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${OBD_BT_CONF:-${SCRIPT_DIR}/obd_bluetooth.conf}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Usage: sudo bash $0" >&2
  exit 1
fi

if [[ ! -f "${CONF}" ]]; then
  echo "Missing config: ${CONF}" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${CONF}"

: "${OBD_BT_MAC:?Set OBD_BT_MAC in ${CONF}}"

MAC="$(echo "${OBD_BT_MAC}" | tr '[:lower:]' '[:upper:]')"
if [[ ! "${MAC}" =~ ^([0-9A-F]{2}:){5}[0-9A-F]{2}$ ]]; then
  echo "Invalid OBD_BT_MAC='${OBD_BT_MAC}' in ${CONF}" >&2
  exit 1
fi
if [[ "${MAC}" == "00:00:00:00:00:00" ]]; then
  echo "Set OBD_BT_MAC in ${CONF} (python3 list_bluetooth.py while the adapter is powered)" >&2
  exit 1
fi

log() { echo "[rnr-obd-pair] $*"; }

rfkill unblock bluetooth 2>/dev/null || true
bluetoothctl power on >/dev/null
bluetoothctl agent NoInputNoOutput >/dev/null 2>&1 || true
bluetoothctl default-agent >/dev/null 2>&1 || true

log "Pairing + trusting ${MAC} (adapter must be powered)..."
bluetoothctl pair "${MAC}" || true
bluetoothctl trust "${MAC}"
bluetoothctl connect "${MAC}" || true
sleep 1
bluetoothctl disconnect "${MAC}" 2>/dev/null || true

log "Binding RFCOMM..."
bash "${SCRIPT_DIR}/bind_obd_bluetooth.sh"

log "Done. /dev/obd -> ${OBD_RFCOMM_DEV:-/dev/rfcomm0} -> ${MAC}"
log "Boot bind is installed via: sudo bash install_service.sh"
