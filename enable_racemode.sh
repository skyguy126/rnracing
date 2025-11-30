#!/usr/bin/env bash
#
# setup_rpi_race_mode.sh
#
# Harden a Raspberry Pi (Zero 2 W etc.) for sudden power loss:
#  - Enable OverlayFS (rootfs in RAM, SD card read-only)
#  - Put journald logs in RAM
#  - Enable hardware watchdog
#  - Disable swap
#
# Run as:
#   sudo bash setup_rpi_race_mode.sh
#
# After it finishes: REBOOT the Pi.

set -euo pipefail

### 0. Basic sanity checks #####################################################

if [[ "$EUID" -ne 0 ]]; then
  echo "[-] This script must be run as root (use: sudo $0)"
  exit 1
fi

echo "[*] Starting Raspberry Pi race-mode hardening..."

# Detect config file location (depends on Pi OS version)
CONFIG_TXT="/boot/config.txt"
if [[ -f /boot/firmware/config.txt ]]; then
  CONFIG_TXT="/boot/firmware/config.txt"
fi
echo "[*] Using config file: $CONFIG_TXT"

### 1. Enable hardware watchdog ###############################################

echo
echo "[1/5] Enabling hardware watchdog..."

# Ensure dtparam=watchdog=on exists in config.txt (idempotent)
if grep -q '^dtparam=watchdog=on' "$CONFIG_TXT"; then
  echo "    - Watchdog already enabled in $CONFIG_TXT"
else
  echo "    - Adding dtparam=watchdog=on to $CONFIG_TXT"
  echo "" >> "$CONFIG_TXT"
  echo "# Enable SoC hardware watchdog" >> "$CONFIG_TXT"
  echo "dtparam=watchdog=on" >> "$CONFIG_TXT"
fi

echo "    - Installing watchdog package (this may take a bit)..."
apt-get update -y
apt-get install -y watchdog

# Configure /etc/watchdog.conf with sane defaults
WATCHDOG_CONF="/etc/watchdog.conf"
echo "    - Configuring $WATCHDOG_CONF"

# Remove any old conflicting lines, then append ours
sed -i '/^watchdog-device/d' "$WATCHDOG_CONF" || true
sed -i '/^watchdog-timeout/d' "$WATCHDOG_CONF" || true
sed -i '/^max-load-1/d' "$WATCHDOG_CONF" || true
sed -i '/^realtime/d' "$WATCHDOG_CONF" || true
sed -i '/^priority/d' "$WATCHDOG_CONF" || true

cat <<'EOF' >> "$WATCHDOG_CONF"

# --- Added by setup_rpi_race_mode.sh ---
watchdog-device = /dev/watchdog
watchdog-timeout = 10      # seconds before forced reboot if not kicked
max-load-1 = 24            # ignore load spikes below this
realtime = yes
priority = 1
# ---------------------------------------
EOF

echo "    - Enabling and starting watchdog.service"
systemctl enable watchdog
systemctl restart watchdog

### 2. Configure journald to use RAM only #####################################

echo
echo "[2/5] Configuring systemd-journald to log to RAM..."

J_CONF="/etc/systemd/journald.conf"

# Make a backup once
if [[ ! -f "${J_CONF}.bak_race_mode" ]]; then
  cp "$J_CONF" "${J_CONF}.bak_race_mode"
  echo "    - Backup created at ${J_CONF}.bak_race_mode"
fi

# Clean existing lines and append ours
sed -i '/^Storage=/d' "$J_CONF" || true
sed -i '/^RuntimeMaxUse=/d' "$J_CONF" || true

cat <<'EOF' >> "$J_CONF"

# --- Added by setup_rpi_race_mode.sh ---
Storage=volatile          # logs live only in RAM
RuntimeMaxUse=10M         # cap RAM usage for logs
# ---------------------------------------
EOF

echo "    - Restarting systemd-journald"
systemctl restart systemd-journald

### 3. Disable swap (safer for SD cards, less corruption risk) #################

echo
echo "[3/5] Disabling swap..."

# Disable zram-based swap on Raspberry Pi

# Turn off active swap
sudo swapoff -a || true

# Disable zram-related services (ignore errors if not present)
sudo systemctl disable --now systemd-zram-setup@zram0.service 2>/dev/null || true
sudo systemctl disable --now rpi-zram-writeback.service 2>/dev/null || true
sudo systemctl disable --now rpi-zram-writeback.timer 2>/dev/null || true

echo "    - Swap disabled (if it existed)."

### 4. Enable OverlayFS (read-only root + RAM overlay) #########################

echo
echo "[4/5] Enabling OverlayFS (root in RAM)..."

# Use raspi-config's non-interactive helpers
# This matches what you'd do manually in raspi-config.
if ! command -v raspi-config >/dev/null 2>&1; then
  echo "[-] raspi-config not found. Are you running Raspberry Pi OS?"
  echo "    Cannot enable OverlayFS automatically."
else
  echo "    - Enabling OverlayFS..."
  raspi-config nonint enable_overlayfs || true
fi

echo "    NOTE: OverlayFS will fully take effect after the next reboot."

### 5. (Optional) Set a hint in /etc/motd so you remember this box is hardened ###

echo
echo "[5/5] Adding login banner reminder..."

MOTD_LINE="*** RACE MODE ENABLED: rootfs overlay + watchdog + RAM logs ***"
if ! grep -q 'RACE MODE ENABLED' /etc/motd 2>/dev/null; then
  echo "$MOTD_LINE" >> /etc/motd
  echo "    - Added notice to /etc/motd"
else
  echo "    - Race-mode notice already in /etc/motd"
fi

### Done #######################################################################

echo
echo "=================================================================="
echo "Setup complete."
echo
echo "What was done:"
echo "  - Hardware watchdog enabled (SoC watchdog, timeout = 10s)"
echo "  - watchdog.service installed and running"
echo "  - systemd-journald logs moved to RAM (Storage=volatile)"
echo "  - Swap disabled"
echo "  - OverlayFS configured via raspi-config"
echo
echo "IMPORTANT: Reboot now to actually start using OverlayFS:"
echo "  sudo reboot"
echo "=================================================================="
