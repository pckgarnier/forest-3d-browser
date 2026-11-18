// Attribute per-frame JS allocations: sample heap allocations during 10 s of the fly-through.
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
const c = await launch({ headless: true, port: 9380 });
await c.nav(pathToFileURL(process.cwd() + '/out/debug.html').href + '?fly&res=2560x1440');
for (let i = 0; i < 400; i++) { await sleep(250); try { if (await c.evaluate('window.__ready===true')) break; } catch {} }
await sleep(4000);
await c.send('HeapProfiler.enable');
const f0 = await c.evaluate('window.__frames()');
await c.send('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await sleep(10000);
const { profile } = await c.send('HeapProfiler.stopSampling');
const f1 = await c.evaluate('window.__frames()');
const agg = new Map();
const walk = (n, stack) => { const fr = n.callFrame; const name = (fr.functionName || '(anon)') + ' ' + (fr.url ? fr.url.split('/').pop() : '') + ':' + fr.lineNumber; const st = [...stack, name]; if (n.selfSize) { const k = st.slice(-3).join(' < '); agg.set(k, (agg.get(k) || 0) + n.selfSize); } for (const ch of n.children) walk(ch, st); };
walk(profile.head, []);
const frames = f1 - f0, tot = [...agg.values()].reduce((a, b) => a + b, 0);
console.log(`frames ${frames}, sampled bytes ${tot}, ~${(tot / frames).toFixed(0)} B/frame`);
[...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log((v / frames).toFixed(1).padStart(8) + ' B/f  ' + k));
c.close(); process.exit(0);
