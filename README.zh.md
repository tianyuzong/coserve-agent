# CoServe AI

[English](README.md) | 中文

CoServe AI 是基于原生 DeepSeek Harness 的工程智能体工作台。它把 harness 的对话、工具与会话运行时，和 CAStudio——一个本地 CAD/CAE 服务——组合在一起，支持参数化建模、项目工作区、场景检视、构建、测量以及结构分析与热分析。

本仓库是开发者预览版：接口、打包方式和数据格式会随版本变化，目前还没有发布预编译安装包。请从源码构建，或自行打包。

## 仓库包含什么

- **桌面应用**（`apps/desktop`）：Electron 外壳，内置 harness 运行时与 CAStudio 服务，并负责管理服务的生命周期。
- **Harness**（`packages/**`）：支撑对话、工具、会话、技能与 Web UI 的插件体系。
- **CAStudio 服务**（`castudio`）：独立 npm 项目，包含 CAD 服务端、参数化编辑器、场景查看器与仿真路由。
- **CAD 工作区 UI**（`packages/client/ui-castudio`）：右侧 CAD 面板及其控制器。
- **智能体工具**（`packages/context/tool-castudio`）：面向模型的 `cad_workbench` 工具与逐步骤的 CAStudio 项目上下文。

## 仓库结构

```text
apps/desktop
apps/cli
apps/web
packages/
castudio/
docs/
```

## 环境要求

- 桌面应用与 CAD 服务需要 Windows 10/11 x64；harness 本身也支持 macOS 与 Linux。
- Node.js 24.9 或更高版本（24.x LTS），以及 pnpm 11，用 `corepack enable pnpm` 启用。
- Python 3.12，仅在需要可选的参数化 CAD 环境时安装。
- 能访问 npm registry 的网络、约 10 GB 可用磁盘，以及首次构建所需的时间。

## 从源码运行桌面版

桌面版就是完整产品：一个窗口里同时有对话、CAD 工作区和内置服务。从干净的检出开始：

```powershell
git clone https://github.com/yhz5613813/coserve-agent.git
cd coserve-agent
corepack enable pnpm
pnpm install
pnpm run dev:desktop
```

第一次 `dev:desktop` 会构建桌面端产物、准备运行时负载并启动 Electron，需要几分钟并下载几百兆内容。之后的启动直接复用已准备好的产物：

```powershell
pnpm run start:desktop
```

<a id="run-the-web-ui"></a>
## 运行 Web UI

harness 也提供不带 Electron 外壳的浏览器界面：

```powershell
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm dsh web` 会在 `http://127.0.0.1:3080` 提供 Web UI。该模式没有自己的 CAD 面板服务。

<a id="public-deployments"></a>
## 公开部署

`dsh web` 为本地会话绑定回环接口。把 harness 暴露到本机之外属于你自己的部署决策：请放在带认证的反向代理之后，并在改动认证或存储配置前先查阅配置目录。

## CAD 工作区

- 打包后的桌面应用会在 `http://127.0.0.1:4317` 启动内置的 CAStudio 服务，除非该地址已有进程在应答。
- 从源码运行时，桌面应用会直接使用该地址上已在运行的服务，需要在另一个终端里先启动它。
- 参数化建模、结构分析与热分析需要可选的 Python 环境，用内置脚本安装一次即可。
- 随仓库提供的 CadFlow wheel 面向 Windows x64 与 Python 3.12。

```powershell
cd castudio
npm ci
npm run dev
```

## 打包 Windows 版本

生成未签名的 NSIS 安装包和解包后的应用目录：

```powershell
pnpm run package:desktop:win:x64:unsigned
```

产物位于 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts`。打包需要与源码构建相同的工具链，外加约 4 GB 可用工作空间；完整跑一次约需十到十五分钟。

## 文档

- [快速开始](docs/quickstart.zh.md)：从干净的 Windows 机器到运行桌面版的完整步骤。
- [桌面服务与打包](apps/desktop/README.zh.md)：服务生命周期、环境变量与打包细节。
- [CAStudio](castudio/README.md)：CAD 服务、项目与 HTTP API。
- [双语文档约定](docs/i18n/README.zh.md)：英文与中文文档如何保持配对。

## 许可证

CoServe AI 以 [MIT 许可证](LICENSE)发布。第三方组件及其声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 [castudio/THIRD_PARTY_NOTICES.md](castudio/THIRD_PARTY_NOTICES.md)。
