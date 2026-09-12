#!/usr/bin/env bash
#
# harden_sdcard.sh — make the Pi SD card survive hard power cuts.
#
#   1. Disable swap
#   2. journald → RAM only
#   3. OverlayFS read-only root (raspi-config), plus boot RO if that works
#
# Watchdog and the overlayroot apt fallback are intentionally omitted: they
# need the network / boot-partition edits and often abort the script before
# overlay is enabled. Swap + journald still cut writes if overlay cannot start.
#
# Usage (after services work):
#   sudo bash harden_sdcard.sh && sudo reboot
#
# Undo before updates:
#   sudo bash unharden_sdcard.sh && sudo reboot
#   # if overlay is still active, run unharden again after the reboot
#
TAG="rnracing-harden-sdcard"

info() { echo "[*] $*"; }
warn() { echo "[!] $*"; }

[[ "${EUID}" -eq 0 ]] || { echo "[-] Run as root: sudo bash $0" >&2; exit 1; }

overlay_on() {
  findmnt -no FSTYPE / 2>/dev/null | grep -qi overlay && return 0
  grep -qE 'boot=overlay|overlayroot' /proc/cmdline 2>/dev/null && return 0
  return 1
}

try_raspi() {
  command -v raspi-config >/dev/null 2>&1 || return 1
  raspi-config nonint "$@"
}

if [[ "${1:-}" == "--status" ]]; then
  if overlay_on; then
    echo "Overlay     : ACTIVE (writes are not persistent)"
  else
    echo "Overlay     : inactive"
  fi
  echo "Swap        : $(swapon --show --noheadings 2>/dev/null | wc -l) active"
  if [[ -f /etc/systemd/journald.conf.d/99-${TAG}.conf ]]; then
    echo "journald    : volatile drop-in present"
  else
    echo "journald    : default"
  fi
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  echo "[-] Unknown option: $1 (use --status or no args)" >&2
  echo "    To undo: sudo bash unharden_sdcard.sh" >&2
  exit 1
fi

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
if [[ -f /etc/fstab ]] && grep -qE '^[^#].*\bswap\b' /etc/fstab; then
  [[ -f /etc/fstab.bak.${TAG} ]] || cp /etc/fstab "/etc/fstab.bak.${TAG}" || true
  sed -i -E 's/^([^#].*\bswap\b)/# '"${TAG}"': \1/' /etc/fstab \
    || warn "could not comment swap lines in /etc/fstab"
fi

info "journald → RAM"
mkdir -p /etc/systemd/journald.conf.d
if cat > "/etc/systemd/journald.conf.d/99-${TAG}.conf" <<EOF
[Journal]
# ${TAG}
Storage=volatile
RuntimeMaxUse=16M
EOF
then
  systemctl restart systemd-journald 2>/dev/null \
    || warn "journald drop-in written; restart failed (applies on reboot)"
else
  warn "could not write journald drop-in"
fi

info "Enabling OverlayFS (read-only root)"
overlay_ok=0
if try_raspi enable_overlayfs || try_raspi do_overlayfs 0; then
  try_raspi enable_bootro || try_raspi do_boot_ro 0 || warn "boot partition left writable"
  overlay_ok=1
else
  warn "Could not enable OverlayFS (raspi-config missing or failed)."
  warn "Swap and journald changes still apply; root will stay writable."
fi

if [[ -f /etc/motd ]] || touch /etc/motd 2>/dev/null; then
  grep -q 'RN Racing: read-only SD' /etc/motd 2>/dev/null \
    || echo "*** RN Racing: read-only SD (overlay) — run unharden_sdcard.sh before updates ***" >> /etc/motd \
    || true
fi

echo
if [[ "${overlay_ok}" -eq 1 ]]; then
  echo "Done. Reboot to activate read-only root:  sudo reboot"
else
  echo "Partial harden only (no overlay). Reboot to apply swap/journald:  sudo reboot"
fi
echo "Status later:              sudo bash $0 --status"
echo "Before updates:            sudo bash unharden_sdcard.sh"
