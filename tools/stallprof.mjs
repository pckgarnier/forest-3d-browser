// CPU-profile the fly-through and report what runs during long frames.
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
const c = await launch({ headless: false, port: 9395, w: 1600, h: 900 });
await c.send('Emulation.clearDeviceMetricsOverride');
await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 200 });
await c.nav(pathToFileURL(process.cwd() + '/out/debug.html').href + '?perf&res=2560x1440');
for (let i = 0; i < 400; i++) { await sleep(250); try { if (await c.evaluate('window.__ready===true')) break; } catch {} }
await sleep(3500 + 20000);
await c.send('Profiler.start');
await sleep(7000);
const { profile } = await c.send('Profiler.stop');
c.close();
const byId = new Map(profile.nodes.map(n => [n.id, n]));
const parent = new Map(); for (const n of profile.nodes) for (const ch of n.children || []) parent.set(ch, n.id);
let t = profile.startTime; const ts = profile.samples.map((s, i) => (t += profile.timeDeltas[i], [t, s]));
// find longest gaps between consecutive samples of 'frame' function → look at what was sampled in windows with dense non-idle activity
const nm = id => { const n = byId.get(id); return n.callFrame.functionName || n.callFrame.url.split('/').pop() || '(anon)'; };
const stack = id => { const a = []; while (id) { a.push(nm(id)); id = parent.get(id); } return a.slice(0, 6).join(' < '); };
// bucket into 10 ms windows, report windows with > 5 ms of non-idle samples
const W = 10000; const buckets = new Map();
for (let i = 1; i < ts.length; i++) { const [tt, s] = ts[i]; const name = nm(s); if (name === '(idle)' || name === '(program)') continue; const b = Math.floor(tt / W); const arr = buckets.get(b) || []; arr.push([s, ts[i][0] - ts[i - 1][0]]); buckets.set(b, arr); }
const busy = [...buckets.entries()].map(([b, a]) => [b, a.reduce((x, y) => x + y[1], 0), a]).filter(x => x[1] > 6000).sort((a, b) => b[1] - a[1]).slice(0, 4);
for (const [b, tot, a] of busy) { const agg = new Map(); for (const [s, d] of a) agg.set(stack(s), (agg.get(stack(s)) || 0) + d); console.log('window', b, (tot / 1000).toFixed(1) + 'ms'); [...agg.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).forEach(([k, v]) => console.log('   ', (v / 1000).toFixed(1), k)); }
process.exit(0);
