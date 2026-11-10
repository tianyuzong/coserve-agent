/** Start a staged or packaged CAStudio service once and verify its HTTP surface. */

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROBE_PATH = '/api/dsh/projects'
const POLL_INTERVAL_MS = 250
const STOP_GRACE_MS = 5000
const STDERR_TAIL_LIMIT = 2048
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

function tsxLoaderEntry(serviceDirectory) {
  const manifestPath = join(serviceDirectory, 'node_modules', 'tsx', 'package.json')
  assert.ok(existsSync(manifestPath), `castudio check: tsx is not installed under ${serviceDirectory}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const dot = typeof manifest.exports === 'object' && manifest.exports !== null
    ? manifest.exports['.']
    : manifest.exports
  const entry = typeof dot === 'string' ? dot
    : typeof dot === 'object' && dot !== null
      ? ['import', 'default', 'node', 'require'].map(key => dot[key]).find(value => typeof value === 'string')
      : undefined
  assert.ok(typeof entry === 'string', 'castudio check: tsx package has no import entry')
  const loader = join(serviceDirectory, 'node_modules', 'tsx', entry)
  assert.ok(existsSync(loader), `castudio check: tsx loader ${loader} is missing`)
  return loader
}

function serviceEnvironment(environment, port, dataDirectory) {
  const env = {}
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_PATTERN.test(key)) continue
    if (key === 'NODE_OPTIONS' || key === 'NODE_PATH') continue
    env[key] = value
  }
  env.STUDIO_PORT = String(port)
  env.STUDIO_DATA_DIR = dataDirectory
  env.ELECTRON_RUN_AS_NODE = '1'
  return env
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolvePort(port))
    })
  })
}

function probe(url) {
  return fetch(url, { signal: AbortSignal.timeout(2000) })
    .then(response => response.status)
    .catch(() => 0)
}

async function stopChild(child, platform) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (platform === 'win32' && child.pid !== undefined) {
    await new Promise(resolveStop => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.once('error', () => resolveStop())
      killer.once('close', () => resolveStop())
    })
    // A filter driver (antivirus) can hold a force-terminated process un-reaped for minutes:
    // taskkill already reported the failure and the process object cannot be waited on anymore.
    // Detach so a straggler cannot pin the caller's event loop, and stop reading dead pipes.
    child.stdout?.destroy()
    child.stderr?.destroy()
    child.unref()
    return
  }
  child.kill('SIGTERM')
  const exited = await Promise.race([
    new Promise(resolveExit => child.once('exit', () => resolveExit(true))),
    new Promise(resolveExit => setTimeout(() => resolveExit(false), STOP_GRACE_MS)),
  ])
  if (!exited) child.kill('SIGKILL')
}

/**
 * Boot one CAStudio service directory under a Node-compatible executable and
 * assert both the SPA and the project API answer. Always stops the child and
 * removes the temporary data directory, including on failure.
 * @param options.serviceDirectory - Staged or packaged tree containing server/index.ts and node_modules/tsx.
 * @param options.node - Node-compatible executable (Electron Node mode is enabled for the child).
 * @param options.environment - Base environment; credential-shaped and Node-injection variables are removed.
 * @param options.timeoutMs - Readiness deadline in milliseconds.
 * @param options.platform - Target platform override for tests.
 * @returns The port the service bound.
 */
export async function checkCAStudioService({ serviceDirectory, node, environment = process.env, timeoutMs = 30_000, platform = process.platform }) {
  const index = join(serviceDirectory, 'server', 'index.ts')
  assert.ok(existsSync(index), `castudio check: ${index} is missing`)
  // The optional parametric-CAD env installer and its install inputs must ship
  // with the service; their absence means the staging prune dropped too much.
  for (const required of [
    join('scripts', 'setup-cad-env.mjs'),
    join('resources', 'parametric', 'requirements.txt'),
    join('resources', 'castudio-runtime', 'pyproject.toml'),
    join('resources', 'castudio-runtime', 'castudio_runtime', 'editor', 'server.py'),
    join('resources', 'castudio-runtime', 'castudio_runtime', 'editor', 'webui', 'index.html'),
  ]) {
    assert.ok(existsSync(join(serviceDirectory, required)), `castudio check: ${join(serviceDirectory, required)} is missing`)
  }
  // The official cadflow wheel (native cadflow_core + OCCT) must be staged whole.
  const wheelDir = join(serviceDirectory, 'resources', 'cadflow-wheel')
  const wheels = existsSync(wheelDir) ? readdirSync(wheelDir).filter(name => name.endsWith('.whl')) : []
  assert.equal(wheels.length, 1, `castudio check: expected exactly one .whl under ${wheelDir}, found ${wheels.length}`)
  const loader = tsxLoaderEntry(serviceDirectory)
  const port = await reservePort()
  const dataDirectory = mkdtempSync(join(tmpdir(), 'castudio-service-check-'))
  const child = spawn(node, ['--import', pathToFileURL(loader).href, 'server/index.ts'], {
    cwd: serviceDirectory,
    env: serviceEnvironment(environment, port, dataDirectory),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  })
  let stderrTail = ''
  child.stderr?.on('data', chunk => { stderrTail = `${stderrTail}${String(chunk)}`.slice(-STDERR_TAIL_LIMIT) })
  child.stdout?.resume()
  const base = `http://127.0.0.1:${port}`
  try {
    const deadline = Date.now() + timeoutMs
    let apiStatus = 0
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`castudio check: service exited early (code ${String(child.exitCode)}, signal ${String(child.signalCode)}); stderr: ${stderrTail.trimEnd()}`)
      }
      apiStatus = await probe(`${base}${PROBE_PATH}`)
      if (apiStatus === 200) break
      await new Promise(resolvePoll => setTimeout(resolvePoll, POLL_INTERVAL_MS))
    }
    assert.equal(apiStatus, 200, `castudio check: ${base}${PROBE_PATH} did not answer 200; stderr: ${stderrTail.trimEnd()}`)
    const pageStatus = await probe(`${base}/`)
    assert.equal(pageStatus, 200, `castudio check: ${base}/ did not answer 200; stderr: ${stderrTail.trimEnd()}`)
    return port
  } finally {
    await stopChild(child, platform)
    rmSync(dataDirectory, { recursive: true, force: true })
  }
}
