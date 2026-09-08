#!/usr/bin/env bash
# Install the car telemetry systemd unit (run on the Pi with sudo).
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Usage: sudo bash $0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SRC="${SCRIPT_DIR}/systemd/rnr-car.service"
UNIT_DST="/etc/systemd/system/rnr-car.service"

# Rewrite WorkingDirectory / ExecStart to this checkout if it isn't the default path
REPO_CAR="${SCRIPT_DIR}"
sed -e "s|/home/rnracing/rnracing/car|${REPO_CAR}|g" "${UNIT_SRC}" > "${UNIT_DST}"
chmod 644 "${UNIT_DST}"

python3 -m pip install --upgrade -r "${SCRIPT_DIR}/requirements.txt"

systemctl daemon-reload
systemctl enable rnr-car.service
systemctl restart rnr-car.service
systemctl --no-pager --full status rnr-car.service || true

echo
echo "Installed. Live logs: journalctl -u rnr-car.service -f"
