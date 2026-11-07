---
description: "CAD project workspaces, geometry references and embedded engineering tools alongside the native DSH conversation."
kind: "package-reference"
---

# CAD workspace in the native DSH conversation

English | [中文](README.zh.md)

## Summary

The desktop opens DSH's original conversation and contributes a CAD tab to its right sidebar. There is no separate CAStudio chat or top-level sidebar entry. DSH owns model credentials, requests, tool execution, approvals, cancellation and history through its existing harness. This package only uses public UI extension services and does not modify the agent loop.

Choosing a CAD project prepares its existing filesystem directory, registers it as a native DSH Workspace and opens a native Session. The service preserves project instructions and installs the bundled CAD, parametric and simulation skills under `.agents/skills`. Project files remain in the same directory used by the CAD service.

The embedded workspace uses `embedded=1&harness=dsh`. Its CAD, file, editor, build and simulation surfaces remain available; its legacy Pi conversation and model settings are not used. Files refresh without remounting the editor. Previous Pi transcripts remain on disk but are not converted into native DSH history.

Viewport selections become native file-style reference chips, with the component name and optional face identifier. Repeated picks of the same target do not duplicate the chip. Native editing, deletion, undo and draft persistence apply; submission serializes each retained reference with its geometry context. Sent messages also display compact references. Explicit analysis feedback remains ordinary draft text. Messages are accepted only from the exact iframe window, its origin and its current project. The workbench consumes DSH's resolved theme tokens, font and control radii; theme updates preserve the live editor. The desktop bridge is required; this package does not run another server.

## Model Experience

### User prompts

#### What the model sees

DSH reads the project AGENTS.md and discovers its engineering skills through normal workspace discovery. CAD references serialize as `<cad-selection>` blocks containing the selected project, file, component and geometry information in the ordinary logged user message. Removed chips contribute no context. CAD tools and HTTP services are invoked with the existing native filesystem and shell tools. No prompt is sent to CAStudio's legacy `/prompt` endpoint.

## Known Limitations and Deferred Work

Historical Pi chats remain separate files. Existing standalone CAStudio operation is preserved. Non-Chinese locales use the English CAD dictionary.
