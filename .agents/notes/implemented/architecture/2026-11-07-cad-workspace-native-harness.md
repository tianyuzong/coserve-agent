# Agent Note: CAD workspace with the native harness

Status: implemented

English | [中文](2026-11-07-cad-workspace-native-harness.zh.md)

## Problem

The desktop CAD integration introduced a separate conversation backed by Pi. The product requires the original DSH conversation and execution behavior to own engineering tasks.

## Decision

The CAD plugin contributes a right-sidebar tab and a native conversation header action. CAD project directories become ordinary DSH Workspaces. Engineering instructions and skills are prepared inside those directories; DSH discovers them through its existing filesystem capabilities. Viewport context enters the native draft through the public conversation input service.

## Alternatives considered

**A separate Pi conversation panel** duplicates model selection, tool display and history, and violates the requested harness ownership.

**A DSH adapter forwarding prompts to Pi** retains two agent lifecycles and changes the meaning of native execution. The integration instead uses the existing CAD services through native tools.

## Consequences

The native agent loop, approvals, persistence and credentials remain under DSH ownership. CAD files and editors retain their existing service. Old Pi transcripts remain separate; they are not imported as native history. Native project preparation and controller tests cover directory identity, preserved instructions, failures and disposal.
