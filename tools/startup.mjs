import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
const c = await launch({ headless: true, port: 9390 });
const t0 = Date.now();
await c.nav(pathToFileURL(process.cwd() + '/index.html').href + '?res=2560x1440');
for (let i = 0; i < 600; i++) { await sleep(100); try { if (await c.evaluate('window.__ready===true')) break; } catch {} }
console.log('ready after', ((Date.now() - t0) / 1000).toFixed(1), 's');
c.close(); process.exit(0);
