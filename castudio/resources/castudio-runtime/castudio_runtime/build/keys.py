"""Cache-key / generator-profile helpers (minimal port)."""

from __future__ import annotations

import platform
import sys
from pathlib import Path
from typing import Any


def generator_profile() -> dict[str, Any]:
    """Environment fingerprint folded into cache keys."""

    try:
        import cadflow

        engine = f"cadflow {getattr(cadflow, '__version__', '0.2.0')}"
    except Exception:  # pragma: no cover
        engine = "cadflow"
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "engine": engine,
    }


def infer_project_root(start: str | Path | None = None) -> Path:
    """Best-effort project root (directory containing the notebook)."""

    return Path(start).resolve().parent if start is not None else Path.cwd()


__all__ = ["generator_profile", "infer_project_root"]
