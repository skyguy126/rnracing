#!/usr/bin/env bash
# Bind a paired Bluetooth OBD adapter to a stable /dev/rfcommN node.
# Safe to run repeatedly (boot + reconnect). Connection happens when the
# serial port is opened (transmit.py); this only ensures the node exists.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF="${OBD_BT_CONF:-${SCRIPT_DIR}/obd_bluetooth.conf}"

if [[ ! -f "${CONF}" ]]; then
  echo "Missing config: ${CONF}" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "${CONF}"

: "${OBD_BT_MAC:?Set OBD_BT_MAC in ${CONF}}"
: "${OBD_RFCOMM_DEV:=/dev/rfcomm0}"
: "${OBD_RFCOMM_CHANNEL:=1}"

MAC="$(echo "${OBD_BT_MAC}" | tr '[:lower:]' '[:upper:]')"
if [[ ! "${MAC}" =~ ^([0-9A-F]{2}:){5}[0-9A-F]{2}$ ]]; then
  echo "Invalid OBD_BT_MAC='${OBD_BT_MAC}' in ${CONF}" >&2
  exit 1
fi
if [[ "${MAC}" == "00:00:00:00:00:00" ]]; then
  echo "Set OBD_BT_MAC in ${CONF} (python3 list_bluetooth.py while the adapter is powered)" >&2
  exit 1
fi

RFCOMM_N="${OBD_RFCOMM_DEV##*[!0-9]}"
if [[ -z "${RFCOMM_N}" ]]; then
  echo "Could not parse rfcomm index from OBD_RFCOMM_DEV=${OBD_RFCOMM_DEV}" >&2
  exit 1
fi

log() { echo "[rnr-obd-bt] $*"; }

wait_for_hci() {
  local i
  for i in $(seq 1 40); do
    if [[ -e /sys/class/bluetooth/hci0 ]]; then
      return 0
    fi
    sleep 0.5
  done
  echo "Bluetooth adapter hci0 not present" >&2
  return 1
}

# True when hci0 is already Powered. Does not use bluetoothctl — that client
# stays attached to BlueZ and never exits, even if power on already succeeded.
hci_powered() {
  timeout 3 busctl get-property org.bluez /org/bluez/hci0 org.bluez.Adapter1 Powered 2>/dev/null \
    | grep -q 'b true'
}

ensure_powered() {
  rfkill unblock bluetooth 2>/dev/null || true
  if hci_powered; then
    log "hci0 already powered"
    return 0
  fi
  log "powering hci0"
  timeout 10 bluetoothctl --timeout 8 power on >/dev/null 2>&1 || true
  if command -v btmgmt >/dev/null 2>&1; then
    timeout 8 btmgmt --index 0 power on >/dev/null 2>&1 || true
  fi
}

already_bound_to_mac() {
  # rfcomm show: "rfcomm0: AA:BB:CC:DD:EE:FF channel 1 clean"
  local line
  line="$(timeout 5 rfcomm show "${RFCOMM_N}" 2>/dev/null || true)"
  [[ "${line}" == *"${MAC}"* ]]
}

release_bind() {
  timeout 5 rfcomm release "${RFCOMM_N}" 2>/dev/null || true
}

bind_rfcomm() {
  # Create /dev/rfcommN permanently bound to this MAC+channel.
  # Opening the device triggers the BlueZ SPP connection.
  timeout 10 rfcomm bind "${RFCOMM_N}" "${MAC}" "${OBD_RFCOMM_CHANNEL}"
}

# Ensure dialout can open the node after bind (some images create it as root:root)
fix_perms() {
  if [[ -e "${OBD_RFCOMM_DEV}" ]]; then
    chgrp dialout "${OBD_RFCOMM_DEV}" 2>/dev/null || true
    chmod 660 "${OBD_RFCOMM_DEV}" 2>/dev/null || true
  fi
  # Stable alias used by rnr-car.service
  ln -sfn "${OBD_RFCOMM_DEV}" /dev/obd
}

wait_for_hci
ensure_powered

if already_bound_to_mac && [[ -e "${OBD_RFCOMM_DEV}" ]]; then
  log "already bound: ${OBD_RFCOMM_DEV} -> ${MAC} ch${OBD_RFCOMM_CHANNEL}"
  fix_perms
  exit 0
fi

release_bind
bind_rfcomm

if [[ ! -e "${OBD_RFCOMM_DEV}" ]]; then
  echo "rfcomm bind succeeded but ${OBD_RFCOMM_DEV} missing" >&2
  exit 1
fi

fix_perms
log "bound ${OBD_RFCOMM_DEV} (/dev/obd) -> ${MAC} channel ${OBD_RFCOMM_CHANNEL}"
