#!/usr/bin/env bash
#
# unharden_sdcard.sh — undo harden_sdcard.sh so the SD is writable for updates.
#
# Typical flow when overlay is active:
#   sudo bash unharden_sdcard.sh && sudo reboot
#   sudo bash unharden_sdcard.sh   # finish restore on normal root
#   # install / edit / test
#   sudo bash harden_sdcard.sh && sudo reboot
#
TAG="rnracing-harden-sdcard"

info() { echo "[*] $*"; }
ok()   { echo "    - $*"; }
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

# Boot is often mounted read-only after harden; raspi-config must be able to
# edit cmdline.txt or the overlay disable is lost.
for boot in /boot/firmware /boot; do
  findmnt -n "${boot}" >/dev/null 2>&1 || continue
  mount -o remount,rw "${boot}" 2>/dev/null || warn "could not remount ${boot} read-write"
done

info "Disabling OverlayFS / boot write-protect"
overlay_disabled=0
if try_raspi disable_overlayfs || try_raspi do_overlayfs 1; then
  ok "overlay disable requested via raspi-config"
  overlay_disabled=1
fi
try_raspi disable_bootro || try_raspi do_boot_ro 1 || true

# Cards hardened by an older script may be on overlayroot instead.
for conf in /media/root-ro/etc/overlayroot.local.conf /etc/overlayroot.local.conf; do
  [[ -f "${conf}" ]] || continue
  # While overlay is up, /etc is the tmpfs upper layer — that write would not persist.
  if overlay_on && [[ "${conf}" != /media/root-ro/* ]]; then
    continue
  fi
  if echo 'overlayroot="disabled"' > "${conf}"; then
    ok "overlayroot disabled in ${conf}"
    overlay_disabled=1
    break
  fi
  warn "could not update ${conf}"
done

if overlay_on; then
  echo
  if [[ "${overlay_disabled}" -eq 1 ]]; then
    echo "Overlay is still ACTIVE. Reboot, then run this script again to finish restore:"
    echo "  sudo reboot"
    echo "  sudo bash $0"
    exit 0
  fi
  echo "Could not turn overlay off (raspi-config missing or failed). Root stays read-only."
  exit 1
fi

info "Restoring journald"
rm -f "/etc/systemd/journald.conf.d/99-${TAG}.conf"
systemctl restart systemd-journald 2>/dev/null || true
ok "removed volatile journald drop-in"

info "Restoring swap"
if [[ -f /etc/fstab.bak.${TAG} ]]; then
  if mv "/etc/fstab.bak.${TAG}" /etc/fstab; then
    ok "restored /etc/fstab from backup"
  else
    warn "could not restore /etc/fstab"
  fi
elif [[ -f /etc/fstab ]]; then
  if sed -i -E "s/^# ${TAG}: //" /etc/fstab; then
    ok "uncommented swap lines in /etc/fstab"
  else
    warn "could not uncomment swap lines in /etc/fstab"
  fi
fi
if command -v dphys-swapfile >/dev/null 2>&1; then
  systemctl enable --now dphys-swapfile 2>/dev/null || true
  ok "dphys-swapfile re-enabled"
fi
swapon -a 2>/dev/null || true

if [[ -f /etc/motd ]]; then
  sed -i '/RN Racing: read-only SD/d' /etc/motd || true
fi

# Older harden enabled the watchdog service. Leave config.txt alone.
systemctl disable --now watchdog 2>/dev/null || true

echo
echo "Unharden complete — root is writable."
echo "Make your updates, then re-harden when ready:"
echo "  sudo bash harden_sdcard.sh && sudo reboot"
