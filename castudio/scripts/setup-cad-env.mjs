#!/usr/bin/env node
/**
 * Optional CAStudio parametric-CAD environment installer.
 *
 * Creates a Python 3.12 environment with the pinned parametric requirements
 * and non-editable installs of the vendored official `cadflow` wheel (native
 * C++ backend + OCCT) and `castudio-runtime` (runtime + editor), then writes
 * <data-dir>/parametric-runtime.json so the CAStudio service picks it up.
 * Nothing here ships inside the application installer; users run this only
 * when they want parametric CAD. Plain Node ESM, no dependencies.
 *
 * Usage: node scripts/setup-cad-env.mjs [--data-dir <dir>] [--env-dir <dir>]
 *        [--python <python.exe>] [--mirror pip=<index-url>] [--force] [--dry-run]
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const RESOURCES = path.resolve(SCRIPT_DIR, '..', 'resources');
const PARAMETRIC_RESOURCES = path.join(RESOURCES, 'parametric');
const CADFLOW_WHEEL_DIR = path.join(RESOURCES, 'cadflow-wheel');
const CASTUDIO_RUNTIME_DIR = path.join(RESOURCES, 'castudio-runtime');
const WEBUI_INDEX = path.join(CASTUDIO_RUNTIME_DIR, 'castudio_runtime', 'editor', 'webui', 'index.html');
const IS_WINDOWS = process.platform === 'win32';
const PROBE_TIMEOUT_MS = 180_000;

function usage(message) {
  if (message) console.error(`setup-cad-env: ${message}`);
  console.error('usage: node scripts/setup-cad-env.mjs [--data-dir <dir>] [--env-dir <dir>] [--python <exe>] [--mirror pip=<url>] [--force] [--dry-run]');
  process.exit(2);
}

function needValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value === '' || value.startsWith('--')) usage(`${flag} needs a value`);
  return value;
}

function parseArgs(argv) {
  const args = { dataDir: undefined, envDir: undefined, python: undefined, mirrors: {}, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') args.force = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--data-dir') args.dataDir = needValue(argv, ++i, arg);
    else if (arg === '--env-dir') args.envDir = needValue(argv, ++i, arg);
    else if (arg === '--python') args.python = needValue(argv, ++i, arg);
    else if (arg === '--mirror') {
      const value = needValue(argv, ++i, arg);
      const eq = value === undefined ? -1 : value.indexOf('=');
      if (eq <= 0) usage('--mirror expects <name>=<value>');
      args.mirrors[value.slice(0, eq)] = value.slice(eq + 1);
    } else usage(`unknown argument ${arg}`);
  }
  for (const key of ['dataDir', 'envDir', 'python']) {
    if (args[key] !== undefined && args[key] === '') usage(`--${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)} needs a value`);
  }
  return args;
}

function resolveDataDir(flag) {
  if (flag) return path.resolve(flag);
  if (process.env.STUDIO_DATA_DIR) return path.resolve(process.env.STUDIO_DATA_DIR);
  const home = process.env.COSERVE_HOME ?? path.join(homedir(), '.coserve');
  return path.join(home, 'castudio');
}

function envPythonPath(envDir) {
  return path.join(envDir, IS_WINDOWS ? 'Scripts' : 'bin', IS_WINDOWS ? 'python.exe' : 'python');
}

function condaPythonPath(envDir) {
  return IS_WINDOWS ? path.join(envDir, 'python.exe') : path.join(envDir, 'bin', 'python');
}

/** Run a command with inherited stdio; resolves on exit 0. */
function run(command, args, options = {}) {
  const { env, cwd, label, shell = false, timeout = 0 } = options;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: 'inherit',
      windowsHide: true,
      shell,
      ...(timeout > 0 ? { timeout, killSignal: 'SIGKILL' } : {}),
    });
    child.once('error', error => rejectPromise(new Error(`${label ?? command}: ${error.message}`)));
    child.once('close', code => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`${label ?? `${command} ${args.join(' ')}`} exited with ${String(code)}`));
    });
  });
}

/** Capture a short command's output; resolves with it or rejects. */
function capture(command, args, timeoutMs = 30_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: timeoutMs, killSignal: 'SIGKILL' });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.once('error', rejectPromise);
    child.once('close', code => (code === 0 ? resolvePromise(out) : rejectPromise(new Error(`exit ${String(code)}`))));
  });
}

/** Probe a candidate interpreter; returns its version string or undefined. */
async function probePython(command, args = []) {
  try {
    const out = await capture(command, [...args, '--version']);
    const match = /(\d+\.\d+\.\d+)/.exec(out);
    return match ? match[1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find a way to create the environment. Returns
 * { mode: 'venv', command, args } or { mode: 'conda', command } or undefined.
 */
async function discoverPython(explicit) {
  if (explicit) {
    const version = await probePython(explicit);
    if (version === undefined) throw new Error(`--python ${explicit} did not answer --version`);
    if (!version.startsWith('3.12.')) {
      throw new Error(`--python ${explicit} is Python ${version}; the parametric runtime requires 3.12`);
    }
    return { mode: 'venv', command: explicit, args: [] };
  }
  for (const [command, args] of [['py', ['-3.12']], ['python3.12', []]]) {
    const version = await probePython(command, args);
    if (version !== undefined && version.startsWith('3.12.')) return { mode: 'venv', command, args };
  }
  for (const command of ['conda.exe', 'conda', 'conda.cmd']) {
    if ((await probePython(command)) !== undefined) return { mode: 'conda', command };
  }
  return undefined;
}

function pipArgs(mirror) {
  return mirror.pip ? ['--index-url', mirror.pip] : [];
}

/** Resolve the single vendored official cadflow wheel inside cadflow-wheel/. */
function cadflowWheel() {
  if (!existsSync(CADFLOW_WHEEL_DIR)) {
    throw new Error(`setup-cad-env: expected ${CADFLOW_WHEEL_DIR}; run this script from a CAStudio checkout or packaged resources/castudio tree`);
  }
  const wheels = readdirSync(CADFLOW_WHEEL_DIR).filter(name => name.endsWith('.whl'));
  if (wheels.length !== 1) {
    throw new Error(`setup-cad-env: expected exactly one .whl in ${CADFLOW_WHEEL_DIR}, found ${wheels.length}`);
  }
  return path.join(CADFLOW_WHEEL_DIR, wheels[0]);
}

/** True when the env's python loads the native backend and builds a colored material. */
async function probePackage(envPy) {
  const code = [
    'import cadflow as cad',
    'm = cad.Model()',
    'v = m.box(2,3,4).volume',
    'assert abs(v - 24) < 1e-6, v',
    'mat = cad.make_material_rmaterial("m", color=(0,0,1))',
    'print("cadflow", cad.__version__, "native+recorded probe ok")',
  ].join('; ');
  try {
    const out = await capture(envPy, ['-I', '-X', 'utf8', '-c', code], PROBE_TIMEOUT_MS);
    return out.includes('probe ok');
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataDir = resolveDataDir(args.dataDir);
  const envDir = path.resolve(args.envDir ?? path.join(dataDir, 'env', 'cadflow'));
  const runtimeFile = path.join(dataDir, 'parametric-runtime.json');
  const requirements = path.join(PARAMETRIC_RESOURCES, 'requirements.txt');
  const wheel = cadflowWheel();
  for (const required of [requirements, wheel, path.join(CASTUDIO_RUNTIME_DIR, 'pyproject.toml')]) {
    if (!existsSync(required)) throw new Error(`setup-cad-env: expected ${required}; run this script from a CAStudio checkout or packaged resources/castudio tree`);
  }
  if (!existsSync(WEBUI_INDEX)) {
    throw new Error(`setup-cad-env: the editor web assets are missing at ${WEBUI_INDEX}; the packaged tree is incomplete`);
  }

  const python = await discoverPython(args.python);
  if (python === undefined) {
    console.error('setup-cad-env: no Python 3.12 found. Install Python 3.12 from https://www.python.org/downloads/ '
      + 'or Miniconda (https://docs.conda.io/en/latest/miniconda.html), then rerun — or pass --python <path-to-3.12>.');
    process.exit(1);
  }
  const envPy = python.mode === 'conda' ? condaPythonPath(envDir) : envPythonPath(envDir);
  const plan = [
    `data dir:      ${dataDir}`,
    `env dir:       ${envDir}`,
    `python plan:   ${python.mode === 'conda' ? `conda create -p "${envDir}" python=3.12` : `${[python.command, ...python.args].join(' ')} -m venv "${envDir}"`}`,
    `env python:    ${envPy} (${existsSync(envPy) ? 'present' : 'absent'})`,
    `requirements:  ${requirements}`,
    `cadflow:       ${wheel} (official wheel, --no-deps)`,
    `castudio-runtime: ${CASTUDIO_RUNTIME_DIR} (vendored, --no-deps)`,
    `pip install:   -r ${requirements}`,
    `pip install:   --no-deps ${wheel} ${CASTUDIO_RUNTIME_DIR}`,
    `runtime file:  ${runtimeFile}`,
  ];
  if (args.mirrors.pip) plan.push(`pip mirror:    ${args.mirrors.pip}`);
  if (args.dryRun) {
    console.log(plan.join('\n'));
    console.log('setup-cad-env: dry run — nothing was created or installed.');
    return;
  }
  console.log(plan.join('\n'));

  // Reuse a healthy environment; --force or a failed probe rebuilds it.
  let healthy = false;
  if (!args.force && existsSync(envPy)) {
    healthy = await probePackage(envPy);
    if (healthy) console.log('setup-cad-env: existing environment passed the probe; reusing it.');
  }
  if (!healthy) {
    if (existsSync(envDir)) await rm(envDir, { recursive: true, force: true });
    await mkdir(envDir, { recursive: true });
    if (python.mode === 'conda') {
      // .cmd shims need a shell; a resolved conda.exe does not.
      const needsShell = IS_WINDOWS && !/\.exe$/i.test(python.command);
      const envArg = needsShell ? `"${envDir}"` : envDir;
      await run(python.command, ['create', '-p', envArg, 'python=3.12', '-y'], { shell: needsShell, label: 'conda create' });
    } else {
      await run(python.command, [...python.args, '-m', 'venv', envDir], { label: 'python -m venv' });
    }
    if (!existsSync(envPy)) throw new Error(`environment was created but ${envPy} is missing`);
    await run(envPy, ['-m', 'pip', 'install', ...pipArgs(args.mirrors), '-r', requirements], { label: 'pip install -r requirements.txt' });
    await run(envPy, ['-m', 'pip', 'install', ...pipArgs(args.mirrors), '--no-deps', wheel, CASTUDIO_RUNTIME_DIR], { label: 'pip install cadflow wheel + castudio-runtime' });
    if (!(await probePackage(envPy))) throw new Error('post-install probe failed; the environment is not usable');
  }

  await mkdir(dataDir, { recursive: true });
  // Stage inside the data dir so the atomic rename never crosses volumes.
  const staging = await mkdtemp(path.join(dataDir, '.parametric-runtime-'));
  try {
    const stagingFile = path.join(staging, 'parametric-runtime.json');
    await writeFile(stagingFile, `${JSON.stringify({ python: envPy }, null, 2)}\n`, 'utf8');
    await rename(stagingFile, runtimeFile);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  console.log(`setup-cad-env: wrote ${runtimeFile}`);
  console.log(`setup-cad-env: done — parametric CAD environment ready at ${envPy}`);
}

main().catch(error => {
  console.error(`setup-cad-env: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
