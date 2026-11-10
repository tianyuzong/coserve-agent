"""The marimo cell executor: one shared recording session per notebook run.

marimo loads a single ``marimo.cell.executor`` entry point for every
notebook it runs, the web editor's included.  The editor keeps a session of
its own, so a cell session there would record operations the editor never
sees.  :class:`CastudioExecutor` therefore only steps in for notebooks
that declare ``[tool.castudio]``; any other notebook runs exactly as
under marimo's default executor.

For a CAStudio notebook every cell of a run records into ONE shared
:class:`~castudio_runtime.recording.graph.GraphSession` (``scope.session``),
created fresh for each run/kernel.  cadflow's recorder uses random node ids
and has no ``adopt``/``namespace``/``shared_lineage`` machinery, so cells
cannot each own a session: a value built in one cell and consumed by the
next must belong to the same graph.  The shared session is entered around
each cell body; its graph accumulates every cell's nodes for the run.

After the cell body runs, every tolerance requirement it declared must be
held by one of its variables; see :func:`.cells.bound_requirements`.

While a cell runs, :func:`notebook_id` returns the id of the run: the
header's id, or the one a caller passed to ``run_notebook``/``use``.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..recording.graph import GraphSession
from ..recording.source_mapping import cell_sources
from ._marimo import (
    CellImpl,
    DefaultExecutor,
    Executor,
    MarimoRescheduleError,
    MarimoRuntimeException,
    MutableGlobals,
    RunResult,
    safe_get_context,
)
from . import prefetch
from .cache import CellCache, CellDigests, cache_root, prune
from .cells import NotebookCells, bound_requirements
from .config import NotebookConfig, read_notebook_config
from .params import apply_saved_params, read_saved_params


class UnboundRequirementError(RuntimeError):
    """A cell declared a tolerance requirement no variable holds.

    The cell cache stores variables only; an unbound requirement would be
    silently lost the next time the cell is restored from the cache.
    """


@dataclass(frozen=True)
class NotebookScope:
    """The notebook a cell belongs to, as the executor needs it."""

    config: NotebookConfig
    cells: NotebookCells
    graph: Any = None
    """marimo's dataflow graph of the notebook, known when marimo itself runs it."""
    session: Any = None
    """The shared :class:`GraphSession` for this run; ``None`` records nothing."""


_running: ContextVar[NotebookScope | None] = ContextVar(
    "castudio_runtime_running_notebook", default=None
)
"""The scope of the cell running in this context, if any."""


def notebook_id() -> str:
    """Return the id of the notebook run the calling cell belongs to.

    It is the header's ``id`` unless the run was started with another
    (``run_notebook(path, id=...)``, ``use(path, id=...)``), so a notebook
    that names its product with it describes a part family: each id is one
    member, with a definition of its own.
    """

    scope = _running.get()
    if scope is None:
        raise RuntimeError("notebook_id() is only available while a CAStudio notebook cell runs")
    return scope.config.id


class CastudioExecutor:
    """Run cells like marimo's default executor, recording per cell.

    Pass *scope* when the caller knows the notebook (a headless run, which
    may be nested inside another notebook's kernel).  Without it the
    executor looks the notebook up from marimo's runtime context for each
    cell, which is what the editor kernel needs.

    Stage 1: the cell cache is disabled — every run re-executes all cells
    into a fresh shared session, so restored values can never carry stale
    graph lineage.  The cache code (:mod:`.cache`, :func:`_kernel_cache`)
    is kept intact so caching can return in a later stage.
    """

    name = "castudio"

    def __init__(self, scope: NotebookScope | None = None) -> None:
        self._scope = scope
        self._delegate = DefaultExecutor()

    def execute_cell(self, cell: CellImpl, glbls: MutableGlobals) -> Any:
        scope = self._scope or _context_scope()
        if scope is None or cell.cell_id not in scope.cells:
            return self._delegate.execute_cell(cell, glbls)
        cache = self._cache_for(scope, cell)
        restored = _restore(cache, cell, glbls)
        if restored is not _MISS:
            return restored
        cache = cache if restored is _MISS else None
        _prefetch(scope, cell, glbls)
        try:
            with _cell_recording(scope, cell, glbls):
                result = self._delegate.execute_cell(cell, glbls)
                self._apply_saved(scope, cell, glbls)
        except BaseException as error:
            _store(cache, cell, glbls, None, error)
            raise
        _store(cache, cell, glbls, result, None)
        return result

    async def execute_cell_async(self, cell: CellImpl, glbls: MutableGlobals) -> Any:
        scope = self._scope or _context_scope()
        if scope is None or cell.cell_id not in scope.cells:
            return await self._delegate.execute_cell_async(cell, glbls)
        cache = self._cache_for(scope, cell)
        restored = _restore(cache, cell, glbls)
        if restored is not _MISS:
            return restored
        _prefetch(scope, cell, glbls)
        try:
            with _cell_recording(scope, cell, glbls):
                result = await self._delegate.execute_cell_async(cell, glbls)
                self._apply_saved(scope, cell, glbls)
        except BaseException as error:
            _store(cache, cell, glbls, None, error)
            raise
        _store(cache, cell, glbls, result, None)
        return result

    def _apply_saved(
        self, scope: NotebookScope, cell: CellImpl, glbls: MutableGlobals
    ) -> None:
        # Only the editor kernel (no scope given) takes the values an editor
        # saved; a headless run takes the overrides it is passed (see params).
        if self._scope is None:
            apply_saved_params(scope.config, set(cell.defs), glbls)

    def _cache_for(self, scope: NotebookScope, cell: CellImpl) -> CellCache | None:
        """The cell cache of the editor kernel's notebook; ``None`` where there is none.

        Stage 1 disables the cell cache entirely (``_CELL_CACHE_ENABLED``):
        restored values would carry graph lineage the fresh shared session
        does not own.  Re-enable by flipping the flag once the cache stores
        and restores lineage-aware values.
        """

        if not _CELL_CACHE_ENABLED:
            return None
        if self._scope is not None or scope.graph is None or os.environ.get("SCA_NO_KERNEL_CACHE"):
            return None
        return _kernel_cache(scope, cell)


def _prefetch(scope: NotebookScope, cell: CellImpl, glbls: MutableGlobals) -> None:
    """Start the notebooks the cell is about to ``use`` in worker processes."""

    try:
        prefetch.start(scope.config.directory, cell.code, glbls, scope.config.id)
    except Exception:  # noqa: BLE001 - an optimisation, never a reason for a cell to fail
        pass


_MISS = object()
"""Returned by :func:`_restore` when the cell must run."""


def _restore(cache: CellCache | None, cell: CellImpl, glbls: MutableGlobals) -> Any:
    """Restore *cell* from the cache: its output, or ``_MISS`` if it has to run."""

    if cache is None:
        return _MISS
    try:
        skip = cache.setup(cell, glbls)
    except MarimoRescheduleError:
        # A value the cache could not restore: run the cell live, store nothing.
        cache._active.pop(cell.cell_id, None)
        return _MISS
    if skip is None:
        return _MISS
    return skip.result.output


def _store(
    cache: CellCache | None,
    cell: CellImpl,
    glbls: MutableGlobals,
    output: Any,
    error: BaseException | None,
) -> None:
    if cache is not None:
        cache.teardown(cell, glbls, RunResult(output=output, exception=error))


@dataclass
class _KernelCache:
    graph: Any
    signature: tuple
    digests: CellDigests
    lifecycle: CellCache


_kernel_caches: dict[Path, _KernelCache] = {}
_KEEP_DIGESTS = 64
"""How many of the most recently used digests the kernel keeps on disk."""


def _kernel_cache(scope: NotebookScope, cell: CellImpl) -> CellCache | None:
    """The cell cache for the notebook marimo is running; rebuilt when its cells change."""

    if cell.cell_id == "setup":
        return None  # like marimo, never cache the setup cell
    config = scope.config
    graph = scope.graph
    cells = list(graph.cells.values())
    saved = read_saved_params(config)
    signature = (
        tuple((item.cell_id, item.code) for item in cells),
        tuple(sorted(saved.items())),
    )
    entry = _kernel_caches.get(config.path)
    if entry is not None and entry.graph is graph and entry.signature == signature:
        return entry.lifecycle
    digests = CellDigests(config, cells, graph.cells.get("setup"), saved=saved, kernel=True)
    if entry is not None and entry.graph is graph:
        entry.signature, entry.digests = signature, digests
        return entry.lifecycle
    entry = _KernelCache(graph=graph, signature=signature, digests=digests, lifecycle=None)  # type: ignore[arg-type]
    entry.lifecycle = CellCache(
        graph, cache_root(config), lambda item: entry.digests.digest(item.cell_id)
    )
    _kernel_caches[config.path] = entry
    return entry.lifecycle


def finish_kernel_cache(config: NotebookConfig) -> None:
    """Write out the kernel's pending cache entries and drop the old ones.

    The cache pickles values on background threads, and projecting the product
    modifies it: flush first.  Called by :func:`.live.live_package`.
    """

    entry = _kernel_caches.get(config.path)
    if entry is None:
        return
    entry.lifecycle.flush()
    prune(cache_root(config), entry.lifecycle.recent(_KEEP_DIGESTS))


_CELL_CACHE_ENABLED = False
"""Stage 1: the cell cache is off (see :meth:`CastudioExecutor._cache_for`)."""


def executor_factory() -> Executor:
    """The ``marimo.cell.executor`` entry point."""

    return CastudioExecutor()


def _context_scope() -> NotebookScope | None:
    """Return the scope of the notebook marimo is running, if it is ours.

    The editor kernel runs cells one at a time but they must all record into
    ONE graph, so the shared session is kept per notebook for the kernel's
    lifetime (a fresh marimo kernel gets a fresh session).
    """

    context = safe_get_context()
    if context is None or context.filename is None:
        return None
    config = read_notebook_config(context.filename)
    if config is None:
        return None
    return NotebookScope(
        config,
        NotebookCells(config.path, context.graph.cells.values()),
        graph=context.graph,
        session=_kernel_session(config),
    )


_kernel_sessions: dict[Path, Any] = {}


def _kernel_session(config: NotebookConfig) -> Any:
    """The shared :class:`GraphSession` of the editor kernel's notebook."""

    session = _kernel_sessions.get(config.path)
    if session is None:
        session = GraphSession(graph_id=config.id)
        _kernel_sessions[config.path] = session
    return session


def reset_kernel_session(config: NotebookConfig) -> None:
    """Drop the kernel's shared session so the next cell run starts a fresh graph."""

    _kernel_sessions.pop(config.path, None)


def reset_all_kernel_sessions() -> None:
    """Drop every kernel's shared session so the next run starts fresh graphs.

    Stage 1 runs each notebook "run" as a fresh shared :class:`GraphSession`
    that re-executes all cells in order; cadflow reserves semantic ids
    (``part_id``/``material_id``/...) per session, so a session kept across
    runs would reject the second registration of the same id.  The editor
    calls this before each full rebuild.
    """

    _kernel_sessions.clear()


@contextmanager
def _cell_recording(
    scope: NotebookScope, cell: CellImpl, glbls: MutableGlobals
) -> Iterator[None]:
    session = scope.session
    token = _running.set(scope)
    try:
        with cell_sources(scope.cells):
            if session is None:
                yield
            else:
                # Re-enter the shared session: its graph accumulates every
                # cell's nodes for the run (fresh session per run/kernel).
                with session:
                    yield
    finally:
        _running.reset(token)
    # Reached only when the body succeeded; failures propagate untouched.
    if session is not None:
        _check_bound(session, cell, glbls)


def _check_bound(session: GraphSession, cell: CellImpl, glbls: MutableGlobals) -> None:
    held = {
        id(requirement)
        for requirement in bound_requirements(
            glbls[name] for name in cell.defs if name in glbls
        )
    }
    unbound = [
        requirement.name
        for requirement in session.tolerance_graph.requirements
        if id(requirement) not in held
    ]
    if unbound:
        error = UnboundRequirementError(
            f"tolerance requirements {unbound} are not held by any variable "
            "this cell defines; assign each one, e.g. "
            "`req = cad.get_active_session().require_tolerance(...)`, so the "
            "cell cache keeps it"
        )
        # Raised like a failing cell body, so marimo reports it as one.
        raise MarimoRuntimeException from error


__all__ = [
    "NotebookScope",
    "CastudioExecutor",
    "UnboundRequirementError",
    "executor_factory",
    "finish_kernel_cache",
    "notebook_id",
    "reset_all_kernel_sessions",
]
