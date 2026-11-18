import { mul4, inv4, viewM, persp, rng, smooth, clamp, TAU, PI } from './util.js';
import * as W from './world.js';
import * as S from './wgsl.js';

const Q = new URLSearchParams(location.search);
const cv = document.getElementById('c'), msg = document.getElementById('m');
const say = t => { msg.textContent = t; msg.style.display = t ? 'block' : 'none'; };
const PERF = Q.has('perf'), FLY = Q.has('fly') || PERF, POSE = Q.has('pose') ? +Q.get('pose') : -1, MANUAL = Q.has('manual');
const SKIP = Q.get('skip') || '', HZ = +(Q.get('hz') || 0), FLYOFF = +(Q.get('fo') || 0), RES = Q.get('res'), RESW = RES ? +RES.split('x')[0] : 0, RESH = RES ? +RES.split('x')[1] : 0, TFIX = Q.has('t') ? +Q.get('t') : -1;
const GU = GPUBufferUsage, TU = GPUTextureUsage;
const tick = () => new Promise(r => setTimeout(r, 0));

async function main() {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
  const ad = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!ad) throw new Error('No WebGPU adapter.');
  const TS = ad.features.has('timestamp-query');
  const dev = await ad.requestDevice({ requiredFeatures: TS ? ['timestamp-query'] : [], requiredLimits: { maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize, maxBufferSize: ad.limits.maxBufferSize } });
  dev.onuncapturederror = e => console.error('GPU: ' + e.error.message);
  dev.lost.then(i => console.error('device lost: ' + i.message));
  const ctx = cv.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device: dev, format: FMT, alphaMode: 'opaque' });
  const Q_ = dev.queue;
  // uploads via mappedAtCreation: no queue staging memory that the GPU process would have to free later
  const buf = (data, usage) => { const sz = Math.max(16, Math.ceil(data.byteLength / 4) * 4); const b = dev.createBuffer({ size: sz, usage: usage | GU.COPY_DST, mappedAtCreation: true }); new Uint8Array(b.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)); b.unmap(); return b; };
  const mod = code => { const m = dev.createShaderModule({ code }); m.getCompilationInfo().then(i => { for (const x of i.messages) if (x.type === 'error') console.error('WGSL ' + x.lineNum + ':' + x.linePos + ' ' + x.message); }); return m; };

  // ---------- procedural textures ----------
  say('Growing noise…'); await tick();
  const noiseT = dev.createTexture({ size: [128, 128, 128], dimension: '3d', format: 'rgba8unorm', mipLevelCount: 7, usage: TU.STORAGE_BINDING | TU.TEXTURE_BINDING });
  {
    const e = dev.createCommandEncoder(), p = e.beginComputePass();
    const pl = dev.createComputePipeline({ layout: 'auto', compute: { module: mod(S.GEN_NOISE), entryPoint: 'main' } });
    p.setPipeline(pl); p.setBindGroup(0, dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: noiseT.createView({ baseMipLevel: 0, mipLevelCount: 1 }) }] }));
    p.dispatchWorkgroups(32, 32, 32);
    const mp = dev.createComputePipeline({ layout: 'auto', compute: { module: mod(S.GEN_MIP3), entryPoint: 'main' } });
    for (let l = 1; l < 7; l++) {
      const s = 128 >> l; p.setPipeline(mp);
      p.setBindGroup(0, dev.createBindGroup({ layout: mp.getBindGroupLayout(0), entries: [{ binding: 0, resource: noiseT.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }) }, { binding: 1, resource: noiseT.createView({ baseMipLevel: l, mipLevelCount: 1 }) }] }));
      p.dispatchWorkgroups(Math.ceil(s / 4), Math.ceil(s / 4), Math.ceil(s / 4));
    }
    p.end(); Q_.submit([e.finish()]);
  }
  const ATL = 1024, ATM = 7;
  const atlasT = dev.createTexture({ size: [ATL, ATL], format: 'rgba8unorm', mipLevelCount: ATM, usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
  {
    const m = mod(S.GEN_ATLAS), e = dev.createCommandEncoder();
    const p0 = dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs_full' }, fragment: { module: m, entryPoint: 'fs_atlas', targets: [{ format: 'rgba8unorm' }] } });
    let r = e.beginRenderPass({ colorAttachments: [{ view: atlasT.createView({ baseMipLevel: 0, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
    r.setPipeline(p0); r.draw(3); r.end();
    const p1 = dev.createRenderPipeline({ layout: 'auto', vertex: { module: m, entryPoint: 'vs_full' }, fragment: { module: m, entryPoint: 'fs_mip', targets: [{ format: 'rgba8unorm' }] } });
    for (let l = 1; l < ATM; l++) {
      r = e.beginRenderPass({ colorAttachments: [{ view: atlasT.createView({ baseMipLevel: l, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      r.setPipeline(p1); r.setBindGroup(0, dev.createBindGroup({ layout: p1.getBindGroupLayout(0), entries: [{ binding: 0, resource: atlasT.createView({ baseMipLevel: l - 1, mipLevelCount: 1 }) }] }));
      r.draw(3); r.end();
    }
    Q_.submit([e.finish()]);
  }
  const sLin = dev.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat', magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
  const sClamp = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const sCmp = dev.createSampler({ compare: 'less-equal', magFilter: 'linear', minFilter: 'linear' });

  // ---------- world ----------
  say('Raising the land…'); await tick();
  W.buildHeight(); W.buildPath();
  const g = new W.Geo(1 << 21), leaves = new W.Cards(), ground = new W.Cards(), ferns = new W.Inst(), mush = new W.Inst();
  say('Growing ancient trees…'); await tick();
  const logs = W.placeForest(g, leaves);

  // SDF set pieces
  say('Carving stone…'); await tick();
  const objs = W.sdfObjects();
  {
    const maxC = Math.max(...objs.map(o => o.dim[0] * o.dim[1] * o.dim[2]));
    const fb = dev.createBuffer({ size: maxC * 4, usage: GU.STORAGE | GU.COPY_SRC });
    const rbs = [0, 1].map(() => dev.createBuffer({ size: maxC * 4, usage: GU.MAP_READ | GU.COPY_DST }));
    const ub = dev.createBuffer({ size: 256 * objs.length, usage: GU.UNIFORM | GU.COPY_DST });
    const pl = dev.createComputePipeline({ layout: 'auto', compute: { module: mod(S.GEN_SDF), entryPoint: 'main' } });
    const R = rng(4242);
    const launch = (o, i) => {
      const a = new ArrayBuffer(64), f = new Float32Array(a), u = new Uint32Array(a);
      f.set(o.o, 0); u.set(o.dim, 4); f[8] = o.pos[0]; f[9] = o.pos[1]; f[10] = o.pos[2]; f[11] = o.seed; f[12] = o.kind; f[13] = o.vs; f[14] = o.s;
      Q_.writeBuffer(ub, i * 256, a);
      const e = dev.createCommandEncoder(), p = e.beginComputePass();
      p.setPipeline(pl);
      p.setBindGroup(0, dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ub, offset: i * 256, size: 64 } }, { binding: 1, resource: { buffer: fb } }, { binding: 2, resource: noiseT.createView() }, { binding: 3, resource: sLin }] }));
      p.dispatchWorkgroups(Math.ceil(o.dim[0] / 4), Math.ceil(o.dim[1] / 4), Math.ceil(o.dim[2] / 4)); p.end();
      const n = o.dim[0] * o.dim[1] * o.dim[2] * 4, rb = rbs[i & 1];
      e.copyBufferToBuffer(fb, 0, rb, 0, n); Q_.submit([e.finish()]);
      return rb.mapAsync(GPUMapMode.READ, 0, n).then(() => rb);
    };
    let pend = launch(objs[0], 0);
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i], rb = await pend, n = o.dim[0] * o.dim[1] * o.dim[2];
      const F = new Float32Array(rb.getMappedRange(0, n * 4)).slice(); rb.unmap();
      if (i + 1 < objs.length) pend = launch(objs[i + 1], i + 1);
      if (o.kind === 4) W.clearBall(leaves, o.pos[0], o.pos[1] - 3 * o.s, o.pos[2], 7.5 * o.s + 1.5);
      g.begin(); W.surfaceNets(g, F, o.dim[0], o.dim[1], o.dim[2], o.o, o.vs, o, R()); g.end(o.mat);
      if (o.kind === 4) { // vines hanging from floating rocks
        g.begin();
        const nv = 9 + (R() * 6 | 0), c = Math.cos(o.rot), s = Math.sin(o.rot);
        for (let k = 0; k < nv; k++) {
          const a = R() * TAU, rr = (1.5 + R() * 1.6) * o.s, lx = Math.cos(a) * rr, lz = Math.sin(a) * rr, ly = -(1.2 + R() * 1.5) * o.s;
          W.vine(g, leaves, R, [lx * c + lz * s + o.pos[0], ly + o.pos[1], -lx * s + lz * c + o.pos[2]], 3 + R() * 8 * o.s, 0.05, o.bob, R());
        }
        g.end(5);
      }
      if (i % 6 === 0) { say(`Carving stone… ${i + 1}/${objs.length}`); await tick(); }
    }
    // vines draped over the temple arch
    g.begin();
    const ty = W.gh(W.TEMPLE[0], W.TEMPLE[2]);
    for (let k = 0; k < 7; k++) {
      const a = 0.15 + R() * (PI - 0.3), r = 4.1;
      W.vine(g, leaves, R, [W.TEMPLE[0] + Math.cos(a) * r, ty + 7.68 + Math.sin(a) * r, W.TEMPLE[2] + (R() - 0.5) * 1.4], 1.5 + R() * 4.5 * Math.sin(a), 0.03, 0, R());
    }
    for (let k = 0; k < 5; k++) {
      const sx = R() < 0.5 ? -1 : 1, x = sx * (4.6 + R() * 3.5);
      W.vine(g, leaves, R, [W.TEMPLE[0] + x, ty + 0.75 + (sx > 0 ? 4.6 : 2.8) - Math.abs(x) * 0.25, W.TEMPLE[2] + (R() < 0.5 ? -0.55 : 0.55)], 1 + R() * 3, 0.02, 0, R());
    }
    g.end(5);
    fb.destroy(); rbs.forEach(b => b.destroy());
  }
  say('Unfurling ferns…'); await tick();
  W.understorey(leaves, ground, ferns, mush, logs);
  { // set dressing along the mid-route (16–28 s): sun shafts, mushroom rings, flower clumps
    const { NS, path, arc } = W.PATH, L = arc[NS], R = rng(909);
    for (let tt = 15; tt <= 29; tt += 1.6) {
      const d = tt / 60 * L; let i = 0; while (i < NS && arc[i] < d) i++;
      const px = path[i * 3], pz = path[i * 3 + 2], j = Math.min(i + 5, NS), tx = path[j * 3] - px, tz = path[j * 3 + 2] - pz, tl = Math.hypot(tx, tz) || 1;
      const side = (R() < 0.5 ? -1 : 1), off = 5 + R() * 4, cx = px - tz / tl * side * off + tx / tl * 6, cz = pz + tx / tl * side * off + tz / tl * 6;
      const h = R() < 0.5 ? 0.52 + R() * 0.06 : 0.76 + R() * 0.1;
      for (let k = 0; k < 7; k++) { const a = R() * TAU, r = R() * 1.6, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; mush.push(x, W.gh(x, z) - 0.03, z, 0.8 + R() * (k ? 1.6 : 4), R() * TAU, (R() - 0.5) * 0.4, h + (R() - 0.5) * 0.04, R()); }
      for (let k = 0; k < 18; k++) {
        const a = R() * TAU, r = 1.5 + R() * 3.5, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, y = W.gh(x, z), s = 0.35 + R() * 0.3, aa = R() * PI;
        for (let q = 0; q < 2; q++) { const b = aa + q * PI / 2; ground.push(x, y + s * 0.45, z, s, Math.cos(b), 0, Math.sin(b), Math.cos(b) * 0.3, 1, Math.sin(b) * 0.3, 3 | 16, 2, 1, R(), 0.03, 0, R()); }
      }
      if (((tt - 15) / 1.6 | 0) % 2 === 0) W.clearSun(leaves, px, W.gh(px, pz) + 2, pz, 4.5);
    }
  }
  W.clearPath(leaves); W.clearPath(ground); W.clearPathInst(mush, 2.5, 0.35); W.clearPathInst(ferns, 2.0, 0.9);
  W.clearSun(leaves, W.STAG[0], W.gh(W.STAG[0], W.STAG[2]) + 4, W.STAG[2], 6.5); W.clearCyl(leaves, 4, 12, 30, W.gh(0, 16) + 16); W.clearCyl(leaves, W.GLADE[0], W.GLADE[2], 26, W.gh(W.GLADE[0], W.GLADE[2]) + 26); W.clearSun(leaves, W.TEMPLE[0], W.gh(W.TEMPLE[0], W.TEMPLE[2]) + 3, W.TEMPLE[2], 5);
  // move bush/vine cards that went into "ground" to leaves? (bushes are in ground list: split by flag)
  // terrain AO from trees + mesh
  const aoMap = new Float32Array((W.G + 1) ** 2).fill(1);
  for (const t of W.TREES) {
    const rad = t.r * 3, i0 = Math.max(0, Math.floor((t.x - rad + W.WH) / W.CELL)), i1 = Math.min(W.G, Math.ceil((t.x + rad + W.WH) / W.CELL));
    const j0 = Math.max(0, Math.floor((t.z - rad + W.WH) / W.CELL)), j1 = Math.min(W.G, Math.ceil((t.z + rad + W.WH) / W.CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = -W.WH + i * W.CELL - t.x, dz = -W.WH + j * W.CELL - t.z, d = Math.hypot(dx, dz);
      aoMap[j * (W.G + 1) + i] *= 1 - 0.55 * Math.exp(-((d / (t.r * 1.6)) ** 2));
    }
  }
  W.terrainMesh(g, aoMap);
  // canopy openness map (ambient occlusion from foliage above)
  const N1 = W.G + 1, cov = new Float32Array(N1 * N1);
  {
    const lf = new Float32Array(leaves.buf, 0, leaves.n * 8);
    for (let k = 0; k < leaves.n; k++) {
      const x = lf[k * 8], z = lf[k * 8 + 2], s = lf[k * 8 + 3];
      const i = Math.round((x + W.WH) / W.CELL), j = Math.round((z + W.WH) / W.CELL);
      if (i >= 0 && j >= 0 && i <= W.G && j <= W.G) cov[j * N1 + i] += s * s;
    }
    const tmp = new Float32Array(N1 * N1), Rb = 7;
    for (let pass = 0; pass < 2; pass++) {
      const src = pass ? tmp : cov, dst = pass ? cov : tmp;
      for (let j = 0; j < N1; j++) for (let i = 0; i < N1; i++) {
        let s = 0; for (let k = -Rb; k <= Rb; k++) { const ii = pass ? i : clamp(i + k, 0, W.G), jj = pass ? clamp(j + k, 0, W.G) : j; s += src[jj * N1 + ii]; }
        dst[j * N1 + i] = s / (2 * Rb + 1);
      }
    }
  }
  const P1 = [0, 0];
  { // pose 1 (canopy from below): densest canopy spot near the start, away from trunks
    let best = -1, bi = 0, bj = 0;
    for (let j = 0; j <= W.G; j += 2) for (let i = 0; i <= W.G; i += 2) {
      const x = -W.WH + i * W.CELL, z = -W.WH + j * W.CELL;
      if (Math.hypot(x, z - 30) > 70 || W.inClear(x, z, 0.6) || W.FORMS.some(f => Math.hypot(x - f[0], z - f[1]) < 30 * f[3])) continue;
      let near = false; for (const t of W.TREES) if ((t.x - x) ** 2 + (t.z - z) ** 2 < (t.r * 1.5 + 6) ** 2) { near = true; break; }
      if (!near && cov[j * N1 + i] > best) { best = cov[j * N1 + i]; bi = i; bj = j; }
    }
    P1[0] = -W.WH + bi * W.CELL; P1[1] = -W.WH + bj * W.CELL;
    W.clearBall(ground, P1[0], W.gh(P1[0], P1[1]), P1[1], 4); W.clearBall(leaves, P1[0], W.gh(P1[0], P1[1]) + 2, P1[1], 4); W.clearInstBall(ferns, P1[0], P1[1], 5); W.clearInstBall(mush, P1[0], P1[1], 3);
  }
  const hmData = new Float16Array(N1 * N1 * 2);
  for (let k = 0; k < N1 * N1; k++) { hmData[k * 2] = W.HM[k]; hmData[k * 2 + 1] = Math.exp(-cov[k] * 0.55); }
  const hmT = dev.createTexture({ size: [N1, N1], format: 'rg16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  Q_.writeTexture({ texture: hmT }, hmData, { bytesPerRow: N1 * 4 }, [N1, N1]);
  const auxT = dev.createTexture({ size: [W.AUXN, W.AUXN], format: 'rgba16float', usage: TU.TEXTURE_BINDING | TU.COPY_DST });
  Q_.writeTexture({ texture: auxT }, new Float16Array(W.auxMap(mush)), { bytesPerRow: W.AUXN * 8 }, [W.AUXN, W.AUXN]);

  // ---------- templates: fern, mushroom, butterfly, bird ----------
  const tpl = new W.Geo(1 << 14);
  const TPL = {};
  {
    const R = rng(55);
    tpl.begin(); // fern
    for (let k = 0; k < 18; k++) {
      const az = k / 18 * TAU + R() * 0.3, L = 0.75 + R() * 0.3, base = tpl.n, sx = -Math.sin(az), sz = Math.cos(az), dx = Math.cos(az), dz = Math.sin(az);
      let h = 0, y = 0.05, pitch0 = 1.15 + R() * 0.25;
      for (let i = 0; i <= 12; i++) {
        const s = i / 12, ang = pitch0 + (-0.45 - pitch0) * Math.pow(s, 1.25), w = 0.25 * L * Math.pow(Math.sin(PI * Math.min(s * 1.05 + 0.04, 1)), 0.7);
        const nx = -Math.sin(ang) * dx, ny = Math.cos(ang), nz = -Math.sin(ang) * dz;
        for (let e = -1; e <= 1; e++) tpl.v(dx * h + sx * w * e, y + (e === 0 ? 0.015 : -0.01) * L, dz * h + sz * w * e, nx, ny, nz, e, s, 0.5 + 0.5 * s, s * 0.08, 0, 0);
        const st = L / 12; h += Math.cos(ang) * st; y += Math.sin(ang) * st;
      }
      for (let i = 0; i < 12; i++) for (let e = 0; e < 2; e++) { const a = base + i * 3 + e, b = a + 1, c = a + 3, d = c + 1; tpl.t(a, b, d); tpl.t(a, d, c); }
    }
    tpl.end(0); TPL.fern = tpl.draws.pop();
    tpl.begin(); // mushroom: stem part 0, cap 0.5, gills 1 (in attr.w)
    const SG = 24; // mushroom ring segments
    const ring = (rs, ys, nyk, part, vv, aoV) => { const b = tpl.n; for (let j = 0; j <= SG; j++) { const a = j / SG * TAU, c = Math.cos(a), s = Math.sin(a); tpl.v(c * rs, ys, s * rs, c * (1 - Math.abs(nyk)), nyk, s * (1 - Math.abs(nyk)), j / SG, vv, aoV, 0, 0, part); } return b; };
    const strip = (a, b) => { for (let j = 0; j < SG; j++) { tpl.t(a + j, b + j, b + j + 1); tpl.t(a + j, b + j + 1, a + j + 1); } };
    let prev = -1;
    for (let i = 0; i <= 5; i++) { const t = i / 5, r = 0.034 - 0.008 * t + 0.02 * Math.pow(1 - t, 6), y = t * 0.2 - 0.01; const b = ring(r, y, 0.0, 0, t, 0.5 + 0.5 * t); if (prev >= 0) strip(prev, b); prev = b; }
    prev = -1;
    for (let i = 0; i <= 7; i++) { const t = i / 7, th = t * 1.75, r = Math.sin(th) * 0.13, y = 0.19 + Math.cos(th) * 0.11 - (t > 0.85 ? (t - 0.85) * 0.06 : 0); const b = ring(r + 0.0001, y, Math.cos(th), 0.5 / 1, t, 1); if (prev >= 0) strip(b, prev); prev = b; }
    const rim = prev;
    const gb = ring(0.03, 0.185, -1, 1, 1, 0.6); // gills underside
    for (let j = 0; j < SG; j++) { tpl.t(rim + j, gb + j, gb + j + 1); tpl.t(rim + j, gb + j + 1, rim + j + 1); }
    tpl.end(0); TPL.mush = tpl.draws.pop();
    tpl.begin(); // butterfly: wings in xz plane, span along x (uv.x = span, uv.y = chord)
    for (const sgn of [-1, 1]) {
      const b = tpl.n;
      const P = [[0, 0.035], [0.08, 0.05], [0.08, -0.045], [0, -0.04]];
      for (const [x, z] of P) tpl.v(x * sgn, 0, z, 0, 1, 0, x / 0.08, (z + 0.045) / 0.095, 1, 0, 0, 0);
      tpl.t(b, b + 1, b + 2); tpl.t(b, b + 2, b + 3);
    }
    tpl.end(0); TPL.bfly = tpl.draws.pop();
    tpl.begin(); // bird
    {
      const b = tpl.n;
      const pts = [[0, 0, 0.32], [0.07, 0.02, 0.05], [0, -0.04, -0.3], [-0.07, 0.02, 0.05], [0.35, 0, 0.08], [0.35, 0, -0.1], [0.72, 0, -0.2], [-0.35, 0, 0.08], [-0.35, 0, -0.1], [-0.72, 0, -0.2]];
      for (const [x, y, z] of pts) tpl.v(x, y, z, 0, 1, 0, 0, 0, 1, 0, 0, 0);
      tpl.t(b, b + 1, b + 2); tpl.t(b, b + 2, b + 3);
      tpl.t(b + 1, b + 4, b + 5); tpl.t(b + 1, b + 5, b + 2); tpl.t(b + 4, b + 6, b + 5);
      tpl.t(b + 3, b + 7, b + 8); tpl.t(b + 3, b + 8, b + 2); tpl.t(b + 7, b + 9, b + 8);
    }
    tpl.end(0); TPL.bird = tpl.draws.pop();
  }
  // butterflies & birds (static instance data, motion computed in shader)
  const bfl = [], birds = [];
  {
    const R = rng(31);
    const spots = [[3, 48], [-6, 26], [6, 8], [-34, -24], [40, -36], [24, -12], [-14, 40], [50, -50], [-20, -40], [14, 60]];
    for (const [x, z] of spots) for (let k = 0; k < 26; k++) bfl.push(x + (R() - 0.5) * 3, W.gh(x, z), z + (R() - 0.5) * 3, 1.7 + R() * 0.7, R() * 10, 0.6 + R() * 0.5, 0.55 + R() * 0.35, 1.2 + R() * 2.2);
    for (let f = 1; f <= 2; f++) for (let k = 0; k < 30; k++) { const row = Math.floor(Math.sqrt(k)); birds.push((k - row * row - row) * 2.3 + (R() - 0.5) * 1.5, (R() - 0.5) * 2.5, -row * 2.5 + (R() - 0.5) * 1.5, 2.2 + R() * 0.6, R() * 10, f, 0, 0); }
  }

  // ---------- GPU buffers ----------
  say('Uploading…'); await tick();
  // sort solid draws by kind
  g.draws.sort((a, b) => a.kind - b.kind);
  const vb = buf(new Float32Array(g.f.buffer, 0, g.n * 7), GU.VERTEX);
  const ib = buf(new Uint32Array(g.idx.buffer, 0, g.ni), GU.INDEX);
  const tvb = buf(new Float32Array(tpl.f.buffer, 0, tpl.n * 7), GU.VERTEX), tib = buf(new Uint32Array(tpl.idx.buffer, 0, tpl.ni), GU.INDEX);
  const ND = g.draws.length, dF = new Uint32Array(ND), dN = new Uint32Array(ND), dK = new Uint32Array(ND), dS = new Float32Array(ND * 4), dSh = new Uint8Array(ND);
  g.draws.forEach((d, i) => { dF[i] = d.first; dN[i] = d.count; dK[i] = d.kind; dS.set([...d.c, d.r], i * 4); dSh[i] = d.shadow; });
  const mkInst = (u8, n) => { const b = dev.createBuffer({ size: Math.max(32, n * 32), usage: GU.STORAGE | GU.COPY_DST, mappedAtCreation: true }); if (n) new Uint8Array(b.getMappedRange()).set(new Uint8Array(u8.buffer, u8.byteOffset, n * 32)); b.unmap(); return b; };
  const outBuf = n => dev.createBuffer({ size: Math.max(32, n * 32), usage: GU.STORAGE });
  const leafIn = mkInst(leaves.data(), leaves.n), gcIn = mkInst(ground.data(), ground.n);
  const fernIn = mkInst(ferns.data(), ferns.n), mushIn = mkInst(mush.data(), mush.n);
  const bflB = mkInst(new Float32Array(bfl), bfl.length / 8), birdB = mkInst(new Float32Array(birds), birds.length / 8);
  const leafCam = outBuf(leaves.n), leafSh = outBuf(leaves.n), gcCam = outBuf(ground.n), fernCam = outBuf(ferns.n), fernSh = outBuf(ferns.n), mushCam = outBuf(mush.n);
  // indirect args: 8 u32 per slot
  const IND = new Uint32Array(8 * 6);
  const setI = (s, a) => IND.set(a, s * 8);
  setI(0, [6, 0, 0, 0]); setI(1, [6, 0, 0, 0]); setI(2, [6, 0, 0, 0]);
  setI(3, [TPL.fern.count, 0, TPL.fern.first, 0, 0]); setI(4, [TPL.fern.count, 0, TPL.fern.first, 0, 0]); setI(5, [TPL.mush.count, 0, TPL.mush.first, 0, 0]);
  const indB = dev.createBuffer({ size: IND.byteLength, usage: GU.INDIRECT | GU.STORAGE | GU.COPY_DST });
  console.log(`verts ${g.n} tris ${g.ni / 3} draws ${ND} leaves ${leaves.n} ground ${ground.n} ferns ${ferns.n} mush ${mush.n}`);

  // ---------- textures for shadows ----------
  const SH0 = 2048, SH1 = 4096, SR = 38;
  const sh0T = dev.createTexture({ size: [SH0, SH0], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
  const sh1T = dev.createTexture({ size: [SH1, SH1], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
  const dumT = dev.createTexture({ size: [1, 1], format: 'depth32float', usage: TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING });
  const sh0V = sh0T.createView(), sh1V = sh1T.createView(), dumV = dumT.createView();
  { const e = dev.createCommandEncoder(); e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: dumV, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } }).end(); Q_.submit([e.finish()]); }

  // ---------- pipelines ----------
  say('Compiling shaders…'); await tick();
  const sceneM = mod(S.UBO + S.SCENE);
  const VIS = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
  const bgl0 = dev.createBindGroupLayout({ entries: [
    { binding: 0, visibility: VIS, buffer: {} },
    { binding: 1, visibility: VIS, texture: { viewDimension: '3d' } },
    { binding: 2, visibility: VIS, sampler: {} },
    { binding: 3, visibility: VIS, texture: { sampleType: 'depth' } },
    { binding: 4, visibility: VIS, texture: { sampleType: 'depth' } },
    { binding: 5, visibility: VIS, sampler: { type: 'comparison' } },
    { binding: 6, visibility: VIS, texture: {} },
    { binding: 7, visibility: VIS, texture: {} },
    { binding: 8, visibility: VIS, texture: {} },
    { binding: 9, visibility: VIS, sampler: {} }] });
  const bgl1 = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } }] });
  const PL = dev.createPipelineLayout({ bindGroupLayouts: [bgl0, bgl1] });
  const VL = [{ arrayStride: 28, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }, { shaderLocation: 2, offset: 16, format: 'float32x2' }, { shaderLocation: 3, offset: 24, format: 'unorm8x4' }] }];
  const HDR = 'rgba16float', MS = 4;
  const rp = (vs, fs, o = {}) => dev.createRenderPipeline({
    layout: PL,
    vertex: { module: sceneM, entryPoint: vs, buffers: o.vb ? VL : [], constants: o.c },
    fragment: fs ? { module: sceneM, entryPoint: fs, targets: o.sh ? [] : [{ format: HDR, blend: o.blend }], constants: o.c } : undefined,
    primitive: { topology: 'triangle-list', cullMode: o.cull || 'none' },
    depthStencil: o.sh ? { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 3, depthBiasSlopeScale: 2.5 } : { format: 'depth32float', depthWriteEnabled: !o.blend, depthCompare: o.dc || 'greater' },
    multisample: o.sh ? undefined : { count: MS, alphaToCoverageEnabled: !!o.a2c },
  });
  const P_ = {
    solid: [0, 1, 2, 3, 4, 5].map(k => rp('vs_solid', 'fs_solid', { vb: 1, c: { KIND: k }, cull: 'back' })),
    solidSh: rp('vs_solid', null, { vb: 1, sh: 1 }),
    card: rp('vs_card', 'fs_card', { a2c: 1 }),
    cardSh: rp('vs_card', 'fs_card_sh', { sh: 1 }),
    inst: [0, 1, 2, 3].map(k => rp('vs_inst', 'fs_inst', { vb: 1, c: { KIND: k }, a2c: k === 0 || k === 2 })),
    fernSh: rp('vs_inst', 'fs_fern_sh', { vb: 1, c: { KIND: 0 }, sh: 1 }),
    part: rp('vs_part', 'fs_part', { blend: { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } }),
  };
  // sky shouldn't write depth
  P_.sky = dev.createRenderPipeline({ layout: PL, vertex: { module: sceneM, entryPoint: 'vs_full' }, fragment: { module: sceneM, entryPoint: 'fs_sky', targets: [{ format: HDR }] }, depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: MS } });

  // uniforms
  const UF = new Float32Array(96), USF = new Float32Array(96), UFAR = new Float32Array(96);
  const uMain = dev.createBuffer({ size: 384, usage: GU.UNIFORM | GU.COPY_DST }), uSh = dev.createBuffer({ size: 384, usage: GU.UNIFORM | GU.COPY_DST }), uFar = dev.createBuffer({ size: 384, usage: GU.UNIFORM | GU.COPY_DST });
  const bg0 = (ub, s0, s1) => dev.createBindGroup({ layout: bgl0, entries: [
    { binding: 0, resource: { buffer: ub } }, { binding: 1, resource: noiseT.createView() }, { binding: 2, resource: sLin },
    { binding: 3, resource: s0 }, { binding: 4, resource: s1 }, { binding: 5, resource: sCmp }, { binding: 6, resource: atlasT.createView() },
    { binding: 7, resource: hmT.createView() }, { binding: 8, resource: auxT.createView() }, { binding: 9, resource: sClamp }] });
  const BG = { main: bg0(uMain, sh0V, sh1V), sh: bg0(uSh, dumV, dumV), far: bg0(uFar, dumV, dumV) };
  const bg1 = b => dev.createBindGroup({ layout: bgl1, entries: [{ binding: 0, resource: { buffer: b } }] });
  const IB = { leafCam: bg1(leafCam), leafSh: bg1(leafSh), leafIn: bg1(leafIn), gcCam: bg1(gcCam), fernCam: bg1(fernCam), fernSh: bg1(fernSh), fernIn: bg1(fernIn), mushCam: bg1(mushCam), bfl: bg1(bflB), bird: bg1(birdB) };

  // cull
  const cullPL = dev.createComputePipeline({ layout: 'auto', compute: { module: mod(S.CULL), entryPoint: 'main' } });
  const cullU = dev.createBuffer({ size: 256 * 6, usage: GU.UNIFORM | GU.COPY_DST });
  const CUA = new ArrayBuffer(256 * 6), CUF = new Float32Array(CUA), CUU = new Uint32Array(CUA);
  const culls = [ // src, dst, slot, count, view(0 cam, 1 shadow), maxDist, radiusK, radiusAdd
    [leafIn, leafCam, 0, leaves.n, 0, 330, 0.8, 1.5], [leafIn, leafSh, 1, leaves.n, 1, 1e5, 0.8, 1.5], [gcIn, gcCam, 2, ground.n, 0, 60, 1, 0.3],
    [fernIn, fernCam, 3, ferns.n, 0, 92, 1.3, 0.3], [fernIn, fernSh, 4, ferns.n, 1, 1e5, 1.3, 0.3], [mushIn, mushCam, 5, mush.n, 0, 220, 0.35, 0.3]];
  const cullBG2 = culls.map((c, i) => dev.createBindGroup({ layout: cullPL.getBindGroupLayout(0), entries: [
    { binding: 0, resource: { buffer: cullU, offset: i * 256, size: 112 } }, { binding: 1, resource: { buffer: c[0] } }, { binding: 2, resource: { buffer: c[1] } }, { binding: 3, resource: { buffer: indB } }] }));
  culls.forEach((c, i) => { CUU[i * 64 + 20] = c[3]; CUU[i * 64 + 21] = c[2] * 8 + 1; CUF[i * 64 + 19] = c[5]; CUF[i * 64 + 24] = c[6]; CUF[i * 64 + 25] = c[7]; });

  // ---------- light ----------
  const SUN = W.SUN, lf = [-SUN[0], -SUN[1], -SUN[2]];
  const lr = (() => { const x = [lf[2], 0, -lf[0]]; const l = Math.hypot(...x); return x.map(v => v / l); })(); // cross(lf, up) normalized (sign irrelevant)
  const lu = [lr[1] * lf[2] - lr[2] * lf[1], lr[2] * lf[0] - lr[0] * lf[2], lr[0] * lf[1] - lr[1] * lf[0]];
  let zn = 1e9, zf = -1e9, xmn = 1e9, xmx = -1e9, ymn = 1e9, ymx = -1e9;
  for (const x of [-W.WH, W.WH]) for (const y of [-30, 170]) for (const z of [-W.WH, W.WH]) {
    const d = x * lf[0] + y * lf[1] + z * lf[2], a = x * lr[0] + y * lr[1] + z * lr[2], b = x * lu[0] + y * lu[1] + z * lu[2];
    zn = Math.min(zn, d); zf = Math.max(zf, d); xmn = Math.min(xmn, a); xmx = Math.max(xmx, a); ymn = Math.min(ymn, b); ymx = Math.max(ymx, b);
  }
  zn -= 5; zf += 5;
  const ortho = (o, cx, cy, hw) => {
    const dz = zf - zn;
    o[0] = lr[0] / hw; o[4] = lr[1] / hw; o[8] = lr[2] / hw; o[12] = -cx / hw;
    o[1] = lu[0] / hw; o[5] = lu[1] / hw; o[9] = lu[2] / hw; o[13] = -cy / hw;
    o[2] = lf[0] / dz; o[6] = lf[1] / dz; o[10] = lf[2] / dz; o[14] = -zn / dz;
    o[3] = 0; o[7] = 0; o[11] = 0; o[15] = 1;
  };
  const L1 = new Float32Array(16), L0 = new Float32Array(16);
  ortho(L1, (xmn + xmx) / 2, (ymn + ymx) / 2, Math.max(xmx - xmn, ymx - ymn) / 2);
  const SUNC = [3.3, 2.55, 1.7];

  // ---------- far shadow (static, rendered once, no wind) ----------
  {
    UFAR.set(L1, 0); UFAR.set(L1, 48); UFAR[68] = SUN[0]; UFAR[69] = SUN[1]; UFAR[70] = SUN[2]; UFAR[71] = 0;
    Q_.writeBuffer(uFar, 0, UFAR);
    const e = dev.createCommandEncoder();
    const p = e.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: sh1V, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    p.setBindGroup(0, BG.far); p.setBindGroup(1, IB.leafIn);
    p.setPipeline(P_.solidSh); p.setVertexBuffer(0, vb); p.setIndexBuffer(ib, 'uint32');
    for (let i = 0; i < ND; i++) if (dSh[i]) p.drawIndexed(dN[i], 1, dF[i]);
    p.setPipeline(P_.cardSh); p.draw(6, leaves.n);
    p.setPipeline(P_.fernSh); p.setBindGroup(1, IB.fernIn); p.setVertexBuffer(0, tvb); p.setIndexBuffer(tib, 'uint32'); p.drawIndexed(TPL.fern.count, ferns.n, TPL.fern.first);
    p.end(); Q_.submit([e.finish()]);
  }

  // ---------- post pipelines (compute) ----------
  const postM = mod(S.UBO + S.POST), blurM = mod(S.BLUR), bloomM = mod(S.BLOOM), compM = mod(S.COMP);
  const cpl = (m, ep, c) => dev.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: ep, constants: c } });
  const PP = {
    vol: cpl(postM, 'main'), bh: cpl(blurM, 'main', { DX: 1, DY: 0 }), bv: cpl(blurM, 'main', { DX: 0, DY: 1 }),
    d0: cpl(bloomM, 'down', { FIRST: 1 }), dn: cpl(bloomM, 'down', { FIRST: 0 }), up: cpl(bloomM, 'up'),
    comp: dev.createRenderPipeline({ layout: 'auto', vertex: { module: compM, entryPoint: 'vs_full' }, fragment: { module: compM, entryPoint: 'fs_comp', targets: [{ format: FMT }] } }),
  };
  const ppU = dev.createBuffer({ size: 16, usage: GU.UNIFORM | GU.COPY_DST }), PPF = new Float32Array(4);

  // ---------- timestamps (logged on the GPU; no per-frame readback) ----------
  const MAXF = 40000;
  let qs, tsRes, tsLog, tsU, tsPL, tsBG; const TSU = new Uint32Array(4);
  if (TS) {
    qs = dev.createQuerySet({ type: 'timestamp', count: 8 });
    tsRes = dev.createBuffer({ size: 64, usage: GU.QUERY_RESOLVE | GU.STORAGE });
    tsLog = dev.createBuffer({ size: MAXF * 20, usage: GU.STORAGE | GU.COPY_SRC });
    tsU = dev.createBuffer({ size: 16, usage: GU.UNIFORM | GU.COPY_DST });
    tsPL = dev.createComputePipeline({ layout: 'auto', compute: { module: mod(S.TSLOG), entryPoint: 'main' } });
    tsBG = dev.createBindGroup({ layout: tsPL.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: tsRes } }, { binding: 1, resource: { buffer: tsLog } }, { binding: 2, resource: { buffer: tsU } }] });
  }
  const tw = (b, e) => TS ? { querySet: qs, beginningOfPassWriteIndex: b, endOfPassWriteIndex: e } : undefined;

  // ---------- size-dependent targets ----------
  let T = null;
  const mainCA = { view: null, resolveTarget: null, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'discard' };
  const mainDA = { view: null, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' };
  const D = {
    cull: { timestampWrites: tw(0, 1) },
    sh: { colorAttachments: [], depthStencilAttachment: { view: sh0V, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' }, timestampWrites: tw(2, 3) },
    main: { colorAttachments: [mainCA], depthStencilAttachment: mainDA, timestampWrites: tw(4, 5) },
    post: { timestampWrites: TS ? { querySet: qs, beginningOfPassWriteIndex: 6 } : undefined },
    comp: { colorAttachments: [{ view: null, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }], timestampWrites: TS ? { querySet: qs, endOfPassWriteIndex: 7 } : undefined },
  };
  const WG = new Uint32Array(64); // dispatch sizes per post step
  function targets(w, h) {
    if (T) for (const k in T) if (T[k].destroy) T[k].destroy(); else if (Array.isArray(T[k])) T[k].forEach(x => x.destroy && x.destroy());
    const ST = TU.STORAGE_BINDING | TU.TEXTURE_BINDING;
    const tex = (W_, H_, f, u, s = 1) => dev.createTexture({ size: [W_, H_], format: f, usage: u, sampleCount: s });
    const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
    T = {
      msC: tex(w, h, HDR, TU.RENDER_ATTACHMENT, MS), msD: tex(w, h, 'depth32float', TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, MS),
      sc: tex(w, h, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING), vA: tex(hw, hh, HDR, ST), vB: tex(hw, hh, HDR, ST),
    };
    const bs = i => [Math.max(1, w >> (i + 1)), Math.max(1, h >> (i + 1))];
    T.b = [0, 1, 2, 3, 4, 5].map(i => tex(...bs(i), HDR, ST));
    T.u = [0, 1, 2, 3, 4].map(i => tex(...bs(i), HDR, ST));
    mainCA.view = T.msC.createView(); mainCA.resolveTarget = T.sc.createView(); mainDA.view = T.msD.createView();
    const bV = T.b.map(t => t.createView()), uV = T.u.map(t => t.createView());
    const bg = (pl, ent) => dev.createBindGroup({ layout: pl.getBindGroupLayout(0), entries: ent.map((r, i) => ({ binding: i, resource: r })) });
    // steps: [pipeline, bindgroup, w, h]
    T.steps = [
      [PP.vol, bg(PP.vol, [{ buffer: uMain }, T.msD.createView(), sh0V, sh1V, sCmp, T.vA.createView()]), hw, hh],
      [PP.bh, bg(PP.bh, [T.vA.createView(), T.vB.createView()]), hw, hh],
      [PP.bv, bg(PP.bv, [T.vB.createView(), T.vA.createView()]), hw, hh],
      [PP.d0, bg(PP.d0, [T.sc.createView(), sClamp, bV[0]]), ...bs(0)],
      ...[1, 2, 3, 4, 5].map(i => [PP.dn, bg(PP.dn, [bV[i - 1], sClamp, bV[i]]), ...bs(i)]),
      ...[4, 3, 2, 1, 0].map(i => [PP.up, bg(PP.up, [i === 4 ? bV[5] : uV[i + 1], sClamp, uV[i], bV[i]]), ...bs(i)]),
    ];
    T.steps.forEach((s, i) => { WG[i * 2] = Math.ceil(s[2] / 8); WG[i * 2 + 1] = Math.ceil(s[3] / 8); });
    T.comp = bg(PP.comp, [T.sc.createView(), T.vA.createView(), uV[0], sClamp, { buffer: ppU }]);
    T.w = w; T.h = h;
  }

  // ---------- camera ----------
  const cam = new Float64Array(8); // x y z yaw pitch
  const start = W.START; cam[0] = start[0]; cam[2] = start[2]; cam[1] = W.gh(start[0], start[2]) + 2.6; cam[3] = 0; cam[4] = 0.05;
  const POSES = [
    [0, 2.4, 66, 0.0, 0.07], [4, 1.6, 40, 0.5, 1.05], [-54.4, 3, -35.8, -1.95, 0.22], [26, 7, -20, -0.8, 0.22], [6, 1.8, 31, 0.4, 0.12], [5, 1.8, 56, -0.73, 0.18],
  ];
  POSES[1] = [P1[0], 1.7, P1[1], 0.4, 1.32];
  if (Q.has('cp')) { const p = Q.get('cp').split(',').map(Number); POSES.push(p); }
  if (POSE >= 0) { const p = POSES[POSE]; cam[0] = p[0]; cam[2] = p[2]; cam[1] = W.gh(p[0], p[2]) + p[1]; cam[3] = p[3]; cam[4] = p[4]; }
  // fly-through path (x, z, height above ground) → arc-length parameterised Catmull-Rom
  const FP = W.FP;
  const { NS, path, arc } = W.PATH;
  const pathAt = (d, o, oi) => { // d = distance along path
    const L = arc[NS]; d = ((d % L) + L) % L;
    let lo = 0, hi = NS; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arc[m] <= d) lo = m; else hi = m; }
    const t = (d - arc[lo]) / (arc[hi] - arc[lo] || 1);
    for (let k = 0; k < 3; k++) o[oi + k] = path[lo * 3 + k] + (path[hi * 3 + k] - path[lo * 3 + k]) * t;
  };
  const FLYT = 60, tmp = new Float32Array(9), TEMPLE_Y = W.gh(W.TEMPLE[0], W.TEMPLE[2]);

  // input
  const keys = new Uint8Array(8); // w a s d q e shift
  const KM = { KeyW: 0, KeyA: 1, KeyS: 2, KeyD: 3, KeyQ: 4, KeyE: 5, ShiftLeft: 6, ShiftRight: 6, ArrowUp: 0, ArrowLeft: 1, ArrowDown: 2, ArrowRight: 3 };
  addEventListener('keydown', e => { const k = KM[e.code]; if (k !== undefined) { keys[k] = 1; e.preventDefault(); } });
  addEventListener('keyup', e => { const k = KM[e.code]; if (k !== undefined) keys[k] = 0; });
  addEventListener('blur', () => keys.fill(0));
  cv.addEventListener('click', () => { if (!FLY && POSE < 0) cv.requestPointerLock(); });
  addEventListener('mousemove', e => { if (document.pointerLockElement === cv) { cam[3] -= e.movementX * 0.0022; cam[4] = clamp(cam[4] - e.movementY * 0.0022, -1.5, 1.5); } });
  document.addEventListener('pointerlockchange', () => { hint.style.opacity = document.pointerLockElement ? 0 : 1; });
  const hint = document.getElementById('h');
  if (FLY || POSE >= 0 || MANUAL) hint.style.display = 'none';

  // ---------- frame ----------
  const V = new Float32Array(16), P = new Float32Array(16), VP = new Float32Array(16), IVP = new Float32Array(16);
  const fw = new Float32Array(3), rt = new Float32Array(3), up = new Float32Array(3), PLN = new Float32Array(16), SPL = new Float32Array(16);
  const sub = [null], dyn = new Uint32Array(1);
  let t0 = -1, last = 0, frameN = 0, perfFrame = 0, perfStart = -1, perfDone = false;
  const cpuLog = new Float64Array(MAXF);
  const FOV = 1.05;
  function size() {
    let w, h;
    if (RES) { w = RESW; h = RESH; } else { const d = Math.min(devicePixelRatio || 1, 2); w = Math.round(cv.clientWidth * d); h = Math.round(cv.clientHeight * d); }
    if (cv.width !== w || cv.height !== h || !T) { cv.width = w; cv.height = h; targets(w, h); }
  }
  function planes(o, m) {
    for (let p = 0; p < 4; p++) {
      const r = p >> 1, s = (p & 1) ? -1 : 1;
      const a = m[3] + s * m[r], b = m[7] + s * m[4 + r], c = m[11] + s * m[8 + r], d = m[15] + s * m[12 + r];
      const l = Math.sqrt(a * a + b * b + c * c); o[p * 4] = a / l; o[p * 4 + 1] = b / l; o[p * 4 + 2] = c / l; o[p * 4 + 3] = d / l;
    }
  }
  const visible = (i, pl) => { const x = dS[i * 4], y = dS[i * 4 + 1], z = dS[i * 4 + 2], r = dS[i * 4 + 3]; for (let p = 0; p < 4; p++) if (pl[p * 4] * x + pl[p * 4 + 1] * y + pl[p * 4 + 2] * z + pl[p * 4 + 3] < -r) return false; return true; };

  function update(t, dt) {
    if (FLY) {
      const L = arc[NS], d = ((t + FLYOFF) / FLYT) * L;
      pathAt(d, tmp, 0); pathAt(d + 7, tmp, 3); pathAt(d + 14, tmp, 6);
      cam[0] = tmp[0]; cam[1] = tmp[1]; cam[2] = tmp[2];
      let lx = (tmp[3] + tmp[6]) * 0.5 - tmp[0], ly = (tmp[4] + tmp[7]) * 0.5 - tmp[1], lz = (tmp[5] + tmp[8]) * 0.5 - tmp[2];
      // ending shot: turn back toward the sunlit temple (also matches the loop's start view)
      const te = ((t + FLYOFF) % FLYT + FLYT) % FLYT, bw = smooth(50.5, 58.5, te);
      if (bw > 0) { const ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1, tx = W.TEMPLE[0] - cam[0], ty = TEMPLE_Y + 4 - cam[1], tz = W.TEMPLE[2] - cam[2], tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
        lx = lx / ll * (1 - bw) + tx / tl * bw; ly = ly / ll * (1 - bw) + ty / tl * bw; lz = lz / ll * (1 - bw) + tz / tl * bw; }
      cam[3] = Math.atan2(-lx, -lz); cam[4] = Math.atan2(ly, Math.sqrt(lx * lx + lz * lz)) * 0.7 + 0.04;
    } else if (POSE < 0) {
      const sp = (keys[6] ? 30 : 7) * dt, cy = Math.cos(cam[3]), sy = Math.sin(cam[3]), cp = Math.cos(cam[4]), spp = Math.sin(cam[4]);
      const f = keys[0] - keys[2], s = keys[3] - keys[1], v = keys[5] - keys[4];
      cam[0] += (-sy * cp * f + cy * s) * sp; cam[2] += (-cy * cp * f - sy * s) * sp; cam[1] += (spp * f + v) * sp;
      const r = Math.sqrt(cam[0] * cam[0] + cam[2] * cam[2] * 1.21); if (r > 205) { cam[0] *= 205 / r; cam[2] *= 205 / r; }
      cam[1] = clamp(cam[1], W.gh(cam[0], cam[2]) + 0.6, 150);
    }
  }

  function frame(now) {
    if (!MANUAL && !HZ) requestAnimationFrame(frame);
    if (t0 < 0) { t0 = now; last = now; }
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    let t = TFIX >= 0 ? TFIX : (now - t0) / 1000;
    if (PERF) {
      if (perfStart < 0 && now - t0 > 3000) perfStart = now;
      t = perfStart < 0 ? 0 : (now - perfStart) / 1000;
      if (perfStart >= 0 && !perfDone) { if (t >= FLYT) { perfDone = true; finishPerf(); } else if (perfFrame < MAXF) { cpuLog[perfFrame] = dt * 1000; } }
    }
    if (MANUAL) t = manualT;
    render(t, dt);
  }
  let manualT = 0;
  function render(t, dt) {
    size();
    update(t, dt);
    const w = T.w, h = T.h;
    const cy = Math.cos(cam[3]), sy = Math.sin(cam[3]), cp = Math.cos(cam[4]), sp = Math.sin(cam[4]);
    fw[0] = -sy * cp; fw[1] = sp; fw[2] = -cy * cp; rt[0] = cy; rt[1] = 0; rt[2] = -sy;
    up[0] = rt[1] * fw[2] - rt[2] * fw[1]; up[1] = rt[2] * fw[0] - rt[0] * fw[2]; up[2] = rt[0] * fw[1] - rt[1] * fw[0];
    viewM(V, cam[0], cam[1], cam[2], rt, up, fw); persp(P, FOV, w / h, 0.08); mul4(VP, P, V); inv4(IVP, VP);
    planes(PLN, VP);
    // near shadow cascade around the camera, texel snapped
    const hl = Math.sqrt(fw[0] * fw[0] + fw[2] * fw[2]) || 1, ccx = cam[0] + fw[0] / hl * SR * 0.55, ccz = cam[2] + fw[2] / hl * SR * 0.55, ccy = cam[1];
    const tx = 2 * SR / SH0;
    const cx = Math.round((ccx * lr[0] + ccy * lr[1] + ccz * lr[2]) / tx) * tx, cyy = Math.round((ccx * lu[0] + ccy * lu[1] + ccz * lu[2]) / tx) * tx;
    ortho(L0, cx, cyy, SR);
    SPL[0] = lr[0]; SPL[1] = lr[1]; SPL[2] = lr[2]; SPL[3] = -(cx - SR); SPL[4] = -lr[0]; SPL[5] = -lr[1]; SPL[6] = -lr[2]; SPL[7] = cx + SR;
    SPL[8] = lu[0]; SPL[9] = lu[1]; SPL[10] = lu[2]; SPL[11] = -(cyy - SR); SPL[12] = -lu[0]; SPL[13] = -lu[1]; SPL[14] = -lu[2]; SPL[15] = cyy + SR;
    UF.set(VP, 0); UF.set(IVP, 16); UF.set(L0, 32); UF.set(L1, 48);
    UF[64] = cam[0]; UF[65] = cam[1]; UF[66] = cam[2]; UF[67] = t;
    UF[68] = SUN[0]; UF[69] = SUN[1]; UF[70] = SUN[2]; UF[71] = 1;
    UF[72] = SUNC[0]; UF[73] = SUNC[1]; UF[74] = SUNC[2];
    UF[76] = w; UF[77] = h; UF[78] = 1 / w; UF[79] = 1 / h;
    UF[80] = rt[0]; UF[81] = rt[1]; UF[82] = rt[2]; UF[84] = up[0]; UF[85] = up[1]; UF[86] = up[2]; UF[88] = fw[0]; UF[89] = fw[1]; UF[90] = fw[2];
    UF[92] = 0; UF[93] = frameN; UF[94] = h * 0.5 / Math.tan(FOV / 2);
    USF.set(UF); USF.set(L0, 0);
    Q_.writeBuffer(uMain, 0, UF); Q_.writeBuffer(uSh, 0, USF);
    for (let i = 0; i < 6; i++) {
      const o = i * 64, pl = culls[i][4] ? SPL : PLN;
      for (let k = 0; k < 16; k++) CUF[o + k] = pl[k];
      CUF[o + 16] = cam[0]; CUF[o + 17] = cam[1]; CUF[o + 18] = cam[2];
    }
    Q_.writeBuffer(cullU, 0, CUA); Q_.writeBuffer(indB, 0, IND);
    PPF[0] = 1.15; PPF[1] = (frameN % 64) * 0.731; Q_.writeBuffer(ppU, 0, PPF);
    if (TS) { TSU[0] = perfStart >= 0 && !perfDone && perfFrame > 0 ? perfFrame - 1 : MAXF + 1; TSU[1] = MAXF; Q_.writeBuffer(tsU, 0, TSU); }

    const e = dev.createCommandEncoder();
    // cull
    const c = e.beginComputePass(D.cull);
    if (TS) { c.setPipeline(tsPL); c.setBindGroup(0, tsBG); c.dispatchWorkgroups(1); }
    c.setPipeline(cullPL);
    for (let i = 0; i < 6; i++) { if (!culls[i][3]) continue; c.setBindGroup(0, cullBG2[i]); c.dispatchWorkgroups(Math.ceil(culls[i][3] / 64)); }
    c.end();
    // near shadow
    let p = e.beginRenderPass(D.sh);
    p.setBindGroup(0, BG.sh); p.setBindGroup(1, IB.leafSh); p.setPipeline(P_.solidSh); p.setVertexBuffer(0, vb); p.setIndexBuffer(ib, 'uint32');
    for (let i = 0; i < ND; i++) if (dSh[i] && visible(i, SPL)) p.drawIndexed(dN[i], 1, dF[i]);
    p.setPipeline(P_.cardSh); p.setBindGroup(1, IB.leafSh); p.drawIndirect(indB, 1 * 32);
    p.setPipeline(P_.fernSh); p.setBindGroup(1, IB.fernSh); p.setVertexBuffer(0, tvb); p.setIndexBuffer(tib, 'uint32'); p.drawIndexedIndirect(indB, 4 * 32);
    p.end();
    // main
    p = e.beginRenderPass(D.main);
    p.setBindGroup(0, BG.main); p.setBindGroup(1, IB.leafCam); p.setVertexBuffer(0, vb); p.setIndexBuffer(ib, 'uint32');
    let kind = -1;
    for (let i = 0; i < ND; i++) {
      const dx = dS[i * 4] - cam[0], dz = dS[i * 4 + 2] - cam[2];
      if (frameN > 3 && (!visible(i, PLN) || dx * dx + dz * dz > (340 + dS[i * 4 + 3]) ** 2)) continue; // first frames draw everything: warms every pipeline
      if (dK[i] !== kind) { kind = dK[i]; p.setPipeline(P_.solid[kind]); }
      p.drawIndexed(dN[i], 1, dF[i]);
    }
    p.setVertexBuffer(0, tvb); p.setIndexBuffer(tib, 'uint32');
    if (!SKIP.includes('m')) { p.setPipeline(P_.inst[1]); p.setBindGroup(1, IB.mushCam); p.drawIndexedIndirect(indB, 5 * 32); }
    if (!SKIP.includes('f')) { p.setPipeline(P_.inst[0]); p.setBindGroup(1, IB.fernCam); p.drawIndexedIndirect(indB, 3 * 32); }
    p.setPipeline(P_.card); p.setBindGroup(1, IB.leafCam); p.drawIndirect(indB, 0);
    p.setBindGroup(1, IB.gcCam); p.drawIndirect(indB, 2 * 32);
    p.setPipeline(P_.inst[2]); p.setBindGroup(1, IB.bfl); p.drawIndexed(TPL.bfly.count, bfl.length / 8, TPL.bfly.first);
    p.setPipeline(P_.inst[3]); p.setBindGroup(1, IB.bird); p.drawIndexed(TPL.bird.count, birds.length / 8, TPL.bird.first);
    p.setPipeline(P_.sky); p.draw(3);
    p.setPipeline(P_.part); p.draw(6, 1300 + 3200 + 1500 + 90 * 24);
    p.end();
    // post: volumetric light, bilateral blur, bloom — one compute pass
    const pc = e.beginComputePass(D.post);
    for (let i = 0; i < T.steps.length; i++) { const s = T.steps[i]; pc.setPipeline(s[0]); pc.setBindGroup(0, s[1]); pc.dispatchWorkgroups(WG[i * 2], WG[i * 2 + 1]); }
    pc.end();
    D.comp.colorAttachments[0].view = ctx.getCurrentTexture().createView();
    p = e.beginRenderPass(D.comp); p.setPipeline(PP.comp); p.setBindGroup(0, T.comp); p.draw(3); p.end();
    if (TS) e.resolveQuerySet(qs, 0, 8, tsRes, 0);
    sub[0] = e.finish(); Q_.submit(sub);
    frameN++; if (perfStart >= 0 && !perfDone) perfFrame++;
  }
  async function finishPerf() {
    const n = Math.min(perfFrame, MAXF);
    const out = { frames: n, adapter: ad.info.description || ad.info.vendor, res: [T.w, T.h], ts: TS };
    const cpu = Array.from(cpuLog.subarray(1, n));
    if (TS) {
      const rb = dev.createBuffer({ size: n * 20, usage: GU.MAP_READ | GU.COPY_DST });
      const e = dev.createCommandEncoder(); e.copyBufferToBuffer(tsLog, 0, rb, 0, n * 20); Q_.submit([e.finish()]);
      await rb.mapAsync(GPUMapMode.READ); const a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap();
      out.gpu = { cull: [], shadow: [], main: [], post: [], total: [] };
      for (let i = 0; i < n; i++) { out.gpu.cull.push(a[i * 5]); out.gpu.shadow.push(a[i * 5 + 1]); out.gpu.main.push(a[i * 5 + 2]); out.gpu.post.push(a[i * 5 + 3]); out.gpu.total.push(a[i * 5 + 4]); }
    }
    out.cpu = cpu;
    window.__perf = out;
    console.log('perf done ' + n + ' frames');
  }
  size();
  say('');
  window.__frames = () => frameN;
  window.__setT = (tt) => { manualT = tt; };
  window.__renderAt = async (tt) => { manualT = tt; frame(performance.now()); await Q_.onSubmittedWorkDone(); return frameN; };
  window.__cam = () => Array.from(cam.subarray(0, 5));
  if (HZ) { // test mode: fixed-rate pacing (e.g. ?hz=180) from a timed task loop, emulating a fixed-refresh display with idle gaps
    let next = performance.now();
    const tickHz = () => { const n = performance.now(); frame(n); next += 1000 / HZ; if (next < n) next = n; scheduler.postTask(tickHz, { delay: Math.max(0, next - performance.now()) }); };
    tickHz();
  } else if (!MANUAL) requestAnimationFrame(frame);
  else { frame(performance.now()); }
  await Q_.onSubmittedWorkDone();
  window.__ready = true;
}
main().catch(e => { console.error(e.stack || e.message); say('Error: ' + e.message); });
