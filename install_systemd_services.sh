#!/bin/bash
set -euo pipefail

# Must be run as root (or via sudo)
if [ "$EUID" -ne 0 ]; then
    echo "Error: This script must be run with sudo/root."
    echo "Usage: sudo $0"
    exit 1
fi

REPO_ROOT="/home/rnracing/rnracing"
SYSTEMD_SRC_DIR="${REPO_ROOT}/systemd"

SERVICES=(
  "rnr-launcher.service"
  "rnr-dashboard.service"
)

echo "Installing systemd services from: ${SYSTEMD_SRC_DIR}"

for svc in "${SERVICES[@]}"; do
    SRC="${SYSTEMD_SRC_DIR}/${svc}"
    DEST="/etc/systemd/system/${svc}"

    if [ ! -f "$SRC" ]; then
        echo "Warning: $SRC not found, skipping."
        continue
    fi

    echo "-> Installing ${svc} to ${DEST}"
    install -m 644 "$SRC" "$DEST"
done

echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Enabling services at boot..."
systemctl enable rnr-launcher.service
systemctl enable rnr-dashboard.service

echo "Starting (or restarting) services..."
systemctl restart rnr-launcher.service
systemctl restart rnr-dashboard.service

echo "Done."
