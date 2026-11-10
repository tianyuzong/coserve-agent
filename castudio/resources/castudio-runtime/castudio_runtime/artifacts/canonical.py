"""Canonical JSON and logical-id validation for CAStudio artifacts.

Minimal port of the SimpleCADAPI helpers the runtime uses for digests and
identity checks; backed by cadflow's canonical JSON where possible.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


class ArtifactValidationError(ValueError):
    """An artifact failed validation."""


class ArtifactError(ValueError):
    """An artifact could not be read or written."""


_LOGICAL_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$")


def validate_logical_id(value: Any, path: str = "/id") -> str:
    """Return *value* as a valid logical id or raise :class:`ArtifactValidationError`."""

    if not isinstance(value, str) or not _LOGICAL_ID.match(value):
        raise ArtifactValidationError(f"{path}: invalid logical id {value!r}")
    return value


def validate_revision(value: Any, path: str = "/revision") -> str:
    """Return *value* as a valid revision string."""

    if not isinstance(value, str) or not value or len(value) > 128:
        raise ArtifactValidationError(f"{path}: invalid revision {value!r}")
    return value


def canonical_bytes(value: Any) -> bytes:
    """Deterministic JSON encoding used for digests."""

    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


__all__ = [
    "ArtifactError",
    "ArtifactValidationError",
    "canonical_bytes",
    "sha256_bytes",
    "validate_logical_id",
    "validate_revision",
]
