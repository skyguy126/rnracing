#!/usr/bin/env python3
"""Scan Bluetooth, or pair the known OBD adapter.

Pairing only works while BlueZ is discovering that MAC. A stored address
is not enough — `pair` on an unseen device returns "not available".

  python3 list_bluetooth.py
  python3 list_bluetooth.py 10
  python3 list_bluetooth.py --pair 00:1D:A5:00:5E:27
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
PAIR_SECS = 40
PINS = ("1234", "0000")
MAC_RE = re.compile(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}")
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


def clean_line(raw: str) -> str:
    text = raw.replace("\r", "").replace("\x01", "").replace("\x02", "")
    text = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", text)
    return text.strip()


def controller() -> str | None:
    try:
        result = bluetoothctl("show", timeout=8)
    except subprocess.TimeoutExpired:
        return None
    match = re.search(r"Controller\s+(" + MAC_RE.pattern + r")", result.stdout or "")
    return match.group(1).upper() if match else None


class BtSession:
    def __init__(self) -> None:
        self.master, slave = pty.openpty()
        self.proc = subprocess.Popen(
            ["bluetoothctl"],
            stdin=slave,
            stdout=slave,
            stderr=slave,
            close_fds=True,
        )
        os.close(slave)
        self.buf = ""

    def write(self, text: str) -> None:
        os.write(self.master, text.encode())

    def read(self, timeout: float) -> list[str]:
        ready, _, _ = select.select([self.master], [], [], timeout)
        if not ready:
            return self._flush_partial(prompt_only=True)
        try:
            chunk = os.read(self.master, 4096)
        except OSError:
            return []
        if not chunk:
            return []
        self.buf += chunk.decode("utf-8", errors="replace")
        parts = self.buf.splitlines(keepends=True)
        self.buf = parts.pop() if parts and not parts[-1].endswith("\n") else ""
        lines = [clean_line(part) for part in parts]
        lines.extend(self._flush_partial(prompt_only=True))
        return [line for line in lines if line]

    def _flush_partial(self, prompt_only: bool) -> list[str]:
        partial = clean_line(self.buf)
        if not partial:
            return []
        if prompt_only and "pin" not in partial.lower() and "yes/no" not in partial.lower():
            return []
        self.buf = ""
        return [partial]

    def close(self) -> None:
        try:
            self.write("scan off\nquit\n")
        except OSError:
            pass
        try:
            self.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        os.close(self.master)


def start_scan(session: BtSession) -> None:
    # Plain scan on is what already saw this adapter on the Pi. Forcing a
    # BR/EDR filter can stop discovery entirely on some bluetoothctl builds.
    session.write("power on\nagent KeyboardDisplay\ndefault-agent\nscan on\n")


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


def report_miss(mac: str | None, heard: dict[str, dict[str, str | int | None]]) -> None:
    who = mac or "the OBD adapter"
    print(f"Did not see {who} during this inquiry.", file=sys.stderr)
    if not heard:
        print("Pi radio heard no devices. Check `bluetoothctl show` for hci0.", file=sys.stderr)
        return
    print("Pi radio did hear:", file=sys.stderr)
    print_devices(heard)
    print(
        "The OBD dongle was not among them. It only answers an inquiry while\n"
        "it is discoverable, usually for a short time after it is plugged in.",
        file=sys.stderr,
    )


def scan(secs: int) -> tuple[dict[str, dict[str, str | int | None]], str]:
    session = BtSession()
    found: dict[str, dict[str, str | int | None]] = {}
    errors: list[str] = []
    deadline = None
    startup_deadline = time.monotonic() + 15
    try:
        start_scan(session)
        while True:
            now = time.monotonic()
            if deadline is None and now >= startup_deadline:
                errors.append("Bluetooth discovery did not start")
                break
            remaining = (deadline if deadline is not None else startup_deadline) - now
            for line in session.read(min(0.5, max(remaining, 0))):
                match = DEVICE_RE.search(line)
                if match:
                    if deadline is None:
                        deadline = time.monotonic() + secs
                    note_device(found, match.group(1).upper(), match.group(2))
                elif "Discovery started" in line and deadline is None:
                    deadline = time.monotonic() + secs
                elif re.search(r"No default controller|org\.bluez\.Error\.NotReady", line, re.I):
                    errors.append(line)
            if deadline is not None and time.monotonic() >= deadline:
                break
    finally:
        session.close()
    return found, "; ".join(dict.fromkeys(errors))


def pair(mac: str, secs: int) -> int:
    session = BtSession()
    heard: dict[str, dict[str, str | int | None]] = {}
    seen = False
    paired = False
    pin_i = 0
    pin_sent = False
    fail = ""
    deadline = time.monotonic() + secs
    try:
        start_scan(session)
        while time.monotonic() < deadline and not paired and not fail:
            for line in session.read(0.4):
                match = DEVICE_RE.search(line)
                if match:
                    note_device(heard, match.group(1).upper(), match.group(2))
                upper = line.upper()
                if not seen and mac in upper and ("[NEW]" in upper or "[CHG]" in upper):
                    seen = True
                    print(f"Found {mac}, pairing (PIN 1234, then 0000 if needed)...", file=sys.stderr)
                    session.write(f"pair {mac}\n")
                if seen and not pin_sent and "pin" in line.lower():
                    pin = PINS[pin_i]
                    print(f"Sending PIN {pin}", file=sys.stderr)
                    session.write(pin + "\n")
                    pin_sent = True
                if seen and ("yes/no" in line.lower() or "confirm passkey" in line.lower()):
                    session.write("yes\n")
                if "Pairing successful" in line or re.search(r"Paired:\s+yes", line):
                    paired = True
                elif "Already Exists" in line or "Already Paired" in line:
                    paired = True
                elif "NotAvailable" in line or (seen and "not available" in line.lower()):
                    # Inquiry object vanished. Keep scanning and pair again when it returns.
                    seen = False
                    pin_sent = False
                elif "Failed to pair" in line or "AuthenticationFailed" in line:
                    if pin_i + 1 < len(PINS):
                        pin_i += 1
                        pin_sent = False
                        print(f"Pair failed, retrying PIN {PINS[pin_i]}...", file=sys.stderr)
                        session.write(f"pair {mac}\n")
                    else:
                        fail = line
        if fail:
            print(fail, file=sys.stderr)
            report_miss(mac, heard)
            return 1
        if not seen:
            report_miss(mac, heard)
            return 1
        if not paired:
            print(f"Saw {mac} but pairing did not finish.", file=sys.stderr)
            report_miss(mac, heard)
            return 1
        session.write(f"trust {mac}\n")
        trust_deadline = time.monotonic() + 8
        trusted = False
        while time.monotonic() < trust_deadline:
            for line in session.read(0.4):
                if re.search(r"Trusted:\s+yes", line) or "trust succeeded" in line.lower():
                    trusted = True
                elif "Failed to trust" in line or "not available" in line.lower():
                    print(line, file=sys.stderr)
                    report_miss(mac, heard)
                    return 1
            if trusted:
                break
        session.write(f"connect {mac}\n")
        time.sleep(2)
        session.write(f"disconnect {mac}\n")
        print(f"Paired and trusted {mac}", file=sys.stderr)
        return 0
    finally:
        session.close()


def print_devices(found: dict[str, dict[str, str | int | None]]) -> None:
    names = cached_names()
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


def usage() -> int:
    print(
        "Usage: list_bluetooth.py [seconds]\n"
        "       list_bluetooth.py --pair MAC [seconds]",
        file=sys.stderr,
    )
    return 2


def parse_args(argv: list[str]) -> tuple[str, str | None, int] | None:
    if not argv:
        return ("scan", None, DEFAULT_SECS)
    if argv[0] in ("-h", "--help"):
        print(
            "Usage: list_bluetooth.py [seconds]\n"
            "       list_bluetooth.py --pair MAC [seconds]",
            file=sys.stderr,
        )
        raise SystemExit(0)
    if argv[0] == "--pair":
        if len(argv) not in (2, 3) or not MAC_RE.fullmatch(argv[1]):
            return None
        secs = PAIR_SECS
        if len(argv) == 3:
            secs = int(argv[2])
        return ("pair", argv[1].upper(), secs)
    if len(argv) > 1:
        return None
    return ("scan", None, int(argv[0]) if argv else DEFAULT_SECS)


def main(argv: list[str]) -> int:
    try:
        parsed = parse_args(argv)
    except ValueError:
        return usage()
    if parsed is None:
        return usage()
    mode, mac, secs = parsed
    if secs < 1:
        print("seconds must be >= 1", file=sys.stderr)
        return 2
    if shutil.which("bluetoothctl") is None:
        print("bluetoothctl not found (install bluez)", file=sys.stderr)
        return 1

    subprocess.run(["rfkill", "unblock", "bluetooth"], check=False, capture_output=True)
    adapter = controller()
    if adapter is None:
        print("No Bluetooth adapter on this machine (no hci controller).", file=sys.stderr)
        print("Check `bluetoothctl show` and `rfkill list bluetooth`.", file=sys.stderr)
        return 1

    if mode == "scan":
        print(f"Adapter {adapter}  scanning for {secs}s...", file=sys.stderr)
        found, scan_error = scan(secs)
        if not found:
            if scan_error:
                print(scan_error, file=sys.stderr)
                return 1
            print("  (none)")
            report_miss(None, found)
            return 0
        print_devices(found)
        return 0

    print(f"Adapter {adapter}  looking for {mac} ({secs}s)...", file=sys.stderr)
    return pair(mac, secs)


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        print("scan interrupted", file=sys.stderr)
        raise SystemExit(130)
