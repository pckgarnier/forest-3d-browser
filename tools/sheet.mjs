// Compose PNGs into one grid image using headless Chrome canvas. usage: node tools/sheet.mjs out.png cols w h img1 img2 ...
import { launch, sleep } from './cdp.mjs';
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
const [out, cols, w, h, ...imgs] = process.argv.slice(2);
const C = +cols, W_ = +w, H_ = +h, rows = Math.ceil(imgs.length / C);
const html = `<body style=margin:0><canvas id=c width=${C * W_} height=${rows * H_}></canvas><script>const LBL=${process.env.NOLABEL?1:0};const x=c.getContext('2d');x.font='bold 28px sans-serif';x.fillStyle='#ff0';Promise.all(${JSON.stringify(imgs.map(i => pathToFileURL(process.cwd() + '/' + i).href))}.map((u,i)=>new Promise(r=>{const m=new Image();m.onload=()=>{x.drawImage(m,(i%${C})*${W_},Math.floor(i/${C})*${H_},${W_},${H_});if(!LBL)x.fillText(u.split('/').pop(),(i%${C})*${W_}+8,Math.floor(i/${C})*${H_}+32);r()};m.src=u}))).then(()=>window.done=1)</script></body>`;
writeFileSync('out/_sheet.html', html);
const c = await launch({ headless: true, port: 9370, w: C * W_, h: rows * H_ });
await c.nav(pathToFileURL(process.cwd() + '/out/_sheet.html').href);
for (let i = 0; i < 100; i++) { await sleep(100); if (await c.evaluate('window.done===1')) break; }
await c.shot(out, { x: 0, y: 0, width: C * W_, height: rows * H_ });
c.close(); process.exit(0);
