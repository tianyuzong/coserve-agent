// Validate a produced scene package through server/scene-package.ts and print
// the appearance base colours, for the parametric runtime E2E.
// Usage: node --import tsx scripts/verify-scene-package.mts <file.scadpkg>
import { readFileSync } from 'node:fs';
import { validateArchive } from '../server/scene-package.js';
import { preflightZipBytes } from '../server/vendor/cadflow/zip.js';
import { parseStrictJson } from '../server/vendor/cadflow/canonical.js';

const file = process.argv[2];
if (!file) { console.error('usage: verify-scene-package.mts <file>'); process.exit(2); }
const bytes = new Uint8Array(readFileSync(file));
const result = await validateArchive(bytes);
const archive = preflightZipBytes(bytes);
const scene = parseStrictJson(archive.members.get('scene.json')!) as { appearances?: { base_color?: number[] }[] };
const colours = (scene.appearances ?? []).map(a => a.base_color ?? null);
console.log('SCENE_RESULT=' + JSON.stringify({ ...result, colours }));
