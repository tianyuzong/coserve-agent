import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { SpawnOptions } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  startCAStudioService,
  type CAStudioServiceChild,
  type CAStudioServiceOptions,
  type CAStudioServiceState,
} from '../src/castudio-service.ts'

const directories: string[] = []

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), 'castudio-service-spec-'))
  directories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

class FakeChild extends EventEmitter implements CAStudioServiceChild {
  readonly pid = 43210
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly killed: (NodeJS.Signals | number | undefined)[] = []
  exitOnKill: 'exit' | 'stay' = 'stay'
  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed.push(signal)
    if (this.exitOnKill === 'exit') queueMicrotask(() => this.emit('exit', 0, null))
    return true
  }
}

interface SpawnCall {
  readonly file: string
  readonly args: readonly string[]
  readonly options: SpawnOptions
}

function fakeSpawn(child: FakeChild) {
  const calls: SpawnCall[] = []
  const spawn = vi.fn((file: string, args: readonly string[], options: SpawnOptions): CAStudioServiceChild => {
    calls.push({ file, args, options })
    return child
  })
  return { calls, spawn }
}

function serviceTree(root: string, options: { dist?: boolean } = {}): string {
  const directory = join(root, 'castudio')
  mkdirSync(join(directory, 'server'), { recursive: true })
  writeFileSync(join(directory, 'server', 'index.ts'), 'export {}\n')
  mkdirSync(join(directory, 'node_modules', 'tsx', 'dist'), { recursive: true })
  writeFileSync(join(directory, 'node_modules', 'tsx', 'package.json'),
    JSON.stringify({ name: 'tsx', exports: { '.': './dist/loader.mjs' } }))
  writeFileSync(join(directory, 'node_modules', 'tsx', 'dist', 'loader.mjs'), 'export {}\n')
  if (options.dist !== false) {
    mkdirSync(join(directory, 'dist'), { recursive: true })
    writeFileSync(join(directory, 'dist', 'index.html'), '<html></html>\n')
  }
  return directory
}

function baseOptions(overrides: Partial<CAStudioServiceOptions> = {}): CAStudioServiceOptions {
  return {
    origin: 'http://127.0.0.1:4317',
    executable: '/runtime/node',
    environment: {},
    harnessHome: tempDir(),
    platform: 'linux',
    sleep: async () => {},
    log: () => {},
    ...overrides,
  }
}

async function outcomeOf(service: ReturnType<typeof startCAStudioService>): Promise<CAStudioServiceState> {
  return service.outcome
}

describe('CAStudio service lifecycle', () => {
  it('leaves an already-serving origin alone and never kills it', async () => {
    const probe = vi.fn(async () => true)
    const { calls, spawn } = fakeSpawn(new FakeChild())
    const service = startCAStudioService(baseOptions({ probe, spawn }))
    await expect(outcomeOf(service)).resolves.toBe('external')
    expect(probe).toHaveBeenCalledWith('http://127.0.0.1:4317/api/dsh/projects')
    expect(calls).toHaveLength(0)
    await expect(service.stop()).resolves.toBeUndefined()
    expect(calls).toHaveLength(0)
  })

  it('never manages a non-loopback origin', async () => {
    const probe = vi.fn(async () => false)
    const { calls, spawn } = fakeSpawn(new FakeChild())
    const log = vi.fn()
    const service = startCAStudioService(baseOptions({ origin: 'https://studio.example.com', probe, spawn, log }))
    await expect(outcomeOf(service)).resolves.toBe('external')
    expect(probe).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
    expect(log).toHaveBeenCalledWith('info', expect.stringContaining('not loopback'))
  })

  it('warns and skips when the service directory is missing', async () => {
    const probe = vi.fn(async () => false)
    const { calls, spawn } = fakeSpawn(new FakeChild())
    const log = vi.fn()
    const service = startCAStudioService(baseOptions({
      probe, spawn, log,
      environment: { COSERVE_CASTUDIO_DIR: join(tempDir(), 'absent') },
    }))
    await expect(outcomeOf(service)).resolves.toBe('unavailable')
    expect(calls).toHaveLength(0)
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('service directory missing'))
  })

  it('honors the COSERVE_CASTUDIO_AUTOSTART=0 kill switch before probing', async () => {
    const probe = vi.fn(async () => false)
    const { calls, spawn } = fakeSpawn(new FakeChild())
    const service = startCAStudioService(baseOptions({
      probe, spawn,
      environment: { COSERVE_CASTUDIO_AUTOSTART: '0' },
    }))
    await expect(outcomeOf(service)).resolves.toBe('disabled')
    expect(probe).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('spawns the bundled node with the designed arguments, environment, and working directory', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    const harnessHome = tempDir()
    const child = new FakeChild()
    const { calls, spawn } = fakeSpawn(child)
    const probe = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const service = startCAStudioService(baseOptions({
      probe, spawn, harnessHome,
      environment: {
        COSERVE_CASTUDIO_DIR: serviceDirectory,
        AWS_SECRET_ACCESS_KEY: 'secret',
        COSERVE_OTHER_SETTING: 'kept',
        NODE_OPTIONS: '--require evil',
      },
    }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.file).toBe('/runtime/node')
    expect(call.args[0]).toBe('--import')
    expect(call.args[1]).toBe(pathToFileURL(join(serviceDirectory, 'node_modules', 'tsx', 'dist', 'loader.mjs')).href)
    expect(call.args[2]).toBe('server/index.ts')
    expect(call.args).not.toContain('--dev')
    expect(call.options.cwd).toBe(serviceDirectory)
    expect(call.options.shell).toBe(false)
    expect(call.options.windowsHide).toBe(true)
    expect(call.options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    const env = call.options.env as NodeJS.ProcessEnv
    expect(env.STUDIO_PORT).toBe('4317')
    expect(env.STUDIO_DATA_DIR).toBe(join(harnessHome, 'castudio'))
    expect(env.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(env.COSERVE_OTHER_SETTING).toBe('kept')
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
  })

  it('honors STUDIO_DATA_DIR and appends --dev only when dist/index.html is absent', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root, { dist: false })
    const dataDirectory = join(tempDir(), 'custom-data')
    const child = new FakeChild()
    const { calls, spawn } = fakeSpawn(child)
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const service = startCAStudioService(baseOptions({
      probe, spawn,
      environment: {
        COSERVE_CASTUDIO_DIR: serviceDirectory,
        STUDIO_DATA_DIR: dataDirectory,
      },
    }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    const call = calls[0]!
    expect(call.args).toContain('--dev')
    const env = call.options.env as NodeJS.ProcessEnv
    expect(env.STUDIO_DATA_DIR).toBe(dataDirectory)
  })

  it('resolves the default service directory under resourcesPath', async () => {
    const resources = tempDir()
    serviceTree(resources)
    const { calls, spawn } = fakeSpawn(new FakeChild())
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const service = startCAStudioService(baseOptions({ probe, spawn, resourcesPath: resources }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    expect(calls[0]!.options.cwd).toBe(join(resources, 'castudio'))
  })

  it('keeps polling until the service answers, then reports running', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    const { spawn } = fakeSpawn(new FakeChild())
    const probe = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true)
    const service = startCAStudioService(baseOptions({
      probe, spawn,
      environment: { COSERVE_CASTUDIO_DIR: serviceDirectory },
    }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('reports failed when readiness never arrives', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    const { spawn } = fakeSpawn(new FakeChild())
    const probe = vi.fn(async () => false)
    const service = startCAStudioService(baseOptions({
      probe, spawn,
      environment: { COSERVE_CASTUDIO_DIR: serviceDirectory },
    }))
    await expect(outcomeOf(service)).resolves.toBe('failed')
    expect(probe).toHaveBeenCalledTimes(101)
  })

  it('logs an early child exit with its code and stderr tail', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    const child = new FakeChild()
    const { spawn } = fakeSpawn(child)
    const probe = vi.fn(async () => false)
    const log = vi.fn()
    const service = startCAStudioService(baseOptions({
      probe, spawn, log,
      environment: { COSERVE_CASTUDIO_DIR: serviceDirectory },
    }))
    queueMicrotask(() => {
      child.stderr.write('module not found\n')
      child.emit('exit', 1, null)
    })
    await expect(outcomeOf(service)).resolves.toBe('failed')
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('exited unexpectedly'))
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('code 1'))
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('module not found'))
  })

  it('stops idempotently: SIGTERM first, SIGKILL only after the grace period', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    const child = new FakeChild()
    const { spawn } = fakeSpawn(child)
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const service = startCAStudioService(baseOptions({
      probe, spawn,
      environment: { COSERVE_CASTUDIO_DIR: serviceDirectory },
    }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    const first = service.stop()
    const second = service.stop()
    expect(second).toBe(first)
    await expect(first).resolves.toBeUndefined()
    expect(child.killed).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('does not escalate to SIGKILL when the child exits within the grace period', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    const child = new FakeChild()
    child.exitOnKill = 'exit'
    const { spawn } = fakeSpawn(child)
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const service = startCAStudioService(baseOptions({
      probe, spawn,
      environment: { COSERVE_CASTUDIO_DIR: serviceDirectory },
    }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    await service.stop()
    expect(child.killed).toEqual(['SIGTERM'])
  })

  it('kills the whole process tree through taskkill on Windows', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    const child = new FakeChild()
    const { calls, spawn } = fakeSpawn(child)
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    const service = startCAStudioService(baseOptions({
      probe, spawn, platform: 'win32',
      environment: { COSERVE_CASTUDIO_DIR: serviceDirectory },
    }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    await service.stop()
    const taskkill = calls.find(call => call.file === 'taskkill')
    expect(taskkill?.args).toEqual(['/PID', String(child.pid), '/T', '/F'])
    expect(child.killed).toEqual(['SIGKILL'])
  })
})

describe('CAStudio service real process', () => {
  it('spawns a fake service, observes readiness, and kills it on stop', async () => {
    const root = tempDir()
    const serviceDirectory = serviceTree(root)
    writeFileSync(join(serviceDirectory, 'server', 'index.ts'), [
      "import { createServer } from 'node:http'",
      'const port = Number(process.env.STUDIO_PORT)',
      "createServer((request, response) => { response.setHeader('content-type', 'application/json'); response.end('[]') }).listen(port, '127.0.0.1')",
      '',
    ].join('\n'))
    const reservation = createServer()
    await new Promise<void>(resolveListen => reservation.listen(0, '127.0.0.1', resolveListen))
    const address = reservation.address()
    if (address === null || typeof address === 'string') throw new Error('Missing test port')
    const port = address.port
    await new Promise<void>(resolveClose => reservation.close(() => resolveClose()))
    const origin = `http://127.0.0.1:${port}`
    const service = startCAStudioService(baseOptions({
      origin,
      executable: process.execPath,
      environment: { ...process.env, COSERVE_CASTUDIO_DIR: serviceDirectory },
      platform: process.platform,
      sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    }))
    await expect(outcomeOf(service)).resolves.toBe('running')
    const alive = await fetch(`${origin}/api/dsh/projects`, { signal: AbortSignal.timeout(2000) })
    expect(alive.status).toBe(200)
    await service.stop()
    await expect(fetch(`${origin}/api/dsh/projects`, { signal: AbortSignal.timeout(2000) })).rejects.toThrow()
  }, 30_000)
})
