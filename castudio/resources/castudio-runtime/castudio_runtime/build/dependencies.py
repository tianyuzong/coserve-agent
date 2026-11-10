"""File-input dependency tracking (minimal port)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class FileInput:
    """A declared file input of a notebook."""

    path: str

    def __init__(self, value: object) -> None:
        if not isinstance(value, str) or not value:
            raise ValueError("file input must be a non-empty path string")
        object.__setattr__(self, "path", value)


def snapshot_file_inputs(
    inputs: Iterable[FileInput], *, project_root: str | Path | None = None
) -> tuple:
    """Snapshot declared file inputs as (path, sha256) pairs for rebuild checks."""

    root = Path(project_root) if project_root is not None else None
    out = []
    for item in inputs:
        path = Path(item.path)
        if not path.is_absolute() and root is not None:
            path = root / path
        digest = ""
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            digest = ""
        out.append((item.path, digest))
    return tuple(out)


__all__ = ["FileInput", "snapshot_file_inputs"]
