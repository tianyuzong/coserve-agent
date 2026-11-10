# castudio-runtime

CAStudio's parametric notebook runtime and live-cell editor, backed by
**cadflow 0.2.0** — the official build ships the compiled `cadflow_core`
native backend (OCCT 7.9.3) alongside the recorded-graph engine, so both
`cad.Model()` and the `make_*_r*` operators are available.

Adapted from SimpleCADAPI 2.2.6.post2 (Apache-2.0 — see `LICENSE` /
`THIRD_PARTY.txt`).  Install alongside the vendored cadflow wheel:

    pip install --no-deps <this dir> <cadflow wheel .whl>

The marimo cell executor entry point is `castudio_runtime.runtime.executor:executor_factory`;
notebooks opt in with a `[tool.castudio]` PEP 723 table.
