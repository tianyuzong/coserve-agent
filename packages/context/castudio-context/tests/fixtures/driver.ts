#!/usr/bin/env node
/**
 * Test driver that serves a fake CAStudio project list plus one connected workbench, and sends three turns
 * through one Headless Loader composition.
 */

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { bootProductionProfile } from '../../../../test-support/loader-smoke/tests/fixtures/production-profile.ts'

const configPath = process.argv[2]
if (configPath === undefined) throw new Error('castudio-context driver requires a config path')

const PROJECTS = [
  {
    id: 'fixture-project',
    name: 'Fixture Bracket',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    workspacePath: 'D:\\studio\\projects\\fixture-project\\workspace',
  },
]

const VIEWPORT_BASE = {
  workspace: 'model',
  model: { path: null, demo: true, status: 'ready' },
  meshes: [
    { id: 'mesh-a', name: '底座', visible: true, triangles: 120 },
    { id: 'mesh-b', name: '螺栓 01', visible: false, triangles: 36 },
  ],
  options: { edges: true, grid: true, ortho: false, section: 100, explode: 0, mode: 'component' },
  camera: { position: [10, -20, 30], target: [0, 0, 0], projection: 'perspective' },
}

let selection: { meshId: string; name: string; bounds: number[]; triangles: number } | null = {
  meshId: 'mesh-a',
  name: '底座',
  bounds: [0, 0, 0, 10, 10, 10],
  triangles: 120,
}

const viewports = () => [{
  id: 'fixture-project',
  name: 'Fixture Bracket',
  workspacePath: 'D:\\studio\\projects\\fixture-project\\workspace',
  ageMs: 50,
  state: { ...VIEWPORT_BASE, selection },
}]

const server = createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(404).end()
    return
  }
  if (req.url === '/api/dsh/projects') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(PROJECTS))
    return
  }
  if (req.url === '/api/dsh/viewports') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(viewports()))
    return
  }
  if (req.url === '/api/parametric/runtime') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ configured: true, upstream: 'fixture', commit: 'fixture' }))
    return
  }
  res.writeHead(404).end()
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
process.env['COSERVE_CASTUDIO_URL'] = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

const ctx = await bootProductionProfile({
  binName: 'castudio-context-e2e',
  profile: 'headless',
  overlayPaths: [resolveConfigPath(configPath, undefined)],
})
try {
  await runFixtureTurn(ctx, { task: 'first' })
  // Same workbench state on turn two: the durable reading must be suppressed.
  await runFixtureTurn(ctx, { task: 'second' })
  // A selection change is stable state: the next turn re-injects the reading.
  selection = { meshId: 'mesh-b', name: '螺栓 01', bounds: [1, 1, 1, 2, 2, 2], triangles: 36 }
  await runFixtureTurn(ctx, { task: 'third' })
} finally {
  await ctx.fiber.dispose()
  await new Promise<void>(resolve => server.close(() => { resolve() }))
}
