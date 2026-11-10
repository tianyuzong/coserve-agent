# CoServe AI

English | [中文](README.zh.md)

CoServe AI is an engineering agent workspace built on the native DeepSeek Harness. It pairs the harness conversation, tools and session runtime with CAStudio, a local CAD/CAE service for parametric models, project workspaces, scene inspection, builds, measurements and structural or thermal analysis.

This repository is a developer preview: interfaces, packaging and data formats change between versions, and no prebuilt installer is published yet. Build the product from source, or package it yourself.

## What is inside

- **Desktop app** (`apps/desktop`): the Electron shell that bundles the harness runtime and the CAStudio service, and manages the service lifecycle.
- **Harness** (`packages/**`): the plugin architecture behind conversation, tools, sessions, skills and the web UI.
- **CAStudio service** (`castudio`): a self-contained npm project with the CAD server, parametric editor, scene viewer and simulation routes.
- **CAD workspace UI** (`packages/client/ui-castudio`): the right-hand CAD pane and its controller.
- **Agent tools** (`packages/context/tool-castudio`): the model-facing `cad_workbench` tool and the per-step CAStudio project context.

## Repository layout

```text
apps/desktop
apps/cli
apps/web
packages/
castudio/
docs/
```

## Requirements

- Windows 10/11 x64 for the desktop app and the CAD service; the harness itself also runs on macOS and Linux.
- Node.js 24.9 or newer (24.x LTS) and pnpm 11, enabled with `corepack enable pnpm`.
- Python 3.12, only when you want the optional parametric CAD environment.
- Network access to the npm registry, about 10 GB of free disk, and time for the first build.

## Run the desktop app from source

The desktop app is the complete product: one window with the conversation, the CAD workspace and the bundled service. From a clean checkout:

```powershell
git clone https://github.com/yhz5613813/coserve-agent.git
cd coserve-agent
corepack enable pnpm
pnpm install
pnpm run dev:desktop
```

The first `dev:desktop` builds the desktop bundles, prepares the runtime payload and launches Electron, which takes several minutes and downloads a few hundred megabytes. Later launches use the prepared artifacts:

```powershell
pnpm run start:desktop
```

## Run the web UI

The harness also ships a browser UI without the Electron shell:

```powershell
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm dsh web` serves the web UI on `http://127.0.0.1:3080`. This mode has no CAD pane service of its own.

## Public deployments

`dsh web` binds a loopback interface for a local session. Exposing the harness beyond the local machine is your own deployment decision: put it behind an authenticated reverse proxy, and review the configuration catalog before changing authentication or storage settings.

## CAD workspace

- The packaged desktop app starts the bundled CAStudio service on `http://127.0.0.1:4317` unless another process already answers there.
- From source, the desktop app expects that service to be running already; start it in a second terminal.
- Parametric modelling, structural analysis and thermal analysis need the optional Python environment, installed once with the bundled script.
- The vendored CadFlow wheel targets Windows x64 with Python 3.12.

```powershell
cd castudio
npm ci
npm run dev
```

## Package a Windows build

Produce an unsigned NSIS installer and an unpacked app directory:

```powershell
pnpm run package:desktop:win:x64:unsigned
```

Artifacts land in `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts`. Packaging needs the same toolchain as the source build plus roughly 4 GB of free working space; a full run takes about ten to fifteen minutes.

## Documentation

- [Quickstart](docs/quickstart.md): the step-by-step path from a clean Windows machine to a running desktop app.
- [Desktop service and packaging](apps/desktop/README.md): service lifecycle, environment variables and packaging details.
- [CAStudio](castudio/README.md): the CAD service, its projects and its HTTP API.
- [Bilingual documentation contract](docs/i18n/README.md): how English and Chinese documents stay paired.

## License

CoServe AI is released under the [MIT license](LICENSE). Third-party components and their notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [castudio/THIRD_PARTY_NOTICES.md](castudio/THIRD_PARTY_NOTICES.md).
