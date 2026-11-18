// Record a Chrome trace around the hitch window and list long events.
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
const c = await launch({ headless: false, port: 9396, w: 1600, h: 900 });
await c.send('Emulation.clearDeviceMetricsOverride');
const ev = []; let done = null;
c.listeners.push(m => { if (m.method === 'Tracing.dataCollected') ev.push(...m.params.value); if (m.method === 'Tracing.tracingComplete') done(); });
await c.nav(pathToFileURL(process.cwd() + '/index.html').href + '?perf&res=2560x1440');
for (let i = 0; i < 400; i++) { await sleep(250); try { if (await c.evaluate('window.__ready===true')) break; } catch {} }
await sleep(3000 + 17000);
await c.send('Tracing.start', { categories: 'v8,v8.gc,disabled-by-default-v8.gc,devtools.timeline,gpu,toplevel,blink.gc', transferMode: 'ReportEvents' });
await sleep(10000);
const p = new Promise(r => done = r); await c.send('Tracing.end'); await p;
c.close();
const long = ev.filter(e => e.ph === 'X' && e.dur > 8000).sort((a, b) => b.dur - a.dur).slice(0, 25);
for (const e of long) console.log((e.dur / 1000).toFixed(1).padStart(7), 'ms', e.pid, e.tid, e.cat, e.name, JSON.stringify(e.args).slice(0, 120));
process.exit(0);
