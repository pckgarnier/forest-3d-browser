// tiny helper: node tools/patch.cjs file  (reads JSON [[from,to],...] from stdin)
const fs = require('fs'); const f = process.argv[2]; let s = fs.readFileSync(f, 'utf8');
const reps = require(require('path').resolve(process.argv[3])); let bad = 0;
for (const [a, b] of reps) { if (!s.includes(a)) { console.log('MISSING in ' + f + ': ' + a.slice(0, 90)); bad++; continue; } s = s.split(a).join(b); }
fs.writeFileSync(f, s); console.log(f + ': ' + (reps.length - bad) + '/' + reps.length + ' applied');
