"""Product scene-package helpers -> product.packages (cadflow scene ZIP)."""

from __future__ import annotations

import time
from typing import Any

from ..product.packages import build_product_package, encode_product_package  # noqa: F401


def inspect_product_package(data: bytes) -> dict[str, Any]:
    """Summarise a scene package (counts only)."""

    import io
    import zipfile

    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = zf.namelist()
    return {"members": len(names), "has_scene_json": "scene.json" in names}


def product_package_timing() -> dict[str, float]:
    return {"elapsed": 0.0}


__all__ = [
    "build_product_package",
    "encode_product_package",
    "inspect_product_package",
    "product_package_timing",
]
