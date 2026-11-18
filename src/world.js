// CPU-side procedural world generation (runs once at startup).
import { PI, TAU, clamp, mix, smooth, rng, fbm, vnoise } from './util.js';

export const WH = 240;            // world half-size (m)
export const G = 512;             // terrain grid cells
export const CELL = 2 * WH / G;

// ---------- layout ----------
export const START = [0, 0, 64];
export const TEMPLE = [0, 0, 16];
export const STAG = [-40, 0, -30];
export const GLADE = [44, 0, -42];
export const CLEAR = [ // x, z, radius, flatten strength
  [TEMPLE[0], TEMPLE[2], 15, 1], [STAG[0], STAG[2], 24, 0.85], [GLADE[0], GLADE[2], 34, 0.4, 1], [0, 58, 9, 0.3, 1],
];
export const FP = [[0, 72, 3], [0, 50, 3.2], [0, 30, 3.8], [0, 16, 4.6], [0, 4, 4.2], [-12, -12, 5], [-30, -17, 6], [-46, -18, 6.5], [-54, -34, 8], [-40, -50, 13], [-12, -58, 22], [16, -54, 22], [36, -44, 18], [52, -30, 12], [56, -8, 6], [42, 8, 3], [28, 16, 2.6], [14, 34, 2.8], [6, 56, 3], [0, 72, 3]];
function segD(x, z, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1); return Math.hypot(x - ax - dx * t, z - az - dz * t); }
export function pathD(x, z) { let d = 1e9; for (let i = 0; i < FP.length - 1; i++) d = Math.min(d, segD(x, z, FP[i][0], FP[i][1], FP[i + 1][0], FP[i + 1][1])); return d; }
// fly-through path, arc-length parameterised Catmull-Rom (shared by placement clearance + camera)
export const PATH = { NS: 2000, path: new Float32Array(2001 * 3), arc: new Float32Array(2001) };
export function buildPath() {
  const { NS, path, arc } = PATH, n = FP.length - 1, P = FP.map(([x, z, h]) => [x, gh(x, z) + h, z]);
  const at = i => P[(i % n + n) % n];
  for (let s = 0; s <= NS; s++) {
    const f = s / NS * n, i = Math.min(Math.floor(f), n - 1), t = f - i;
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < 3; k++) path[s * 3 + k] = 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t * t * t);
    path[s * 3 + 1] = Math.max(path[s * 3 + 1], gh(path[s * 3], path[s * 3 + 2]) + 1.4);
    arc[s] = s ? arc[s - 1] + Math.hypot(path[s * 3] - path[s * 3 - 3], path[s * 3 + 1] - path[s * 3 - 2], path[s * 3 + 2] - path[s * 3 - 1]) : 0;
  }
}
export function pathD3(x, y, z) { const p = PATH.path; let d = 1e9; for (let s = 0; s <= PATH.NS; s += 4) { const e = (p[s * 3] - x) ** 2 + (p[s * 3 + 1] - y) ** 2 + (p[s * 3 + 2] - z) ** 2; if (e < d) d = e; } return Math.sqrt(d); }
// open a window in the canopy so a sun shaft lands on (cx, cy, cz)
export function clearSun(cards, cx, cy, cz, r) {
  const f = new Float32Array(cards.buf), u = new Uint32Array(cards.buf); let w = 0;
  for (let i = 0; i < cards.n; i++) {
    const o = i * 8, k = (f[o + 1] - cy) / SUN[1];
    if (!(k > 0 && Math.hypot(f[o] - SUN[0] * k - cx, f[o + 2] - SUN[2] * k - cz) < r + f[o + 3] * 0.5)) { if (w !== i) for (let q = 0; q < 8; q++) u[w * 8 + q] = u[o + q]; w++; }
  }
  cards.n = w;
}
export function clearCyl(cards, x, z, r, y0) {
  const f = new Float32Array(cards.buf), u = new Uint32Array(cards.buf); let w = 0;
  for (let i = 0; i < cards.n; i++) { const o = i * 8; if (f[o + 1] > y0 && Math.hypot(f[o] - x, f[o + 2] - z) < r + f[o + 3] * 0.5) continue; if (w !== i) for (let q = 0; q < 8; q++) u[w * 8 + q] = u[o + q]; w++; }
  cards.n = w;
}
export function clearInstBall(inst, x, z, r) { const a = inst.a, o = []; for (let i = 0; i < a.length; i += 8) if (Math.hypot(a[i] - x, a[i + 2] - z) > r + a[i + 3] * 0.9) for (let q = 0; q < 8; q++) o.push(a[i + q]); inst.a = o; }
export function clearBall(cards, x, y, z, r) {
  const f = new Float32Array(cards.buf), u = new Uint32Array(cards.buf); let w = 0;
  for (let i = 0; i < cards.n; i++) { const o = i * 8; if (Math.hypot(f[o] - x, f[o + 1] - y, f[o + 2] - z) < r + f[o + 3] * 0.5) continue; if (w !== i) for (let q = 0; q < 8; q++) u[w * 8 + q] = u[o + q]; w++; }
  cards.n = w;
}
export function clearPathInst(inst, r, k) { const a = inst.a, o = []; for (let i = 0; i < a.length; i += 8) if (pathD3(a[i], a[i + 1] + a[i + 3] * 0.2, a[i + 2]) > r + a[i + 3] * k) for (let q = 0; q < 8; q++) o.push(a[i + q]); inst.a = o; }
// remove foliage cards that would brush the camera on the scripted path
export function clearPath(cards) {
  const f = new Float32Array(cards.buf), u = new Uint32Array(cards.buf); let w = 0;
  for (let i = 0; i < cards.n; i++) {
    const o = i * 8;
    if (pathD3(f[o], f[o + 1], f[o + 2]) < 2.6 + f[o + 3] * 0.6) continue;
    if (w !== i) for (let k = 0; k < 8; k++) u[w * 8 + k] = u[o + k];
    w++;
  }
  cards.n = w;
}
export const SUN = (() => { const v = [-0.42, 0.56, -0.71]; const l = Math.hypot(...v); return v.map(x => x / l); })();

// ---------- terrain ----------
function rawH(x, z) {
  const r = Math.hypot(x, z * 1.1);
  let h = (fbm(x * 0.011 + 3.1, z * 0.011 + 7.7, 4) - 0.5) * 16 + (fbm(x * 0.045, z * 0.045, 3) - 0.5) * 3;
  const rr = r + (fbm(x * 0.018 + 9, z * 0.018, 3) - 0.5) * 50;
  const rim = smooth(140, 225, rr);
  h += rim * rim * 16 + rim * (fbm(x * 0.05, z * 0.05, 4) - 0.5) * 8;
  // a raised mound for the stag
  h += 3.2 * Math.exp(-((x - STAG[0]) ** 2 + (z - STAG[2]) ** 2) / 180);
  return h;
}
export const HM = new Float32Array((G + 1) * (G + 1));
export function buildHeight() {
  const cl = CLEAR.map(([x, z, r, s]) => [x, z, r, s, rawH(x, z)]);
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
    const x = -WH + i * CELL, z = -WH + j * CELL;
    let h = rawH(x, z);
    for (const [cx, cz, r, s, ch] of cl) { const d = Math.hypot(x - cx, z - cz); h = mix(h, ch, s * (1 - smooth(r * 0.6, r * 1.6, d))); }
    HM[j * (G + 1) + i] = h;
  }
}
export function gh(x, z) { // bilinear terrain height, no allocation
  let fx = (x + WH) / CELL, fz = (z + WH) / CELL;
  fx = fx < 0 ? 0 : fx > G - 0.001 ? G - 0.001 : fx; fz = fz < 0 ? 0 : fz > G - 0.001 ? G - 0.001 : fz;
  const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, k = j * (G + 1) + i;
  return (HM[k] * (1 - tx) + HM[k + 1] * tx) * (1 - tz) + (HM[k + G + 1] * (1 - tx) + HM[k + G + 2] * tx) * tz;
}

// ---------- geometry builder: pos f32x3 | nrm snorm8x4 | uv f32x2 | attr unorm8x4 (ao, wind, bob, rand) ----------
export class Geo {
  constructor(cap = 1 << 20) { this.f = new Float32Array(cap * 7); this.u8 = new Uint8Array(this.f.buffer); this.n = 0; this.idx = new Uint32Array(cap * 6); this.ni = 0; this.draws = []; }
  grow() {
    const f = new Float32Array(this.f.length * 2); f.set(this.f); this.f = f; this.u8 = new Uint8Array(f.buffer);
  }
  v(x, y, z, nx, ny, nz, u, v, ao, w, bob, rnd) {
    if ((this.n + 1) * 7 > this.f.length) this.grow();
    const o = this.n * 7, f = this.f, b = this.u8, l = Math.hypot(nx, ny, nz) || 1;
    f[o] = x; f[o + 1] = y; f[o + 2] = z;
    const bo = (o + 3) * 4; b[bo] = (nx / l * 127) & 255; b[bo + 1] = (ny / l * 127) & 255; b[bo + 2] = (nz / l * 127) & 255; b[bo + 3] = 0;
    f[o + 4] = u; f[o + 5] = v;
    const ao_ = (o + 6) * 4; b[ao_] = clamp(ao * 255, 0, 255); b[ao_ + 1] = clamp(w / 4 * 255, 0, 255); b[ao_ + 2] = bob; b[ao_ + 3] = rnd * 255;
    return this.n++;
  }
  t(a, b, c) { if (this.ni + 3 > this.idx.length) { const i = new Uint32Array(this.idx.length * 2); i.set(this.idx); this.idx = i; } this.idx[this.ni++] = a; this.idx[this.ni++] = b; this.idx[this.ni++] = c; }
  begin() { this.b0 = this.ni; this.v0 = this.n; }
  end(kind, shadow = 1) {
    if (this.ni === this.b0) return;
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; const f = this.f;
    for (let i = this.v0; i < this.n; i++) for (let k = 0; k < 3; k++) { const p = f[i * 7 + k]; if (p < mn[k]) mn[k] = p; if (p > mx[k]) mx[k] = p; }
    const c = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2);
    this.draws.push({ kind, first: this.b0, count: this.ni - this.b0, c, r: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2 + 2, shadow });
  }
}

// ---------- card instances (32B): pos.xyz,size | octN | octS | bytes(variant|flags,palette,ao,rand) | wind(u16) bob(u8) phase(u8) ----------
export class Cards {
  constructor() { this.buf = new ArrayBuffer(32 * 65536); this.n = 0; }
  push(x, y, z, size, nx, ny, nz, sx, sy, sz, variant, pal, ao, rnd, w, bob, ph) {
    if ((this.n + 1) * 32 > this.buf.byteLength) { const b = new ArrayBuffer(this.buf.byteLength * 2); new Uint8Array(b).set(new Uint8Array(this.buf)); this.buf = b; }
    const f = new Float32Array(this.buf, this.n * 32, 4), u = new Uint32Array(this.buf, this.n * 32 + 16, 4);
    f[0] = x; f[1] = y; f[2] = z; f[3] = size;
    u[0] = oct(nx, ny, nz); u[1] = oct(sx, sy, sz);
    u[2] = (variant & 255) | ((pal & 255) << 8) | ((clamp(ao, 0, 1) * 255 | 0) << 16) | ((rnd * 255 | 0) << 24);
    u[3] = (clamp(w / 4, 0, 1) * 65535 | 0) | ((bob & 255) << 16) | ((ph * 255 | 0) << 24);
    this.n++;
  }
  data() { return new Uint8Array(this.buf, 0, this.n * 32); }
}
function oct(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1; let a = x / l, b = z / l;
  if (y / l < 0) { const ta = (1 - Math.abs(b)) * Math.sign(a || 1), tb = (1 - Math.abs(a)) * Math.sign(b || 1); a = ta; b = tb; }
  return ((Math.round(clamp(a, -1, 1) * 32767) & 65535) | ((Math.round(clamp(b, -1, 1) * 32767) & 65535) << 16)) >>> 0;
}

// ---------- terrain mesh ----------
export function terrainMesh(g, aoMap) {
  g.begin();
  const base = g.n, W = G + 1;
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
    const k = j * W + i, x = -WH + i * CELL, z = -WH + j * CELL;
    const hl = HM[j * W + Math.max(i - 1, 0)], hr = HM[j * W + Math.min(i + 1, G)], hd = HM[Math.max(j - 1, 0) * W + i], hu = HM[Math.min(j + 1, G) * W + i];
    g.v(x, HM[k], z, hl - hr, 2 * CELL, hd - hu, x, z, aoMap[k], 0, 0, 0);
  }
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const a = base + j * W + i, b = a + 1, c = a + W, d = c + 1;
    if ((i + j) & 1) { g.t(a, c, b); g.t(b, c, d); } else { g.t(a, c, d); g.t(a, d, b); }
  }
  // split terrain into 8x8 chunks for culling: re-emit draws by index ranges per row band is awkward; keep single draw split by rows
  const rowsPer = G / 16, triPerRow = G * 6;
  const f = g.f; g.end(0); const all = g.draws.pop();
  for (let s = 0; s < 16; s++) {
    const first = all.first + s * rowsPer * triPerRow, count = rowsPer * triPerRow;
    let mn = 1e9, mx = -1e9; for (let j = s * rowsPer; j <= (s + 1) * rowsPer; j++) for (let i = 0; i <= G; i += 4) { const h = HM[j * W + i]; if (h < mn) mn = h; if (h > mx) mx = h; }
    const zc = -WH + (s + 0.5) * rowsPer * CELL;
    g.draws.push({ kind: 0, first, count, c: [0, (mn + mx) / 2, zc], r: Math.hypot(WH, (mx - mn) / 2, rowsPer * CELL / 2) + 1, shadow: 1 });
  }
}

// ---------- tubes ----------
// pts: flat [x,y,z,...]; rad: radius per point; w: wind per point; lob: lobe amplitude per point; opt: {segs, lobes:[[ang,str,width]], twist, ph, aoFn, uScale}
const tmpP = new Float32Array(3 * 64 * 80);
export function tube(g, pts, rad, w, lob, opt) {
  const n = rad.length, S = opt.segs, base = g.n;
  let Tx = 0, Ty = 0, Tz = 0, Nx = 0, Ny = 0, Nz = 0;
  const P = n * (S + 1) * 3 <= tmpP.length ? tmpP : new Float32Array(n * (S + 1) * 3);
  let vlen = 0; const V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
    let tx = pts[b * 3] - pts[a * 3], ty = pts[b * 3 + 1] - pts[a * 3 + 1], tz = pts[b * 3 + 2] - pts[a * 3 + 2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (i === 0) { // initial normal
      if (Math.abs(ty) < 0.9) { Nx = -tz; Ny = 0; Nz = tx; } else { Nx = 1; Ny = 0; Nz = 0; }
      const d = Nx * tx + Ny * ty + Nz * tz; Nx -= tx * d; Ny -= ty * d; Nz -= tz * d;
    } else {
      const d = Nx * tx + Ny * ty + Nz * tz; Nx -= tx * d; Ny -= ty * d; Nz -= tz * d;
      vlen += Math.hypot(pts[i * 3] - pts[i * 3 - 3], pts[i * 3 + 1] - pts[i * 3 - 2], pts[i * 3 + 2] - pts[i * 3 - 1]);
    }
    const nl = Math.hypot(Nx, Ny, Nz) || 1; Nx /= nl; Ny /= nl; Nz /= nl;
    Tx = tx; Ty = ty; Tz = tz; V[i] = vlen;
    const Bx = Ty * Nz - Tz * Ny, By = Tz * Nx - Tx * Nz, Bz = Tx * Ny - Ty * Nx;
    for (let j = 0; j <= S; j++) {
      const th = j / S * TAU;
      let lo = 0;
      if (opt.lobes && lob[i] > 0) for (const [ang, str, wid] of opt.lobes) {
        let d = th - ang - opt.twist * vlen; d = ((d % TAU) + TAU + PI) % TAU - PI; lo += str * Math.exp(-(d * d) / (wid * wid));
      }
      const r = rad[i] * (1 + lob[i] * lo) * (1 + 0.12 * (vnoise(th * 2.2 + opt.ph * 7, vlen * 0.6) - 0.5) + 0.12 * Math.max(0, vnoise(th * 1.3 + opt.ph * 3, vlen * 0.18) - 0.6));
      const c = Math.cos(th), s = Math.sin(th), o = (i * (S + 1) + j) * 3;
      P[o] = pts[i * 3] + (Nx * c + Bx * s) * r; P[o + 1] = pts[i * 3 + 1] + (Ny * c + By * s) * r; P[o + 2] = pts[i * 3 + 2] + (Nz * c + Bz * s) * r;
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j <= S; j++) {
    const o = (i * (S + 1) + j) * 3;
    const jp = ((j + 1) % S), jm = ((j - 1 + S) % S), ip = Math.min(i + 1, n - 1), im = Math.max(i - 1, 0);
    const ox = (i * (S + 1) + jp) * 3, oy = (i * (S + 1) + jm) * 3, os1 = (ip * (S + 1) + j) * 3, os0 = (im * (S + 1) + j) * 3;
    const ax = P[ox] - P[oy], ay = P[ox + 1] - P[oy + 1], az = P[ox + 2] - P[oy + 2];
    const bx = P[os1] - P[os0], by = P[os1 + 1] - P[os0 + 1], bz = P[os1 + 2] - P[os0 + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const ao = opt.aoFn ? opt.aoFn(P[o], P[o + 1], P[o + 2], i, j) : 1;
    g.v(P[o], P[o + 1], P[o + 2], nx, ny, nz, j / S + opt.twist * V[i] / TAU, V[i], ao, w[i], opt.bob || 0, opt.ph);
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < S; j++) {
    const a = base + i * (S + 1) + j, b = a + 1, c = a + S + 1, d = c + 1;
    g.t(a, b, d); g.t(a, d, c);
  }
}

// ---------- trees ----------
export const TREES = []; // {x,z,r}  for occupancy
function occupied(x, z, pad) { for (const t of TREES) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r + pad) ** 2) return true; return false; }
export const FORMS = [[80, 26, 0.3, 1.0], [-82, 38, 2.2, 1.1], [30, -104, 4.0, 1.15], [-62, -88, 1.0, 0.9], [104, -42, 3.0, 1.05], [-112, -18, 5.0, 1.2]];
FORMS.push([-30, -82, 0.9, 1.0, 1], [-78, -50, 2.0, 1.05, 1]);
for (let i = 0; i < 10; i++) { const a = i / 10 * TAU + 0.3, r = 100 + (i % 3) * 7; FORMS.push([Math.cos(a) * r, Math.sin(a) * r / 1.1, a + PI / 2, 0.95 + (i % 4) * 0.12]); }
export function inClear(x, z, k = 1, trees = true) {
  for (const [fx, fz, , fs, keep] of FORMS) if ((keep || pathD(fx, fz) > 30 * fs) && Math.hypot(x - fx, z - fz) < 21 * fs * k) return true;
  for (const [cx, cz, r, , tOnly] of CLEAR) if ((trees || !tOnly) && Math.hypot(x - cx, z - cz) < r * k) return true;
  // view corridor from start to temple
  if (trees && Math.abs(x) < 7 * k && z > TEMPLE[2] && z < START[2] + 4) return true;
  if (pathD(x, z) < 6.5 * k) return true;
  const sl = Math.hypot(SUN[0], SUN[2]), sx = SUN[0] / sl, sz = SUN[2] / sl;
  if (segD(x, z, STAG[0], STAG[2], STAG[0] + sx * 95, STAG[2] + sz * 95) < 11 * k) return true;
  if (segD(x, z, TEMPLE[0], TEMPLE[2], TEMPLE[0] + sx * 80, TEMPLE[2] + sz * 80) < 8 * k) return true;
  return false;
}

function rotDir(d, ax, ay, az, ang) { // rotate d around axis
  const c = Math.cos(ang), s = Math.sin(ang), k = ax * d[0] + ay * d[1] + az * d[2];
  return [d[0] * c + (ay * d[2] - az * d[1]) * s + ax * k * (1 - c), d[1] * c + (az * d[0] - ax * d[2]) * s + ay * k * (1 - c), d[2] * c + (ax * d[1] - ay * d[0]) * s + az * k * (1 - c)];
}
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// grows a curved limb, returns {pts, rad, w}
function limb(R, p0, d0, len, r0, r1, w0, wk, up, n, wob) {
  const pts = [], rad = [], w = []; let p = p0.slice(), d = norm(d0); const step = len / (n - 1);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push(p[0], p[1], p[2]); rad.push(mix(r0, r1, Math.pow(t, 0.8))); w.push(w0 + wk * t * t);
    d = norm([d[0] + (R() - 0.5) * wob, d[1] + up + (R() - 0.5) * wob * 0.5, d[2] + (R() - 0.5) * wob]);
    p = [p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step];
  }
  return { pts, rad, w, end: p, dir: d };
}

function cluster(cards, R, c, rc, cnt, w, pal, ph, sizeK, flat = 0.55) {
  for (let k = 0; k < cnt; k++) {
    let x, y, z; do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; } while (x * x + y * y + z * z > 1);
    const px = c[0] + x * rc, py = c[1] + y * rc * flat, pz = c[2] + z * rc;
    const dd = Math.hypot(x, y, z);
    const n = norm([R() - 0.5, 0.6 + R(), R() - 0.5]);
    const sN = norm([x, y * 1.4 + 0.35, z]);
    const v = R() < (pal === 1 ? 0.35 : 0.6) ? 0 : 1;
    cards.push(px, py, pz, sizeK * (2.5 + R() * 1.6), n[0], n[1], n[2], sN[0], sN[1], sN[2], v, pal, 0.35 + 0.65 * dd, R(), w + 0.08, 0, ph);
  }
}

export function makeTree(g, cards, x, z, R0, H, kind, seed, vines) {
  const R = rng(seed), gy = gh(x, z), ph = R();
  const giant = kind === 0 || kind === 2, arch = kind === 2;
  const archH = arch ? (Math.hypot(x - 19, z - 44) < 1 ? 4.6 : 2.6 + R() * 1.4) : 0;
  const by = gy - (arch ? -archH : 1.0);
  const n = giant ? 34 : 18;
  const pts = [], rad = [], w = [], lob = [];
  const lx = (R() - 0.5) * 0.08, lz = (R() - 0.5) * 0.08, f1 = R() * 6, f2 = R() * 6, A = giant ? R0 * 0.9 : R0 * 0.8;
  let px = x, pz = z;
  const trunkY = [];
  for (let i = 0; i < n; i++) {
    const t = Math.pow(i / (n - 1), 1.35), h = t * H;
    px = x + lx * h + A * Math.sin(t * 4 + f1) * t * 2; pz = z + lz * h + A * Math.sin(t * 3.3 + f2) * t * 2;
    pts.push(px, by + h - (arch ? 1.2 * (1 - smooth(0, 2.5, h)) : 0), pz); trunkY.push(t);
    rad.push((R0 * (0.16 + 0.84 * Math.pow(1 - t, 1.4)) + (giant && !arch ? R0 * 0.9 * Math.exp(-h / 2.2) : 0) + (arch ? R0 * 0.3 * Math.exp(-h / 2) : 0)) * (arch ? mix(0.55, 1, smooth(0, 2.5, h)) * (1 + 0.6 * Math.exp(-h / 1.5)) : 1));
    w.push(0.05 * t * t);
    lob.push(giant ? (arch ? 0.35 : 1.1) * Math.exp(-h / 3.5) + 0.2 + 0.08 * Math.sin(h * 0.4 + ph * 6) : 0.1);
  }
  const lobes = []; const nl = giant ? 5 + (R() * 4 | 0) : 4;
  for (let k = 0; k < nl; k++) lobes.push([k / nl * TAU + (R() - 0.5) * 0.6, 0.5 + R() * 0.7, 0.25 + R() * 0.25]);
  const twist = (R() < 0.5 ? -1 : 1) * (giant ? 0.06 + R() * 0.1 : 0.03 + R() * 0.04);
  g.begin();
  tube(g, pts, rad, w, lob, {
    segs: giant ? 30 : 12, lobes, twist, ph,
    aoFn: (X, Y, Z) => { const hh = Y - gh(X, Z); return 0.35 + 0.65 * smooth(-0.5, 5, hh); }
  });
  // roots
  if (giant) {
    const nr = arch ? 14 + (R() * 4 | 0) : 6 + (R() * 3 | 0);
    for (let k = 0; k < nr; k++) {
      const L = arch ? lobes[k % nl] : lobes[k % nl];
      let ang = (arch ? k / nr * TAU : L[0]) + (R() - 0.5) * 0.4;
      const len = arch ? 6 + R() * 6 + R0 * 1.2 : 4 + R() * 4 + R0 * 1.2;
      const rp = [], rr = [], rw = [], rl = []; const m = 16;
      let ox = x, oz = z;
      for (let i = 0; i < m; i++) {
        const t = i / (m - 1), d = R0 * (arch ? 0.15 : 0.8) + t * len;
        ang += (R() - 0.5) * 0.12;
        ox = x + Math.cos(ang) * d; oz = z + Math.sin(ang) * d;
        const g2 = gh(ox, oz); const rad0 = R0 * (arch ? 0.5 * (0.85 + 0.3 * ((k * 0.37) % 1)) : 0.58) * Math.pow(1 - t * (arch ? 0.75 : 0.9), arch ? 1.1 : 1.5);
        let yy;
        if (arch) yy = mix(by + 0.6, g2 - rad0 * 0.2, Math.pow(t, 0.6)) + Math.sin(t * PI) * archH * 0.18 - smooth(0.82, 1, t) * rad0 * 3;
        else yy = mix(by + 1.4, g2 + rad0 * 0.05, smooth(0, 0.16, t)) - smooth(0.6, 1, t) * rad0 * 2.2;
        rp.push(ox, yy, oz); rr.push(rad0); rw.push(0); rl.push(0.15);
      }
      let hit = false; if (arch) for (let i = 9; i < rp.length; i += 3) if (pathD3(rp[i], rp[i + 1], rp[i + 2]) < rr[i / 3] + 2.2) hit = true;
      if (hit) continue;
      tube(g, rp, rr, rw, rl, { segs: arch ? 12 : 10, lobes: [[0, 0.5, 0.6], [PI, 0.4, 0.6]], twist: 0, ph, aoFn: (X, Y, Z) => 0.45 + 0.55 * smooth(-0.3, 2.5, Y - gh(X, Z)) });
    }
  } else {
    for (let k = 0; k < 4; k++) {
      const ang = lobes[k][0], len = 2 + R() * 2.5; const rp = [], rr = [], rw = [], rl = [];
      for (let i = 0; i < 8; i++) {
        const t = i / 7, d = R0 * 0.6 + t * len, ox = x + Math.cos(ang) * d, oz = z + Math.sin(ang) * d, r0 = R0 * 0.35 * (1 - t * 0.8);
        rp.push(ox, mix(by + 1.2, gh(ox, oz) + r0 * 0.1, smooth(0, 0.4, t)) - smooth(0.7, 1, t) * r0 * 2.5, oz); rr.push(r0); rw.push(0); rl.push(0);
      }
      tube(g, rp, rr, rw, rl, { segs: 7, twist: 0, ph, aoFn: (X, Y, Z) => 0.5 + 0.5 * smooth(-0.3, 1.5, Y - gh(X, Z)) });
    }
  }
  // branches + foliage
  const pal = kind === 1 ? 1 : 0, ck = giant ? 1 : 0.75;
  const nb = giant ? 6 + (R() * 3 | 0) : 4 + (R() * 3 | 0);
  const crownStart = giant ? 0.5 : 0.45;
  const tp = i => [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]];
  for (let b = 0; b < nb; b++) {
    const ta = crownStart + (b / nb) * (0.95 - crownStart) + (R() - 0.5) * 0.05;
    let ti = 0; while (ti < n - 1 && trunkY[ti] < ta) ti++;
    const p0 = tp(ti), az = b * 2.39996 + R() * 0.5, pitch = 0.35 + R() * 0.5;
    const d0 = [Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch)];
    const L = H * (giant ? 0.32 + R() * 0.16 : 0.3 + R() * 0.12) * (1.25 - ta * 0.5);
    const rb = Math.min(rad[ti] * 0.62, R0 * 0.45);
    const wb = w[ti];
    const br = limb(R, p0, d0, L, rb, rb * 0.15, wb, 0.5 * L / 12, giant ? 0.04 : 0.06, giant ? 12 : 8, 0.25);
    tube(g, br.pts, br.rad, br.w, br.rad.map(() => 0), { segs: giant ? 12 : 7, twist: 0.05, ph });
    // sub branches
    const ns = giant ? 3 + (R() * 2 | 0) : 2;
    for (let s = 0; s < ns; s++) {
      const si = Math.floor((0.35 + 0.55 * (s + R() * 0.5) / ns) * (br.rad.length - 1));
      const sp = [br.pts[si * 3], br.pts[si * 3 + 1], br.pts[si * 3 + 2]];
      const sd = rotDir([br.pts[si * 3 + 3] - sp[0], br.pts[si * 3 + 4] - sp[1], br.pts[si * 3 + 5] - sp[2]], 0, 1, 0, (s & 1 ? 1 : -1) * (0.6 + R() * 0.6));
      sd[1] += 0.25;
      const sl = L * (0.35 + R() * 0.25);
      const sb = limb(R, sp, sd, sl, br.rad[si] * 0.7, 0.04, br.w[si], 0.5 * sl / 8, 0.05, 6, 0.4);
      tube(g, sb.pts, sb.rad, sb.w, sb.rad.map(() => 0), { segs: giant ? 7 : 5, twist: 0.05, ph });
      const cpos = [sb.pts[9], sb.pts[10], sb.pts[11]];
      cluster(cards, R, sb.end, (giant ? 4.6 : 2.6) + R() * 1.4, giant ? 50 : 22, sb.w[5] + 0.1, pal, ph, ck);
      cluster(cards, R, cpos, (giant ? 3.2 : 1.8) + R(), giant ? 22 : 10, sb.w[3], pal, ph, ck);
    }
    cluster(cards, R, br.end, (giant ? 5.0 : 2.8) + R() * 1.4, giant ? 52 : 22, br.w[br.w.length - 1] + 0.1, pal, ph, ck);
    // hanging vines
    if (giant && vines && R() < 0.75) {
      const nv = 1 + (R() * 3 | 0);
      for (let v = 0; v < nv; v++) {
        const vi = Math.floor((0.3 + R() * 0.6) * (br.rad.length - 1));
        const vp = [br.pts[vi * 3], br.pts[vi * 3 + 1] - br.rad[vi], br.pts[vi * 3 + 2]];
        const gyv = gh(vp[0], vp[2]);
        const vl = Math.min(vp[1] - gyv - 1.5, 6 + R() * 16);
        if (vl > 2) vine(g, cards, R, vp, vl, br.w[vi], 0, ph);
      }
    }
  }
  // crown leader
  cluster(cards, R, tp(n - 1), giant ? 5.5 : 3.2, giant ? 44 : 20, 0.15, pal, ph, ck, 0.5);
  g.end(1);
  TREES.push({ x, z, r: giant ? R0 * (arch ? 1.5 : 2.2) : R0 * 1.2 });
}

export function vine(g, cards, R, p0, len, w0, bob, ph) {
  const n = Math.max(4, Math.round(len / 0.8)), pts = [], rad = [], w = [], l = [];
  const sx = (R() - 0.5) * 0.6, sz = (R() - 0.5) * 0.6;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    pts.push(p0[0] + sx * Math.sin(t * PI) * 2, p0[1] - t * len, p0[2] + sz * Math.sin(t * PI) * 2);
    rad.push(0.045 * (1 - t * 0.5)); w.push(w0 + t * len * 0.05); l.push(0);
  }
  tube(g, pts, rad, w, l, { segs: 4, twist: 0, ph, bob });
  for (let i = 1; i < n; i++) {
    const t = i / (n - 1), q = 2 + (R() * 3 | 0);
    for (let k = 0; k < q; k++) {
      const a = R() * TAU, rr = 0.15;
      const nn = norm([Math.cos(a), (R() - 0.3), Math.sin(a)]);
      cards.push(pts[i * 3] + Math.cos(a) * rr, pts[i * 3 + 1] + R() * 0.4, pts[i * 3 + 2] + Math.sin(a) * rr, 0.55 + R() * 0.35,
        nn[0], nn[1], nn[2], nn[0], nn[1] + 0.3, nn[2], 2, 4, 0.8, R(), w[i] + 0.05, bob, ph);
    }
  }
}

export function fallenLog(g, R, x, z) {
  const a = R() * PI, L = 8 + R() * 9, r0 = 0.45 + R() * 0.5, n = 14, pts = [], rad = [], w = [], l = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), px = x + Math.cos(a) * (t - 0.5) * L, pz = z + Math.sin(a) * (t - 0.5) * L;
    pts.push(px, gh(px, pz) + r0 * 0.55 - smooth(0.8, 1, Math.abs(t - 0.5) * 2) * r0 * 1.4 + Math.sin(t * 5) * 0.1, pz);
    rad.push(r0 * (1 - 0.15 * t)); w.push(0); l.push(0.1);
  }
  g.begin();
  tube(g, pts, rad, w, l, { segs: 14, lobes: [[0, 0.4, 0.5], [2, 0.3, 0.5], [4, 0.4, 0.5]], twist: 0.1, ph: R(), aoFn: (X, Y, Z) => 0.4 + 0.6 * smooth(-0.2, 1.0, Y - gh(X, Z)) });
  g.end(1);
  TREES.push({ x, z, r: 1.5 });
  return [x, z, a, L];
}

// ---------- place the forest ----------
export function placeForest(g, cards) {
  const R = rng(1234);
  // root-arch giants (hand placed near the start / temple)
  const archTrees = [[19, 44], [-24, -6], [64, 20], [10, -64]];
  let seed = 100;
  for (const [x, z] of archTrees) makeTree(g, cards, x, z, 1.8 + R() * 0.6, 42 + R() * 12, 2, seed++, 1);
  // giant trees
  let tries = 0, cnt = 0;
  while (cnt < 110 && tries++ < 9000) {
    const x = (R() * 2 - 1) * 205, z = (R() * 2 - 1) * 205;
    const rr = Math.hypot(x, z * 1.1); if (rr > 215) continue;
    if (inClear(x, z, 1.25)) continue;
    const R0 = 2.4 + R() * 2.8;
    if (occupied(x, z, 11 + R0 * 1.6) || pathD(x, z) < 9 + R0 * 2.4) continue;
    makeTree(g, cards, x, z, R0, 40 + R() * 22 + R0 * 4, 0, seed++, 1); cnt++;
  }
  // medium trees (some iridescent purple)
  tries = 0; cnt = 0;
  while (cnt < 230 && tries++ < 16000) {
    const x = (R() * 2 - 1) * 225, z = (R() * 2 - 1) * 225;
    if (Math.hypot(x, z * 1.1) > 235 || inClear(x, z, 0.9)) continue;
    const R0 = 0.45 + R() * 0.5;
    if (occupied(x, z, 4.5)) continue;
    makeTree(g, cards, x, z, R0, 13 + R() * 14, R() < 0.22 ? 1 : 3, seed++, 0); cnt++;
  }
  // backdrop giants on the basin rim (hide the ridge line against the sky)
  tries = 0; cnt = 0;
  while (cnt < 70 && tries++ < 6000) {
    const a = R() * TAU, r = 150 + R() * 75, x = Math.cos(a) * r, z = Math.sin(a) * r / 1.1;
    const R0 = 2.2 + R() * 2.2;
    if (inClear(x, z, 0.8) || occupied(x, z, 9 + R0 * 1.5)) continue;
    makeTree(g, cards, x, z, R0, 45 + R() * 20, 0, seed++, 0); cnt++;
  }
  const logs = [];
  for (let i = 0; i < 26; i++) {
    let x, z, k = 0; do { x = (R() * 2 - 1) * 170; z = (R() * 2 - 1) * 170; } while ((inClear(x, z, 0.8) || occupied(x, z, 6) || pathD(x, z) < 13) && k++ < 50);
    logs.push(fallenLog(g, R, x, z));
  }
  return logs;
}

// ---------- understorey instances ----------
// generic 32B instances for ferns/mushrooms: pos.xyz, scale | rotY f32 | tilt f32 | hue f32 | phase f32
export class Inst {
  constructor() { this.a = []; }
  push(x, y, z, s, rot, tilt, hue, ph) { this.a.push(x, y, z, s, rot, tilt, hue, ph); }
  data() { return new Float32Array(this.a); }
  get n() { return this.a.length / 8; }
}
export function flowerDensity(x, z) {
  return smooth(0.52, 0.68, fbm(x * 0.03 + 40, z * 0.03 - 11, 3)) * (1 - smooth(140, 175, Math.hypot(x, z)));
}
export function understorey(leaves, cards, ferns, mush, logs) {
  const R = rng(777);
  // ferns
  for (let i = 0, c = 0; i < 80000 && c < 6500; i++) {
    const x = (R() * 2 - 1) * 200, z = (R() * 2 - 1) * 200;
    const d = fbm(x * 0.04 - 7, z * 0.04 + 3, 3);
    if (d < 0.42 || Math.hypot(x, z * 1.1) > 200) continue;
    if (inClear(x, z, 0.75, false) || occupied(x, z, 0.4)) continue;
    const s = 1.8 + R() * 1.8 + (R() < 0.3 ? 2.4 : 0);
    ferns.push(x, gh(x, z) - 0.1, z, s, R() * TAU, (R() - 0.5) * 0.2, R(), R()); c++;
  }
  // purple / pink iridescent bushes
  for (let i = 0, c = 0; i < 20000 && c < 520; i++) {
    const x = (R() * 2 - 1) * 190, z = (R() * 2 - 1) * 190;
    if (fbm(x * 0.025 + 70, z * 0.025, 3) < 0.5 || inClear(x, z, 0.7, false) || occupied(x, z, 1.2)) continue;
    const y = gh(x, z), rc = 0.8 + R() * 1.0, ph = R();
    for (let k = 0; k < 40; k++) {
      const a = R() * TAU, rr = Math.sqrt(R()) * rc;
      const px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr, py = y + 0.3 + R() * rc * 1.1;
      const n = norm([Math.cos(a) * 0.6, 0.6 + R(), Math.sin(a) * 0.6]);
      leaves.push(px, py, pz, 0.7 + R() * 0.5, n[0], n[1], n[2], Math.cos(a), 0.5 + (py - y) / rc, Math.sin(a), (R() < 0.5 ? 0 : 1) | 32, 1, 0.4 + 0.6 * rr / rc, R(), 0.05 + 0.04 * (py - y), 0, ph);
    }
    c++;
  }
  // magenta flowering ground cover + small green plants (upright crossed cards, flag 16)
  for (let i = 0, c = 0; i < 400000 && c < 30000; i++) {
    const cx = (R() * 2 - 1) * 170, cz = (R() * 2 - 1) * 170;
    const fd = flowerDensity(cx, cz), ug = smooth(0.45, 0.62, fbm(cx * 0.09 + 5, cz * 0.09 - 3, 3));
    const isF = R() < fd * 1.6;
    if (!isF && R() > ug * 0.8) continue;
    if (occupied(cx, cz, 0.4) || (inClear(cx, cz, 0.35, false))) continue;
    const m = 3 + (R() * 5 | 0), ph = R();
    for (let q = 0; q < m; q++) {
      const x = cx + (R() - 0.5) * 1.3, z = cz + (R() - 0.5) * 1.3;
      const y = gh(x, z), a = R() * PI, s = (isF ? 0.32 + R() * 0.3 : 0.28 + R() * 0.4) * (0.7 + 0.5 * R());
      for (let k = 0; k < 2; k++) {
        const aa = a + k * PI / 2, nx = Math.cos(aa), nz = Math.sin(aa);
        cards.push(x, y + s * 0.45, z, s, nx, 0, nz, nx * 0.3, 1, nz * 0.3, (isF ? 3 : 1) | 16, isF ? 2 : 3, 1, R(), 0.03, 0, ph);
      }
    }
    c++;
  }
  // mushrooms: clusters at tree bases and on logs, plus a ring of giants in the glade
  const hue = () => R() < 0.55 ? 0.5 + R() * 0.07 : (R() < 0.5 ? 0.6 + R() * 0.08 : 0.76 + R() * 0.1);
  for (const t of TREES) {
    if (R() < 0.45) continue;
    const nc = 1 + (R() * 2 | 0);
    for (let c = 0; c < nc; c++) {
      const a = R() * TAU, d = t.r * (0.9 + R() * 0.6), cx = t.x + Math.cos(a) * d, cz = t.z + Math.sin(a) * d, h = hue();
      const m = 3 + (R() * 7 | 0);
      for (let k = 0; k < m; k++) { const x = cx + (R() - 0.5) * 1.2, z = cz + (R() - 0.5) * 1.2; mush.push(x, gh(x, z) - 0.02, z, 0.6 + R() * 1.6, R() * TAU, (R() - 0.5) * 0.5, h + (R() - 0.5) * 0.04, R()); }
    }
  }
  for (const [x, z, a, L] of logs) for (let k = 0; k < 10; k++) {
    const t = (R() - 0.5) * L * 0.8, px = x + Math.cos(a) * t, pz = z + Math.sin(a) * t, h = hue();
    mush.push(px + (R() - 0.5) * 1.4, gh(px, pz), pz + (R() - 0.5) * 1.4, 0.7 + R() * 1.2, R() * TAU, (R() - 0.5) * 0.6, h, R());
  }
  for (let k = 0; k < 14; k++) { const a = k / 14 * TAU + R() * 0.2, d = 11 + R() * 4, x = GLADE[0] + Math.cos(a) * d, z = GLADE[2] + Math.sin(a) * d; mush.push(x, gh(x, z) - 0.05, z, 5 + R() * 6, R() * TAU, (R() - 0.5) * 0.3, 0.5 + R() * 0.3, R()); }
  // a few giant mushrooms scattered near the start for scale
  for (const [x, z] of [[-9, 50], [-7, 47], [11, 30], [-12, 22], [8, 54]]) mush.push(x, gh(x, z) - 0.05, z, 3 + R() * 4, R() * TAU, (R() - 0.5) * 0.3, hue(), R());
}

// ---------- aux map: rgb mushroom glow, a flower density ----------
export const AUXN = 512;
export function auxMap(mush) {
  const A = new Float32Array(AUXN * AUXN * 4), s = 2 * WH / AUXN;
  const m = mush.a;
  for (let i = 0; i < m.length; i += 8) {
    const x = m[i], z = m[i + 2], sc = m[i + 3], hue = m[i + 6];
    const col = hsv(hue, 0.8, 1), I = 0.03 * Math.min(sc, 2.2) ** 2, rad = 1.2 + Math.min(sc, 4) * 0.8;
    const ci = (x + WH) / s, cj = (z + WH) / s, rr = Math.ceil(rad * 2 / s);
    for (let j = Math.max(0, cj - rr | 0); j <= Math.min(AUXN - 1, cj + rr | 0); j++) for (let ii = Math.max(0, ci - rr | 0); ii <= Math.min(AUXN - 1, ci + rr | 0); ii++) {
      const dx = (ii + 0.5) * s - WH - x, dz = (j + 0.5) * s - WH - z, f = I * Math.exp(-(dx * dx + dz * dz) / (rad * rad));
      const o = (j * AUXN + ii) * 4; A[o] += col[0] * f; A[o + 1] += col[1] * f; A[o + 2] += col[2] * f;
    }
  }
  for (let j = 0; j < AUXN; j++) for (let i = 0; i < AUXN; i++) A[(j * AUXN + i) * 4 + 3] = flowerDensity((i + 0.5) * s - WH, (j + 0.5) * s - WH);
  return A;
}
export function hsv(h, s, v) {
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}

// ---------- SDF objects (evaluated on GPU, meshed here) ----------
// kind: 1 temple, 2 stag, 3 rock formation, 4 floating rock, 5 boulder. Grids are in local space; pos/rot place them.
export function sdfObjects() {
  const R = rng(99), L = [];
  L.push({ kind: 1, mat: 3, o: [-11.5, -1.4, -9.5], size: [23, 13.5, 19], vs: 0.085, pos: [TEMPLE[0], gh(TEMPLE[0], TEMPLE[2]), TEMPLE[2]], rot: 0, s: 1, seed: 0 });
  L.push({ kind: 2, mat: 4, o: [-5.2, -0.6, -3.4], size: [10.4, 15.0, 6.8], vs: 0.065, pos: [STAG[0], gh(STAG[0], STAG[2]) - 0.4, STAG[2]], rot: 2.5, s: 1, seed: 0 });
  for (const [x, z, rot, sc] of FORMS.filter(f => f[4] || pathD(f[0], f[1]) > 30 * f[3])) L.push({ kind: 3, mat: 2, o: [-22 * sc, -6 * sc, -20 * sc], size: [44 * sc, 28 * sc, 40 * sc], vs: 0.3 * sc, pos: [x, gh(x, z), z], rot, s: sc, seed: rot * 3.7 });
  for (let i = 0; i < 12; i++) {
    let a, d, x, z, y, sc, k = 0;
    do { a = i / 9 * TAU + R() * 0.6; d = 5 + R() * 12; x = GLADE[0] + Math.cos(a) * d; z = GLADE[2] + Math.sin(a) * d; sc = 0.6 + R() * 0.9; y = gh(x, z) + 9 * sc + 8 + R() * 22; } while ((pathD3(x, y - 3 * sc, z) < 14 * sc + 9 || occupied(x, z, 7 * sc + 4)) && k++ < 600);
    if (k >= 600) continue;
    L.push({ kind: 4, mat: 2, o: [-6 * sc, -9 * sc, -6 * sc], size: [12 * sc, 10.5 * sc, 12 * sc], vs: 0.12 * sc, pos: [x, y, z], rot: R() * TAU, s: sc, seed: R() * 10, bob: 1 + i * 27 });
  }
  for (let i = 0; i < 40; i++) {
    const sc = 0.6 + R() * 1.8;
    let x, z, k = 0; do { x = (R() * 2 - 1) * 180; z = (R() * 2 - 1) * 180; } while ((inClear(x, z, 0.5) || occupied(x, z, 2.6 * sc + 1.5) || pathD(x, z) < 5 + 3 * sc) && k++ < 60);
    L.push({ kind: 5, mat: 2, o: [-3.2 * sc, -2 * sc, -3.2 * sc], size: [6.4 * sc, 4.4 * sc, 6.4 * sc], vs: 0.14 * sc, pos: [x, gh(x, z), z], rot: R() * TAU, s: sc, seed: R() * 10 });
    TREES.push({ x, z, r: 2 * sc });
  }
  for (const o of L) o.dim = o.size.map(s => Math.ceil(s / o.vs) + 1);
  return L;
}

// Surface nets over a dense grid F (dims nx,ny,nz) -> appends to Geo. Also returns nothing.
export function surfaceNets(g, F, nx, ny, nz, org, vs, ob, rnd) {
  const cr = Math.cos(ob.rot), sr = Math.sin(ob.rot), [tx_, ty_, tz_] = ob.pos, bob = ob.bob || 0;
  const idx = new Int32Array(nx * ny * nz).fill(-1); // per cell
  const base = g.n;
  const sx = 1, sy = nx, sz = nx * ny;
  const vpos = [];
  const cornerOff = [0, 1, nx, nx + 1, sz, sz + 1, sz + nx, sz + nx + 1];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cpos = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const v = new Float32Array(8);
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const c0 = x + y * nx + z * sz; let mask = 0;
    for (let k = 0; k < 8; k++) { v[k] = F[c0 + cornerOff[k]]; if (v[k] < 0) mask |= 1 << k; }
    if (mask === 0 || mask === 255) continue;
    let ax = 0, ay = 0, az = 0, cnt = 0;
    for (let e = 0; e < 12; e++) {
      const a = edges[e][0], b = edges[e][1];
      if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
      const t = v[a] / (v[a] - v[b]), pa = cpos[a], pb = cpos[b];
      ax += pa[0] + (pb[0] - pa[0]) * t; ay += pa[1] + (pb[1] - pa[1]) * t; az += pa[2] + (pb[2] - pa[2]) * t; cnt++;
    }
    idx[c0] = vpos.length / 3;
    vpos.push(org[0] + (x + ax / cnt) * vs, org[1] + (y + ay / cnt) * vs, org[2] + (z + az / cnt) * vs);
  }
  const nv = vpos.length / 3, nrm = new Float32Array(nv * 3), tris = [];
  const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d); };
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const c = x + y * nx + z * sz, in0 = F[c] < 0;
    // edge along +x from corner c: cells sharing it are (x, y-1..y, z-1..z)
    if (x < nx - 1 && in0 !== (F[c + sx] < 0)) quad(idx[c - sy - sz], idx[c - sz], idx[c], idx[c - sy], !in0);
    if (y < ny - 1 && in0 !== (F[c + sy] < 0)) quad(idx[c - sx - sz], idx[c - sx], idx[c], idx[c - sz], !in0);
    if (z < nz - 1 && in0 !== (F[c + sz] < 0)) quad(idx[c - sx - sy], idx[c - sy], idx[c], idx[c - sx], !in0);
  }
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i] * 3, b = tris[i + 1] * 3, c = tris[i + 2] * 3;
    const ux = vpos[b] - vpos[a], uy = vpos[b + 1] - vpos[a + 1], uz = vpos[b + 2] - vpos[a + 2];
    const wx = vpos[c] - vpos[a], wy = vpos[c + 1] - vpos[a + 1], wz = vpos[c + 2] - vpos[a + 2];
    const nx_ = uy * wz - uz * wy, ny_ = uz * wx - ux * wz, nz_ = ux * wy - uy * wx;
    for (const q of [a, b, c]) { nrm[q] += nx_; nrm[q + 1] += ny_; nrm[q + 2] += nz_; }
  }
  // ambient occlusion from the field: sample along normal
  const samp = (px, py, pz) => {
    let fx = (px - org[0]) / vs, fy = (py - org[1]) / vs, fz = (pz - org[2]) / vs;
    if (fx < 0 || fy < 0 || fz < 0 || fx >= nx - 1 || fy >= ny - 1 || fz >= nz - 1) return 1e3;
    const i = fx | 0, j = fy | 0, k = fz | 0, tx = fx - i, ty = fy - j, tz = fz - k, o = i + j * nx + k * sz;
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(F[o], F[o + 1], tx), l(F[o + nx], F[o + nx + 1], tx), ty), l(l(F[o + sz], F[o + sz + 1], tx), l(F[o + sz + nx], F[o + sz + nx + 1], tx), ty), tz);
  };
  for (let i = 0; i < nv; i++) {
    const px = vpos[i * 3], py = vpos[i * 3 + 1], pz = vpos[i * 3 + 2];
    let nx_ = nrm[i * 3], ny_ = nrm[i * 3 + 1], nz_ = nrm[i * 3 + 2]; const l = Math.hypot(nx_, ny_, nz_) || 1; nx_ /= l; ny_ /= l; nz_ /= l;
    let ao = 1;
    for (const d of [0.25, 0.7, 1.6]) ao -= Math.max(0, d - Math.min(samp(px + nx_ * d, py + ny_ * d, pz + nz_ * d), d)) / d * 0.3;
    const wx = px * cr + pz * sr + tx_, wy = py + ty_, wz = -px * sr + pz * cr + tz_;
    ao *= 0.5 + 0.5 * smooth(-0.3, 2.0, wy - gh(wx, wz));
    g.v(wx, wy, wz, nx_ * cr + nz_ * sr, ny_, -nx_ * sr + nz_ * cr, 0, 0, Math.max(ao, 0.15), 0, bob, rnd);
  }
  for (const t of tris) { if (g.ni >= g.idx.length) { const i2 = new Uint32Array(g.idx.length * 2); i2.set(g.idx); g.idx = i2; } g.idx[g.ni++] = base + t; }
  return vpos;
}
