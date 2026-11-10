# Quickstart

English | [中文](quickstart.zh.md)

This page takes a clean Windows machine to a running CoServe AI desktop app with the CAD workspace, and shows the optional steps for the parametric environment and for packaging an installer.

## What you need

- Windows 10 or 11 on x64. The desktop app and the bundled CAD service are built and tested there; macOS and Linux can run the harness and web UI, not the packaged CAD stack.
- Node.js 24.9 or newer. Install the 24.x LTS release and confirm it with `node --version`.
- pnpm 11. It ships with Node through Corepack, so `corepack enable pnpm` is enough; the repository pins `pnpm@11.28.5` in `package.json`.
- Git, plus a GitHub account when you want to push changes back.
- Python 3.12 only if you plan to use parametric modelling, structural analysis or thermal analysis.
- About 10 GB of free disk for dependencies, build output and the prepared runtime, and a network that can reach the npm registry.

## 1. Clone and install

```powershell
git clone https://github.com/yhz5613813/coserve-agent.git
cd coserve-agent
corepack enable pnpm
pnpm install
```

`pnpm install` resolves about 400 workspace projects and writes roughly 2.5 GB of dependencies. The first run takes five to fifteen minutes depending on the network; later runs reuse the pnpm store.

## 2. Build and launch the desktop app

```powershell
pnpm run dev:desktop
```

The launcher compiles the desktop bundles, prepares the runtime payload, starts the harness host and opens the Electron window with DevTools. Expect several minutes and a few hundred megabytes of downloads on the first run.

After the first run, launch again without rebuilding:

```powershell
pnpm run start:desktop
```

Development state lives under `apps/desktop/.desktop-build`; set `COSERVE_HOME` to choose another harness home, or `DSH_DESKTOP_USER_DATA_DIR` to isolate the Electron profile.

## 3. Start the CAStudio service

The CAD pane talks to a local service on `http://127.0.0.1:4317`. A packaged build starts it automatically; a source build expects you to run it.

```powershell
cd castudio
npm ci
npm run dev
```

Leave that terminal open. The service serves the CAD projects, the parametric editor, scene inspection and the simulation routes. `STUDIO_PORT` changes the port, and `COSERVE_CASTUDIO_URL` changes the address the desktop app probes.

## 4. Install the parametric CAD environment

```powershell
node castudio/scripts/setup-cad-env.mjs
```

The script creates a Python 3.12 environment of about 1.1 GB, installs the pinned requirements plus the vendored CadFlow wheel and CAStudio runtime, then records the interpreter in the CAStudio data directory. Rerunning it reuses a healthy environment; `--dry-run` prints the plan without changing anything.

## 5. Package a Windows installer

```powershell
pnpm run package:desktop:win:x64:unsigned
```

The build stages the CAStudio service, packs the harness runtime and produces an unsigned NSIS installer plus an unpacked directory under `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts`. A full run takes ten to fifteen minutes and needs roughly 4 GB of working space.

## Troubleshooting

- **`pnpm` is not recognized**: run `corepack enable pnpm` once, then open a new terminal; the repository expects the pnpm version pinned in `package.json`.
- **Unsupported engine warning**: the workspace asks for Node 24.9 or newer; older releases usually build, but the desktop runtime and the packaging toolchain are qualified on Node 24.
- **Electron or registry downloads stall**: configure an npm mirror or a proxy (`npm config set proxy`, or a `pnpm` mirror in `.npmrc`); the first install is the only step that needs the full dependency graph.
- **Port 4317 is already in use**: start the service with `STUDIO_PORT=4320` and point the desktop app at it with `COSERVE_CASTUDIO_URL=http://127.0.0.1:4320`.
- **The CAD pane stays empty**: the desktop app could not reach the service; confirm `curl http://127.0.0.1:4317/api/dsh/projects` answers, and check that the service terminal is still running.

## Next steps

- Read the [repository README](../README.md) for the product overview and the web UI path.
- Read the [CAStudio README](../castudio/README.md) when you want the project model and its HTTP API.
- Read the [desktop README](../apps/desktop/README.md) before changing the service lifecycle or the packaging pipeline.
