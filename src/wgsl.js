// All WGSL. Tagged with /*wgsl*/ so the build can strip comments/whitespace.
export const UBO = /*wgsl*/`
struct U { vp: mat4x4f, ivp: mat4x4f, l0: mat4x4f, l1: mat4x4f, cam: vec4f, sun: vec4f, sunc: vec4f, res: vec4f, right: vec4f, up: vec4f, fwd: vec4f, misc: vec4f }
const PI = 3.14159265;
const WH = 240.0;
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn h01(v: u32) -> f32 { return f32(pcg(v) >> 8u) / 16777216.0; }
fn hsv(h: f32, s: f32, v: f32) -> vec3f { let k = clamp(abs(fract(h + vec3f(1.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0)); return v * mix(vec3f(1.0), k, s); }
const FC = 0.0036; const FA = 0.0095; const FH = 10.0; const FY = 0.0;
fn rimS(p: vec3f) -> f32 { return 0.06 * smoothstep(95.0, 150.0, length(p.xz * vec2f(1.0, 1.1))); }
fn fogSig(p: vec3f) -> f32 { return FC + FA * exp(-(p.y - FY) / FH) + rimS(p); }
fn fogOD(ro: vec3f, p: vec3f) -> f32 {
  let d = distance(ro, p); let k = (p.y - ro.y) / FH;
  let f = select((1.0 - exp(-k)) / k, 1.0 - k * 0.5, abs(k) < 0.01);
  return FC * d + FA * exp(-(ro.y - FY) / FH) * d * f + 0.06 * max(length(p.xz * vec2f(1.0, 1.1)) - max(length(ro.xz * vec2f(1.0, 1.1)), 98.0), 0.0);
}
fn fogCol(rd: vec3f) -> vec3f {
  let m = max(dot(rd, u.sun.xyz), 0.0);
  return mix(vec3f(0.018, 0.022, 0.085), vec3f(0.036, 0.040, 0.120), clamp(rd.y * 2.0 + 0.5, 0.0, 1.0)) + vec3f(0.40, 0.26, 0.10) * pow(m, 6.0) * 0.28;
}
fn applyFog(c: vec3f, P: vec3f) -> vec3f {
  let T = exp(-fogOD(u.cam.xyz, P));
  return c * T + fogCol(normalize(P - u.cam.xyz)) * (1.0 - T);
}
fn shadow(P: vec3f, soft: bool) -> f32 {
  let c1 = (u.l1 * vec4f(P, 1.0)).xyz;
  let s1 = textureSampleCompareLevel(tS1, sC, c1.xy * vec2f(0.5, -0.5) + 0.5, c1.z);
  let c0 = (u.l0 * vec4f(P, 1.0)).xyz;
  let e = max(abs(c0.x), abs(c0.y));
  if (e >= 0.98 || c0.z > 1.0) { return s1; }
  let uv = c0.xy * vec2f(0.5, -0.5) + 0.5;
  var s0 = textureSampleCompareLevel(tS0, sC, uv, c0.z);
  if (soft) {
    let o = 2.3 / 2048.0;
    s0 = s0 * 0.36 + (textureSampleCompareLevel(tS0, sC, uv + vec2f(o, o * 0.3), c0.z) + textureSampleCompareLevel(tS0, sC, uv + vec2f(-o * 0.3, o), c0.z)
      + textureSampleCompareLevel(tS0, sC, uv + vec2f(-o, -o * 0.3), c0.z) + textureSampleCompareLevel(tS0, sC, uv + vec2f(o * 0.3, -o), c0.z)) * 0.16;
  }
  return mix(s0, s1, smoothstep(0.8, 0.98, e));
}
`;

export const SCENE = /*wgsl*/`
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tN: texture_3d<f32>;
@group(0) @binding(2) var sL: sampler;
@group(0) @binding(3) var tS0: texture_depth_2d;
@group(0) @binding(4) var tS1: texture_depth_2d;
@group(0) @binding(5) var sC: sampler_comparison;
@group(0) @binding(6) var tA: texture_2d<f32>;
@group(0) @binding(7) var tH: texture_2d<f32>;
@group(0) @binding(8) var tX: texture_2d<f32>;
@group(0) @binding(9) var sK: sampler;
@group(1) @binding(0) var<storage, read> inst: array<vec4f>;
override KIND: u32 = 0u;

fn nzl(p: vec3f) -> vec4f { return textureSampleLevel(tN, sL, p, 0.0); }
fn nzg(p: vec3f, dx: vec3f, dy: vec3f) -> vec4f { return textureSampleGrad(tN, sL, p, dx, dy); }
fn hmap(xz: vec2f) -> vec2f { return textureSampleLevel(tH, sK, (xz + WH) / (2.0 * WH) * (512.0 / 513.0) + 0.5 / 513.0, 0.0).rg; }
fn aux(xz: vec2f) -> vec4f { return textureSampleLevel(tX, sK, (xz + WH) / (2.0 * WH), 0.0); }
fn wind(p: vec3f, w: f32, ph: f32) -> vec3f {
  let t = u.cam.w;
  let g = 0.6 + 0.4 * sin(t * 0.31 + p.x * 0.011 + p.z * 0.007);
  let a = sin(t * 0.83 + ph * 6.283 + p.x * 0.045) * g;
  let b = sin(t * 1.37 + ph * 4.1 + p.z * 0.05) * g;
  return vec3f(a * 0.7 + 0.35 * g, (a - b) * 0.08, b * 0.5 + a * 0.25) * w * u.sun.w * 1.7;
}
fn bobY(id: f32) -> f32 { return select(0.0, sin(u.cam.w * 0.32 + id * 0.71) * 0.55 + sin(u.cam.w * 0.53 + id) * 0.2, id > 0.5); }
fn octd(v: u32) -> vec3f {
  let e = vec2f(f32(i32(v << 16u) >> 16u), f32(i32(v) >> 16u)) / 32767.0;
  var n = vec3f(e.x, 1.0 - abs(e.x) - abs(e.y), e.y);
  if (n.y < 0.0) { let t = n.xz; n = vec3f((1.0 - abs(t.y)) * select(-1.0, 1.0, t.x >= 0.0), n.y, (1.0 - abs(t.x)) * select(-1.0, 1.0, t.y >= 0.0)); }
  return normalize(n);
}
fn bump(N: vec3f, dx: vec3f, dy: vec3f, h: f32, k: f32) -> vec3f {
  let hx = dpdx(h); let hy = dpdy(h);
  let r1 = cross(dy, N); let r2 = cross(N, dx); let det = dot(dx, r1);
  let g = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * N - k * g);
}
fn ambient(N: vec3f, hag: f32, open: f32) -> vec3f {
  let a = mix(vec3f(0.09, 0.095, 0.10), vec3f(0.24, 0.27, 0.46), N.y * 0.5 + 0.5);
  return a * mix(0.55, 1.0, open) * (0.8 + 0.2 * smoothstep(0.0, 30.0, hag));
}
fn lit(alb: vec3f, N: vec3f, V: vec3f, P: vec3f, ao: f32, sh: f32, specK: f32, specP: f32, hag: f32, open: f32) -> vec3f {
  let L = u.sun.xyz;
  let ndl = max(dot(N, L), 0.0);
  let H = normalize(L + V);
  let sp = pow(max(dot(N, H), 0.0), specP) * specK * ndl * sh * (specP + 8.0) / 25.0;
  return alb * (u.sunc.rgb * ndl * sh + ambient(N, hag, open) * ao) + u.sunc.rgb * sp;
}

// ---------------- solids ----------------
struct SO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) a: vec4f }
@vertex fn vs_solid(@location(0) p: vec3f, @location(1) n: vec4f, @location(2) uv: vec2f, @location(3) a: vec4f) -> SO {
  var o: SO;
  var wp = p + wind(p, a.y * 4.0, a.w);
  wp.y += bobY(a.z * 255.0);
  o.pos = u.vp * vec4f(wp, 1.0); o.wp = wp; o.n = n.xyz; o.uv = uv; o.a = a;
  return o;
}
fn mossCol(n: f32, m: f32) -> vec3f { return mix(vec3f(0.032, 0.062, 0.018), vec3f(0.095, 0.12, 0.03), n) * (0.75 + 0.5 * m); }
@fragment fn fs_solid(i: SO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let P = i.wp; let cam = u.cam.xyz; let V = normalize(cam - P); let dist = distance(cam, P);
  var N = normalize(i.n); if (!ff) { N = -N; }
  let dx = dpdx(P); let dy = dpdy(P);
  let hm = hmap(P.xz); let hag = P.y - hm.x; let open = hm.y;
  var alb = vec3f(0.1); var ao = i.a.x; var em = vec3f(0.0); var spk = 0.03; var spp = 16.0; var fuzz = 0.0; var hh = 0.0; var bk = 0.0;
  let L = u.sun.xyz;
  if (KIND == 0u) { // ground
    let n1 = nzg(P * 0.05, dx * 0.05, dy * 0.05); let n2 = nzg(P * 0.4, dx * 0.4, dy * 0.4); let n3 = nzg(P * 1.9, dx * 1.9, dy * 1.9);
    let ax = aux(P.xz);
    let slope = 1.0 - N.y;
    var c = mossCol(n2.r, n3.g) * 0.8;
    let litter = smoothstep(0.42, 0.62, n1.g + (n2.g - 0.5) * 0.5);
    c = mix(c, vec3f(0.075, 0.042, 0.022) * (0.6 + 0.8 * n3.r), litter * 0.75);
    c = mix(c, vec3f(0.12, 0.022, 0.075) * (0.7 + 0.6 * n2.b), ax.a * 0.6 * (1.0 - litter * 0.6));
    let rk = smoothstep(0.32, 0.55, slope + (n2.r - 0.5) * 0.35);
    let strata = 0.5 + 0.25 * sin(P.y * 1.3 + n1.r * 9.0 + n2.r * 4.0);
    let n4 = nzg(P * 7.3, dx * 7.3, dy * 7.3);
    c = mix(c, vec3f(0.085, 0.082, 0.075) * (0.55 + 0.6 * n3.g) * (0.8 + 0.4 * strata), rk * (1.0 - smoothstep(0.55, 0.75, N.y + n2.g * 0.3)));
    alb = c * (0.82 + 0.36 * n4.r);
    hh = n2.r * 0.25 + n3.g * 0.07 + n4.g * 0.02 + rk * strata * 0.08;
    ao *= 0.65 + 0.35 * n2.r;
    em = ax.rgb * (c + 0.02) * 5.0;
    fuzz = (1.0 - litter) * (1.0 - rk) * 0.25;
    bk = 0.6;
  } else if (KIND == 1u) { // bark
    let th = i.uv.x * 6.2831853; let v = i.uv.y;
    let q = vec3f(cos(th) * 0.9, sin(th) * 0.9, v * 0.085) + i.a.w * 3.7;
    let qx = dpdx(q); let qy = dpdy(q);
    let b1 = nzg(q, qx, qy); let b2 = nzg(q * 3.1, qx * 3.1, qy * 3.1);
    let ridge = 1.0 - abs(b1.g * 2.0 - 1.0);
    let ridge2 = 1.0 - abs(b2.r * 2.0 - 1.0);
    let wn = nzg(P * 0.18, dx * 0.18, dy * 0.18); let wf = nzg(P * 1.7, dx * 1.7, dy * 1.7);
    var c = vec3f(0.062, 0.050, 0.042) * (0.45 + 0.8 * ridge * (0.7 + 0.3 * ridge2));
    c = mix(c, vec3f(0.15, 0.16, 0.13) * (0.7 + 0.3 * wf.r), smoothstep(0.62, 0.75, wf.b + wn.a * 0.3) * 0.5); // lichen
    let mossAmt = smoothstep(0.35, 0.6, N.y * 0.5 + (1.0 - smoothstep(0.0, 7.0, hag)) * 0.4 + (1.0 - smoothstep(4.0, 22.0, hag)) * 0.25 + (wn.g - 0.5) * 0.9 + (1.0 - ridge) * 0.18 + max(dot(N.xz, vec2f(-0.6, 0.8)), 0.0) * 0.3);
    alb = mix(c, mossCol(wf.g, wf.r), mossAmt);
    hh = (ridge * 0.11 + ridge2 * 0.03) * (1.0 - mossAmt) + mossAmt * (wf.g * 0.04 + 0.04);
    ao *= mix(0.55 + 0.45 * ridge, 1.0, mossAmt);
    fuzz = mossAmt * 0.35;
    spk = 0.02; bk = 1.3;
    let ax = aux(P.xz); em = ax.rgb * alb * 2.0 * smoothstep(3.0, 0.0, hag);
  } else if (KIND == 5u) { // vine stems
    alb = vec3f(0.07, 0.1, 0.035); hh = 0.0; fuzz = 0.2;
  } else { // rock (2), temple stone (3), stag (4)
    let n1 = nzg(P * 0.12, dx * 0.12, dy * 0.12); let n2 = nzg(P * 0.7, dx * 0.7, dy * 0.7); let n3 = nzg(P * 3.0, dx * 3.0, dy * 3.0);
    var base = vec3f(0.085, 0.088, 0.08);
    var mossBias = 0.12;
    if (KIND == 3u) { base = vec3f(0.22, 0.2, 0.17); mossBias = 0.32; }
    if (KIND == 4u) { base = vec3f(0.22, 0.21, 0.19); mossBias = 0.45; }
    let streak = nzg(vec3f(P.x * 1.5, P.y * 0.12, P.z * 1.5), vec3f(dx.x * 1.5, dx.y * 0.12, dx.z * 1.5), vec3f(dy.x * 1.5, dy.y * 0.12, dy.z * 1.5)).r;
    var c = base * (0.6 + 0.55 * n2.g) * (0.75 + 0.5 * n3.r) * (0.7 + 0.45 * streak);
    if (KIND == 2u) { c *= (0.8 + 0.4 * smoothstep(0.2, 0.9, fract(P.y / 2.2 + n1.r * 0.6))) * mix(vec3f(1.1, 1.0, 0.85), vec3f(0.85, 0.95, 1.1), n1.a); c *= 1.0 - 0.6 * smoothstep(0.82, 0.92, n2.b); }
    let crack = smoothstep(0.86, 0.95, n2.b) * select(0.0, 1.0, KIND >= 3u);
    c *= 1.0 - crack * 0.55;
    let mossAmt = smoothstep(0.42, 0.6, N.y * 0.55 + (n1.g - 0.5) * 0.9 + (1.0 - ao) * 0.6 + mossBias + (n3.g - 0.5) * 0.15 + crack * 0.25);
    alb = mix(c, mossCol(n3.g, n2.r), mossAmt);
    hh = (n2.r * 0.12 + n3.g * 0.035 - crack * 0.04) * (1.0 - mossAmt) + mossAmt * n3.b * 0.03;
    fuzz = mossAmt * 0.3; spk = 0.03 * (1.0 - mossAmt);
    if (KIND == 4u) { // bioluminescent lichen specks on the stag
      let sp = smoothstep(0.78, 0.86, n3.b) * (1.0 - mossAmt) * smoothstep(0.55, 0.7, n1.a) * smoothstep(1.8, 2.4, hag);
      em = vec3f(0.15, 0.9, 0.8) * (sp * 3.0 + smoothstep(0.7, 0.75, n3.r) * mossAmt * 0.25) * (1.2 + 0.4 * sin(u.cam.w * 1.1 + n1.r * 20.0));
    }
    let ax = aux(P.xz); em += ax.rgb * alb * 2.0 * smoothstep(3.0, 0.0, hag);
    if (KIND == 2u) { em += alb * vec3f(0.12, 0.13, 0.2) * max(-N.y, 0.0) * smoothstep(4.0, 10.0, hag); }
    bk = 0.7;
  }
  N = bump(N, dx, dy, hh, bk * smoothstep(80.0, 10.0, dist));
  let sh = shadow(P + N * (0.05 + dist * 0.0025) + L * 0.06, true);
  var col = lit(alb, N, V, P, ao, sh, spk, spp, hag, open) + em;
  col += alb * u.sunc.rgb * fuzz * pow(1.0 - max(dot(N, V), 0.0), 3.0) * (0.3 + 0.7 * sh) * 1.5;
  return vec4f(applyFog(col, P), 1.0);
}

// ---------------- cards (leaves, bushes, flowers, plants) ----------------
struct CO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) uv: vec2f, @location(2) @interpolate(flat) d: vec4u, @location(3) n: vec3f, @location(4) sn: vec3f }
const CORN = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
@vertex fn vs_card(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> CO {
  var o: CO;
  let A = inst[ii * 2u]; let B = bitcast<vec4u>(inst[ii * 2u + 1u]);
  let cr = CORN[vi];
  var n = octd(B.x); let var_ = B.z & 15u; let up = (B.z & 16u) != 0u;
  if ((B.z & 32u) != 0u) { n = normalize(n + normalize(u.cam.xyz - A.xyz) * 0.6); }
  let rnd = f32(B.z >> 24u) / 255.0;
  var T: vec3f; var Bt: vec3f;
  var size = A.w * smoothstep(0.8, 2.6, distance(A.xyz, u.cam.xyz) - A.w * 0.5);
  if (up) {
    T = normalize(cross(vec3f(0.0, 1.0, 0.0), n)); Bt = vec3f(0.0, 1.0, 0.0);
    let d = distance(A.xyz, u.cam.xyz);
    size *= 1.0 - smoothstep(42.0, 58.0, d);
  } else {
    let t0 = normalize(cross(n, select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.x) > 0.8)));
    let b0 = cross(n, t0); let r = rnd * 6.2831;
    T = t0 * cos(r) + b0 * sin(r); Bt = cross(n, T);
  }
  let w = f32(B.w & 65535u) / 65535.0 * 4.0; let ph = f32(B.w >> 24u) / 255.0;
  var p = A.xyz + (T * cr.x + Bt * cr.y) * size * 0.5;
  if (!up) { p -= n * dot(cr, cr) * size * 0.07; }
  let t = u.cam.w;
  p += wind(A.xyz, w, ph) + vec3f(sin(t * 5.1 + ph * 40.0 + cr.x), sin(t * 4.3 + ph * 31.0), cos(t * 6.2 + ph * 23.0 + cr.y)) * 0.025 * min(w * 6.0, 1.0) * u.sun.w;
  if (up) { p += vec3f(sin(t * 1.3 + ph * 30.0 + A.x), 0.0, cos(t * 1.1 + ph * 20.0)) * 0.05 * (cr.y * 0.5 + 0.5) * u.sun.w; }
  p.y += bobY(f32((B.w >> 16u) & 255u));
  o.pos = u.vp * vec4f(p, 1.0); o.wp = p;
  let fl = select(1.0, -1.0, rnd > 0.5);
  o.uv = vec2f(f32(var_ & 1u), f32(var_ >> 1u)) * 0.5 + (vec2f(cr.x * fl, -cr.y) * 0.5 + 0.5) * 0.5;
  o.d = B; o.n = n; o.sn = octd(B.y);
  return o;
}
fn leafAlbedo(pal: u32, t: vec4f, NdV: f32) -> vec3f {
  if (pal == 0u) { return mix(vec3f(0.030, 0.085, 0.016), vec3f(0.12, 0.13, 0.02), t.g * t.g) * (0.55 + 0.7 * t.r); }
  if (pal == 1u) {
    let base = mix(vec3f(0.15, 0.045, 0.2), vec3f(0.27, 0.06, 0.17), t.g) * (0.55 + 0.6 * t.r);
    let ir = 0.5 + 0.5 * cos(6.2831 * (vec3f(0.95, 0.15, 0.55) * 0.0 + vec3f(0.0, 0.33, 0.67) + (1.0 - NdV) * 0.7 + t.g * 0.2 + 0.02));
    let iri = mix(base, length(base) * 1.35 * ir, 0.75 * (1.0 - NdV * 0.4));
    return iri;
  }
  if (pal == 2u) { return mix(vec3f(0.035, 0.08, 0.02), vec3f(0.55, 0.03, 0.30) * (0.7 + 0.5 * t.g), t.b) * (0.6 + 0.5 * t.r); }
  if (pal == 3u) { return mix(vec3f(0.03, 0.075, 0.015), vec3f(0.08, 0.11, 0.02), t.g) * (0.6 + 0.6 * t.r); }
  return mix(vec3f(0.03, 0.07, 0.02), vec3f(0.07, 0.1, 0.02), t.g) * (0.6 + 0.6 * t.r);
}
@fragment fn fs_card(i: CO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let t = textureSample(tA, sL, i.uv);
  let a = clamp((t.a - 0.5) / max(fwidth(t.a), 0.0001) + 0.5, 0.0, 1.0);
  let P = i.wp; let V = normalize(u.cam.xyz - P); let L = u.sun.xyz;
  let pal = (i.d.z >> 8u) & 255u; let ao = f32((i.d.z >> 16u) & 255u) / 255.0;
  let up = (i.d.z & 16u) != 0u;
  var cn = i.n; if (!ff) { cn = -cn; }
  let N = normalize(mix(cn, i.sn, select(select(0.6, 0.85, (i.d.z & 32u) != 0u), 0.5, up)));
  let alb = leafAlbedo(pal, t, abs(dot(cn, V)));
  let hm = hmap(P.xz); let hag = P.y - hm.x;
  let sh = shadow(P + L * 0.12, false);
  let ndl = max(dot(N, L), 0.0) * 0.8 + 0.2;
  let tr = (pow(max(dot(-V, L), 0.0), 4.0) * 1.4 + 0.35) * max(dot(-cn, L) * 0.7 + 0.3, 0.0);
  let H = normalize(L + V);
  let sp = pow(max(dot(cn, H), 0.0), 40.0) * 0.12 * sh;
  var col = alb * (u.sunc.rgb * sh * (ndl + tr * vec3f(1.1, 1.25, 0.55)) + ambient(N, hag, hm.y) * (0.35 + 0.65 * ao)) + u.sunc.rgb * sp * select(1.0, 0.0, up);
  col += alb * vec3f(0.55, 0.75, 0.35) * (0.25 + 0.75 * max(-V.y, 0.0)) * mix(0.35, 0.9, hm.y) * (0.5 + 0.5 * ao) * select(1.0, 0.3, up);
  if (pal == 2u) { col += vec3f(0.55, 0.04, 0.32) * t.b * t.r * 0.35; }
  if (pal == 1u) { let fr = pow(1.0 - abs(dot(cn, V)), 3.0); col += mix(vec3f(0.5, 0.15, 0.9), vec3f(0.1, 0.7, 0.8), fr) * fr * (0.08 + 0.25 * sh) * u.sunc.rgb * 0.35; }
  let ax = aux(P.xz); col += ax.rgb * alb * 2.0 * smoothstep(3.0, 0.0, hag);
  return vec4f(applyFog(col, P), a);
}
@fragment fn fs_card_sh(i: CO) { if (textureSampleLevel(tA, sL, i.uv, 1.0).a < 0.5) { discard; } }

// ---------------- instanced meshes: ferns(0) mushrooms(1) butterflies(2) birds(3) ----------------
struct IO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) uv: vec2f, @location(3) a: vec4f, @location(4) @interpolate(flat) b: vec4f }
fn rotY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
fn rotX(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
fn bflyPos(A: vec4f, B: vec4f, t: f32) -> vec3f {
  let s = t * B.y + B.x * 100.0;
  return A.xyz + vec3f(sin(s * 0.31) * B.w + sin(s * 0.73 + 1.0) * 1.2, 2.0 + sin(s * 0.47) * 0.9 + sin(s * 1.9) * 0.25, cos(s * 0.27) * B.w + cos(s * 0.61) * 1.2);
}
fn birdPos(A: vec4f, B: vec4f, t: f32) -> vec3f {
  let s = t * 0.045;
  var s2 = t * 0.16 + 3.0; var c = vec3f(4.0 + cos(s2) * 12.0, 27.0 + sin(s2 * 2.0) * 2.5, 14.0 + sin(s2) * 10.0);
  if (B.y > 1.5) { s2 = -t * 0.13 + 2.0; c = vec3f(44.0 + cos(s2) * 15.0, 36.0 + sin(s2 * 2.0) * 3.0, -42.0 + sin(s2) * 13.0); }
  return c + A.xyz + vec3f(sin(t * 0.7 + B.x * 9.0), sin(t * 0.9 + B.x * 5.0) * 0.6, cos(t * 0.8 + B.x * 7.0)) * 1.5;
}
@vertex fn vs_inst(@location(0) p: vec3f, @location(1) n: vec4f, @location(2) uv: vec2f, @location(3) a: vec4f, @builtin(instance_index) ii: u32) -> IO {
  var o: IO;
  let A = inst[ii * 2u]; let B = inst[ii * 2u + 1u];
  var wp: vec3f; var wn: vec3f;
  let t = u.cam.w;
  if (KIND <= 1u) {
    var s = A.w;
    if (KIND == 0u) { let fd = distance(A.xyz, u.cam.xyz); s *= (1.0 - smoothstep(70.0, 90.0, fd)) * smoothstep(1.0, 3.0 + A.w * 0.6, fd); }
    var lp = p;
    if (KIND == 1u) { let cs = 0.7 + fract(B.w * 7.3) * 0.9; let st = 0.8 + fract(B.w * 3.1) * 0.8; lp = vec3f(p.x * select(1.0, cs, a.w > 0.25) * select(1.0, 0.85, a.w < 0.25), select(p.y * st, 0.2 * st + (p.y - 0.19) * (2.0 - cs) * 0.8, a.w > 0.25), p.z * select(1.0, cs, a.w > 0.25) * select(1.0, 0.85, a.w < 0.25)); }
    wp = A.xyz + rotY(rotX(lp, B.y), B.x) * s;
    wn = rotY(rotX(n.xyz, B.y), B.x);
    if (KIND == 0u) { wp += wind(A.xyz, a.y * 4.0 * s, B.w) + vec3f(sin(t * 2.1 + B.w * 30.0 + p.x * 3.0), 0.0, cos(t * 1.7 + B.w * 20.0)) * 0.03 * a.y * 4.0 * s * u.sun.w; }
  } else if (KIND == 2u) {
    let c = bflyPos(A, B, t); let c2 = bflyPos(A, B, t + 0.1);
    let f = normalize(c2 - c + vec3f(0.0001));
    let r = normalize(cross(f, vec3f(0.0, 1.0, 0.0))); let up = cross(r, f);
    let fl = sin(t * 15.0 + B.x * 50.0) * 1.05 + 0.35;
    let lp = vec3f(p.x * cos(fl), abs(p.x) * sin(fl) + p.y, p.z) * A.w * smoothstep(1.0, 3.0, distance(c, u.cam.xyz));
    wp = c + r * lp.x + up * lp.y + f * lp.z;
    wn = normalize(up * cos(fl) - r * sign(p.x) * sin(fl));
  } else {
    let c = birdPos(A, B, t); let c2 = birdPos(A, B, t + 0.2);
    let f = normalize(c2 - c);
    let r = normalize(cross(f, vec3f(0.0, 1.0, 0.0))); let up = cross(r, f);
    let flapOn = smoothstep(-0.3, 0.3, sin(t * 0.35 + B.x * 4.0));
    let th = (sin(t * 7.5 + B.x * 30.0) * 0.75 + 0.1) * flapOn + 0.08;
    let ax = abs(p.x);
    let y1 = min(ax, 0.35) * sin(th); let y2 = max(ax - 0.35, 0.0) * sin(th * 1.5);
    let lp = vec3f(p.x, p.y + y1 + y2, p.z) * A.w;
    wp = c + r * lp.x + up * lp.y + f * lp.z;
    wn = up;
  }
  o.pos = u.vp * vec4f(wp, 1.0); o.wp = wp; o.n = wn; o.uv = uv; o.a = a; o.b = B;
  return o;
}
fn fernCov(uv: vec2f) -> f32 {
  let x = abs(uv.x); let s = uv.y;
  let k = s * 24.0 + x * 2.2;
  let cell = abs(fract(k) - 0.5) * 2.0;
  let width = 0.85 * (1.0 - x * x * 0.5) * smoothstep(1.0, 0.85, s) + 0.1;
  let pin = 1.0 - cell / width;
  let stem = 0.09 - x;
  let edge = 1.0 - x;
  return max(min(pin, edge * 4.0), stem * 6.0);
}
@fragment fn fs_inst(i: IO, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  let P = i.wp; let V = normalize(u.cam.xyz - P); let L = u.sun.xyz;
  var N = normalize(i.n); if (!ff) { N = -N; }
  let hm = hmap(P.xz); let hag = P.y - hm.x;
  var alpha = 1.0; var col = vec3f(0.0);
  let t = u.cam.w;
  if (KIND == 0u) {
    let c = fernCov(i.uv);
    alpha = clamp(c / max(fwidth(c), 0.0001) + 0.5, 0.0, 1.0);
    let s = i.uv.y;
    let alb = mix(vec3f(0.05, 0.11, 0.022), vec3f(0.11, 0.16, 0.025), s * 0.7 + i.b.z * 0.3) * (0.75 + 0.5 * abs(i.uv.x));
    let sh = shadow(P + L * 0.7, false);
    let tr = (pow(max(dot(-V, L), 0.0), 4.0) * 1.2 + 0.3) * max(-dot(N, L) * 0.7 + 0.3, 0.0);
    col = alb * (u.sunc.rgb * sh * (abs(dot(N, L)) * 0.6 + 0.25 + tr * vec3f(1.1, 1.3, 0.5)) + ambient(vec3f(0.0, 1.0, 0.0), hag, hm.y) * (0.6 + 0.6 * i.a.x));
    col += alb * vec3f(0.45, 0.6, 0.35) * (0.35 + 0.65 * hm.y) * (0.4 + 0.6 * s);
    let ax = aux(P.xz); col += ax.rgb * alb * 2.0 * smoothstep(3.0, 0.0, hag);
  } else if (KIND == 1u) {
    let part = i.a.w;
    let hc = hsv(i.b.z, 0.75, 1.0);
    let pulse = 0.75 + 0.25 * sin(t * 1.3 + i.b.w * 20.0);
    let nn = nzl(P * 3.0 + i.b.w * 5.0);
    var alb = vec3f(0.35, 0.33, 0.3) * 0.6; var em = vec3f(0.0);
    if (part < 0.25) { em = hc * 0.25 * smoothstep(0.0, 1.0, i.uv.y) * pulse; }
    else if (part < 0.75) {
      alb = hsv(i.b.z, 0.55, 0.22);
      let sq = nzl(vec3f(cos(i.uv.x * 6.2831) * 0.35, sin(i.uv.x * 6.2831) * 0.35, i.uv.y * 0.3) + i.b.w * 3.0);
      let spots = smoothstep(0.66, 0.74, sq.b);
      em = hc * (0.3 + 1.6 * spots + 1.4 * pow(i.uv.y, 4.0)) * pulse;
    } else { em = hc * (1.4 + 0.8 * sin(i.uv.x * 120.0)) * pulse; alb = vec3f(0.05); }
    let sh = shadow(P + N * 0.03, false);
    col = lit(alb, N, V, P, i.a.x, sh, 0.25, 30.0, hag, hm.y) + em * 1.6;
  } else if (KIND == 2u) {
    let s = i.uv.x; let c = i.uv.y;
    let fore = 1.0 - length(vec2f((s - 0.42) * 1.15, (c - 0.66) * 1.4)) / 0.5;
    let hind = 1.0 - length(vec2f((s - 0.3) * 1.3, (c - 0.27) * 1.5)) / 0.4;
    let body = 0.06 - s;
    let cv = max(max(fore, hind), body * 3.0);
    alpha = clamp(cv / max(fwidth(cv), 0.0001) + 0.5, 0.0, 1.0);
    let ir = 0.5 + 0.5 * cos(6.2831 * (vec3f(0.0, 0.33, 0.67) + abs(dot(N, V)) * 1.5 + i.b.z));
    var alb = mix(hsv(i.b.z, 0.8, 0.5), ir * 0.6, 0.45);
    let edgeB = 1.0 - smoothstep(0.0, 0.25, max(fore, hind));
    alb = mix(alb, vec3f(0.01), edgeB * 0.85);
    let eye = 0.0;
    let sh = shadow(P, false);
    col = alb * (u.sunc.rgb * sh * (abs(dot(N, L)) * 0.8 + 0.3) + ambient(N, hag, hm.y)) + hsv(i.b.z + 0.1, 0.6, 1.0) * (0.9 + 0.6 * (1.0 - max(fore, hind))) * (1.0 - edgeB * 0.7);
  } else {
    let sh = shadow(P, false);
    col = vec3f(0.02, 0.018, 0.016) * (u.sunc.rgb * sh * max(dot(N, L), 0.2) + vec3f(0.3, 0.35, 0.5));
  }
  return vec4f(applyFog(col, P), alpha);
}
@fragment fn fs_fern_sh(i: IO) { if (fernCov(i.uv) < 0.0) { discard; } }

// ---------------- sky ----------------
struct FO { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> FO {
  var o: FO; let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u)) * 2.0 - 1.0;
  o.pos = vec4f(p, 0.0, 1.0); o.ndc = p; return o;
}
@fragment fn fs_sky(i: FO) -> @location(0) vec4f {
  let w = u.ivp * vec4f(i.ndc, 0.5, 1.0);
  let rd = normalize(w.xyz / w.w - u.cam.xyz);
  let mu = dot(rd, u.sun.xyz); let h = max(rd.y, 0.0);
  var c = mix(vec3f(0.62, 0.62, 0.66), vec3f(0.12, 0.28, 0.78), pow(h, 0.4)) * 0.85;
  c += vec3f(1.0, 0.72, 0.4) * (pow(max(mu, 0.0), 6.0) * 1.0 + pow(max(mu, 0.0), 60.0) * 2.5);
  let cp = rd.xz / (h + 0.12) * 0.06 + vec2f(u.cam.w * 0.0015, 0.0);
  let cn = nzl(vec3f(cp, 0.31)).r * 0.65 + nzl(vec3f(cp * 3.1, 0.71)).g * 0.35;
  let cl = smoothstep(0.48, 0.72, cn) * smoothstep(0.02, 0.25, rd.y);
  c = mix(c, vec3f(1.15, 1.05, 0.95) * 1.6 + vec3f(1.0, 0.7, 0.4) * pow(max(mu, 0.0), 4.0) * 2.0, cl * 0.8);
  c += vec3f(1.0, 0.9, 0.75) * smoothstep(0.99955, 0.9998, mu) * 40.0;
  c = mix(fogCol(rd), c, exp(-0.09 / max(rd.y, 0.015)));
  return vec4f(c, 1.0);
}

// ---------------- particles: motes, pollen, fireflies, wisps ----------------
struct PO { @builtin(position) pos: vec4f, @location(0) c: vec3f, @location(1) q: vec2f }
const NM = 1300u; const NP = 3200u; const NF = 1500u; const NW = 90u; const WT = 24u;
@vertex fn vs_part(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> PO {
  var o: PO;
  let cr = CORN[vi]; let t = u.cam.w; let cam = u.cam.xyz;
  let h = vec3f(h01(ii * 3u + 1u), h01(ii * 3u + 2u), h01(ii * 3u + 3u));
  var P: vec3f; var col: vec3f; var sz: f32;
  if (ii < NM + NP) {
    let isM = ii < NM;
    let B = select(26.0, 44.0, isM);
    var p = h * B + vec3f(sin(t * 0.13 + h.y * 30.0) * 2.0, t * select(0.04, 0.12, isM) + sin(t * 0.21 + h.x * 20.0), cos(t * 0.11 + h.z * 25.0) * 2.0);
    let l = (fract((p - cam) / B + 0.5) - 0.5) * B;
    P = cam + l;
    let fade = 1.0 - smoothstep(0.32, 0.5, max(max(abs(l.x), abs(l.y)), abs(l.z)) / B);
    let gy = hmap(P.xz).x;
    let sh = shadow(P, false) * smoothstep(gy, gy + 1.0, P.y);
    if (isM) {
      col = mix(vec3f(0.45, 1.0, 0.25), vec3f(1.0, 0.75, 0.25), h.y) * (0.25 + 3.0 * sh) * fade * (0.6 + 0.4 * sin(t * 2.0 + h.x * 40.0));
      sz = 0.018 + h.z * 0.016;
    } else {
      col = vec3f(1.0, 0.85, 0.6) * (0.004 + 0.6 * sh) * fade;
      sz = 0.012 + h.z * 0.012;
    }
  } else if (ii < NM + NP + NF) {
    let xz = (h.xz * 2.0 - 1.0) * 175.0;
    let gy = hmap(xz).x;
    P = vec3f(xz.x, gy + 0.4 + h.y * 3.5, xz.y) + vec3f(sin(t * 0.3 + h.x * 50.0) * 1.6, sin(t * 0.5 + h.z * 40.0) * 0.5, cos(t * 0.27 + h.y * 60.0) * 1.6);
    let blink = pow(max(sin(t * (0.8 + h.z) + h.x * 90.0), 0.0), 6.0);
    col = vec3f(0.75, 1.0, 0.25) * (0.15 + 7.0 * blink);
    sz = 0.05;
  } else {
    let k = ii - (NM + NP + NF); let wi = k / WT; let ti = k % WT;
    let hw = vec3f(h01(wi * 7u + 11u), h01(wi * 7u + 12u), h01(wi * 7u + 13u));
    let tt = t - f32(ti) * 0.035;
    let xz = (hw.xz * 2.0 - 1.0) * 140.0 + vec2f(sin(tt * 0.11 + hw.x * 9.0) * 9.0 + sin(tt * 0.37 + hw.y * 3.0) * 2.0, cos(tt * 0.09 + hw.z * 9.0) * 9.0 + cos(tt * 0.41) * 2.0);
    let gy = hmap(xz).x;
    P = vec3f(xz.x, gy + 1.2 + hw.y * 3.0 + sin(tt * 0.6 + hw.x * 20.0) * 0.6, xz.y);
    let fr = 1.0 - f32(ti) / f32(WT);
    col = hsv(0.42 + hw.z * 0.2, 0.55, 1.0) * select(1.0, 2.2, ti == 0u) * fr * fr * (0.8 + 0.2 * sin(t * 3.0 + hw.x * 10.0));
    sz = select(0.08 * fr + 0.02, 0.17, ti == 0u);
  }
  col *= smoothstep(2.0, 6.0, distance(P, cam));
  let clip = u.vp * vec4f(P, 1.0);
  let px = sz * u.misc.z / max(clip.w, 0.01);
  let pc = max(px, 1.8);
  col *= (px / pc) * (px / pc);
  let s2 = pc * max(clip.w, 0.01) / u.misc.z;
  let wp = P + (u.right.xyz * cr.x + u.up.xyz * cr.y) * s2 * 2.0;
  o.pos = u.vp * vec4f(wp, 1.0);
  o.c = col * exp(-fogOD(cam, P));
  o.q = cr;
  return o;
}
@fragment fn fs_part(i: PO) -> @location(0) vec4f {
  let r2 = dot(i.q, i.q);
  let a = max(exp(-r2 * 5.0) - 0.0067, 0.0);
  return vec4f(i.c * a * 1.6, 0.0);
}
`;

export { POST, BLUR, BLOOM } from './post.js';

export const COMP = /*wgsl*/`
@group(0) @binding(0) var tC: texture_2d<f32>;
@group(0) @binding(1) var tV: texture_2d<f32>;
@group(0) @binding(2) var tB: texture_2d<f32>;
@group(0) @binding(3) var sK: sampler;
@group(0) @binding(4) var<uniform> pp: vec4f;
struct FO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> FO {
  var o: FO; let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o;
}
const AI = mat3x3f(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
const AO = mat3x3f(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
fn aces(c: vec3f) -> vec3f { let v = AI * c; let a = v * (v + 0.0245786) - 0.000090537; let b = v * (0.983729 * v + 0.4329510) + 0.238081; return clamp(AO * (a / b), vec3f(0.0), vec3f(1.0)); }
fn srgb(c: vec3f) -> vec3f { return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c < vec3f(0.0031308)); }
@fragment fn fs_comp(i: FO) -> @location(0) vec4f {
  let pc = vec2i(i.pos.xy);
  var c = textureLoad(tC, pc, 0).rgb;
  c += textureSampleLevel(tV, sK, i.uv, 0.0).rgb;
  c += textureSampleLevel(tB, sK, i.uv, 0.0).rgb * 0.045;
  c *= pp.x;
  let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
  c = mix(vec3f(l), c, 1.08);
  c = aces(max(c, vec3f(0.0)));
  c = c + vec3f(0.010, 0.006, 0.018) * (1.0 - c);
  let v = i.uv - 0.5; c *= 1.0 - dot(v, v) * 0.55;
  var o = srgb(c);
  let n = fract(sin(dot(vec2f(pc) + pp.y, vec2f(12.9898, 78.233))) * 43758.5453) + fract(sin(dot(vec2f(pc) * 1.37 + pp.y, vec2f(39.346, 11.135))) * 24634.6345) - 1.0;
  o += n / 255.0;
  return vec4f(o, 1.0);
}
`;

export const CULL = /*wgsl*/`
struct CP { pl: array<vec4f, 4>, cam: vec4f, cfg: vec4u, k: vec4f }
@group(0) @binding(0) var<uniform> c: CP;
@group(0) @binding(1) var<storage, read> src: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> dst: array<vec4f>;
@group(0) @binding(3) var<storage, read_write> ind: array<atomic<u32>>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) g: vec3u) {
  let i = g.x; if (i >= c.cfg.x) { return; }
  let a = src[i * 2u];
  let r = a.w * c.k.x + c.k.y;
  for (var k = 0; k < 4; k++) { if (dot(c.pl[k].xyz, a.xyz) + c.pl[k].w < -r) { return; } }
  if (distance(a.xyz, c.cam.xyz) > c.cam.w + r) { return; }
  let o = atomicAdd(&ind[c.cfg.y], 1u);
  dst[o * 2u] = a; dst[o * 2u + 1u] = src[i * 2u + 1u];
}
`;

export const TSLOG = /*wgsl*/`
@group(0) @binding(0) var<storage, read> ts: array<u32>;
@group(0) @binding(1) var<storage, read_write> lg: array<f32>;
@group(0) @binding(2) var<uniform> fr: vec4u;
@compute @workgroup_size(1) fn main() {
  let f = fr.x; if (f >= fr.y) { return; }
  for (var k = 0u; k < 4u; k++) { lg[f * 5u + k] = f32(ts[(2u * k + 1u) * 2u] - ts[(2u * k) * 2u]) * 1e-6; }
  lg[f * 5u + 4u] = f32(ts[14] - ts[0]) * 1e-6;
}
`;

// ---------------- generation ----------------
export const GEN_NOISE = /*wgsl*/`
@group(0) @binding(0) var o: texture_storage_3d<rgba8unorm, write>;
fn h3(p: vec3i) -> vec3f {
  var q = vec3u(p);
  q = q * vec3u(1597334673u, 3812015801u, 2798796415u);
  let n = (q.x ^ q.y ^ q.z) * 1597334673u;
  let v = vec3u(n, n * 16807u, n * 48271u);
  return vec3f(v >> vec3u(8u)) / 16777216.0 * 2.0 - 1.0;
}
fn gn(p: vec3f, per: i32) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p); let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  var r = 0.0;
  var acc = array<f32, 8>();
  for (var k = 0; k < 8; k++) {
    let o = vec3i(k & 1, (k >> 1) & 1, (k >> 2) & 1);
    let c = (i + o + vec3i(per * 64)) % vec3i(per);
    acc[k] = dot(normalize(h3(c) + 1e-4), f - vec3f(o));
  }
  let x0 = mix(acc[0], acc[1], w.x); let x1 = mix(acc[2], acc[3], w.x); let x2 = mix(acc[4], acc[5], w.x); let x3 = mix(acc[6], acc[7], w.x);
  return mix(mix(x0, x1, w.y), mix(x2, x3, w.y), w.z);
}
fn fbm(p: vec3f, per: i32, oct: i32) -> f32 {
  var s = 0.0; var a = 0.5; var q = p; var pr = per;
  for (var k = 0; k < oct; k++) { s += a * gn(q, pr); q *= 2.0; pr *= 2; a *= 0.5; }
  return s;
}
fn wor(p: vec3f, per: i32) -> f32 {
  let i = vec3i(floor(p)); let f = fract(p); var d = 9.0;
  for (var z = -1; z <= 1; z++) { for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
    let o = vec3i(x, y, z); let c = (i + o + vec3i(per * 64)) % vec3i(per);
    let r = vec3f(o) + h3(c + vec3i(17)) * 0.5 + 0.5 - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) g: vec3u) {
  let p = (vec3f(g) + 0.5) / 128.0;
  let r = fbm(p * 4.0, 4, 5) * 0.9 + 0.5;
  let gg = fbm(p * 8.0 + 3.1, 8, 4) * 0.9 + 0.5;
  let b = 1.0 - wor(p * 8.0, 8) * 0.9;
  let a = fbm(p * 16.0 + 7.3, 16, 3) * 0.9 + 0.5;
  textureStore(o, g, clamp(vec4f(r, gg, b, a), vec4f(0.0), vec4f(1.0)));
}
`;
export const GEN_MIP3 = /*wgsl*/`
@group(0) @binding(0) var i: texture_3d<f32>;
@group(0) @binding(1) var o: texture_storage_3d<rgba8unorm, write>;
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (any(g >= textureDimensions(o))) { return; }
  var s = vec4f(0.0);
  for (var k = 0u; k < 8u; k++) { s += textureLoad(i, g * 2u + vec3u(k & 1u, (k >> 1u) & 1u, (k >> 2u) & 1u), 0); }
  textureStore(o, g, s / 8.0);
}
`;
// leaf atlas: 4 quadrants. r = shade, g = variation, b = petal mask, a = coverage
export const GEN_ATLAS = /*wgsl*/`
struct FO { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs_full(@builtin(vertex_index) vi: u32) -> FO {
  var o: FO; let p = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(p.x, 1.0 - p.y); return o;
}
fn pcg(v: u32) -> u32 { let s = v * 747796405u + 2891336453u; let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
fn hf(v: u32) -> f32 { return f32(pcg(v) >> 8u) / 16777216.0; }
// leaf at origin pointing along dir, returns (inside, shade)
fn leaf(p: vec2f, o: vec2f, ang: f32, len: f32, wid: f32, heart: bool) -> vec2f {
  let d = p - o; let c = cos(ang); let s = sin(ang);
  let x = (d.x * c + d.y * s) / len; let y = (-d.x * s + d.y * c) / len;
  if (x < 0.0 || x > 1.0) { return vec2f(0.0); }
  var w = wid * pow(sin(PI * x), 0.75) * (1.0 - 0.25 * x);
  if (heart) { w = wid * pow(sin(PI * pow(x, 0.8)), 0.6) * (1.0 - 0.15 * x); }
  if (abs(y) > w) { return vec2f(0.0); }
  let rib = smoothstep(0.0, 0.08, abs(y) / max(w, 0.001));
  let vein = 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.06, abs(fract(x * 7.0 - abs(y) / max(w, 0.01) * 0.8) - 0.5) - 0.0));
  return vec2f(1.0, (0.55 + 0.45 * rib * vein) * (0.75 + 0.25 * (1.0 - abs(y) / max(w, 0.001))));
}
const PI = 3.14159265;
fn eval(p: vec2f, q: u32) -> vec4f {
  var best = vec4f(0.0);
  if (q == 0u || q == 1u) {
    let n = select(26u, 14u, q == 0u);
    for (var k = 0u; k < n; k++) {
      let t = (f32(k) + 0.5) / f32(n);
      let side = select(-1.0, 1.0, (k & 1u) == 1u);
      let br = select(0.0, (hf(k * 3u + q * 101u) - 0.5) * 0.25, q == 1u);
      let o = vec2f(0.5 + br + sin(t * 3.0) * 0.04, 0.95 - t * 0.8);
      let ang = -PI * 0.5 + side * (0.75 + 0.35 * hf(k + 9u)) - (1.0 - t) * side * 0.2;
      let len = select(0.1, 0.22, q == 0u) * (0.75 + 0.4 * hf(k + 31u)) * (1.0 - t * 0.35);
      let r = leaf(p, o, ang, len, select(0.34, 0.3, q == 0u), false);
      if (r.x > 0.0) { best = vec4f(r.y, hf(k + 77u + q * 13u), 0.0, 1.0); }
    }
    let tip = leaf(p, vec2f(0.5, 0.18), -PI * 0.5, select(0.12, 0.2, q == 0u), 0.32, false);
    if (tip.x > 0.0) { best = vec4f(tip.y, 0.5, 0.0, 1.0); }
    if (abs(p.x - 0.5 - sin((0.95 - p.y) / 0.8 * 3.0) * 0.04) < 0.006 && p.y > 0.15 && p.y < 0.96) { best = vec4f(0.3, 0.2, 0.0, 1.0); }
  } else if (q == 2u) {
    for (var k = 0u; k < 9u; k++) {
      let ang = -PI * 0.5 + (f32(k) - 4.0) * 0.36 + (hf(k + 3u) - 0.5) * 0.2;
      let r = leaf(p, vec2f(0.5, 0.92), ang, 0.42 + 0.2 * hf(k + 50u), 0.36, true);
      if (r.x > 0.0) { best = vec4f(r.y, hf(k + 200u), 0.0, 1.0); }
    }
  } else {
    for (var k = 0u; k < 5u; k++) {
      let fk = f32(k);
      let bx = 0.5 + (fk - 2.0) * 0.12 + (hf(k + 7u) - 0.5) * 0.05;
      let top = 0.18 + hf(k + 17u) * 0.3;
      let sx = mix(0.5, bx, (0.97 - p.y) / (0.97 - top));
      if (p.y > top && p.y < 0.97 && abs(p.x - sx) < 0.007) { best = vec4f(0.5, 0.3, 0.0, 1.0); }
      let lf = leaf(p, vec2f(mix(0.5, bx, 0.4), 0.8), -PI * 0.5 + (fk - 2.0) * 0.5, 0.17, 0.3, false);
      if (lf.x > 0.0) { best = vec4f(lf.y, 0.4, 0.0, 1.0); }
      let c = vec2f(bx, top); let d = p - c; let a = atan2(d.y, d.x); let r = length(d);
      let pr = 0.075 * (0.55 + 0.45 * abs(cos(2.5 * a + fk)));
      if (r < pr) { best = vec4f(0.7 + 0.3 * (1.0 - r / pr) - select(0.0, 0.3, r < 0.016), hf(k + 60u), select(1.0, 0.25, r < 0.016), 1.0); }
    }
  }
  return best;
}
@fragment fn fs_atlas(i: FO) -> @location(0) vec4f {
  let q2 = floor(i.uv * 2.0); let q = u32(q2.x) + u32(q2.y) * 2u;
  let l = fract(i.uv * 2.0);
  let px = 1.0 / 512.0;
  var acc = vec4f(0.0); var cw = 0.0;
  for (var y = 0; y < 4; y++) { for (var x = 0; x < 4; x++) {
    let p = (l - 0.5) * 1.06 + 0.5 + (vec2f(f32(x), f32(y)) - 1.5) * px * 0.25;
    let e = eval(p, q);
    acc += vec4f(e.rgb * e.a, e.a);
  } }
  if (acc.a <= 0.0) { return vec4f(0.5, 0.5, 0.0, 0.0); }
  return vec4f(acc.rgb / acc.a, acc.a / 16.0);
}
@group(0) @binding(0) var tI: texture_2d<f32>;
@fragment fn fs_mip(i: FO) -> @location(0) vec4f {
  let pc = vec2i(i.pos.xy) * 2;
  var s = vec4f(0.0);
  for (var k = 0; k < 4; k++) { let t = textureLoad(tI, pc + vec2i(k & 1, k >> 1), 0); s += vec4f(t.rgb * t.a, t.a); }
  if (s.a <= 0.0) { return vec4f(0.5, 0.5, 0.0, 0.0); }
  return vec4f(s.rgb / s.a, s.a / 4.0);
}
`;

// SDF evaluation for meshing. Local coordinates.
export const GEN_SDF = /*wgsl*/`
const PI = 3.14159265;
struct SP { org: vec4f, dims: vec4u, p: vec4f, k: vec4f }
@group(0) @binding(0) var<uniform> sp: SP;
@group(0) @binding(1) var<storage, read_write> outF: array<f32>;
@group(0) @binding(2) var tN: texture_3d<f32>;
@group(0) @binding(3) var sL: sampler;
fn nz(p: vec3f) -> vec4f { return textureSampleLevel(tN, sL, p, 0.0); }
fn sdBox(p: vec3f, b: vec3f) -> f32 { let q = abs(p) - b; return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0); }
fn sdRB(p: vec3f, b: vec3f, r: f32) -> f32 { return sdBox(p, b - r) - r; }
fn sdEll(p: vec3f, r: vec3f) -> f32 { let k0 = length(p / r); let k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
fn sdCap(p: vec3f, a: vec3f, b: vec3f, ra: f32, rb: f32) -> f32 { let pa = p - a; let ba = b - a; let h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - mix(ra, rb, h); }
fn smin(a: f32, b: f32, k: f32) -> f32 { let h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
fn rY(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
fn rX(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
fn rZ(v: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
fn hh(p: vec3f) -> vec3f { var q = vec3u(vec3i(floor(p * 7.31)) + vec3i(1000)); q = q * vec3u(1597334673u, 3812015801u, 2798796415u); let n = (q.x ^ q.y ^ q.z) * 1597334673u; return vec3f(vec3u(n, n * 16807u, n * 48271u) >> vec3u(8u)) / 16777216.0; }

fn temple(q: vec3f) -> f32 {
  var d = sdRB(q - vec3f(0.0, -0.55, 0.0), vec3f(10.5, 0.6, 8.0), 0.1);
  d = min(d, sdRB(q - vec3f(0.0, -0.05, 0.0), vec3f(9.6, 0.32, 7.2), 0.08));
  d = min(d, sdRB(q - vec3f(0.0, 0.4, 0.0), vec3f(8.6, 0.32, 6.3), 0.08));
  // floor slabs (cracked grid)
  let fc = floor(q.xz / 1.4); let fl = (fract(q.xz / 1.4) - 0.5) * 1.4; let fh = hh(vec3f(fc, 9.0));
  if (abs(q.x) < 8.0 && abs(q.z) < 5.8) { d = min(d, sdRB(vec3f(fl.x, q.y - 0.78 + fh.x * 0.06, fl.y), vec3f(0.66, 0.1, 0.66), 0.04)); }
  // broken colonnade: drums of decreasing count
  for (var cx = -1.0; cx <= 1.0; cx += 2.0) { for (var cz = -1.0; cz <= 1.0; cz += 2.0) {
    let cr = hh(vec3f(cx, cz, 5.0));
    let nd = 2.0 + floor(cr.x * 5.0);
    let cp = q - vec3f(cx * 6.6, 0.75, cz * 4.6);
    let k = clamp(floor(cp.y / 1.05), 0.0, nd - 1.0);
    let ly = cp.y - (k + 0.5) * 1.05;
    let rr = length(cp.xz) - 0.62 - 0.05 * sin(atan2(cp.z, cp.x) * 16.0);
    d = min(d, max(max(rr, abs(ly) - 0.49), cp.y - nd * 1.05 + 0.05));
    d = min(d, sdRB(cp - vec3f(0.0, 0.18, 0.0), vec3f(0.85, 0.2, 0.85), 0.05));
  } }
  // fallen column drums lying on the plinth
  for (var k = 0.0; k < 4.0; k += 1.0) {
    let rr = hh(vec3f(k, 7.0, 1.0));
    let c = vec3f(-3.0 + k * 1.7 + rr.x * 0.8, 1.2 + rr.y * 0.25, 6.2 - k * 0.6 + rr.z * 1.2);
    let lp = rZ(rY(q - c, rr.x * 3.0), (rr.y - 0.5) * 0.6);
    d = min(d, max(length(lp.yz) - 0.45 - rr.z * 0.25, abs(lp.x) - 0.35 - rr.y * 0.3));
  }
  // pillars of stacked blocks
  for (var s = -1.0; s <= 1.0; s += 2.0) {
    for (var k = 0; k < 6; k++) {
      let fk = f32(k); let r = hh(vec3f(s, fk, 3.0));
      let c = vec3f(s * 3.6 + (r.x - 0.5) * 0.14, 0.75 + 0.55 + fk * 1.1, (r.y - 0.5) * 0.14);
      d = min(d, sdRB(rY(q - c, (r.z - 0.5) * 0.1), vec3f(0.8, 0.53, 0.8), 0.08));
    }
    d = min(d, sdRB(q - vec3f(s * 3.6, 7.5, 0.0), vec3f(0.98, 0.18, 0.98), 0.05)); // capital
  }
  // arch of voussoirs
  let ac = q - vec3f(0.0, 7.68, 0.0);
  let r = length(ac.xy); let a = atan2(ac.y, ac.x);
  if (a > -0.05 && a < PI + 0.05) {
    let n = 11.0; let k = clamp(floor(a / (PI / n)), 0.0, n - 1.0);
    let am = (k + 0.5) * PI / n;
    var lp = rZ(vec3f(ac.xy, 0.0), -am); lp.z = ac.z;
    var drop = 0.0; if (k == 5.0) { drop = 0.35; }
    if (k == 4.0) { drop = 0.08; }
    lp = lp + vec3f(drop, 0.0, 0.0);
    let bw = (2.85 + 0.65) * sin(PI / n * 0.5) - 0.05;
    d = min(d, sdRB(lp - vec3f(3.5, 0.0, 0.0), vec3f(0.68, bw, 0.72), 0.06));
  }
  // crumbling side walls (bricks removed above a ragged line)
  let wq = q - vec3f(0.0, 0.75, 0.0);
  let row = floor(wq.y / 0.56); let xo = wq.x + (row - 2.0 * floor(row * 0.5)) * 0.46;
  let col = floor(xo / 0.92);
  let cc = vec2f((col + 0.5) * 0.92 - (row - 2.0 * floor(row * 0.5)) * 0.46, (row + 0.5) * 0.56);
  let ax = abs(cc.x);
  let top = select(5.6 - 4.8 * smoothstep(4.3, 9.0, ax), 3.4 - 2.6 * smoothstep(4.3, 7.8, ax), cc.x < 0.0) + (hh(vec3f(col, row, 1.0)).x - 0.5) * 1.6;
  if (ax > 4.25 && ax < 9.2 && cc.y < top && cc.y > 0.0) {
    let lb = vec3f(xo - (col + 0.5) * 0.92, wq.y - cc.y, wq.z);
    let jit = hh(vec3f(col, row, 2.0));
    d = min(d, sdRB(lb + vec3f(0.0, 0.0, (jit.x - 0.5) * 0.12), vec3f(0.43, 0.25, 0.42 + jit.y * 0.08), 0.05));
  }
  // fallen blocks
  d = min(d, sdRB(rY(q - vec3f(5.6, 0.85, 3.4), 0.6), vec3f(0.75, 0.5, 0.7), 0.1));
  d = min(d, sdRB(rZ(rY(q - vec3f(-5.2, 0.7, 3.1), -0.4), 0.3), vec3f(0.7, 0.45, 0.6), 0.1));
  d = min(d, sdRB(rY(q - vec3f(1.2, 1.1, 4.6), 1.2), vec3f(0.65, 0.4, 0.6), 0.1));
  d = min(d, sdRB(rZ(q - vec3f(-2.8, 0.95, -4.4), 0.5), vec3f(0.68, 0.53, 0.7), 0.1));
  d = min(d, sdRB(q - vec3f(0.35, 1.0, 0.4), vec3f(0.5, 0.3, 0.5), 0.1) + 0.0 * q.x);
  let n = nz(q * 0.35); let n2 = nz(q * 1.4);
  d += (n.r - 0.5) * 0.12 + (n2.g - 0.5) * 0.04;
  d += smoothstep(0.62, 0.8, n.b) * 0.04;
  return d;
}
fn stag(q0: vec3f) -> f32 {
  var d = sdRB(q0 - vec3f(0.3, 0.6, 0.0), vec3f(4.7, 0.85, 2.3), 0.3);
  d += (nz(q0 * 0.3).r - 0.5) * 0.35;
  let q = q0 - vec3f(-0.2, 1.4, 0.0);
  let qs = vec3f(q.x, q.y, abs(q.z));
  var s = sdEll(q - vec3f(0.0, 3.6, 0.0), vec3f(2.3, 1.28, 1.12));
  s = smin(s, sdEll(q - vec3f(1.45, 3.65, 0.0), vec3f(1.2, 1.5, 1.12)), 0.7);
  s = smin(s, sdEll(q - vec3f(-1.55, 3.8, 0.0), vec3f(1.2, 1.2, 1.08)), 0.7);
  s = smin(s, sdCap(q, vec3f(1.85, 4.1, 0.0), vec3f(2.65, 5.45, 0.0), 0.82, 0.5), 0.6);
  s = smin(s, sdEll(q - vec3f(1.9, 4.0, 0.0), vec3f(0.9, 1.0, 0.95)), 0.5);
  s = smin(s, sdEll(q - vec3f(2.95, 5.85, 0.0), vec3f(0.66, 0.52, 0.44)), 0.3);
  s = smin(s, sdCap(q, vec3f(3.15, 5.8, 0.0), vec3f(3.95, 5.35, 0.0), 0.38, 0.22), 0.25);
  s = smin(s, sdEll(qs - vec3f(3.12, 6.08, 0.24), vec3f(0.3, 0.16, 0.18)), 0.15);
  s = smin(s, sdEll(q - vec3f(3.95, 5.38, 0.0), vec3f(0.24, 0.2, 0.22)), 0.12);
  s = max(s, -sdEll(qs - vec3f(3.32, 5.95, 0.38), vec3f(0.14, 0.1, 0.1)));
  s = smin(s, sdEll(rX(rZ(qs - vec3f(2.6, 6.3, 0.66), -0.5), -0.6), vec3f(0.1, 0.5, 0.26)), 0.1);
  // legs
  s = smin(s, sdCap(qs, vec3f(1.6, 3.1, 0.55), vec3f(1.78, 1.55, 0.52), 0.52, 0.26), 0.4);
  s = smin(s, sdEll(qs - vec3f(1.8, 1.55, 0.52), vec3f(0.25, 0.28, 0.23)), 0.12);
  s = smin(s, sdCap(qs, vec3f(1.78, 1.55, 0.52), vec3f(1.68, 0.14, 0.52), 0.2, 0.15), 0.1);
  s = smin(s, sdEll(qs - vec3f(1.76, 0.07, 0.52), vec3f(0.25, 0.16, 0.21)), 0.06);
  s = smin(s, sdCap(qs, vec3f(-1.7, 3.5, 0.6), vec3f(-1.35, 1.95, 0.55), 0.68, 0.3), 0.45);
  s = smin(s, sdEll(qs - vec3f(-1.42, 1.95, 0.55), vec3f(0.27, 0.3, 0.24)), 0.12);
  s = smin(s, sdCap(qs, vec3f(-1.35, 1.95, 0.55), vec3f(-1.85, 0.9, 0.52), 0.23, 0.17), 0.12);
  s = smin(s, sdCap(qs, vec3f(-1.85, 0.9, 0.52), vec3f(-1.75, 0.14, 0.52), 0.17, 0.14), 0.08);
  s = smin(s, sdEll(qs - vec3f(-1.74, 0.07, 0.52), vec3f(0.24, 0.15, 0.2)), 0.06);
  s = smin(s, sdEll(q - vec3f(-2.75, 4.05, 0.0), vec3f(0.32, 0.22, 0.16)), 0.2);
  // antlers
  let A0 = vec3f(2.75, 6.35, 0.28); let A1 = vec3f(2.5, 7.3, 1.05); let A2 = vec3f(2.0, 8.5, 1.8); let A3 = vec3f(1.55, 9.7, 2.3); let A4 = vec3f(1.35, 10.9, 2.35); let A5 = vec3f(1.5, 11.9, 2.0);
  var an = sdCap(qs, A0, A1, 0.27, 0.23);
  an = smin(an, sdCap(qs, A1, A2, 0.23, 0.2), 0.1);
  an = smin(an, sdCap(qs, A2, A3, 0.2, 0.17), 0.1);
  an = smin(an, sdCap(qs, A3, A4, 0.17, 0.14), 0.1);
  an = smin(an, sdCap(qs, A4, A5, 0.14, 0.08), 0.08);
  an = smin(an, sdCap(qs, mix(A0, A1, 0.5), vec3f(3.6, 7.0, 1.1), 0.18, 0.06), 0.08);
  an = smin(an, sdCap(qs, mix(A0, A1, 0.9), vec3f(3.35, 7.9, 1.4), 0.16, 0.06), 0.08);
  an = smin(an, sdCap(qs, mix(A1, A2, 0.8), vec3f(2.95, 9.3, 2.05), 0.16, 0.055), 0.07);
  an = smin(an, sdCap(qs, mix(A2, A3, 0.8), vec3f(2.35, 10.6, 2.6), 0.15, 0.05), 0.07);
  an = smin(an, sdCap(qs, mix(A3, A4, 0.7), vec3f(0.75, 11.0, 2.75), 0.13, 0.05), 0.06);
  an = smin(an, sdCap(qs, A4, vec3f(2.0, 11.9, 2.6), 0.12, 0.045), 0.05);
  an = smin(an, sdCap(qs, A5, vec3f(1.1, 12.6, 1.85), 0.08, 0.04), 0.05);
  an = smin(an, sdCap(qs, A5, vec3f(1.9, 12.5, 1.7), 0.08, 0.04), 0.05);
  s = smin(s, an, 0.12);
  let n = nz(q * 0.6); let n2 = nz(q * 2.3);
  s += (n.r - 0.5) * 0.06 + (n2.g - 0.5) * 0.025;
  s -= smoothstep(0.55, 0.8, n.g) * 0.05 * smoothstep(1.0, 4.0, q.y);
  return min(d, s);
}
// strata: per-layer radius jitter, constant inside a layer with a short transition -> vertical faces + ledges
fn strataR(y: f32, seed: f32) -> f32 {
  let L = floor(y / 2.6); let f = fract(y / 2.6);
  let a = hh(vec3f(L, seed, 3.0)).x; let b = hh(vec3f(L + 1.0, seed, 3.0)).x;
  return mix(a, b, smoothstep(0.8, 1.0, f));
}
fn rockForm(q0: vec3f, sc: f32, seed: f32) -> f32 {
  let q = q0 / sc;
  let r = hh(vec3f(seed));
  let ang = atan2(q.z, q.x);
  let n = nz(vec3f(q.x * 0.035, q.y * 0.008, q.z * 0.035) + seed);
  let foot = length(q.xz * vec2f(1.0, 1.25)) + (n.r - 0.5) * 12.0 + sin(ang * 3.0 + seed) * 1.4;
  let h = q.y;
  var R = 11.0 - max(h, 0.0) * 0.1 + (strataR(h, seed) - 0.5) * 3.0;
  R += smoothstep(12.5, 16.0, h) * (2.0 + r.x * 2.0);
  var d = foot - R;
  let top = 17.0 + (nz(vec3f(q.x * 0.06, 0.3, q.z * 0.06) + seed).g - 0.5) * 5.0;
  d = max(d, h - top);
  d = max(d, -sdEll(q - vec3f(-8.0 + r.y * 4.0, 1.0, 3.0), vec3f(6.5, 4.2 + r.z * 1.5, 8.0)));
  let cr = nz(vec3f(ang * 1.27, q.y * 0.04, seed * 0.37)).b;
  d += smoothstep(0.74, 0.9, cr) * 0.9;
  d += (nz(q * 0.45).r - 0.5) * 0.35;
  return d * sc * 0.7;
}
fn floatRock(q0: vec3f, sc: f32, seed: f32) -> f32 {
  let q = q0 / sc;
  let r = hh(vec3f(seed * 1.7));
  let n = nz(vec3f(q.x * 0.12, q.y * 0.03, q.z * 0.12) + seed);
  let foot = length(q.xz * vec2f(1.0, 1.0 + r.y * 0.5)) + (n.r - 0.5) * 2.6;
  let R0 = 3.2 + r.x * 1.2; let depth = 4.5 + r.z * 3.0;
  let t = clamp(-q.y / depth, 0.0, 1.0);
  let R = R0 * pow(1.0 - t, 0.75) + (strataR(q.y * 1.5, seed) - 0.5) * 1.0 * (1.0 - t * 0.5);
  var d = foot - R;
  d = max(d, q.y - 0.4 - (n.g - 0.5) * 0.8);
  d = max(d, -q.y - depth - 0.3);
  d = min(d, sdCap(q, vec3f(r.y * 2.0 - 1.0, -depth * 0.4, r.x * 2.0 - 1.0), vec3f(r.y * 2.4 - 1.2, -depth - 0.4, r.z * 2.0 - 1.0), 0.9, 0.12));
  d = min(d, sdCap(q, vec3f(1.2 - r.z * 2.4, -depth * 0.3, r.y * 2.0 - 1.0), vec3f(1.3 - r.z * 2.6, -depth * 0.85, r.y * 2.2 - 1.1), 0.7, 0.1));
  d += (nz(q * 0.6).r - 0.5) * 0.22;
  return d * sc * 0.7;
}
fn boulder(q0: vec3f, sc: f32, seed: f32) -> f32 {
  let q = q0 / sc;
  var d = sdEll(q - vec3f(0.0, 0.3, 0.0), vec3f(2.0, 1.4, 1.7));
  let n = nz(q * 0.15 + seed); let n2 = nz(q * 0.5 + seed);
  d += (n.r - 0.5) * 1.4 + (n2.g - 0.5) * 0.15;
  return d * sc;
}
@compute @workgroup_size(4, 4, 4) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (any(g >= sp.dims.xyz)) { return; }
  let q = sp.org.xyz + vec3f(g) * sp.k.y;
  let kind = u32(sp.k.x);
  var d = 1e3;
  if (kind == 1u) { d = temple(q); }
  else if (kind == 2u) { d = stag(q); }
  else if (kind == 3u) { d = rockForm(q, sp.k.z, sp.p.w); }
  else if (kind == 4u) { d = floatRock(q, sp.k.z, sp.p.w); }
  else { d = boulder(q, sp.k.z, sp.p.w); }
  // force outside at grid border so surfaces close
  if (any(g == vec3u(0u)) || any(g >= sp.dims.xyz - 1u)) { d = max(d, 0.01); }
  outF[g.x + g.y * sp.dims.x + g.z * sp.dims.x * sp.dims.y] = d;
}
`;
