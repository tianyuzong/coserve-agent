/** Stage the bundled CAStudio service that packaged Desktop builds ship as resources/castudio. */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { desktopTargetPlatform, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { packagingStep } from './packaging-step.mjs'
import { resolveNpmRegistry } from './desktop-release-environment.mjs'
import { checkCAStudioService } from './castudio-service-check.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const BUILD_PATHS = resolveDesktopTargetBuildPaths()
const STAGED = BUILD_PATHS.castudio
const SOURCE = process.env.COSERVE_CASTUDIO_SOURCE_DIR ?? resolve(REPOSITORY_ROOT, 'castudio')
const NODE = join(BUILD_PATHS.electron, process.platform === 'win32' ? 'electron.exe' : 'Electron.app/Contents/MacOS/Electron')

/** Files the staged service reads at runtime; everything else stays in the source checkout. */
const STAGED_ENTRIES = ['server', 'shared', 'resources', 'dist', 'src/scene/vendor', 'package.json', 'package-lock.json'] as const

function npmCli(): string {
  const candidate = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!existsSync(candidate)) throw new Error(`desktop castudio: npm CLI not found beside ${process.execPath}`)
  return candidate
}

function npmEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  // A dependency may ship a shrinkwrap pinned to another mirror; the staged runtime must still
  // resolve every tarball from the configured registry, so replace lockfile hosts outright.
  const env: NodeJS.ProcessEnv = {
    ...environment, npm_config_registry: resolveNpmRegistry(environment),
    npm_config_replace_registry_host: 'always',
  }
  const nodeBin = dirname(process.execPath)
  const pathKey = Object.keys(env).find(name => name.toLowerCase() === 'path') ?? 'PATH'
  env[pathKey] = `${nodeBin}${delimiter}${env[pathKey] ?? ''}`
  return env
}

function run(command: string, args: readonly string[], options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`desktop castudio: ${command} ${args.join(' ')} exited with ${String(code)}`))
    })
  })
}

const npm = (args: readonly string[], cwd: string) => run(process.execPath, [npmCli(), ...args], { cwd, env: npmEnvironment(process.env) })

/**
 * npm installs every @esbuild platform package a lockfile records; the staged
 * bundle only ever runs on the selected target, so drop the other binaries.
 */
function pruneEsbuildPlatforms(nodeModules: string, keep: string): number {
  let removed = 0
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = join(directory, entry.name)
      if (entry.name === '@esbuild') {
        for (const platform of readdirSync(path)) {
          if (platform === keep) continue
          rmSync(join(path, platform), { recursive: true, force: true })
          removed += 1
        }
        continue
      }
      visit(path)
    }
  }
  visit(nodeModules)
  return removed
}

/** Vendored pip-installable package dirs the optional-env installer needs (`pip install --no-deps <dir>`). */
const PARAMETRIC_PACKAGES = ['castudio-runtime'] as const
const PARAMETRIC_PACKAGE_FILES = ['pyproject.toml', 'README.md', 'LICENSE'] as const
/** Vendored official cadflow wheel directory; the installer runs `pip install --no-deps <wheel>`. */
const CADFLOW_WHEEL_DIR = 'cadflow-wheel'

/**
 * Stage the vendored parametric-CAD inputs the optional-env installer needs
 * and drop the retired SimpleCADAPI tree and the superseded pure-Python
 * cadflow-py checkout. `castudio-runtime` is a real package dir (build residue
 * pruned, top-level names only so the real `castudio_runtime/build`
 * subpackage survives); `cadflow-wheel` ships as a flat `.whl` plus notices.
 */
function stageParametricPackages(stagedResources: string, sourceResources: string): void {
  rmSync(join(stagedResources, 'simplecadapi'), { recursive: true, force: true })
  rmSync(join(stagedResources, 'cadflow-py'), { recursive: true, force: true })
  const wheelDir = join(stagedResources, CADFLOW_WHEEL_DIR)
  const wheels = existsSync(wheelDir) ? readdirSync(wheelDir).filter(name => name.endsWith('.whl')) : []
  if (wheels.length !== 1) throw new Error(`desktop castudio: expected exactly one .whl under ${wheelDir}, found ${wheels.length}; staging aborted`)
  for (const name of PARAMETRIC_PACKAGES) {
    const staged = join(stagedResources, name)
    const source = join(sourceResources, name)
    for (const file of PARAMETRIC_PACKAGE_FILES) {
      if (!existsSync(join(source, file))) throw new Error(`desktop castudio: expected ${join(source, file)} for the ${name} install; staging aborted`)
    }
    for (const artifact of ['build', 'dist', '.eggs']) rmSync(join(staged, artifact), { recursive: true, force: true })
    for (const entry of readdirSync(staged)) {
      if (entry.endsWith('.egg-info')) rmSync(join(staged, entry), { recursive: true, force: true })
    }
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__pycache__') rmSync(path, { recursive: true, force: true })
          else visit(path)
        }
      }
    }
    visit(staged)
  }
}

async function stageSource(): Promise<void> {
  process.stdout.write(`desktop castudio: registry ${resolveNpmRegistry(process.env)} (npm_config_registry=${process.env.npm_config_registry ?? ''}, replace=${process.env.npm_config_replace_registry_host ?? ''})\n`)
  if (!existsSync(join(SOURCE, 'package.json')) || !existsSync(join(SOURCE, 'server', 'index.ts'))) {
    throw new Error(`desktop castudio: CAStudio source ${SOURCE} is missing package.json or server/index.ts; set COSERVE_CASTUDIO_SOURCE_DIR`)
  }
  if (!existsSync(NODE)) throw new Error(`desktop castudio: prepared Electron runtime missing at ${NODE}; run prepare:runtime first`)
  // Command-line config outranks any inherited npm_config_* environment, so the staged install
  // always resolves from the registry this build selected, never from a mirror baked into the
  // environment or into a dependency's shrinkwrap.
  const registryArgs = [`--registry=${resolveNpmRegistry(process.env)}`, '--replace-registry-host=always'] as const
  if (!existsSync(join(SOURCE, 'node_modules'))) await npm(['ci', ...registryArgs], SOURCE)
  await npm(['run', 'build'], SOURCE)
  rmSync(STAGED, { recursive: true, force: true })
  mkdirSync(STAGED, { recursive: true })
  for (const entry of STAGED_ENTRIES) {
    const source = join(SOURCE, entry)
    if (!existsSync(source)) throw new Error(`desktop castudio: expected ${source} after build; staging aborted`)
    cpSync(source, join(STAGED, entry), { recursive: true })
  }
  // The optional parametric-CAD env installer ships next to the service; it is
  // user-triggered and never part of the app install itself.
  const setupScript = join(SOURCE, 'scripts', 'setup-cad-env.mjs')
  if (!existsSync(setupScript)) throw new Error(`desktop castudio: expected ${setupScript}; staging aborted`)
  mkdirSync(join(STAGED, 'scripts'), { recursive: true })
  cpSync(setupScript, join(STAGED, 'scripts', 'setup-cad-env.mjs'))
  stageParametricPackages(join(STAGED, 'resources'), join(SOURCE, 'resources'))
  await npm(['ci', '--omit=dev', ...registryArgs], STAGED)
  const lock = JSON.parse(readFileSync(join(STAGED, 'package-lock.json'), 'utf8')) as {
    packages?: Record<string, { version?: string }>
  }
  const tsxVersion = lock.packages?.['node_modules/tsx']?.version
  if (tsxVersion === undefined) throw new Error('desktop castudio: package-lock.json does not pin tsx')
  // `npm ci --omit=dev` leaves the omitted devDependencies as version-less nodes in npm's ideal
  // tree, so adding one more package re-resolves their peers (vite via @vitejs/plugin-react) and
  // fails with ERESOLVE. The staged tree is a runtime bundle, not a develop install: skipping peer
  // resolution installs exactly the pinned tsx without pulling that dev graph in for checking.
  await npm(['install', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', '--legacy-peer-deps', ...registryArgs, `tsx@${tsxVersion}`], STAGED)
  const stagedTsx = JSON.parse(readFileSync(join(STAGED, 'node_modules', 'tsx', 'package.json'), 'utf8')) as { version?: string }
  if (stagedTsx.version !== tsxVersion) {
    throw new Error(`desktop castudio: staged tsx ${String(stagedTsx.version)} does not match locked ${tsxVersion}`)
  }
  const target = desktopTargetPlatform(resolveDesktopBuildTarget())
  const pruned = pruneEsbuildPlatforms(join(STAGED, 'node_modules'), `${target.platform}-${target.arch}`)
  if (pruned > 0) process.stdout.write(`desktop castudio: removed ${pruned} non-target @esbuild platform packages\n`)
}

async function main(): Promise<void> {
  const runDir = process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
  await packagingStep(runDir, 'prepare:castudio', stageSource)
  await packagingStep(runDir, 'castudio:verify', () => checkCAStudioService({ serviceDirectory: STAGED, node: NODE }))
  process.stdout.write(`desktop castudio: staged ${STAGED} from ${SOURCE}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
