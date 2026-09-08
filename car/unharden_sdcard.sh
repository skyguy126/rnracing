#!/usr/bin/env bash
#
# unharden_sdcard.sh — undo harden_sdcard.sh so the SD is writable for updates.
#
# Typical flow when overlay is active:
#   sudo bash unharden_sdcard.sh
#   sudo reboot
#   sudo bash unharden_sdcard.sh   # finish restore on normal root
#   # install / edit / test
#   sudo bash harden_sdcard.sh && sudo reboot
#
set -euo pipefail

TAG="rnracing-harden-sdcard"
MARKER="# --- Added by ${TAG} ---"

die()  { echo "[-] $*" >&2; exit 1; }
info() { echo "[*] $*"; }
ok()   { echo "    - $*"; }

[[ "${EUID}" -eq 0 ]] || die "Run as root: sudo bash $0"

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

# --- 1) turn off overlay / boot RO (must reboot to take effect) ---------------

info "Disabling OverlayFS / boot write-protect"

overlay_disabled=0
if raspi disable_bootro || raspi do_boot_ro 1; then
  ok "boot RO disable requested"
fi
if raspi disable_overlayfs || raspi do_overlayfs 1; then
  ok "overlay disable requested via raspi-config"
  overlay_disabled=1
fi

# overlayroot package fallback (write lower layer if mounted)
if [[ "${overlay_disabled}" -eq 0 ]]; then
  for conf in /media/root-ro/etc/overlayroot.local.conf /etc/overlayroot.local.conf; do
    if [[ -f "${conf}" ]] || [[ -d "$(dirname "${conf}")" && -f /etc/overlayroot.conf ]]; then
      mkdir -p "$(dirname "${conf}")"
      if [[ -f "${conf}" ]]; then
        sed -i -E 's/^[[:space:]]*overlayroot=.*/overlayroot="disabled"/' "${conf}"
        grep -q '^[[:space:]]*overlayroot=' "${conf}" || echo 'overlayroot="disabled"' >> "${conf}"
      else
        echo 'overlayroot="disabled"' > "${conf}"
      fi
      ok "overlayroot disabled in ${conf}"
      overlay_disabled=1
      break
    fi
  done
fi

if overlay_on; then
  echo
  echo "Overlay is still ACTIVE. Reboot, then run this script again to finish restore:"
  echo "  sudo reboot"
  echo "  sudo bash $0"
  exit 0
fi

# --- 2) restore writable-root settings ----------------------------------------

info "Restoring journald"
rm -f "/etc/systemd/journald.conf.d/99-${TAG}.conf"
systemctl restart systemd-journald 2>/dev/null || true
ok "removed volatile journald drop-in"

info "Restoring swap"
if [[ -f /etc/fstab.bak.${TAG} ]]; then
  mv "/etc/fstab.bak.${TAG}" /etc/fstab
  ok "restored /etc/fstab from backup"
elif [[ -f /etc/fstab ]]; then
  sed -i -E "s/^# ${TAG}: //" /etc/fstab
  ok "uncommented swap lines in /etc/fstab"
fi
if command -v dphys-swapfile >/dev/null 2>&1; then
  systemctl enable dphys-swapfile 2>/dev/null || true
  dphys-swapfile setup 2>/dev/null || true
  dphys-swapfile swapon 2>/dev/null || true
  systemctl start dphys-swapfile 2>/dev/null || true
  ok "dphys-swapfile re-enabled"
fi
swapon -a 2>/dev/null || true

info "Removing hardening MOTD line"
if [[ -f /etc/motd ]]; then
  sed -i '/RN Racing: read-only SD/d' /etc/motd
  sed -i '/RN Racing car node: read-only SD/d' /etc/motd
fi

info "Watchdog (optional leave-on; stripping our config.txt marker)"
if [[ -f "${CONFIG_TXT}" ]]; then
  mount -o remount,rw "${BOOT_DIR}" 2>/dev/null || true
  # Remove the marker block we appended (marker line + following dtparam)
  if grep -qF "${MARKER}" "${CONFIG_TXT}"; then
    sed -i "/${MARKER}/,+1d" "${CONFIG_TXT}"
    ok "removed ${TAG} watchdog lines from ${CONFIG_TXT}"
  fi
fi
# Leave watchdog package installed; disable service so behaviour matches pre-harden
systemctl disable --now watchdog 2>/dev/null || true
if [[ -f /etc/watchdog.conf.bak.${TAG} ]]; then
  mv "/etc/watchdog.conf.bak.${TAG}" /etc/watchdog.conf
  ok "restored /etc/watchdog.conf"
fi

echo
echo "Unharden complete — root is writable."
echo "Make your updates, then re-harden when ready:"
echo "  sudo bash harden_sdcard.sh && sudo reboot"
