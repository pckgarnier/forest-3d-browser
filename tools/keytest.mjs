// Drive the interactive page with real key events and report the camera after each step.
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
const c = await launch({ headless: true, port: 9399, w: 1600, h: 900 });
await c.nav(pathToFileURL(process.cwd() + '/index.html').href);
for (let i = 0; i < 400; i++) { await sleep(250); try { if (await c.evaluate('window.__ready===true')) break; } catch {} }
const key = async (code, key, hold = 60) => { await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key }); await sleep(hold); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key }); };
const camS = async () => (await c.evaluate('window.__cam()')).map(v => +v.toFixed(2)).join(', ');
await sleep(500); console.log('start         ', await camS());
await key('KeyQ', 'q'); await sleep(1000); const a1 = await camS(); await sleep(2000); console.log('Q +1s / +3s   ', a1, '|', await camS());
await c.shot('out/dbg/key_auto.jpg');
await key('Digit3', '3'); await sleep(200); console.log('3 mid-fade    ', await camS()); await sleep(1200); console.log('3 done        ', await camS());
await c.shot('out/dbg/key_3.jpg');
await key('Digit5', '5'); await sleep(1400); console.log('5 done        ', await camS());
await key('KeyQ', 'q'); await sleep(1500); await key('KeyW', 'w', 600); const w1 = await camS(); await sleep(1000); console.log('Q then W (stops auto):', w1, '|', await camS());
console.log([...new Set(c.logs.map(l => l.split('\n')[0]))].join('\n'));
c.close(); process.exit(0);
