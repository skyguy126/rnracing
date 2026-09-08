#!/usr/bin/env bash
#
# harden_sdcard.sh
#
# Harden a headless Raspberry Pi (Pi 2 / Raspbian / Raspberry Pi OS)
# against unexpected power cuts — no graceful shutdown expected.
#
# Strategy (aligned with Raspberry Pi / Adafruit / common field practice):
#   1. Disable swap so nothing pages to the SD card
#   2. Keep journald logs in RAM only
#   3. Enable OverlayFS so the rootfs on the SD card is read-only and
#      runtime writes land in a tmpfs layer discarded on reboot
#   4. Write-protect the boot partition when the OS supports it
#   5. Enable the SoC hardware watchdog so a hung system recovers
#
# Compatible with older Raspbian (/boot) and newer Pi OS Bookworm+
# (/boot/firmware). Prefers raspi-config; falls back to the overlayroot
# package when raspi-config overlay helpers are missing.
#
# Usage (on the Pi, after apps/services are installed and tested):
#   sudo bash harden_sdcard.sh
#   sudo reboot
#
# Status / undo helpers:
#   sudo bash harden_sdcard.sh --status
#   sudo bash harden_sdcard.sh --disable   # then reboot (may need a 2nd reboot)
#
# Notes:
#   - Run this LAST before race use. Changes made after enabling overlay
#     vanish on reboot unless you disable overlay first.
#   - Pi 2 has ~1 GB RAM; the overlay lives in RAM — keep logging modest.
#   - Does not require a GUI (Lite / headless is ideal).

set -euo pipefail

SCRIPT_TAG="rnracing-harden-sdcard"
MARKER="# --- Added by ${SCRIPT_TAG} ---"

die()  { echo "[-] $*" >&2; exit 1; }
info() { echo "[*] $*"; }
ok()   { echo "    - $*"; }

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root: sudo bash $0 ${*:-}"
  fi
}

# ---------------------------------------------------------------------------
# Path detection (Raspbian / Buster vs Bookworm+)
# ---------------------------------------------------------------------------

detect_boot_paths() {
  if [[ -f /boot/firmware/config.txt ]]; then
    BOOT_DIR="/boot/firmware"
  elif [[ -f /boot/config.txt ]]; then
    BOOT_DIR="/boot"
  elif [[ -d /boot/firmware ]]; then
    BOOT_DIR="/boot/firmware"
  else
    BOOT_DIR="/boot"
  fi

  CONFIG_TXT="${BOOT_DIR}/config.txt"
  CMDLINE_TXT="${BOOT_DIR}/cmdline.txt"

  # Prefer the writable boot mount when present
  if [[ -f /boot/firmware/config.txt ]]; then
    CONFIG_TXT="/boot/firmware/config.txt"
    CMDLINE_TXT="/boot/firmware/cmdline.txt"
  elif [[ -f /boot/config.txt ]]; then
    CONFIG_TXT="/boot/config.txt"
    CMDLINE_TXT="/boot/cmdline.txt"
  fi
}

overlay_active_now() {
  # True if root is already an overlay (any common implementation)
  findmnt -no FSTYPE / 2>/dev/null | grep -qi overlay && return 0
  grep -q 'overlayroot' /proc/cmdline 2>/dev/null && return 0
  grep -Eq '(^|[[:space:]])boot=overlay([[:space:]]|$)' /proc/cmdline 2>/dev/null && return 0
  return 1
}

# ---------------------------------------------------------------------------
# --status
# ---------------------------------------------------------------------------

cmd_status() {
  require_root
  detect_boot_paths

  echo "=== SD card / power-loss hardening status ==="
  echo "Boot config : ${CONFIG_TXT}"
  echo "cmdline     : ${CMDLINE_TXT}"
  echo

  if overlay_active_now; then
    echo "Overlay     : ACTIVE (root writes are not persistent)"
    findmnt / || true
  else
    echo "Overlay     : inactive (or not yet rebooted after enable)"
  fi

  echo
  echo "Root mount  : $(findmnt -no OPTIONS / 2>/dev/null || echo unknown)"
  echo "Swap        : $(swapon --show --noheadings 2>/dev/null | wc -l) active device(s)"
  swapon --show 2>/dev/null || true

  if [[ -f /etc/systemd/journald.conf.d/99-${SCRIPT_TAG}.conf ]]; then
    echo "journald    : volatile drop-in present"
  else
    echo "journald    : no ${SCRIPT_TAG} drop-in"
  fi

  if grep -q '^dtparam=watchdog=on' "${CONFIG_TXT}" 2>/dev/null; then
    echo "Watchdog DT : enabled in ${CONFIG_TXT}"
  else
    echo "Watchdog DT : not set in ${CONFIG_TXT}"
  fi

  if systemctl is-enabled watchdog >/dev/null 2>&1; then
    echo "watchdog.service : enabled ($(systemctl is-active watchdog 2>/dev/null || true))"
  else
    echo "watchdog.service : not enabled"
  fi

  if command -v raspi-config >/dev/null 2>&1; then
    echo
    echo "raspi-config queries (if supported on this image):"
    raspi-config nonint get_overlay_now 2>/dev/null && echo "  get_overlay_now exit=$?" || true
    raspi-config nonint get_bootro_now 2>/dev/null && echo "  get_bootro_now exit=$?" || true
  fi
}

# ---------------------------------------------------------------------------
# --disable  (maintenance / updates)
# ---------------------------------------------------------------------------

raspi_try() {
  # Run raspi-config nonint helper; return 0 only if the command exists and succeeds
  local cmd="$1"
  shift || true
  if ! command -v raspi-config >/dev/null 2>&1; then
    return 1
  fi
  if raspi-config nonint "${cmd}" "$@" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

disable_overlay_raspi() {
  # Older images: disable_overlayfs / disable_bootro
  # Newer images: do_overlayfs 1 / do_boot_ro 1  (1 = disable)
  if raspi_try disable_bootro || raspi_try do_boot_ro 1; then
    ok "Boot partition write-protect disable requested"
  else
    ok "Could not disable boot RO via raspi-config (may already be RW or unsupported)"
  fi

  if raspi_try disable_overlayfs || raspi_try do_overlayfs 1; then
    ok "OverlayFS disable requested via raspi-config"
    return 0
  fi
  return 1
}

disable_overlay_package() {
  local conf="/etc/overlayroot.local.conf"
  local lower_conf="/media/root-ro/etc/overlayroot.local.conf"

  if [[ -f "${lower_conf}" ]]; then
    conf="${lower_conf}"
  fi

  if [[ ! -f "${conf}" ]] && [[ ! -f /etc/overlayroot.conf ]]; then
    return 1
  fi

  mkdir -p "$(dirname "${conf}")"
  if [[ -f "${conf}" ]]; then
    sed -i -E 's/^[[:space:]]*overlayroot=.*/overlayroot="disabled"/' "${conf}"
    if ! grep -q '^[[:space:]]*overlayroot=' "${conf}"; then
      echo 'overlayroot="disabled"' >> "${conf}"
    fi
  else
    echo 'overlayroot="disabled"' > "${conf}"
  fi
  ok "Set overlayroot=\"disabled\" in ${conf}"
  return 0
}

cmd_disable() {
  require_root
  detect_boot_paths

  info "Disabling read-only / overlay protection for maintenance..."

  if disable_overlay_raspi; then
    :
  elif disable_overlay_package; then
    :
  else
    die "No known overlay disable method found. Edit cmdline/overlayroot manually."
  fi

  echo
  echo "Reboot now, then (if boot is still RO) run --disable once more and reboot again."
  echo "  sudo reboot"
}

# ---------------------------------------------------------------------------
# Hardening steps
# ---------------------------------------------------------------------------

disable_swap() {
  info "Disabling swap (required before read-only root)..."

  swapoff -a 2>/dev/null || true

  if command -v dphys-swapfile >/dev/null 2>&1; then
    dphys-swapfile swapoff 2>/dev/null || true
    systemctl disable --now dphys-swapfile 2>/dev/null || true
    ok "dphys-swapfile stopped and disabled"
  fi

  # Newer Pi OS zram swap (ignore if absent)
  systemctl disable --now "systemd-zram-setup@zram0.service" 2>/dev/null || true
  systemctl disable --now rpi-zram-writeback.service 2>/dev/null || true
  systemctl disable --now rpi-zram-writeback.timer 2>/dev/null || true

  # Comment swap entries in fstab (idempotent)
  if [[ -f /etc/fstab ]] && grep -qE '^[^#].*\bswap\b' /etc/fstab; then
    if [[ ! -f /etc/fstab.bak.${SCRIPT_TAG} ]]; then
      cp /etc/fstab "/etc/fstab.bak.${SCRIPT_TAG}"
    fi
    sed -i -E 's/^([^#].*\bswap\b)/# '"${SCRIPT_TAG}"': \1/' /etc/fstab
    ok "Commented swap lines in /etc/fstab"
  else
    ok "No active swap lines in /etc/fstab"
  fi

  # Remove classic swapfile if present (frees space; safe if unused)
  if [[ -f /var/swap ]]; then
    rm -f /var/swap
    ok "Removed /var/swap"
  fi
}

configure_journald_ram() {
  info "Configuring journald to keep logs in RAM only..."

  local drop_in_dir="/etc/systemd/journald.conf.d"
  local drop_in="${drop_in_dir}/99-${SCRIPT_TAG}.conf"
  mkdir -p "${drop_in_dir}"

  cat > "${drop_in}" <<EOF
[Journal]
# ${SCRIPT_TAG}: no journal writes to the SD card
Storage=volatile
RuntimeMaxUse=16M
EOF

  systemctl restart systemd-journald
  ok "Installed ${drop_in} and restarted journald"
}

enable_watchdog() {
  info "Enabling SoC hardware watchdog..."

  if [[ ! -f "${CONFIG_TXT}" ]]; then
    ok "No ${CONFIG_TXT} found — skipping dtparam (unusual for Raspberry Pi OS)"
  else
    if grep -qE '^[[:space:]]*dtparam=watchdog=on' "${CONFIG_TXT}"; then
      ok "dtparam=watchdog=on already set"
    else
      # Remount boot RW if currently RO
      mount -o remount,rw "${BOOT_DIR}" 2>/dev/null || true
      {
        echo ""
        echo "${MARKER}"
        echo "dtparam=watchdog=on"
      } >> "${CONFIG_TXT}"
      ok "Added dtparam=watchdog=on to ${CONFIG_TXT}"
    fi
  fi

  if ! command -v apt-get >/dev/null 2>&1; then
    ok "apt-get not found — install 'watchdog' package manually if desired"
    return 0
  fi

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y watchdog

  local wconf="/etc/watchdog.conf"
  if [[ -f "${wconf}" ]]; then
    if [[ ! -f "${wconf}.bak.${SCRIPT_TAG}" ]]; then
      cp "${wconf}" "${wconf}.bak.${SCRIPT_TAG}"
    fi
    # Drop previous values we manage, then append a known-good block once
    sed -i '/^watchdog-device/d;/^watchdog-timeout/d;/^max-load-1/d;/^realtime/d;/^priority/d' "${wconf}"
    if ! grep -q "${SCRIPT_TAG}" "${wconf}"; then
      cat >> "${wconf}" <<EOF

${MARKER}
watchdog-device		= /dev/watchdog
watchdog-timeout	= 15
max-load-1		= 24
realtime		= yes
priority		= 1
EOF
    fi
  fi

  systemctl enable watchdog
  # Device node may not exist until after reboot with dtparam set; don't fail
  systemctl restart watchdog 2>/dev/null || ok "watchdog.service enable queued (starts fully after reboot)"
  ok "watchdog package installed and enabled"
}

enable_overlay() {
  info "Enabling read-only root via OverlayFS..."

  if overlay_active_now; then
    ok "Overlay already active — nothing to do"
    return 0
  fi

  # Prefer raspi-config (official path on Raspberry Pi OS)
  if command -v raspi-config >/dev/null 2>&1; then
    if raspi_try enable_overlayfs || raspi_try do_overlayfs 0; then
      ok "OverlayFS enable requested via raspi-config"
    else
      ok "raspi-config overlay enable failed — trying overlayroot package"
      enable_overlay_via_package || die "Failed to enable OverlayFS"
    fi

    # Write-protect boot (second raspi-config question in the interactive flow)
    if raspi_try enable_bootro || raspi_try do_boot_ro 0; then
      ok "Boot partition write-protect requested"
    else
      ok "Boot RO helper unavailable — root overlay alone still protects most corruption cases"
    fi
    return 0
  fi

  enable_overlay_via_package || die "raspi-config missing and overlayroot fallback failed"
}

enable_overlay_via_package() {
  info "Installing/configuring overlayroot package fallback..."

  if ! command -v apt-get >/dev/null 2>&1; then
    return 1
  fi

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y overlayroot

  local conf="/etc/overlayroot.local.conf"
  if [[ -f "${conf}" ]] && grep -qE '^[[:space:]]*overlayroot=' "${conf}"; then
    sed -i -E 's/^[[:space:]]*overlayroot=.*/overlayroot="tmpfs"/' "${conf}"
  else
    echo 'overlayroot="tmpfs"' > "${conf}"
  fi
  ok "Wrote overlayroot=\"tmpfs\" to ${conf}"
  return 0
}

add_motd_banner() {
  info "Adding login reminder..."
  local line="*** RN Racing car node: read-only SD (overlay) — power-cut safe; changes vanish on reboot ***"
  touch /etc/motd
  if ! grep -q 'RN Racing car node: read-only SD' /etc/motd 2>/dev/null; then
    echo "${line}" >> /etc/motd
    ok "Updated /etc/motd"
  else
    ok "MOTD already present"
  fi
}

cmd_enable() {
  require_root
  detect_boot_paths

  info "Starting SD-card hardening for unexpected power loss"
  ok "Using boot config: ${CONFIG_TXT}"

  if overlay_active_now; then
    echo
    echo "[!] Overlay is already active. Persistent config changes will not stick."
    echo "    For maintenance: sudo bash $0 --disable && sudo reboot"
    exit 0
  fi

  disable_swap
  configure_journald_ram
  enable_watchdog
  enable_overlay
  add_motd_banner

  echo
  echo "=================================================================="
  echo "Hardening configured."
  echo
  echo "Done:"
  echo "  - Swap disabled (dphys-swapfile / zram / fstab)"
  echo "  - journald Storage=volatile (16M RAM cap)"
  echo "  - Hardware watchdog enabled"
  echo "  - OverlayFS / overlayroot configured (SD root read-only)"
  echo "  - Boot partition RO requested when supported"
  echo
  echo "REBOOT to activate the overlay:"
  echo "  sudo reboot"
  echo
  echo "After reboot, verify:"
  echo "  sudo bash $0 --status"
  echo "  findmnt /"
  echo
  echo "To update software later:"
  echo "  sudo bash $0 --disable && sudo reboot"
  echo "  # make changes, then:"
  echo "  sudo bash $0 && sudo reboot"
  echo "=================================================================="
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

case "${1:-}" in
  --status)  cmd_status ;;
  --disable) cmd_disable ;;
  --help|-h)
    sed -n '2,35p' "$0"
    ;;
  "")
    cmd_enable
    ;;
  *)
    die "Unknown option: $1 (use --status, --disable, or no args to enable)"
    ;;
esac
