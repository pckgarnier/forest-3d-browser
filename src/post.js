// Compute-shader post chain (one compute pass per frame): volumetric light, bilateral blur, bloom.
export const POST = /*wgsl*/`
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tD: texture_depth_multisampled_2d;
@group(0) @binding(2) var tS0: texture_depth_2d;
@group(0) @binding(3) var tS1: texture_depth_2d;
@group(0) @binding(4) var sC: sampler_comparison;
@group(0) @binding(5) var oV: texture_storage_2d<rgba16float, write>;
fn hg(m: f32, g: f32) -> f32 { return (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * m, 1.5)); }
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let od = textureDimensions(oV); if (any(gid.xy >= od)) { return; }
  let pos = vec2f(gid.xy) + 0.5;
  let dims = vec2i(textureDimensions(tD));
  let pc = min(vec2i(gid.xy) * 2, dims - 1);
  let d = textureLoad(tD, pc, 0);
  let uv = (vec2f(pc) + 0.5) / vec2f(dims);
  let w = u.ivp * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-7), 1.0);
  let ro = u.cam.xyz; var rd = w.xyz / w.w - ro; var dist = length(rd); rd /= dist;
  dist = min(dist, 220.0);
  let ig = fract(52.9829189 * fract(dot(pos, vec2f(0.06711056, 0.00583715))));
  var T = 1.0; var acc = 0.0; var prev = 0.0;
  for (var k = 0; k < 32; k++) {
    let s = dist * pow((f32(k) + ig) / 32.0, 1.7);
    let ds = s - prev; prev = s;
    let p = ro + rd * s;
    let sg = fogSig(p);
    acc += T * (sg - rimS(p)) * shadow(p, false) * ds;
    T *= exp(-sg * ds);
  }
  let m = dot(rd, u.sun.xyz);
  let ph = hg(m, 0.62) * 0.65 + hg(m, 0.0) * 0.35;
  textureStore(oV, gid.xy, vec4f(u.sunc.rgb * vec3f(1.0, 0.92, 0.78) * acc * ph * 1.3, dist));
}
`;

export const BLUR = /*wgsl*/`
@group(0) @binding(0) var tI: texture_2d<f32>;
@group(0) @binding(1) var oT: texture_storage_2d<rgba16float, write>;
override DX: i32 = 1; override DY: i32 = 0;
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let dm = vec2i(textureDimensions(tI)) - 1;
  let pc = vec2i(gid.xy); if (any(pc > dm)) { return; }
  let c = textureLoad(tI, pc, 0);
  var acc = c.rgb; var ws = 1.0;
  for (var k = 1; k <= 5; k++) {
    let g = exp(-f32(k * k) / 10.0);
    for (var s = -1; s <= 1; s += 2) {
      let q = textureLoad(tI, clamp(pc + vec2i(DX, DY) * k * s, vec2i(0), dm), 0);
      let wt = g * exp(-abs(q.a - c.a) / (c.a * 0.06 + 0.3));
      acc += q.rgb * wt; ws += wt;
    }
  }
  textureStore(oT, gid.xy, vec4f(acc / ws, c.a));
}
`;

export const BLOOM = /*wgsl*/`
@group(0) @binding(0) var tI: texture_2d<f32>;
@group(0) @binding(1) var sK: sampler;
@group(0) @binding(2) var oT: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var tA: texture_2d<f32>;
override FIRST: bool = false;
fn kw(c: vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722))); }
fn s(uv: vec2f) -> vec3f { return min(textureSampleLevel(tI, sK, uv, 0.0).rgb, vec3f(200.0)); }
@compute @workgroup_size(8, 8) fn down(@builtin(global_invocation_id) gid: vec3u) {
  let od = textureDimensions(oT); if (any(gid.xy >= od)) { return; }
  let t = 1.0 / vec2f(textureDimensions(tI)); let uv = (vec2f(gid.xy) + 0.5) / vec2f(od);
  let a = s(uv + t * vec2f(-2, -2)); let b = s(uv + t * vec2f(0, -2)); let c = s(uv + t * vec2f(2, -2));
  let d = s(uv + t * vec2f(-2, 0)); let e = s(uv); let f = s(uv + t * vec2f(2, 0));
  let g = s(uv + t * vec2f(-2, 2)); let h = s(uv + t * vec2f(0, 2)); let ii = s(uv + t * vec2f(2, 2));
  let j = s(uv + t * vec2f(-1, -1)); let k = s(uv + t * vec2f(1, -1)); let l = s(uv + t * vec2f(-1, 1)); let m = s(uv + t * vec2f(1, 1));
  var r: vec3f;
  if (FIRST) {
    let g0 = (a + b + d + e) * 0.25; let g1 = (b + c + e + f) * 0.25; let g2 = (d + e + g + h) * 0.25; let g3 = (e + f + h + ii) * 0.25; let g4 = (j + k + l + m) * 0.25;
    let w0 = kw(g0) * 0.125; let w1 = kw(g1) * 0.125; let w2 = kw(g2) * 0.125; let w3 = kw(g3) * 0.125; let w4 = kw(g4) * 0.5;
    r = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else { r = e * 0.125 + (a + c + g + ii) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125; }
  textureStore(oT, gid.xy, vec4f(r, 1.0));
}
@compute @workgroup_size(8, 8) fn up(@builtin(global_invocation_id) gid: vec3u) {
  let od = textureDimensions(oT); if (any(gid.xy >= od)) { return; }
  let t = 1.0 / vec2f(textureDimensions(tI)); let uv = (vec2f(gid.xy) + 0.5) / vec2f(od);
  let r = s(uv + t * vec2f(-1, -1)) + s(uv + t * vec2f(1, -1)) + s(uv + t * vec2f(-1, 1)) + s(uv + t * vec2f(1, 1))
    + (s(uv + t * vec2f(0, -1)) + s(uv + t * vec2f(-1, 0)) + s(uv + t * vec2f(1, 0)) + s(uv + t * vec2f(0, 1))) * 2.0 + s(uv) * 4.0;
  textureStore(oT, gid.xy, vec4f(textureLoad(tA, gid.xy, 0).rgb + r / 16.0, 1.0));
}
`;
