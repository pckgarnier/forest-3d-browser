// Scripted 60 s fly-through at 2560x1440 internal res, vsync off. Collects GPU timestamp + CPU frame logs and JS heap samples.
// usage: node tools/perf.mjs [page=index.html] [headless=0]
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
const [pageF = 'index.html', hl = '0'] = process.argv.slice(2);
const c = await launch({ headless: hl === '1', port: 9350, w: 1600, h: 900, extra: ['--enable-precise-memory-info', ...(process.env.XFLAGS ? process.env.XFLAGS.split(' ') : [])] });
await c.send('Emulation.clearDeviceMetricsOverride');
await c.nav(pathToFileURL(process.cwd() + '/' + pageF).href + '?perf&res=2560x1440' + (process.env.HZ ? '&hz=' + process.env.HZ : '') + (process.argv[4] ? '&fo=' + process.argv[4] : ''));
const heap = []; const t0 = Date.now(); let r = null;
while (Date.now() - t0 < 240000) {
  await sleep(1000);
  try { const h = await c.send('Runtime.getHeapUsage'); heap.push(h.usedSize); r = await c.evaluate('window.__perf ? JSON.stringify(window.__perf) : null'); if (r) break; } catch {}
}
c.close();
if (!r) { console.log('no result', c.logs.slice(0, 20)); process.exit(1); }
const P = JSON.parse(r);
const st = a => { const s = [...a].sort((x, y) => x - y); const avg = a.reduce((x, y) => x + y, 0) / a.length; return { avg: +avg.toFixed(3), p50: +s[Math.floor(s.length * .5)].toFixed(3), p99: +s[Math.floor(s.length * .99)].toFixed(3), max: +s[s.length - 1].toFixed(3), over16_7: a.filter(x => x > 16.7).length }; };
const rep = { adapter: P.adapter, res: P.res, frames: P.frames, gpuTotal: st(P.gpu.total), gpuCull: st(P.gpu.cull), gpuShadow: st(P.gpu.shadow), gpuMain: st(P.gpu.main), gpuPost: st(P.gpu.post), cpuFrameInterval: st(P.cpu), heapSamplesMB: heap.map(h => +(h / 1048576).toFixed(2)) };
mkdirSync('out', { recursive: true });
writeFileSync('out/perf.json', JSON.stringify({ rep, raw: P }, null, 1));
console.log(JSON.stringify(rep, null, 1));
process.exit(0);
