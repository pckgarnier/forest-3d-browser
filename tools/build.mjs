// Bundles src/ into a single self-contained index.html (minified) + out/debug.html (readable).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const wgslMin = s => s.replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/\s*([{}(),;:=<>+*\/&|!\[\]])\s*/g, '$1').trim();
const plugin = min => ({ name: 'wgsl', setup(b) { b.onLoad({ filter: /(wgsl|post)\.js$/ }, a => {
  let src = readFileSync(a.path, 'utf8');
  if (min) src = src.replace(/\/\*wgsl\*\/`([\s\S]*?)`/g, (_, c) => '`' + wgslMin(c) + '`');
  return { contents: src, loader: 'js' };
}); } });
const page = js => `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Enchanted Forest</title><style>html,body{margin:0;height:100%;background:#05060a;overflow:hidden}canvas{display:block;width:100%;height:100%;cursor:crosshair}#m,#h{position:fixed;left:50%;transform:translateX(-50%);font:14px/1.4 system-ui,sans-serif;color:#e8f0d8;text-shadow:0 1px 3px #000;pointer-events:none}#m{top:45%;font-size:18px}#h{bottom:24px;opacity:1;transition:opacity .5s;background:#0008;padding:6px 14px;border-radius:14px}</style></head><body><canvas id=c></canvas><div id=m>Loading…</div><div id=h>Click to fly · WASD move · mouse look · Q/E down/up · Shift faster · Esc release</div><script type=module>${js}</script></body></html>`;
mkdirSync(root + '/out', { recursive: true });
for (const min of [true, false]) {
  const r = await build({ entryPoints: [root + '/src/main.js'], bundle: true, write: false, format: 'esm', minify: min, target: 'chrome130', legalComments: 'none', plugins: [plugin(min)] });
  const html = page(r.outputFiles[0].text.replace(/<\/script/g, '<\/script'));
  const out = min ? root + '/index.html' : root + '/out/debug.html';
  writeFileSync(out, html);
  if (min) console.log(`index.html: ${html.length} bytes (${(html.length / 1024).toFixed(1)} KiB), gzip ${gzipSync(html).length} bytes`);
}
