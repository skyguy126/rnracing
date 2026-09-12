#!/usr/bin/env bash
# Stop and remove car telemetry + Bluetooth OBD bind systemd units.
# Does not uninstall Python packages or undo Bluetooth pairing.
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Usage: sudo bash $0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNITS=(rnr-car.service rnr-obd-bluetooth.service)

echo "Stopping and disabling ${UNITS[*]}"
systemctl disable --now "${UNITS[@]}" 2>/dev/null || true

for name in "${UNITS[@]}"; do
  rm -f "/etc/systemd/system/${name}"
  rm -rf "/etc/systemd/system/${name}.d"
done

systemctl daemon-reload
systemctl reset-failed "${UNITS[@]}" 2>/dev/null || true

# Unit ExecStop normally releases this. Do it again if the unit was already gone.
CONF="${SCRIPT_DIR}/obd_bluetooth.conf"
if [[ -f "${CONF}" ]]; then
  # shellcheck source=/dev/null
  source "${CONF}"
fi
dev="${OBD_RFCOMM_DEV:-/dev/rfcomm0}"
n="${dev##*[!0-9]}"
if [[ -n "${n}" ]]; then
  rfcomm release "${n}" 2>/dev/null || true
fi
rm -f /dev/obd

echo "Uninstalled ${UNITS[*]}."
echo "Bluetooth pairing is unchanged. Python packages were left installed."
echo "To install again: sudo bash ${SCRIPT_DIR}/install_service.sh"
