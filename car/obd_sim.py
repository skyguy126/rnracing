"""
Simulated OBD connection for laptop / dual-radio bring-up.

Duck-types the subset of python-obd that transmit.py uses:
  OBD().is_connected(), protocol_name(), query(cmd), close()
  commands.SPEED / RPM / COOLANT_TEMP / THROTTLE_POS / ENGINE_LOAD / FUEL_LEVEL
  response.value.magnitude
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


class _Quantity:
    __slots__ = ("magnitude",)

    def __init__(self, magnitude: float) -> None:
        self.magnitude = magnitude


class _Response:
    __slots__ = ("value",)

    def __init__(self, magnitude: float | None) -> None:
        self.value = None if magnitude is None else _Quantity(magnitude)


class OBD:
    """Always-connected fake adapter with smoothly varying PIDs."""

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
        values = {
            "speed": round(80 + 40 * math.sin(t / 8.0), 2),
            "rpm": round(2500 + 2000 * (0.5 + 0.5 * math.sin(t / 3.0)), 2),
            "coolant_temp": round(85 + 8 * math.sin(t / 60.0), 2),
            "throttle": round(30 + 40 * (0.5 + 0.5 * math.sin(t / 4.0)), 2),
            "engine_load": round(40 + 30 * (0.5 + 0.5 * math.sin(t / 5.0)), 2),
            "fuel_level": round(max(5.0, 70 - t / 120.0), 2),
        }
        name = getattr(cmd, "name", None)
        if name not in values:
            return _Response(None)
        return _Response(values[name])
