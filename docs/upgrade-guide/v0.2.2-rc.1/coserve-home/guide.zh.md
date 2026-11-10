---
kind: upgrade-guide
description: "harness home 迁移到 COSERVE_HOME 与 ~/.coserve，共享 agent 根目录迁移到 COSERVE_AGENTS_HOME 与 ~/.coserve-agents。"
---

# harness home 环境变量与目录改名

[English](guide.md) | 中文

## 变更

用户数据环境变量与默认目录改名：

- `DSH_HOME` 更名为 `COSERVE_HOME`；默认 home `~/.dsh` 更名为 `~/.coserve`。
- `DSH_AGENTS_HOME` 更名为 `COSERVE_AGENTS_HOME`；默认共享 agent 根目录 `~/.agents` 更名为 `~/.coserve-agents`。
- 配置字段与辅助函数同步更名：`dshHome` 更名为 `coserveHome`，`resolveDshHome` 更名为 `resolveCoserveHome`，`dshHomePath` 更名为 `coserveHomePath`，`dshHomeDisplay` 更名为 `coserveHomeDisplay`。`resolveAgentsHome` 与 `agentsHomeDisplay` 保持不变。

仍导出 `DSH_HOME` 或 `DSH_AGENTS_HOME` 的进程不再获得覆盖：harness 读取 `COSERVE_HOME` 与 `COSERVE_AGENTS_HOME`，随后回退到新默认值，因此旧 home 下的会话、profile、凭据与设置将无法找到。

## 迁移

1. 在 shell 配置、服务定义与启动脚本中重命名变量：`COSERVE_HOME` 替代 `DSH_HOME`，`COSERVE_AGENTS_HOME` 替代 `DSH_AGENTS_HOME`。
2. 若要在不复制数据的情况下保留现有数据，把新变量指向旧根目录，例如 `COSERVE_HOME=$HOME/.dsh` 与 `COSERVE_AGENTS_HOME=$HOME/.agents`。若要完全迁移，把 `~/.dsh` 复制到 `~/.coserve`、把 `~/.agents` 复制到 `~/.coserve-agents`，更新引用旧路径的脚本，然后取消覆盖使新默认值生效。
3. 在 `cordis.yml` 中，使用了 `dshHome`、`dshHomePath(` 或 `resolveDshHome(` 的 `!!js` 表达式与插件 `config` 字段必须改用 `coserveHome`、`coserveHomePath(` 与 `resolveCoserveHome(`。
4. 把声明 `dshHome` 配置字段的插件与组合包更新为 `coserveHome`，并重新构建或安装，使 schema 校验接受新字段。
5. 通过启动一个会话并确认会话、凭据与设置在新 home 下解析来验证，或运行录制的 workspace-context 快照夹具。
