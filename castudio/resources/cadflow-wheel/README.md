# cadflow-wheel — official Windows CadFlow build

`cadflow-0.2.0-cp312-cp312-win_amd64.whl` is the **official** CadFlow 0.2.0
Windows x64 wheel: the upstream `python/cadflow` frontend plus the compiled
`cadflow_core.dll` native backend and the full Open CASCADE (OCCT) 7.9.3
runtime DLL closure, all bundled inside the `cadflow/` package directory.

## Provenance

- Source: <https://github.com/yhz5613813/CadFlow> `main` @ `43fbac0`
  (`43fbac0515a560229d700e07281cc5c08c3f9765`).
- Built with MSVC (Visual Studio 2022 Build Tools) + CMake/Ninja against the
  conda-forge `occt-7.9.3` SDK.
- One Windows CMake patch is required and is vendored here as
  `official-windows.patch` (adds the `WIN32` `.lib` glob for OCCT linking).
- `build_wheel_official.ps1` builds the base wheel from the official source;
  `bundle_wheel.py` unpacks it, copies the native DLL closure into `cadflow/`
  and repacks. Both are kept for reproducibility.

## Installing

`pip install --no-deps cadflow-0.2.0-cp312-cp312-win_amd64.whl`

The wheel carries its own DLLs; no `PATH` or `add_dll_directory` setup is
needed — `cadflow/native.py` loads `cadflow_core.dll` from the package
directory and its OCCT dependencies resolve beside it.

Runtime dependencies (installed separately from PyPI, all with Windows wheels):
numpy, rich, cadquery-ocp (>=7.9.3.1), jsonschema, rfc8785, typing-extensions,
py-slvs (==1.0.6), ocp-gordon, marimo, starlette, uvicorn, websockets — see
`resources/parametric/requirements.txt`.

## Licensing

- CadFlow Python/C++ source: MIT — see the wheel's
  `cadflow-0.2.0.dist-info/licenses/LICENSE`.
- Bundled OCCT 7.9.3 runtime libraries: LGPL-2.1 with the OCCT special
  exception — see `NOTICE-OCCT.md`, `LICENSE_LGPL_21.txt` and
  `OCCT_LGPL_EXCEPTION.txt` in this directory. OCCT source:
  <https://github.com/Open-Cascade-SAS/OCCT> (tag V7_9_3).
