"""Build-result wrappers (minimal)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PartBuildResult:
    value: Any
    definition: Any = None
    file_inputs: tuple = ()


@dataclass(frozen=True)
class AssemblyBuildResult:
    value: Any
    definition: Any = None
    file_inputs: tuple = ()


__all__ = ["AssemblyBuildResult", "PartBuildResult"]
