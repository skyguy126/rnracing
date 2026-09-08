"""
Simulated OBD connection for laptop / dual-radio bring-up.

Duck-types the subset of python-obd that transmit.py uses:
  OBD().is_connected(), protocol_name(), query(cmd), close()
  commands.SPEED / RPM / … / STATUS / GET_DTC
  response.value (.magnitude for sensors; Status / DTC list for MIL)

DTC cycle: silent until t=10s → codes on for 15s → clear → wait 60s → repeat.
"""

from __future__ import annotations

import math
import time


class _Cmd:
    __slots__ = ("name",)

    def __init__(self, name: str) -> None:
        self.name = name


class commands:  # noqa: N801 — mirror python-obd.commands
    SPEED = _Cmd("speed")
    RPM = _Cmd("rpm")
    COOLANT_TEMP = _Cmd("coolant_temp")
    THROTTLE_POS = _Cmd("throttle")
    ENGINE_LOAD = _Cmd("engine_load")
    FUEL_LEVEL = _Cmd("fuel_level")
    STATUS = _Cmd("status")
    GET_DTC = _Cmd("get_dtc")


class _Quantity:
    __slots__ = ("magnitude",)

    def __init__(self, magnitude: float) -> None:
        self.magnitude = magnitude


class _Status:
    __slots__ = ("MIL", "DTC_count", "ignition_type")

    def __init__(self, mil: bool, count: int) -> None:
        self.MIL = mil
        self.DTC_count = count
        self.ignition_type = "spark"


class _Response:
    __slots__ = ("value",)

    def __init__(self, value) -> None:
        self.value = value


_SIM_DTCS = [
    ("P0301", "Cylinder 1 Misfire Detected"),
    ("P0420", "Catalyst System Efficiency Below Threshold"),
]


def _dtcs_active(t: float) -> bool:
    """Off until 10s; then 15s on / 60s off repeating."""
    if t < 10.0:
        return False
    return ((t - 10.0) % 75.0) < 15.0


class OBD:
    """Always-connected fake adapter with smoothly varying PIDs + cycling DTCs."""

    def __init__(self, *args, **kwargs) -> None:
        self._t0 = time.time()

    def is_connected(self) -> bool:
        return True

    def protocol_name(self) -> str:
        return "SIM"

    def close(self) -> None:
        return None

    def query(self, cmd: _Cmd) -> _Response:
        t = time.time() - self._t0
        name = getattr(cmd, "name", None)

        if name == "status":
            active = _dtcs_active(t)
            return _Response(_Status(active, len(_SIM_DTCS) if active else 0))

        if name == "get_dtc":
            return _Response(list(_SIM_DTCS) if _dtcs_active(t) else [])

        values = {
            "speed": round(80 + 40 * math.sin(t / 8.0), 2),  # km/h (like python-obd; TX converts to mph)
            "rpm": round(2500 + 2000 * (0.5 + 0.5 * math.sin(t / 3.0)), 2),
            "coolant_temp": round(85 + 8 * math.sin(t / 60.0), 2),
            "throttle": round(30 + 40 * (0.5 + 0.5 * math.sin(t / 4.0)), 2),
            "engine_load": round(40 + 30 * (0.5 + 0.5 * math.sin(t / 5.0)), 2),
            "fuel_level": round(max(5.0, 70 - t / 120.0), 2),
        }
        if name not in values:
            return _Response(None)
        return _Response(_Quantity(values[name]))
