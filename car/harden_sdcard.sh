#!/usr/bin/env bash
#
# harden_sdcard.sh — make the Pi SD card survive hard power cuts.
#
#   1. Disable swap
#   2. journald → RAM only
#   3. OverlayFS read-only root (raspi-config, else overlayroot)
#   4. Boot partition RO when supported
#   5. SoC watchdog
#
# Usage (after services work):
#   sudo bash harden_sdcard.sh
#   sudo reboot
#
# Undo before updates:
#   sudo bash unharden_sdcard.sh
#   sudo reboot
#   # if overlay still active, run unharden again, reboot, then update
#
set -euo pipefail

TAG="rnracing-harden-sdcard"
MARKER="# --- Added by ${TAG} ---"

die()  { echo "[-] $*" >&2; exit 1; }
info() { echo "[*] $*"; }

[[ "${EUID}" -eq 0 ]] || die "Run as root: sudo bash $0"

# Boot paths: Bookworm+ uses /boot/firmware
if [[ -f /boot/firmware/config.txt ]]; then
  BOOT_DIR=/boot/firmware
elif [[ -f /boot/config.txt ]]; then
  BOOT_DIR=/boot
else
  BOOT_DIR=/boot
fi
CONFIG_TXT="${BOOT_DIR}/config.txt"

overlay_on() {
  findmnt -no FSTYPE / 2>/dev/null | grep -qi overlay && return 0
  grep -qE 'overlayroot|boot=overlay' /proc/cmdline 2>/dev/null && return 0
  return 1
}

raspi() {
  command -v raspi-config >/dev/null 2>&1 || return 1
  raspi-config nonint "$@" >/dev/null 2>&1
}

# --- status -------------------------------------------------------------------

if [[ "${1:-}" == "--status" ]]; then
  echo "Boot config : ${CONFIG_TXT}"
  if overlay_on; then
    echo "Overlay     : ACTIVE (writes are not persistent)"
    findmnt / || true
  else
    echo "Overlay     : inactive"
  fi
  echo "Swap        : $(swapon --show --noheadings 2>/dev/null | wc -l) active"
  [[ -f /etc/systemd/journald.conf.d/99-${TAG}.conf ]] \
    && echo "journald    : volatile drop-in present" \
    || echo "journald    : default"
  grep -q '^dtparam=watchdog=on' "${CONFIG_TXT}" 2>/dev/null \
    && echo "Watchdog DT : on" || echo "Watchdog DT : off"
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  die "Unknown option: $1 (use --status or no args). To undo: sudo bash unharden_sdcard.sh"
fi

# --- enable -------------------------------------------------------------------

if overlay_on; then
  echo "[!] Overlay already active — changes will not persist."
  echo "    sudo bash unharden_sdcard.sh && sudo reboot"
  exit 0
fi

info "Disabling swap"
swapoff -a 2>/dev/null || true
if command -v dphys-swapfile >/dev/null 2>&1; then
  dphys-swapfile swapoff 2>/dev/null || true
  systemctl disable --now dphys-swapfile 2>/dev/null || true
fi
systemctl disable --now "systemd-zram-setup@zram0.service" 2>/dev/null || true
if [[ -f /etc/fstab ]] && grep -qE '^[^#].*\bswap\b' /etc/fstab; then
  [[ -f /etc/fstab.bak.${TAG} ]] || cp /etc/fstab "/etc/fstab.bak.${TAG}"
  sed -i -E 's/^([^#].*\bswap\b)/# '"${TAG}"': \1/' /etc/fstab
fi
rm -f /var/swap

info "journald → RAM"
mkdir -p /etc/systemd/journald.conf.d
cat > "/etc/systemd/journald.conf.d/99-${TAG}.conf" <<EOF
[Journal]
# ${TAG}
Storage=volatile
RuntimeMaxUse=16M
EOF
systemctl restart systemd-journald

info "Enabling watchdog"
if [[ -f "${CONFIG_TXT}" ]] && ! grep -qE '^[[:space:]]*dtparam=watchdog=on' "${CONFIG_TXT}"; then
  mount -o remount,rw "${BOOT_DIR}" 2>/dev/null || true
  printf '\n%s\ndtparam=watchdog=on\n' "${MARKER}" >> "${CONFIG_TXT}"
fi
if command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y watchdog
  systemctl enable watchdog
  systemctl restart watchdog 2>/dev/null || true
fi

info "Enabling OverlayFS (read-only root)"
if raspi enable_overlayfs || raspi do_overlayfs 0; then
  raspi enable_bootro || raspi do_boot_ro 0 || true
elif command -v apt-get >/dev/null 2>&1; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y overlayroot
  echo 'overlayroot="tmpfs"' > /etc/overlayroot.local.conf
else
  die "Need raspi-config or the overlayroot package"
fi

line="*** RN Racing: read-only SD (overlay) — run unharden_sdcard.sh before updates ***"
touch /etc/motd
grep -q 'RN Racing: read-only SD' /etc/motd 2>/dev/null || echo "${line}" >> /etc/motd

echo
echo "Done. Reboot to activate:  sudo reboot"
echo "Status later:              sudo bash $0 --status"
echo "Before updates:            sudo bash unharden_sdcard.sh"
