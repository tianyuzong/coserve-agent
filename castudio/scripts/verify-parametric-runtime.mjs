// Real-service smoke for the parametric CAD runtime: starts a private CAStudio
// server on a free port with a temp STUDIO_DATA_DIR + parametric-runtime.json,
// creates a project, installs the cylinder template, starts the cadflow
// worker, inserts a cell assigning a blue Material, runs it, and stops.
// Never touches port 4317 or the user's data dir.
// Usage: node scripts/verify-parametric-runtime.mjs [--keep]
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const keep = process.argv.includes('--keep');
const CAD_PYTHON = process.env.CAD_PYTHON || 'D:/castudio-env/cf/Scripts/python.exe';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function freePort() {
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  return port;
}
async function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs; let last;
  while (Date.now() < deadline) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await sleep(500);
  }
  throw new Error(`timeout: ${label}${last ? ` (${last.message})` : ''}`);
}

const port = process.env.E2E_PORT ? Number(process.env.E2E_PORT) : await freePort();
const base = `http://127.0.0.1:${port}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'castudio-parametric-e2e-'));
await fs.writeFile(path.join(dataDir, 'parametric-runtime.json'), JSON.stringify({ python: CAD_PYTHON }));

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root, env: { ...process.env, STUDIO_PORT: String(port), STUDIO_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const api = (suffix, init) => fetch(`${base}/api${suffix}`, init).then(async r => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json().catch(() => null) : await r.text() }));
const post = (suffix, body) => api(suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });

let pbase = null;
try {
  await waitFor(async () => (await fetch(`${base}/api/projects`).then(r => r.ok).catch(() => false)), 30000, 'studio server');
  const rt = (await api('/parametric/runtime')).body;
  check('parametric runtime configured', rt?.configured === true, JSON.stringify(rt));

  const project = (await post('/projects', { name: '参数化冒烟' })).body;
  check('project created', !!project?.id, project?.id);
  pbase = `/projects/${project.id}/parametric`;

  const tpl = await post(`${pbase}/template`);
  check('template installed', tpl.status === 201, `status=${tpl.status}`);

  const started = await post(`${pbase}/start`);
  check('parametric worker started', started.status === 200 && !!started.body?.url, `status=${started.status} ${JSON.stringify(started.body).slice(0, 120)}`);

  const cells0 = await waitFor(async () => {
    const r = await api(`${pbase}/agent/cells`);
    return r.status === 200 && r.body?.kernel === true && (r.body?.cells?.length ?? 0) > 0 ? r.body : null;
  }, 300000, 'agent cells with kernel');
  check('kernel up, cells listed', true, `${cells0.cells.length} cells, notebook=${cells0.notebook}`);
  const lastCell = cells0.cells[cells0.cells.length - 1];
  console.log(`last cell: index=${lastCell.index} id=${lastCell.id} name=${lastCell.name} status=${lastCell.status}`);

  // Edit the template's final cell (the `cylinder = cad.Part(...)` cell) to
  // assign a blue Material before its `return`, keeping its output contract.
  // The kernel runs cells inside a GraphSession: recorded operators reject
  // inputs not built inside it, so the Part must come from make_part_rpart
  // (not the raw scad.Part constructor) and the Material from
  // make_material_rmaterial before assign_material_rpart accepts them.
  const lastCode = String(lastCell.code ?? '');
  const materialLines = [
    "blue_paint = cad.make_material_rmaterial('paint-blue', name='蓝色涂层', color=(0.0, 0.0, 1.0))",
    'cylinder = cad.assign_material_rpart(cylinder, blue_paint)',
  ];
  let lines = lastCode.split('\n').map(l =>
    l.includes('cad.Part(') ? l.replace('cad.Part(', 'cad.make_part_rpart(') : l);
  const retIdx = lines.map((l, i) => /^\s*return\b/.test(l) ? i : -1).filter(i => i >= 0).pop();
  const edited = retIdx === undefined
    ? [...lines, ...materialLines, 'return (cylinder,)'].join('\n')
    : [...lines.slice(0, retIdx), ...materialLines, ...lines.slice(retIdx)].join('\n');
  console.log('--- edited cell code ---\n' + edited);

  const edit = await post(`${pbase}/agent/cells/edit`, { cell: lastCell.id, code: edited, run: true });
  check('cell edit accepted', edit.status === 200 && !edit.body?.error, `status=${edit.status} ${JSON.stringify(edit.body).slice(0, 200)}`);

  const cells1 = await waitFor(async () => {
    const r = await api(`${pbase}/agent/cells`);
    const cell = r.body?.cells?.find(c => c.id === lastCell.id);
    return cell && (cell.code || '').includes('paint-blue') && !['running', 'queued'].includes(cell.status) ? r.body : null;
  }, 120000, 'edited cell settled');
  const matCell = cells1.cells.find(c => c.id === lastCell.id);
  console.log(`edited cell: id=${matCell.id} status=${matCell.status} errors=${JSON.stringify(matCell.errors ?? null)}`);
  console.log(`cell console: ${JSON.stringify(matCell.console ?? [])}`);
  check('edited cell ran without errors', !matCell.errors?.length && !/error|failed|exception/i.test(String(matCell.status)), `status=${matCell.status} errors=${JSON.stringify(matCell.errors ?? [])}`);

  // Native-backend proof inside the live kernel: a cell that builds a box via
  // cad.Model() and asserts its volume — exercises cadflow_core.dll + OCCT in
  // the same process as the recorded-graph engine. Inserted without running;
  // the cells/run below executes it with everything else.
  // `cad` is already a notebook global from the setup cell; redefining it
  // trips marimo's multiply-defined-names validation, so use it directly.
  const probeCode = [
    '_native_m = cad.Model()',
    '_native_v = _native_m.box(2,3,4).volume',
    'assert abs(_native_v - 24) < 1e-6, _native_v',
    '_native_m.close()',
    'return ()',
  ].join('\n');
  const ins = await post(`${pbase}/agent/cells/insert`, { after: 'end', code: probeCode, name: 'native_probe', run: false });
  check('native probe cell inserted', ins.status === 200 && !ins.body?.error, `status=${ins.status} ${JSON.stringify(ins.body).slice(0, 160)}`);

  const run = await post(`${pbase}/agent/cells/run`, {});
  check('cells/run accepted', run.status === 200, `status=${run.status} ${JSON.stringify(run.body).slice(0, 160)}`);
  await sleep(3000);
  const cells2 = (await api(`${pbase}/agent/cells`)).body;
  const failing = (cells2?.cells ?? []).filter(c => c.errors?.length || /error|failed/i.test(String(c.status)));
  check('no cell errors after run', failing.length === 0, failing.length ? JSON.stringify(failing.map(c => ({ id: c.id, status: c.status, errors: c.errors }))).slice(0, 400) : 'all cells clean');
  const probeCell = (cells2?.cells ?? []).find(c => String(c.code ?? '').includes('cad.Model()'));
  check('native cad.Model() probe ran clean in kernel', !!probeCell && !probeCell.errors?.length && !/error|failed|exception/i.test(String(probeCell.status)), probeCell ? `status=${probeCell.status} errors=${JSON.stringify(probeCell.errors ?? [])}` : 'probe cell not found');

  // Publish through the same HTTP flow the modeling panel uses: the editor
  // sends its settled snapshot; the server gates on /api/castudio/settled then
  // runs bridge.py build headlessly into exports/<rid>/.
  const editorSnapshot = {
    notebook: 'cylinder.py',
    cells: (cells2?.cells ?? []).map(c => ({ id: c.id, code: c.code })),
    parameters: {},
    modules: [],
  };
  const pub = await post(`${pbase}/publish`, { editor: editorSnapshot });
  check('publish accepted', pub.status === 202, `status=${pub.status} ${JSON.stringify(pub.body).slice(0, 200)}`);

  // Wait for the async build job to finish (poll the parametric status).
  const job = await waitFor(async () => {
    const r = await api(pbase);
    const j = r.body?.job;
    return j && j.state !== 'running' ? j : null;
  }, 600000, 'publish job to finish');
  check('publish job succeeded', job.state === 'succeeded', `state=${job.state} ${String(job.error ?? '').slice(0, 300)}`);
  if (job.log) console.log('--- build log tail ---\n' + String(job.log).split('\n').slice(-15).join('\n'));

  // Locate the produced scene package and validate it through scene-package.ts.
  const published = (await api(pbase)).body?.published;
  const rid = /exports\/([0-9a-f-]{36})\//.exec(String(published?.source ?? ''))?.[1];
  check('published manifest recorded', !!published?.manifest, JSON.stringify(published?.manifest?.equivalence ?? null).slice(0, 160));
  let sceneFile = null;
  if (rid) {
    const candidate = path.join(dataDir, 'projects', project.id, 'parametric', 'exports', rid, 'cylinder.scadpkg');
    sceneFile = (await fs.stat(candidate).then(() => candidate).catch(() => null));
  }
  if (!sceneFile) {
    // Fallback: newest cylinder.scadpkg anywhere under the temp data dir.
    const hits = [];
    async function walk(dir) {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.name === 'cylinder.scadpkg') hits.push(p);
      }
    }
    await walk(dataDir).catch(() => {});
    sceneFile = hits.sort().pop() ?? null;
  }
  check('scene package produced', !!sceneFile, sceneFile ?? 'not found');
  if (sceneFile) {
    const out = await new Promise(resolve => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'scripts', 'verify-scene-package.mts'), sceneFile], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let buf = '';
      child.stdout.on('data', d => { buf += d; });
      child.stderr.on('data', d => { buf += d; });
      child.on('close', () => resolve(buf));
    });
    const line = out.split('\n').find(l => l.startsWith('SCENE_RESULT='));
    console.log('scene check output:', out.trim().slice(0, 500));
    let parsed = null;
    try { parsed = line ? JSON.parse(line.slice('SCENE_RESULT='.length)) : null; } catch { parsed = null; }
    check('scene package validates as cadflow-1.0', parsed?.format === 'cadflow-1.0', JSON.stringify(parsed).slice(0, 200));
    const blue = (parsed?.colours ?? []).some(c => Array.isArray(c) && c.length >= 3 && c[2] === 1 && c[0] === 0 && c[1] === 0);
    check('appearance has blue base_color [0,0,1,...]', blue, JSON.stringify(parsed?.colours ?? null));
  }

  const stop = await post(`${pbase}/stop`);
  check('worker stopped', stop.status === 200, `status=${stop.status}`);
} catch (error) {
  check('smoke completed', false, error.message);
  if (serverLog.trim()) console.log('--- server log tail ---\n' + serverLog.trim().split('\n').slice(-20).join('\n'));
} finally {
  // Best-effort worker stop before killing the server so the cadflow
  // editor (and its marimo kernel children) does not orphan on Windows.
  if (pbase) await post(`${pbase}/stop`, {}).catch(() => {});
  server.kill();
  await sleep(500);
  try { process.kill(server.pid, 'SIGKILL'); } catch { /* gone */ }
  if (!keep) await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  else console.log(`kept dataDir=${dataDir} port=${port}`);
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
