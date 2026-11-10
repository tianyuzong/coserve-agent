#!/usr/bin/env node
/** Test driver that serves a fake CAStudio workbench and sends four turns through one Headless Loader composition. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('tool-castudio driver requires a config path')

const PROJECTS = [
  {
    id: 'fixture-project',
    name: 'Fixture Bracket',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    workspacePath: '',
  },
]

// Smallest valid PNG (1x1) so the snapshot path carries real bytes.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const WORKSPACE = mkdtempSync(join(tmpdir(), 'tool-castudio-e2e-'))
PROJECTS[0]!.workspacePath = WORKSPACE

interface FakeMesh { id: string; name: string; visible: boolean; triangles: number }
interface FakeSelection { meshId: string; name: string; bounds: number[]; triangles: number; cadFace?: unknown }

const state = {
  workspace: 'model' as 'model' | 'parametric' | 'structural' | 'thermal',
  model: { path: null as string | null, demo: true, status: 'ready' as const },
  meshes: [
    { id: 'mesh-a', name: '底座', visible: true, triangles: 120 },
    { id: 'mesh-b', name: '螺栓 01', visible: false, triangles: 36 },
  ] as FakeMesh[],
  selection: {
    meshId: 'mesh-a',
    name: '底座',
    bounds: [0, 0, 0, 10, 10, 10],
    triangles: 120,
  } as FakeSelection | null,
  options: { edges: true, grid: true, ortho: false, section: 100, explode: 0, mode: 'component' as 'component' | 'face' },
  camera: { position: [10, -20, 30] as [number, number, number], target: [0, 0, 0] as [number, number, number], projection: 'perspective' as const },
}

const viewports = () => [{
  id: 'fixture-project',
  name: 'Fixture Bracket',
  workspacePath: WORKSPACE,
  ageMs: 50,
  state: structuredClone(state),
}]

function applyCommand(command: Record<string, unknown>): Record<string, unknown> {
  const snapshotDir = join(WORKSPACE, 'artifacts', 'viewport')
  switch (command['action']) {
    case 'fit': {
      state.camera = {
        position: command['view'] === 'top' ? [0, 300, 0.01] : [10, -20, 30],
        target: [0, 0, 0],
        projection: 'perspective',
      }
      break
    }
    case 'select': {
      const mesh = state.meshes.find(entry => entry.id === command['meshId'])
      if (mesh !== undefined) {
        state.selection = { meshId: mesh.id, name: mesh.name, bounds: [0, 0, 0, 1, 1, 1], triangles: mesh.triangles }
      }
      break
    }
    case 'select_face': {
      if (state.selection !== null) state.selection = { ...state.selection, cadFace: command['face'] }
      break
    }
    case 'visible': {
      const mesh = state.meshes.find(entry => entry.id === command['meshId'])
      if (mesh !== undefined) mesh.visible = command['visible'] === true
      break
    }
    case 'options': {
      Object.assign(state.options, command['options'] as Partial<typeof state.options>)
      break
    }
    case 'workspace': {
      state.workspace = command['workspace'] as typeof state.workspace
      break
    }
    case 'snapshot': {
      mkdirSync(snapshotDir, { recursive: true })
      const name = 'viewport-20260101-000000-000.png'
      writeFileSync(join(snapshotDir, name), PNG_1X1)
      return {
        ok: true,
        state: structuredClone(state),
        snapshot: {
          path: `artifacts/viewport/${name}`,
          absolutePath: join(WORKSPACE, 'artifacts', 'viewport', name),
          width: 1,
          height: 1,
          bytes: PNG_1X1.byteLength,
        },
      }
    }
    default:
      return { ok: false, error: `unknown action ${String(command['action'])}` }
  }
  return { ok: true, state: structuredClone(state) }
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method === 'GET' && url.pathname === '/api/dsh/projects') {
    json(200, PROJECTS)
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/dsh/viewports') {
    json(200, viewports())
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/projects/fixture-project/viewport/state') {
    json(200, { connected: true, ageMs: 50, state: structuredClone(state) })
    return
  }
  if (req.method === 'POST' && url.pathname === '/api/projects/fixture-project/viewport/command') {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      try {
        json(200, applyCommand(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>))
      } catch {
        json(422, { error: 'bad command' })
      }
    })
    return
  }
  res.writeHead(404).end()
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
process.env['COSERVE_CASTUDIO_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

const ctx = await bootProductionProfile({
  binName: 'tool-castudio-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'inspect the workbench' })
  await runFixtureTurn(ctx, { task: 'frame the top view' })
  await runFixtureTurn(ctx, { task: 'select the bolt by name' })
  await runFixtureTurn(ctx, { task: 'capture the viewport' })
} finally {
  await ctx.fiber.dispose()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
  rmSync(WORKSPACE, { recursive: true, force: true })
}
