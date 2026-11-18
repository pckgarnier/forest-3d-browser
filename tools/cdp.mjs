// Minimal Chrome DevTools Protocol driver (no deps). Launches installed Chrome with GPU WebGPU.
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export async function launch({ headless = true, w = 2560, h = 1440, port = 9333, extra = [] } = {}) {
  const prof = mkdtempSync(join(tmpdir(), 'cdpprof-'));
  const args = [
    `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-webgpu', '--enable-webgpu-developer-features', '--enable-gpu', '--ignore-gpu-blocklist',
    '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--allow-file-access-from-files', '--disable-component-update', '--disable-background-networking', '--disable-features=OptimizationGuideModelDownloading,OptimizationHintsFetching,OptimizationTargetPrediction,MediaRouter', '--no-pings', '--disable-sync', '--hide-scrollbars', `--window-size=${w},${h}`, '--force-device-scale-factor=1',
    ...(headless ? ['--headless=new'] : []), ...extra, 'about:blank'];
  const proc = spawn(CHROME, args, { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 100; i++) {
    try { ver = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (ver.length) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  const tgt = ver.find(t => t.type === 'page');
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pend = new Map(); const listeners = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method) listeners.forEach(l => l(m));
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const logs = [];
  listeners.push(m => {
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const nav = async (url) => { await send('Page.navigate', { url }); };
  const shot = async (file, clip) => { const jpg = file.endsWith('.jpg'); const r = await send('Page.captureScreenshot', { format: jpg ? 'jpeg' : 'png', ...(jpg ? { quality: 86 } : {}), ...(clip ? { clip: { scale: 1, ...clip } } : {}) }); (await import('node:fs')).writeFileSync(file, Buffer.from(r.data, 'base64')); };
  const close = () => { try { ws.close(); } catch {} proc.kill(); };
  return { send, evaluate, nav, shot, close, logs, listeners };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
