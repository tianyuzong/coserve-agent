// Real cross-repo E2E for the cad_workbench tool: starts a private CAStudio
// server on a free port with a temp STUDIO_DATA_DIR, opens the studio page in
// headless Edge through playwright-core, then runs the harness headless
// profile from source (mock LLM) against COSERVE_CASTUDIO_URL and inspects the
// durable session log. Never touches port 4317 or the installed app.
// Usage: node orchestrate.mjs [--keep]
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const COSERVE_ROOT = path.resolve(here, '../../../../../../');
const CADFLOW_ROOT = path.resolve(COSERVE_ROOT, '../cadflow-studio');
const keep = process.argv.includes('--keep');
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
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await sleep(250);
  }
  throw new Error(`timeout: ${label}${last ? ` (${last.message})` : ''}`);
}

const tsxUrl = import.meta.resolve('tsx');
const { chromium } = await import(pathToFileURL(
  'D:/devin workspace/coserve-agent/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs',
).href);
const EDGE = 'C:/Program Files (x86)/Microsoft/EdgeCore/157.0.4341.42/msedge.exe';
await fs.access(EDGE);

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'castudio-harness-e2e-data-'));
const harnessHome = await fs.mkdtemp(path.join(os.tmpdir(), 'castudio-harness-e2e-home-'));
const scriptFile = path.join(os.tmpdir(), `castudio-mock-script-${process.pid}.json`);

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: CADFLOW_ROOT,
  env: { ...process.env, STUDIO_PORT: String(port), STUDIO_DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

const api = (suffix, init) => fetch(`${base}/api${suffix}`, init).then(async r => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }));
const post = (suffix, body) => api(suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let browser = null;
let driver = null;
let driverLog = '';
try {
  await waitFor(async () => (await fetch(`${base}/api/projects`).then(r => r.ok).catch(() => false)), 30000, 'studio server');
  const project = (await post('/projects', { name: 'Harness E2E 工作台' })).body;
  check('project created', !!project?.id, project?.id);

  browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.goto(`${base}/?embedded=1&project=${project.id}`, { waitUntil: 'domcontentloaded' });

  const viewports = () => api('/dsh/viewports').then(r => r.body);
  const live = await waitFor(async () => {
    const list = await viewports();
    const entry = Array.isArray(list) ? list.find(v => v.id === project.id) : null;
    return entry?.state?.meshes?.length > 0 ? entry : null;
  }, 45000, 'connected viewport with meshes');
  check('viewport connected via /api/dsh/viewports', true, `${live.state.meshes.length} meshes, workspace=${live.state.workspace}, model.demo=${live.state.model?.demo}`);

  // Pick a uniquely-named real mesh for the select-by-name call.
  const meshes = live.state.meshes;
  const nameCount = new Map();
  for (const m of meshes) nameCount.set(m.name, (nameCount.get(m.name) ?? 0) + 1);
  const pick = meshes.find(m => typeof m.name === 'string' && m.name.length > 0 && nameCount.get(m.name) === 1 && m.id !== live.state.selection?.meshId) ?? meshes[0];
  check('select target is a unique mesh name', !!pick?.name, `${pick.name} (${pick.id})`);
  const cameraBefore = live.state.camera?.position;

  const script = [
    { tool: { name: 'cad_workbench', arguments: { action: 'state' } }, note: 'reading the workbench' },
    { text: 'state noted' },
    { tool: { name: 'cad_workbench', arguments: { action: 'fit', view: 'top' } }, note: 'framing the top view' },
    { text: 'fit applied' },
    { tool: { name: 'cad_workbench', arguments: { action: 'select', part: pick.name } }, note: `selecting ${pick.name}` },
    { text: 'selection applied' },
    { tool: { name: 'cad_workbench', arguments: { action: 'snapshot' } }, note: 'capturing the viewport' },
    { text: 'snapshot saved' },
  ];
  await fs.writeFile(scriptFile, JSON.stringify(script));

  const driverPath = path.join(here, 'driver.ts');
  const patchPath = path.join(here, 'real-e2e.patch.yml');
  driver = spawn(process.execPath, ['--import', tsxUrl, driverPath, patchPath], {
    cwd: harnessHome,
    env: {
      ...process.env,
      TSX_TSCONFIG_PATH: path.join(COSERVE_ROOT, 'tsconfig.json'),
      COSERVE_CASTUDIO_URL: base,
      TOOL_CASTUDIO_MOCK_SCRIPT: scriptFile,
    },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  driver.stdout.on('data', d => { driverLog += d; });
  driver.stderr.on('data', d => { driverLog += d; });
  const driverExit = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { driver.kill('SIGKILL'); reject(new Error('driver timed out after 240s')); }, 240000);
    driver.once('exit', code => { clearTimeout(timer); resolve(code); });
    driver.once('error', err => { clearTimeout(timer); reject(err); });
  });
  check('harness driver exited cleanly', driverExit === 0, `code=${driverExit}`);
  if (driverExit !== 0 && driverLog.trim()) console.log('--- driver log tail ---\n' + driverLog.trim().split('\n').slice(-25).join('\n'));

  // Inspect durable session events.
  const jsonlFiles = [];
  const walk = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) jsonlFiles.push(p);
    }
  };
  await waitFor(async () => {
    try { await walk(path.join(harnessHome, '.sessions')); return jsonlFiles.length > 0; } catch { return false; }
  }, 10000, 'session jsonl').catch(() => {});
  check('session log written', jsonlFiles.length === 1, jsonlFiles[0] ?? 'none');

  const lines = jsonlFiles.length ? (await fs.readFile(jsonlFiles[0], 'utf8')).trimEnd().split('\n').slice(1) : [];
  const events = lines.map(l => JSON.parse(l));
  const messageText = blocks => (blocks ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');

  const turns = events.filter(e => e.type === 'turn/end');
  check('four turns completed', turns.length === 4, `${turns.length} turn/end`);

  const calls = events.filter(e => e.type === 'tool/call' && e.data?.name === 'cad_workbench');
  check('four cad_workbench calls', calls.length === 4, calls.map(c => JSON.parse(c.data.arguments).action).join(','));
  const actions = calls.map(c => JSON.parse(c.data.arguments).action);
  check('action order state/fit/select/snapshot', JSON.stringify(actions) === JSON.stringify(['state', 'fit', 'select', 'snapshot']), actions.join(','));

  const results = events.filter(e => e.type === 'tool/result');
  const cadResults = results.filter(r => calls.some(c => String(c.data.callId) === String(r.data.message?.toolCallId)));
  check('four tool results, none errored', cadResults.length === 4 && cadResults.every(r => r.data.message.isError !== true), `${cadResults.length} results`);
  const resultText = callId => messageText(cadResults.find(r => String(r.data.message.toolCallId) === String(callId))?.data.message.content);

  const stateText = resultText(calls[0]?.data.callId);
  check('state result names project + workbench', stateText.includes('Harness E2E 工作台'), stateText.split('\n')[0]);
  const fitText = resultText(calls[1]?.data.callId);
  check('fit result ok', fitText.includes('fit view applied'), fitText.split('\n')[0]);
  const selectText = resultText(calls[2]?.data.callId);
  check('select-by-name resolved to part', selectText.includes(pick.name), selectText.split('\n').slice(0, 3).join(' | '));
  const snapshotText = resultText(calls[3]?.data.callId);
  const snapRel = /artifacts\/viewport\/[^\s"']+\.png/.exec(snapshotText)?.[0];
  check('snapshot result has workspace path + read_image hint', !!snapRel && snapshotText.includes('read_image'), snapRel ?? snapshotText.slice(0, 120));

  // Injected workbench summaries (model-visible durable context).
  const contexts = events.filter(e => e.type === 'user/message' && e.data?.source?.kind === 'castudio-context');
  const contextTexts = contexts.map(e => messageText(e.data.content));
  check('workbench summary injected', contexts.length >= 1, `${contexts.length} injection(s)`);
  if (contextTexts[0]) {
    console.log('--- injected summary (first) ---\n' + contextTexts[0]);
    check('summary names project + cad_workbench tool', contextTexts[0].includes('Harness E2E 工作台') && contextTexts[0].includes('cad_workbench'));
  }
  const distinct = [...new Set(contextTexts)];
  check('summary re-injected after selection changed', distinct.length >= 2, `${distinct.length} distinct summaries`);
  const lastText = contextTexts[contextTexts.length - 1] ?? '';
  check('latest summary shows selected part', lastText.includes(pick.name), lastText.split('\n').filter(l => /select/i.test(l)).join(' | ').slice(0, 160));

  // Service-side truth: the real viewport really changed.
  const after = await api(`/projects/${project.id}/viewport/state`).then(r => r.body);
  check('service selection matches picked mesh', after.state?.selection?.meshId === pick.id, `${after.state?.selection?.meshId} vs ${pick.id}`);
  check('service camera moved after fit(top)', JSON.stringify(after.state?.camera?.position) !== JSON.stringify(cameraBefore), `${JSON.stringify(cameraBefore)} -> ${JSON.stringify(after.state?.camera?.position)}`);

  // Snapshot PNG: real file, valid PNG, non-blank pixels.
  if (snapRel) {
    const pngPath = path.join(dataDir, 'projects', project.id, 'workspace', ...snapRel.split('/'));
    const png = await fs.readFile(pngPath).catch(() => null);
    check('snapshot PNG exists on disk', !!png && png.length > 1000, png ? `${pngPath} (${png.length} bytes)` : pngPath);
    if (png) {
      const sig = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
      check('PNG signature + dimensions', sig && w > 100 && h > 100, `${w}x${h}`);
      const pixels = await page.evaluate(async url => {
        const img = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = document.createElement('canvas');
        canvas.width = 96; canvas.height = 54;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 96, 54);
        const data = ctx.getImageData(0, 0, 96, 54).data;
        const colors = new Set();
        for (let i = 0; i < data.length; i += 16) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return { uniqueColors: colors.size, w: img.width, h: img.height };
      }, `${base}/api/projects/${project.id}/file?path=${encodeURIComponent(snapRel)}`);
      check('snapshot is non-blank', pixels.uniqueColors > 8, `${pixels.uniqueColors} unique colors at ${pixels.w}x${pixels.h}`);
      const sampleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'castudio-harness-png-'));
      const samplePath = path.join(sampleDir, 'viewport-snapshot.png');
      await fs.copyFile(pngPath, samplePath);
      console.log(`sample PNG kept at ${samplePath}`);
    }
  }
} catch (error) {
  check('e2e completed', false, error.message);
  if (serverLog.trim()) console.log('--- studio log tail ---\n' + serverLog.trim().split('\n').slice(-15).join('\n'));
  if (driverLog.trim()) console.log('--- driver log tail ---\n' + driverLog.trim().split('\n').slice(-25).join('\n'));
} finally {
  if (driver && driver.exitCode === null) { driver.kill('SIGKILL'); }
  if (browser) await browser.close().catch(() => {});
  server.kill();
  await sleep(500);
  try { process.kill(server.pid, 'SIGKILL'); } catch { /* already gone */ }
  if (!keep) {
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
    await fs.rm(harnessHome, { recursive: true, force: true }).catch(() => {});
    await fs.rm(scriptFile, { force: true }).catch(() => {});
  } else {
    console.log(`kept dataDir=${dataDir} harnessHome=${harnessHome} script=${scriptFile} port=${port}`);
  }
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
