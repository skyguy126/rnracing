#!/usr/bin/env bash
# One-time: discover, pair, and trust the Bluetooth OBD adapter, then write
# its MAC into obd_bluetooth.conf. After this, bind_obd_bluetooth.sh / the
# systemd unit keep /dev/rfcomm0 (+ /dev/obd) ready across reboots.
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

: "${OBD_BT_NAME:=OBDII}"
SCAN_SECS="${OBD_BT_SCAN_SECS:-20}"

log() { echo "[rnr-obd-pair] $*"; }

rfkill unblock bluetooth 2>/dev/null || true
bluetoothctl power on >/dev/null
bluetoothctl agent NoInputNoOutput >/dev/null 2>&1 || true
bluetoothctl default-agent >/dev/null 2>&1 || true

log "Put the OBD adapter in pairing mode (plug into the car / power it)."
log "Scanning ${SCAN_SECS}s for name matching '${OBD_BT_NAME}' (case-insensitive)..."

SCAN_OUT="$(mktemp)"
MAP_FILE="$(mktemp)"
cleanup() { rm -f "${SCAN_OUT}" "${MAP_FILE}"; }
trap cleanup EXIT

# Portable scan: bluetoothctl --timeout is not on every BlueZ build
(
  bluetoothctl scan on >/dev/null 2>&1 || true
  sleep "${SCAN_SECS}"
  bluetoothctl scan off >/dev/null 2>&1 || true
) &
SCAN_PID=$!
# Sample device list while scanning
for _ in $(seq 1 "${SCAN_SECS}"); do
  bluetoothctl devices 2>/dev/null >>"${SCAN_OUT}" || true
  sleep 1
done
wait "${SCAN_PID}" 2>/dev/null || true
bluetoothctl devices 2>/dev/null >>"${SCAN_OUT}" || true

awk '
  /Device ([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/ {
    mac=toupper($2)
    name=tolower($0)
    sub(/^.*Device [0-9A-Fa-f:]+[ \t]+/, "", name)
    if (mac != "") print mac "\t" name
  }
' "${SCAN_OUT}" | sort -u >"${MAP_FILE}"

NAME_LC="$(echo "${OBD_BT_NAME}" | tr '[:upper:]' '[:lower:]')"
MAC=""
while IFS=$'\t' read -r cand_mac cand_name; do
  [[ -z "${cand_mac}" ]] && continue
  if [[ "${cand_name}" == *"${NAME_LC}"* ]]; then
    MAC="${cand_mac}"
    log "Found ${cand_mac}  (${cand_name})"
    break
  fi
done <"${MAP_FILE}"

if [[ -z "${MAC}" ]]; then
  log "No device matched '${OBD_BT_NAME}'. Seen:"
  if [[ ! -s "${MAP_FILE}" ]]; then
    echo "  (none)"
  else
    while IFS=$'\t' read -r cand_mac cand_name; do
      echo "  ${cand_mac}  ${cand_name}"
    done <"${MAP_FILE}"
  fi
  echo
  echo "Re-run with OBD powered, or set OBD_BT_NAME / OBD_BT_MAC in ${CONF}" >&2
  exit 1
fi

log "Pairing + trusting ${MAC}..."
bluetoothctl pair "${MAC}" || true
bluetoothctl trust "${MAC}"
bluetoothctl connect "${MAC}" || true
sleep 1
bluetoothctl disconnect "${MAC}" 2>/dev/null || true

tmp="$(mktemp)"
awk -v mac="${MAC}" '
  BEGIN { done=0 }
  /^OBD_BT_MAC=/ { print "OBD_BT_MAC=" mac; done=1; next }
  { print }
  END { if (!done) print "OBD_BT_MAC=" mac }
' "${CONF}" >"${tmp}"
mv "${tmp}" "${CONF}"
chmod 644 "${CONF}"

log "Wrote OBD_BT_MAC=${MAC} to ${CONF}"
log "Binding RFCOMM..."
bash "${SCRIPT_DIR}/bind_obd_bluetooth.sh"

log "Done. /dev/obd -> ${OBD_RFCOMM_DEV:-/dev/rfcomm0} -> ${MAC}"
log "Boot bind is installed via: sudo bash install_service.sh"
