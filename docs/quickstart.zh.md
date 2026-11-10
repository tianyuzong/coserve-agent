# 快速开始

[English](quickstart.md) | 中文

本页把一台干净的 Windows 机器带到"CoServe AI 桌面版 + CAD 工作区"可运行的状态，并给出参数化环境与打包安装包的可选步骤。

## 你需要准备

- Windows 10 或 11 x64。桌面应用与内置 CAD 服务只在这里构建和验证；macOS 与 Linux 可以运行 harness 和 Web UI，但没有打包的 CAD 栈。
- Node.js 24.9 或更高版本，安装 24.x LTS 后用 `node --version` 确认。
- pnpm 11。Node 通过 Corepack 自带它，执行 `corepack enable pnpm` 即可；仓库在 `package.json` 里锁定了 `pnpm@11.28.5`。
- Git；需要把改动推回仓库时还要一个 GitHub 账号。
- 只有在使用参数化建模、结构分析或热分析时，才需要 Python 3.12。
- 约 10 GB 可用磁盘，用于依赖、构建产物与准备好的运行时；网络需能访问 npm registry。

## 1. 克隆并安装依赖

```powershell
git clone https://github.com/yhz5613813/coserve-agent.git
cd coserve-agent
corepack enable pnpm
pnpm install
```

`pnpm install` 会解析约 400 个工作区项目，写入约 2.5 GB 依赖。首次视网络情况需要五到十五分钟，之后会复用 pnpm 存储。

## 2. 构建并启动桌面版

```powershell
pnpm run dev:desktop
```

启动器会编译桌面端产物、准备运行时负载、启动 harness 主机并打开带 DevTools 的 Electron 窗口。首次运行需要几分钟，并会下载几百兆内容。

首次之后，不重新构建直接再启动：

```powershell
pnpm run start:desktop
```

开发状态位于 `apps/desktop/.desktop-build`；可用 `COSERVE_HOME` 指定另一个 harness 主目录，或用 `DSH_DESKTOP_USER_DATA_DIR` 隔离 Electron 配置目录。

## 3. 启动 CAStudio 服务

CAD 面板连接的是 `http://127.0.0.1:4317` 上的本地服务。打包版本会自动启动它；源码运行时需要你手动启动。

```powershell
cd castudio
npm ci
npm run dev
```

保持这个终端运行。服务提供 CAD 项目、参数化编辑器、场景检视与仿真路由。`STUDIO_PORT` 可改端口，`COSERVE_CASTUDIO_URL` 可改桌面端探测的地址。

## 4. 安装参数化 CAD 环境

```powershell
node castudio/scripts/setup-cad-env.mjs
```

脚本会创建约 1.1 GB 的 Python 3.12 环境，安装锁定的依赖、随仓库提供的 CadFlow wheel 与 CAStudio 运行时，然后在 CAStudio 数据目录中登记解释器。重复运行会复用健康环境；`--dry-run` 只打印计划、不做更改。

## 5. 打包 Windows 安装包

```powershell
pnpm run package:desktop:win:x64:unsigned
```

构建会先暂存 CAStudio 服务、打包 harness 运行时，然后在 `apps/desktop/.desktop-build/targets/win-x64/unsigned-artifacts` 下生成未签名的 NSIS 安装包与解包目录。完整跑一次约需十到十五分钟，占用约 4 GB 工作空间。

## 常见问题

- **提示找不到 `pnpm`**：先执行一次 `corepack enable pnpm`，再开一个新终端；仓库要求 `package.json` 中锁定的 pnpm 版本。
- **出现 Unsupported engine 警告**：工作区要求 Node 24.9 或更高；更旧的版本通常也能构建，但桌面运行时与打包工具链只在 Node 24 上验证过。
- **Electron 或 registry 下载卡住**：配置 npm 镜像或代理（`npm config set proxy`，或在 `.npmrc` 中配置 pnpm 镜像）；只有首次安装需要完整依赖图。
- **4317 端口已被占用**：用 `STUDIO_PORT=4320` 启动服务，并用 `COSERVE_CASTUDIO_URL=http://127.0.0.1:4320` 让桌面端连过去。
- **CAD 面板一直为空**：桌面端没能连上服务；确认 `curl http://127.0.0.1:4317/api/dsh/projects` 有应答，并检查服务终端是否还在运行。

## 下一步

- 阅读[仓库 README](../README.zh.md)了解产品全貌与 Web UI 的使用方式。
- 需要项目模型与 HTTP API 时，阅读 [CAStudio README](../castudio/README.md)。
- 修改服务生命周期或打包流程前，阅读[桌面端 README](../apps/desktop/README.zh.md)。
