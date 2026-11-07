# Agent Note: CAD 工作区使用原生 harness

[English](2026-11-07-cad-workspace-native-harness.md) | 中文

Status: implemented

## Problem

桌面 CAD 集成曾引入由 Pi 驱动的独立对话。产品要求工程任务由 DSH 原有对话和执行行为负责。

## Decision

CAD 插件提供右侧标签和原生对话顶部按钮。CAD 项目目录成为普通 DSH 工作区。工程说明和技能准备在项目目录内，由 DSH 通过已有文件系统能力发现。视口上下文通过公开的对话输入服务进入原生草稿。

## Alternatives considered

**独立的 Pi 对话面板**重复了模型选择、工具展示和历史管理，也不符合要求的 harness 归属。

**将 DSH 提示转发给 Pi 的适配器**保留两套智能体生命周期，并改变原生执行的含义。当前集成使用原生工具访问已有 CAD 服务。

## Consequences

原生智能体循环、审批、持久化和凭据继续由 DSH 管理。CAD 文件和编辑器保留原有服务。旧 Pi 对话单独保留，不导入为原生历史。项目准备与控制器测试覆盖目录匹配、说明保留、失败和销毁。
