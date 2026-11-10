"""Recorded-operation graph session for CAStudio notebooks.

CAStudio notebooks record into cadflow's :class:`GraphSession`.  Unlike the
upstream SimpleCADAPI runtime, cells share ONE session per notebook run (a
fresh session per run/kernel) rather than a per-cell namespaced session with
shared lineage: cadflow's recorder uses random node ids and has no
``adopt``/``namespace`` machinery.  See ``runtime/executor.py``.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

# cadflow's recorded-graph session and its recording context variables.
from cadflow._engine.workflow.graph import (  # noqa: F401
    GraphSession,
    get_active_session,
    suspend_graph_recording,
    _active_session_var,
    _recording_suspend_depth_var,
)
from cadflow._engine.geometry.core import WORLD_CS, use_coordinate_system


@contextmanager
def isolated_recording() -> Iterator[None]:
    """Run a nested build as if it were called at top level.

    The caller's session is hidden (no active session, recording not
    suspended) and the world coordinate system is current, so the nested
    build records only into its own session and does not depend on where it
    was called from.  Everything is restored on exit.
    """

    session_token = _active_session_var.set(None)
    suspend_token = _recording_suspend_depth_var.set(0)
    try:
        with use_coordinate_system(WORLD_CS):
            yield
    finally:
        _recording_suspend_depth_var.reset(suspend_token)
        _active_session_var.reset(session_token)


__all__ = [
    "GraphSession",
    "get_active_session",
    "isolated_recording",
    "suspend_graph_recording",
]
