// Render fixed camera poses at 2560x1440 in GPU Chrome and save PNGs.
// usage: node tools/shoot.mjs <outdir> [page=index.html] [poses=0,1,2,3,4,5] [t=14]
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';
const [out = 'out/shots', pageF = 'index.html', poses = '0,1,2,3,4,5', t = '14'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const c = await launch({ headless: true, port: 9340 });
try {
  for (const k of poses.split(',')) {
    const url = pathToFileURL(process.cwd() + '/' + pageF).href + `?pose=${k}&t=${t}&res=2560x1440` + (process.argv[6] ? '&cp=' + process.argv[6] : '');
    await c.nav(url);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) { await sleep(250); try { if (await c.evaluate('window.__ready===true && window.__frames()>12')) break; } catch {} }
    await sleep(300);
    await c.shot(`${out}/pose${k}.png`);
    console.log('pose', k, 'ok', ((Date.now() - t0) / 1000).toFixed(1) + 's');
  }
} finally {
  console.log([...new Set(c.logs.map(l => l.split('\n')[0]))].slice(0, 25).join('\n'));
  c.close();
}
process.exit(0);
