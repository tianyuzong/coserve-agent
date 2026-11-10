import type { Express } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, jsonRead } from './storage.js';

const resources = fileURLToPath(new URL('../resources/', import.meta.url));
const marker = '<!-- coserve-dsh-workspace -->';
const platformNoteMarker = '<!-- coserve-platform-note -->';
const agentsBlock = 'This is a CoServe AI CAD project. Before CAD, parametric editing, build or simulation tasks, read .agents/skills/castudio/SKILL.md first, then the relevant bundled engineering skill (cadflow, structural-sim, thermal-sim). Use the configured runtime and existing project services. DSH is the sole conversation and tool-execution harness.';
// The bundled upstream cadflow skill documents PyPI installs for Linux/macOS;
// they cannot run here. Windows parametric CAD instead uses the official
// cadflow wheel CAStudio ships — native cadflow_core backend + OCCT — already
// installed in the parametric environment. Keep upstream files untouched and
// annotate only the per-project copy, right after its frontmatter.
const cadflowPlatformNote = `\n${platformNoteMarker}\n> **Platform note (CoServe AI):** This skill's PyPI install steps target upstream CadFlow on Linux/macOS and do not apply on Windows. CAStudio ships an official \`cadflow\` wheel — the native \`cadflow_core\` C++ backend plus OCCT 7.9.3 — already installed in the parametric environment, so you never install it yourself. Write CadFlow Python through the parametric cell API described in the \`castudio\` skill: native \`cad.Model()\` features and the recorded-graph \`make_*_r*\` operators are both available inside cells.\n`;

/** Prepare CAD project instructions for DSH's existing filesystem and skill tools. */
export async function prepareDshWorkspace(store: Store, id: string) {
  const project = await store.project(id);
  const workspacePath = store.workspace(id);
  const skillRoot = path.join(workspacePath, '.agents', 'skills');
  await fs.mkdir(skillRoot, { recursive: true });
  for (const name of ['cadflow', 'thermal-sim', 'structural-sim']) {
    const destination = path.join(skillRoot, name);
    try { await fs.access(destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.cp(path.join(resources, name), destination, { recursive: true, filter: source => !source.split(path.sep).some(part => ['__pycache__', 'data', '.venv'].includes(part)) });
    }
  }
  // The original skill assumes Pi holds an editing lock throughout each turn.
  // Adapt that exact bundled instruction for DSH without changing either harness.
  const structuralSkill = path.join(skillRoot, 'structural-sim', 'SKILL.md');
  const structuralText = await fs.readFile(structuralSkill, 'utf8');
  const nativeStructuralText = structuralText.replaceAll("'/structural/queue'", "'/structural'")
    .replace('The current agent turn holds the project editing lock. Queueing returns promptly; **finish the turn after reporting the queued job ID** so execution can acquire that lock. Do not wait in this same turn for the queued job or call the immediate `/structural` POST. A later turn can GET `/structural` or `/structural/<id>`. Source changes after queueing reject the job. Queueing alone is not successful analysis.', 'DSH does not hold the legacy Pi editing lock. POST `/structural` starts the calculation through the existing project service. Poll GET `/structural` or `/structural/<id>` until a terminal state; starting a job alone is not successful analysis. Do not change source geometry while its calculation is running.')
    .replace('submit the existing queue route', 'submit the existing `/structural` route');
  if (nativeStructuralText !== structuralText) await fs.writeFile(structuralSkill, nativeStructuralText);
  // The upstream cadflow skill's PyPI install cannot run on Windows; annotate
  // only the project copy (resources stay untouched), marker-guarded so repeat
  // prepares and already-copied projects get exactly one note.
  const cadflowSkill = path.join(skillRoot, 'cadflow', 'SKILL.md');
  let cadflowText: string | undefined;
  try { cadflowText = await fs.readFile(cadflowSkill, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (cadflowText !== undefined && !cadflowText.includes(platformNoteMarker)) {
    const frontmatter = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(cadflowText);
    const at = frontmatter === null ? 0 : frontmatter[0].length;
    await fs.writeFile(cadflowSkill, `${cadflowText.slice(0, at)}${cadflowPlatformNote}${cadflowText.slice(at)}`);
  }
  const runtime = await jsonRead<{ executable?: string }>(path.join(store.root, 'runtime.json'), {});
  const thermal = await jsonRead<{ executable?: string }>(path.join(store.root, 'thermal-runtime.json'), {});
  const parametric = await jsonRead<{ python?: string }>(path.join(store.root, 'parametric-runtime.json'), {});
  const service = `http://127.0.0.1:${Number(process.env.STUDIO_PORT || 4317)}`;
  const api = `${service}/api/projects/${id}`;
  const skill = `---
name: castudio
description: Use the integrated CAD project, parametric editor, model files, build and simulation services when designing, editing or inspecting engineering models.
---

# CAD workspace

**Decision rule:** for any request to change, inspect or explain geometry, colour, parameters or model appearance, read this skill first and follow it — never guess service endpoints and never take screenshots of the desktop.

This directory is the current CAD project's source of truth. DSH owns conversation, model requests and tool execution. Use its normal file and shell tools. The local CAD service supplies geometry editing, previews, builds, history and simulation; do not call its /prompt endpoint or use its legacy Pi agent.

Project API: ${api}
Service origin: ${service}
Parametric CAD Python: ${parametric.python || 'not configured; check GET /api/parametric/runtime'}
Plain-build Python: ${runtime.executable || 'not configured; inspect GET /api/runtime'}
Thermal Python: ${thermal.executable || 'not configured; inspect GET /api/thermal/runtime'}

## Geometry, colour and parameter edits — parametric code API

Every change to a parametric part's geometry, dimensions, colour or material goes through the project's parametric editor, which executes cadflow notebook cells. Work in this order:

1. \`GET ${service}/api/parametric/runtime\` — when \`configured\` is \`false\` the optional parametric CAD environment is not installed: tell the user and give them the install command under "Installing the CAD environment" below; do not substitute another engine.
2. \`GET ${api}/parametric\` — reports whether the parametric notebook exists (\`exists\`) and whether its worker is running (\`running\`, \`url\`).
3. \`POST ${api}/parametric/template\` — only when \`exists\` is \`false\`; installs the parametric cylinder template a new project starts from (201; 409 when it already exists).
4. \`POST ${api}/parametric/start\` — starts the cadflow editor worker; the first start can take a minute.
5. \`GET ${api}/parametric/agent/cells\` — lists cells with id, name and status; read the current code before editing.
6. \`POST ${api}/parametric/agent/cells/edit\` replaces a cell's code, \`/cells/insert\` adds one, and \`/cells/run\` executes; every response returns the refreshed cell list. A cell reporting \`status\` \`exception\` with \`errors\` failed — fix the code and re-run.
7. \`POST ${api}/parametric/publish\` needs the modelling panel's editor payload and answers 409 to a bare API call — publishing is a user action in the parametric panel; tell the user when an edit is ready to publish.

Cell code rules (verified against the running editor):

- Cells take code-mode bodies: plain statements with no \`@app.cell\` decorator and no \`def\`. A trailing \`return (name,)\` marks the cell's outputs for downstream cells.
- Cells run inside a shared recorded graph session, so build graph-owned values with the operator forms: \`cad.make_part_rpart(part_id=..., body=...)\`, \`cad.make_material_rmaterial('id', name=..., color=(r,g,b))\` with colour components in 0..1, and \`cad.assign_material_rpart(part, material)\`. A raw \`cad.Part(...)\` constructor is not graph-owned — convert it to \`cad.make_part_rpart(...)\` (keep the same \`part_id\`) before attaching a material.
- The environment also ships the native CadFlow backend, so \`cad.Model()\` and the other native APIs documented in the bundled \`cadflow\` skill work inside cells. For the product's returned parts/materials keep using the recorded operator forms above — native \`Model\` shapes are not graph-owned and cannot carry scene materials.
- The template already imports \`cadflow as cad\` and \`parametric_common\`; reuse the existing cell variable names (\`tagged\`, \`cylinder\`, ...) and keep the product's \`part_id\` (\`"castudio-stiffened-cylinder"\`).

Example — make the part bright blue by editing the last cell that builds \`cylinder\` (replace \`cad.Part(\` with \`cad.make_part_rpart(\` first so the part is graph-owned):

~~~python
cylinder = cad.make_part_rpart(part_id="castudio-stiffened-cylinder", body=tagged)
blue_paint = cad.make_material_rmaterial('paint-blue', name='蓝色涂层', color=(0.0, 0.0, 1.0))
cylinder = cad.assign_material_rpart(cylinder, blue_paint)
return (cylinder,)
~~~

A viewport showing demonstration geometry is a UI sample, not project source: there is nothing to edit until a parametric project exists (steps 2–4 above).

### Installing the CAD environment

Parametric editing needs an optional Python environment of about 1.1 GB; install it only when the user asks. It needs network access to PyPI. Run the bundled \`setup-cad-env.mjs\` script: in a packaged install, launch \`"<CoServe AI install dir>\\resources\\castudio\\scripts\\setup-cad-env.mjs"\` with \`ELECTRON_RUN_AS_NODE=1\` through \`"CoServe AI.exe"\`; from a source checkout, run \`node scripts/setup-cad-env.mjs\` at the cadflow-studio root. The script creates the environment, installs the pinned dependencies and writes \`parametric-runtime.json\` itself; check \`GET /api/parametric/runtime\` afterwards for \`configured:true\`.

## Inspecting and operating the workbench — view only

The \`cad_workbench\` tool inspects and operates the live 3D workbench the user has open: read state, select parts or faces, move the camera, toggle visibility and display options, switch workbench tabs, and save viewport snapshots as PNG files. It changes the view only — geometry, colour, material and parameter edits go through the parametric code API above, never through the workbench tool. Agents without the tool can call the same operations over \`GET/POST ${api}/viewport/state|command\` (actions: fit, select, select_face, visible, options, workspace, snapshot); snapshot PNGs land in the project's \`artifacts/viewport/\` and are readable with \`read_image\`. \`connected:false\` means no workbench tab is open — ask the user to open the CAD workbench.

Viewport selections inserted in the conversation are preview context. Only cadFace explicitly identifies an imported STEP face; a triangle index is a mesh index, not BREP topology. A selection marked isDemo is a UI sample. Verify the actual source and geometry before editing or analysis.

## Other project services

- Plain (non-parametric) builds use the Python configured at \`GET /api/runtime\`; the parametric editor's environment does not replace it.
- Structural simulation: read \`.agents/skills/structural-sim/SKILL.md\` and inspect \`GET ${api}/structural\`. DSH holds no legacy Pi project lock — use the ordinary calculation endpoint, not \`/structural/queue\`.
- Thermal simulation: read \`.agents/skills/thermal-sim/SKILL.md\`; its runtime is configured at \`GET /api/thermal/runtime\`.
- Model files, build history, measurements and reviews use the project API under \`${api}\`.

The bundled \`cadflow\` skill documents the CadFlow Python modelling API. The parametric editor runs the official CadFlow engine — the native \`cadflow_core\` C++ backend with OCCT 7.9.3 on Windows — so cells can use native \`cad.Model()\` features as well as the recorded-graph \`make_*_r*\` operators for parts and materials. Geometry, colour and material edits still go through the parametric code API above; publish remains a user action in the modelling panel.

Keep generated files in this project. Export STEP plus GLB or STL for preview. Never report a model or solver result before checking the actual files and output.
`;
  await fs.mkdir(path.join(skillRoot, 'castudio'), { recursive: true });
  await fs.writeFile(path.join(skillRoot, 'castudio', 'SKILL.md'), skill);
  const instructions = path.join(workspacePath, 'AGENTS.md');
  let existing = '';
  try { existing = await fs.readFile(instructions, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const at = existing.indexOf(marker);
  if (at === -1) {
    await fs.writeFile(instructions, `${existing.trimEnd()}\n\n${marker}\n${agentsBlock}\n`);
  } else {
    // Refresh only the marker's own block (marker line plus its single text
    // line) so projects prepared before the current wording pick it up;
    // user content after the block is preserved.
    const markerBreak = existing.indexOf('\n', at);
    const blockEnd = markerBreak === -1 ? existing.length : existing.indexOf('\n', markerBreak + 1);
    const tail = blockEnd === -1 ? '' : existing.slice(blockEnd);
    const updated = `${existing.slice(0, at)}${marker}\n${agentsBlock}${tail}`;
    if (updated !== existing) await fs.writeFile(instructions, updated);
  }
  return { ...project, workspacePath };
}

/** Loopback-only routes used by the native DSH CAD tab; these never start Pi. */
export function dshWorkspaceRoutes(app: Express, store: Store): void {
  app.get('/api/dsh/projects', async (_req, res) => res.json((await store.projects()).map(project => ({ ...project, workspacePath: store.workspace(project.id) }))));
  app.post('/api/dsh/projects/:id/prepare', async (req, res) => res.json(await prepareDshWorkspace(store, String(req.params.id))));
}
