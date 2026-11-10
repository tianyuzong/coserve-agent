"""Declared-definition discovery (minimal)."""

from __future__ import annotations

from typing import Any


def declared_definitions(items: Any) -> tuple[list, list]:
    """cadflow products carry no upstream definitions; nothing is declared."""

    return [], []


__all__ = ["declared_definitions"]
