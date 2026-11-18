// node tools/frame.mjs out.png t skip
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
const [out, t, skip = ''] = process.argv.slice(2);
const c = await launch({ headless: true, port: 9365 });
await c.nav(pathToFileURL(process.cwd() + '/out/debug.html').href + '?fly&manual&res=2560x1440&skip=' + skip);
for (let i = 0; i < 400; i++) { await sleep(250); try { if (await c.evaluate('window.__ready===true')) break; } catch {} }
await c.evaluate(`window.__renderAt(${t})`); await c.evaluate(`window.__renderAt(${t})`);
await c.shot(out, { x: 640, y: 360, width: 1280, height: 720 });
c.close(); process.exit(0);
