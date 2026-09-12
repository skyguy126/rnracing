#!/usr/bin/env python3
"""Scan Bluetooth for a few seconds and print devices found.

  python3 list_bluetooth.py       # 20 seconds
  python3 list_bluetooth.py 10
"""

from __future__ import annotations

import os
import pty
import re
import select
import shutil
import subprocess
import sys
import time

DEFAULT_SECS = 20
DEVICE_RE = re.compile(
    r"\[(?:NEW|CHG)\]\s+Device\s+((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})\s*(.*)$"
)
CACHED_RE = re.compile(
    r"^Device\s+((?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2})\s*(.*)$"
)
NAME_PROP_RE = re.compile(r"^(?:Name|Alias):\s*(.+)$")
RSSI_PROP_RE = re.compile(r"^RSSI:\s*(-?\d+)")
OBD_HINTS = ("OBD", "ELM", "VGATE", "VEEPEAK", "KONNWEI", "BAFX", "OBDLINK")


def bluetoothctl(*args: str, timeout: float = 15) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bluetoothctl", *args],
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )


def cached_names() -> dict[str, str]:
    try:
        result = bluetoothctl("devices", timeout=8)
    except subprocess.TimeoutExpired:
        return {}
    names: dict[str, str] = {}
    for line in (result.stdout or "").splitlines():
        match = CACHED_RE.match(line.strip())
        if not match:
            continue
        mac = match.group(1).upper()
        name = match.group(2).strip()
        if mac not in names or (name and not names[mac]):
            names[mac] = name
    return names


def clean_line(raw: str) -> str:
    text = raw.replace("\r", "").replace("\x01", "").replace("\x02", "")
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    return text.strip()


def note_device(found: dict[str, dict[str, str | int | None]], mac: str, rest: str) -> None:
    entry = found.setdefault(mac, {"name": "", "rssi": None})
    rest = rest.strip()
    name_match = NAME_PROP_RE.match(rest)
    rssi_match = RSSI_PROP_RE.match(rest)
    if name_match and name_match.group(1).strip():
        entry["name"] = name_match.group(1).strip()
    elif rssi_match:
        entry["rssi"] = int(rssi_match.group(1))
    elif rest and ":" not in rest and not entry["name"]:
        entry["name"] = rest


def obd_tag(name: str) -> str:
    hay = name.upper()
    return "  <-- OBD?" if any(hint in hay for hint in OBD_HINTS) else ""


def scan(secs: int) -> tuple[dict[str, dict[str, str | int | None]], str]:
    master, slave = pty.openpty()
    proc = subprocess.Popen(
        ["bluetoothctl"],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        close_fds=True,
    )
    os.close(slave)
    found: dict[str, dict[str, str | int | None]] = {}
    errors: list[str] = []
    # bluetoothctl can take a moment to attach to bluetoothd; count scan time
    # only after discovery is actually running.
    deadline = None
    startup_deadline = time.monotonic() + 15
    buf = ""
    try:
        os.write(master, b"power on\nscan on\n")
        while True:
            now = time.monotonic()
            if deadline is None and now >= startup_deadline:
                errors.append("Bluetooth discovery did not start")
                break
            remaining = (deadline if deadline is not None else startup_deadline) - now
            ready, _, _ = select.select([master], [], [], min(0.5, max(remaining, 0)))
            if not ready:
                if deadline is not None and time.monotonic() >= deadline:
                    break
                continue
            try:
                chunk = os.read(master, 4096)
            except OSError:
                break
            if not chunk:
                break
            buf += chunk.decode("utf-8", errors="replace")
            lines = buf.splitlines(keepends=True)
            buf = lines.pop() if lines and not lines[-1].endswith("\n") else ""
            for raw in lines:
                line = clean_line(raw)
                if not line:
                    continue
                match = DEVICE_RE.search(line)
                if match:
                    if deadline is None:
                        deadline = time.monotonic() + secs
                    note_device(found, match.group(1).upper(), match.group(2))
                elif "Discovery started" in line and deadline is None:
                    deadline = time.monotonic() + secs
                elif re.search(r"No default controller|Failed to|not available|org\.bluez", line, re.I):
                    errors.append(line)
            if deadline is not None and time.monotonic() >= deadline:
                break
        try:
            os.write(master, b"scan off\nquit\n")
        except OSError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
        os.close(master)
    return found, "; ".join(dict.fromkeys(errors))


def main() -> int:
    if len(sys.argv) > 2 or (len(sys.argv) == 2 and sys.argv[1] in ("-h", "--help")):
        print(f"Usage: {sys.argv[0]} [seconds]", file=sys.stderr)
        return 2 if len(sys.argv) > 2 else 0

    secs = DEFAULT_SECS
    if len(sys.argv) == 2:
        try:
            secs = int(sys.argv[1])
        except ValueError:
            print(f"Usage: {sys.argv[0]} [seconds]", file=sys.stderr)
            return 2
    if secs < 1:
        print("seconds must be >= 1", file=sys.stderr)
        return 2

    if shutil.which("bluetoothctl") is None:
        print("bluetoothctl not found (install bluez)", file=sys.stderr)
        return 1

    subprocess.run(["rfkill", "unblock", "bluetooth"], check=False, capture_output=True)

    print(f"Scanning Bluetooth for {secs}s...", file=sys.stderr)
    try:
        found, scan_error = scan(secs)
    except FileNotFoundError:
        print("bluetoothctl not found (install bluez)", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("scan interrupted", file=sys.stderr)
        return 130

    names = cached_names()
    if not found:
        if scan_error:
            print(scan_error, file=sys.stderr)
            print("Try sudo, or add this user to the bluetooth group.", file=sys.stderr)
            return 1
        print("  (none)")
        return 0

    rows = []
    for mac, entry in found.items():
        name = str(entry["name"] or names.get(mac) or "")
        rows.append((name.lower(), mac, name, entry["rssi"]))
    for _, mac, name, rssi in sorted(rows):
        label = name or "(unnamed)"
        rssi_bit = f"  rssi={rssi}" if isinstance(rssi, int) else ""
        print(f"{mac}  {label}{rssi_bit}{obd_tag(label)}")
    sys.stdout.flush()
    print(f"{len(found)} device(s)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("scan interrupted", file=sys.stderr)
        raise SystemExit(130)
