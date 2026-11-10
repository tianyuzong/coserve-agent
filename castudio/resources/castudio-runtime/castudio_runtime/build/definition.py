"""Product definition helpers (minimal cadflow-backed).

cadflow has no durable ``Definition`` artifact; the product value is compiled
directly into a scene package.  These names exist so the runtime's imports
resolve; the ``finish_*``/``check_*`` helpers are pass-throughs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Definition:
    """Lightweight stand-in for the upstream durable definition."""

    product: Any = None
    product_id: str = ""
    kind: str = ""
    revision: str = ""
    tolerance_profile: str = ""
    file_inputs: tuple = ()
    project_root: Any = None

    @property
    def definition_id(self) -> str:
        return self.product_id

    @property
    def definition_kind(self) -> str:
        return self.kind

    @property
    def content_hash(self) -> str:
        return ""


def check_declared_profiles(declared: Any, tolerance_profile: Any) -> None:
    return None


def finish_part_definition(session: Any, product: Any, **kwargs: Any):
    from .results import PartBuildResult

    return PartBuildResult(value=product)


def finish_assembly_definition(session: Any, product: Any, **kwargs: Any):
    from .results import AssemblyBuildResult

    return AssemblyBuildResult(value=product)


__all__ = [
    "Definition",
    "check_declared_profiles",
    "finish_assembly_definition",
    "finish_part_definition",
]
