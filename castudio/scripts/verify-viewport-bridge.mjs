// Real-browser verification for the viewport bridge. Starts a private CAStudio server on a free
// port with a temp STUDIO_DATA_DIR, drives headless Edge/Chromium through playwright-core, and
// exercises GET/POST viewport endpoints end to end. Never touches port 4317.
// Usage: node scripts/verify-viewport-bridge.mjs [--keep]
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  throw new Error(`等待超时: ${label}${last ? ` (${last.message})` : ''}`);
}

// playwright-core lives in the sibling harness checkout's pnpm store; Edge/Chrome supply the browser.
const candidates = [
  process.env.PLAYWRIGHT_CORE,
  'D:/devin workspace/coserve-agent/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core/index.mjs',
  'D:/devin workspace/coserve-agent/node_modules/.pnpm/playwright-core@1.63.0-alpha-2026-08-31/node_modules/playwright-core/index.mjs',
].filter(Boolean);
let chromium = null, playwrightPath = null;
for (const candidate of candidates) {
  try { ({ chromium } = await import(pathToFileURL(candidate).href)); playwrightPath = candidate; break; } catch (error) { console.log(`playwright-core candidate failed: ${candidate} (${error.message})`); }
}
const executables = [
  process.env.STUDIO_VERIFY_BROWSER,
  'C:/Program Files (x86)/Microsoft/EdgeCore/157.0.4341.42/msedge.exe',
  'C:/Program Files (x86)/Microsoft/EdgeCore/156.0.4314.42/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
let executablePath = null;
for (const candidate of executables) { try { await fs.access(candidate); executablePath = candidate; break; } catch { /* next */ } }

if (!chromium || !executablePath) {
  console.log(`SKIP: no usable browser/playwright-core (core=${!!chromium} browser=${executablePath})`);
  process.exit(2);
}
console.log(`playwright-core: ${playwrightPath}\nbrowser: ${executablePath}`);

const port = await freePort();
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'castudio-viewport-e2e-'));
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  cwd: root, env: { ...process.env, STUDIO_PORT: String(port), STUDIO_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let serverLog = '';
server.stdout.on('data', d => { serverLog += d; });
server.stderr.on('data', d => { serverLog += d; });

let browser = null;
const api = (suffix, init) => fetch(`${base}/api${suffix}`, init).then(async r => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }));
const post = (suffix, body) => api(suffix, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const pngInfo = bytes => ({ signature: bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });

try {
  await waitFor(async () => (await fetch(`${base}/api/projects`).then(r => r.ok).catch(() => false)), 20000, 'studio server');
  const project = (await post('/projects', { name: 'Viewport E2E' })).body;
  check('project created', !!project?.id, project?.id);

  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  await page.goto(`${base}/?embedded=1&project=${project.id}`, { waitUntil: 'domcontentloaded' });

  const state = () => api(`/projects/${project.id}/viewport/state`).then(r => r.body);
  const command = body => post(`/projects/${project.id}/viewport/command`, body).then(r => ({ status: r.status, body: r.body }));
  const connected = await waitFor(async () => {
    const s = await state();
    return s.connected && s.state?.model?.demo === true && s.state?.meshes?.length > 0 ? s : null;
  }, 30000, 'viewport state connected with demo meshes');
  check('state connected, demo model, meshes', true, `${connected.state.meshes.length} meshes, workspace=${connected.state.workspace}`);

  const camBefore = connected.state.camera;
  const fit = await command({ action: 'fit', view: 'top' });
  check('fit(top) command', fit.status === 200 && fit.body.ok === true, JSON.stringify(fit.body).slice(0, 120));
  const afterFit = await waitFor(async () => {
    const s = await state();
    const cam = s.state?.camera;
    return cam && JSON.stringify(cam.position) !== JSON.stringify(camBefore.position) ? s : null;
  }, 10000, 'camera moved after fit(top)');
  check('camera position changed', true, `${JSON.stringify(camBefore?.position)} -> ${JSON.stringify(afterFit.state.camera.position)}`);

  const meshId = connected.state.meshes[0].id;
  const sel = await command({ action: 'select', meshId });
  check('select command', sel.status === 200 && sel.body.ok === true);
  const selected = await waitFor(async () => {
    const s = await state();
    return s.state?.selection?.meshId === meshId ? s : null;
  }, 10000, 'selection reported');
  check('selection.meshId matches', true, `${meshId} (${selected.state.selection.name})`);

  const opt = await command({ action: 'options', options: { grid: false } });
  check('options command', opt.status === 200 && opt.body.ok === true);
  const gridded = await waitFor(async () => {
    const s = await state();
    return s.state?.options?.grid === false ? s : null;
  }, 10000, 'grid=false reported');
  check('options.grid reflected', true);

  const ws = await command({ action: 'workspace', workspace: 'parametric' });
  check('workspace command', ws.status === 200 && ws.body.ok === true);
  const switched = await waitFor(async () => {
    const s = await state();
    return s.state?.workspace === 'parametric' ? s : null;
  }, 10000, 'workspace=parametric reported');
  check('workspace reflected', true);

  const snap = await command({ action: 'snapshot' });
  check('snapshot command', snap.status === 200 && snap.body.ok === true && !!snap.body.snapshot, JSON.stringify(snap.body.snapshot || snap.body).slice(0, 160));
  const snapInfo = snap.body.snapshot;
  const filePath = path.join(dataDir, 'projects', project.id, 'workspace', ...snapInfo.path.split('/'));
  const png = await fs.readFile(filePath);
  const info = pngInfo(png);
  check('snapshot PNG on disk', info.signature && info.width > 100 && info.height > 100, `${snapInfo.path} ${info.width}x${info.height} ${png.length} bytes`);

  // Decode pixels inside the page (createImageBitmap + canvas) to prove the image is not blank.
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
  }, `${base}/api/projects/${project.id}/file?path=${encodeURIComponent(snapInfo.path)}`);
  check('snapshot has real content', pixels.uniqueColors > 8, `${pixels.uniqueColors} unique colors at ${pixels.w}x${pixels.h}`);

  const sampleDir = await fs.mkdtemp(path.join(os.tmpdir(), 'castudio-viewport-png-'));
  const samplePath = path.join(sampleDir, 'viewport-sample.png');
  await fs.copyFile(filePath, samplePath);
  console.log(`sample PNG kept at ${samplePath}`);

  await page.close();
  const denied = await waitFor(async () => {
    const s = await state();
    return !s.connected ? s : null;
  }, 30000, 'connected:false after page close');
  check('connected:false after close (~20s)', true, `ageMs=${denied.ageMs}`);
  const after = await command({ action: 'fit' });
  check('command after close -> 409', after.status === 409, `status=${after.status} ${JSON.stringify(after.body).slice(0, 80)}`);
} catch (error) {
  check('e2e completed', false, error.message);
  if (serverLog.trim()) console.log('--- server log tail ---\n' + serverLog.trim().split('\n').slice(-15).join('\n'));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (!keep) {
    server.kill();
    await sleep(500);
    try { process.kill(server.pid, 'SIGKILL'); } catch { /* already gone */ }
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  } else {
    console.log(`kept data dir ${dataDir}, server pid ${server.pid} on port ${port} (--keep)`);
  }
}
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
