/** Bundled CAStudio service lifecycle: probe, spawn, readiness, and owned shutdown. */

import { type SpawnOptions, spawn as nodeSpawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import type { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveCoserveHome } from '@deepseek-ai/dsh-home-paths'

const PROBE_PATH = '/api/dsh/projects'
const PROBE_TIMEOUT_MS = 1500
const READY_POLL_MS = 300
const READY_ATTEMPTS = 100
const STOP_GRACE_MS = 5000
const STDERR_TAIL_LIMIT = 2048
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** Narrow child-process face the lifecycle needs; `ChildProcess` satisfies it. */
export interface CAStudioServiceChild extends EventEmitter {
  readonly pid?: number | undefined
  kill(signal?: NodeJS.Signals | number): boolean
  readonly stdout: Readable | null
  readonly stderr: Readable | null
}

export type CAStudioServiceSpawn = (
  file: string,
  args: readonly string[],
  options: SpawnOptions,
) => CAStudioServiceChild

export type CAStudioServiceState =
  | 'disabled'
  | 'external'
  | 'unavailable'
  | 'stopped'
  | 'running'
  | 'failed'

export interface CAStudioServiceOptions {
  /** Same origin passed to `installCAStudio`; only loopback origins are managed. */
  readonly origin: string
  /** Node-compatible executable that runs the service (Electron Node mode in the app). */
  readonly executable: string
  /** `process.resourcesPath`; `COSERVE_CASTUDIO_DIR` overrides the service directory. */
  readonly resourcesPath?: string | undefined
  readonly environment?: NodeJS.ProcessEnv | undefined
  /** Harness home receiving the default `STUDIO_DATA_DIR`; defaults to `resolveCoserveHome()`. */
  readonly harnessHome?: string | undefined
  readonly platform?: NodeJS.Platform | undefined
  readonly spawn?: CAStudioServiceSpawn | undefined
  /** Returns true when the probe URL already answers 200. */
  readonly probe?: ((url: string) => Promise<boolean>) | undefined
  readonly sleep?: ((ms: number) => Promise<void>) | undefined
  readonly log?: ((level: 'info' | 'warn' | 'error', message: string) => void) | undefined
}

export interface CAStudioService {
  /** Resolves once the spawn decision and readiness outcome are known. */
  readonly outcome: Promise<CAStudioServiceState>
  /** Idempotent; kills only a child this module spawned. */
  stop(): Promise<void>
}

function defaultProbe(url: string): Promise<boolean> {
  return fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
    .then(response => response.status === 200)
    .catch(() => false)
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function defaultLog(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `desktop castudio: ${message}`
  if (level === 'info') console.log(line)
  else if (level === 'warn') console.warn(line)
  else console.error(line)
}

function serviceEnvironment(
  environment: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_PATTERN.test(key)) continue
    if (key === 'NODE_OPTIONS' || key === 'NODE_PATH') continue
    scrubbed[key] = value
  }
  return { ...scrubbed, ...overrides }
}

function tsxLoaderEntry(serviceDirectory: string): string | undefined {
  const manifestPath = join(serviceDirectory, 'node_modules', 'tsx', 'package.json')
  if (!existsSync(manifestPath)) return undefined
  let manifest: { exports?: unknown }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: unknown }
  } catch {
    return undefined
  }
  const dot = typeof manifest.exports === 'object' && manifest.exports !== null
    ? (manifest.exports as Record<string, unknown>)['.']
    : manifest.exports
  const entry = typeof dot === 'string' ? dot
    : typeof dot === 'object' && dot !== null
      ? (['import', 'default', 'node', 'require'] as const)
        .map(key => (dot as Record<string, unknown>)[key])
        .find((value): value is string => typeof value === 'string')
      : undefined
  if (entry === undefined) return undefined
  const loader = join(serviceDirectory, 'node_modules', 'tsx', entry)
  return existsSync(loader) ? loader : undefined
}

/**
 * Start the bundled CAStudio service when the configured loopback origin is not
 * already served. Never throws: every failure degrades to a logged skip so app
 * startup is never blocked by the optional CAD workspace.
 * @param options - origin, executable, and injectable process/environment seams.
 * @returns a handle whose `stop()` kills only the child this module spawned.
 */
export function startCAStudioService(options: CAStudioServiceOptions): CAStudioService {
  const environment = options.environment ?? process.env
  const platform = options.platform ?? process.platform
  const spawnFn = options.spawn ?? ((file, args, spawnOptions) => nodeSpawn(file, [...args], spawnOptions))
  const probe = options.probe ?? defaultProbe
  const sleep = options.sleep ?? defaultSleep
  const log = options.log ?? defaultLog
  const harnessHome = options.harnessHome ?? resolveCoserveHome()

  let child: CAStudioServiceChild | undefined
  let childExited = false
  let stopping = false
  let stderrTail = ''
  let settle!: (state: CAStudioServiceState) => void
  const outcome = new Promise<CAStudioServiceState>((resolve) => { settle = resolve })
  let stopPromise: Promise<void> | undefined

  const recordStderr = (chunk: unknown): void => {
    stderrTail = `${stderrTail}${String(chunk)}`.slice(-STDERR_TAIL_LIMIT)
  }

  const waitForExit = (target: CAStudioServiceChild, ms: number): Promise<boolean> => {
    if (childExited) return Promise.resolve(true)
    return Promise.race([
      new Promise<true>((resolve) => { target.once('exit', () => resolve(true)) }),
      sleep(ms).then(() => false as const),
    ])
  }

  const terminate = async (): Promise<void> => {
    stopping = true
    const target = child
    if (target === undefined || childExited) return
    if (platform === 'win32') {
      // Node reports SIGTERM on Windows as TerminateProcess: there is no graceful
      // console signal for a hidden child, so kill the whole tree directly.
      if (target.pid !== undefined) {
        try {
          spawnFn('taskkill', ['/PID', String(target.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
            .on('error', () => {})
        } catch (error) {
          log('warn', `taskkill failed: ${String(error)}`)
        }
      }
      if (!await waitForExit(target, STOP_GRACE_MS)) target.kill('SIGKILL')
      return
    }
    target.kill('SIGTERM')
    if (!await waitForExit(target, STOP_GRACE_MS)) target.kill('SIGKILL')
  }

  const stop = (): Promise<void> => {
    stopPromise ??= terminate()
    return stopPromise
  }

  const run = async (): Promise<CAStudioServiceState> => {
    if (environment.COSERVE_CASTUDIO_AUTOSTART === '0') {
      log('info', 'autostart disabled by COSERVE_CASTUDIO_AUTOSTART=0')
      return 'disabled'
    }
    let url: URL
    try {
      url = new URL(options.origin)
    } catch {
      log('warn', `cannot parse CAStudio origin ${JSON.stringify(options.origin)}; service not managed`)
      return 'unavailable'
    }
    if (!LOOPBACK_HOSTNAMES.has(url.hostname)) {
      log('info', `CAStudio origin ${url.origin} is not loopback; service not managed`)
      return 'external'
    }
    const probeUrl = `${options.origin.replace(/\/+$/, '')}${PROBE_PATH}`
    if (await probe(probeUrl)) {
      log('info', `CAStudio already serving at ${url.origin}; leaving it running`)
      return 'external'
    }
    if (stopping) return 'stopped'
    const serviceDirectory = environment.COSERVE_CASTUDIO_DIR
      ?? (options.resourcesPath === undefined ? undefined : join(options.resourcesPath, 'castudio'))
    if (serviceDirectory === undefined || !existsSync(join(serviceDirectory, 'server', 'index.ts'))) {
      const looked = serviceDirectory ?? (options.resourcesPath === undefined ? 'an unknown resources path' : join(options.resourcesPath, 'castudio'))
      log('warn', `CAStudio service directory missing (no server/index.ts under ${looked}); CAD workspace unavailable`)
      return 'unavailable'
    }
    const loader = tsxLoaderEntry(serviceDirectory)
    if (loader === undefined) {
      log('warn', `CAStudio service at ${serviceDirectory} has no usable tsx loader; CAD workspace unavailable`)
      return 'unavailable'
    }
    const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
    const dataDirectory = environment.STUDIO_DATA_DIR !== undefined && environment.STUDIO_DATA_DIR !== ''
      ? environment.STUDIO_DATA_DIR
      : join(harnessHome, 'castudio')
    const args = ['--import', pathToFileURL(loader).href, 'server/index.ts']
    if (!existsSync(join(serviceDirectory, 'dist', 'index.html'))) args.push('--dev')
    const env = serviceEnvironment(environment, {
      STUDIO_PORT: port,
      STUDIO_DATA_DIR: dataDirectory,
      ELECTRON_RUN_AS_NODE: '1',
    })
    log('info', `starting bundled CAStudio from ${serviceDirectory} on ${url.origin}`)
    const spawned = spawnFn(options.executable, args, {
      cwd: serviceDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    })
    child = spawned
    child.stdout?.on('data', chunk => log('info', `stdout: ${String(chunk).trimEnd()}`))
    child.stderr?.on('data', (chunk) => {
      recordStderr(chunk)
      log('warn', `stderr: ${String(chunk).trimEnd()}`)
    })
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      childExited = true
      if (!stopping) {
        const detail = stderrTail === '' ? '' : `; stderr tail: ${stderrTail.trimEnd()}`
        log('warn', `CAStudio service exited unexpectedly (code ${String(code)}, signal ${String(signal)})${detail}`)
      }
    })
    child.once('error', (error: Error) => {
      if (!stopping) log('error', `CAStudio service failed to start: ${String(error)}`)
    })
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt += 1) {
      if (childExited) return stopping ? 'stopped' : 'failed'
      if (await probe(probeUrl)) {
        log('info', `CAStudio service ready at ${url.origin}`)
        return 'running'
      }
      await sleep(READY_POLL_MS)
    }
    log('warn', `CAStudio service did not become ready within ${READY_ATTEMPTS * READY_POLL_MS / 1000}s`)
    return 'failed'
  }

  void run().then(settle, (error: unknown) => {
    log('error', `CAStudio service lifecycle failed: ${String(error)}`)
    settle('failed')
  })
  return { outcome, stop }
}
