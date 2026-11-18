// Deterministic fly-through "recording": contact sheet (1 frame / 2 s, full frame scaled 50%)
// + bursts of 8 consecutive 60 fps frames as 1:1 crops for shimmer/aliasing/popping inspection.
// usage: node tools/record.mjs <outdir> [page=index.html]
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const [out = 'out/rec', pageF = 'index.html'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const c = await launch({ headless: true, port: 9360 });
await c.nav(pathToFileURL(process.cwd() + '/' + pageF).href + '?fly&manual&res=2560x1440');
for (let i = 0; i < 400; i++) { await sleep(250); try { if (await c.evaluate('window.__ready===true')) break; } catch {} }
const at = async t => { await c.evaluate(`window.__renderAt(${t})`); await c.evaluate(`window.__renderAt(${t})`); };
for (let s = 0; s < 60; s += 2) { await at(s); await c.shot(`${out}/sheet_${String(s).padStart(2, '0')}s.png`, { x: 0, y: 0, width: 2560, height: 1440, scale: 0.5 }); }
const bursts = [[4, 640, 360], [21, 640, 200], [37, 640, 360], [50, 640, 500]];
for (const [t, x, y] of bursts) for (let k = 0; k < 8; k++) { await at(t + k / 60); await c.shot(`${out}/burst_${t}s_f${k}.png`, { x, y, width: 1280, height: 720, scale: 1 }); }
console.log([...new Set(c.logs.map(l => l.split('\n')[0]))].slice(0, 10).join('\n'));
c.close(); process.exit(0);
