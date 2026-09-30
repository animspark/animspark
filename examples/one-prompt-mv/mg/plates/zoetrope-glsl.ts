// Shader for the `zoetrope` plate: an engraved zoetrope (drum on a spindle and a turned base, on a table),
// raytraced analytically where it is a surface of revolution (drum walls, floor, lamp, table) and
// sphere-traced where it is a turned profile (rim beads, hub, column, pedestal, pin).
//  - engraving: bone burin lines on ink that follow the object's own parameters (around the drum at
//    constant height, rings on the floor and the turned base, around the bead's section), width = tone,
//    octave LOD by the analytic pixel footprint; the backlight recolours the lines ember
//  - the lyric is printed on an ink band round the drum's outside (a data texture: R sung fill, G heat,
//    B unsung), with persistence trails once it spins (the words smear into rings)
//  - the 16 slits are cut through the wall (exact, anti-aliased, closing with incidence); through them
//    the strip of 16 frames on the far inner wall. Spinning (relative to the camera), the slit band turns
//    into the persistence-of-vision window: the strip is sampled at the strobe instants (true zoetrope
//    mapping), so the caret inside bounces
//  - the lamp (the spark) sits on the pin in the drum; it lights the strip on "spin"
// World units: the drum radius is 1 (150 mm), y up, the drum's axis is the y axis.
import { SS_TAP_GLSL } from '../px/gl';

export const Z = {
  R_OUT: 1.0, R_IN: 0.976, H_TOP: 0.66, Y_FLOOR: 0.03,
  SLIT_Y0: 0.34, SLIT_Y1: 0.64, SLIT_HW: 0.006, NS: 16,
  BAND_Y0: 0.035, BAND_Y1: 0.305, TEX_Y0: 0.02, TEX_Y1: 0.02 + 208 / (4096 / (2 * Math.PI)),
  STRIP_Y0: 0.045, STRIP_Y1: 0.30,
  LAMP: [0, 0.145, 0] as [number, number, number], LAMP_R: 0.022,
  TABLE_Y: -1.0, BEAD_R: 0.988, BEAD_r: 0.022,
  N_TRAIL: 24,
};
const f = (x: number) => x.toFixed(6);

export const FRAG_ZOE = /* glsl */ `
${SS_TAP_GLSL}
uniform vec2 res;
uniform vec3 camPos, camR, camU, camF; uniform float focal;
uniform float th, thQ, strobeK, phiS, veilK;
uniform vec3 keyDir, rimDir; uniform float keyI, rimI, litK, tableK;
uniform float lampI, gateF, slitK, ringHeat, bladeK, ringHW;
uniform vec4 beatBand;
uniform sampler2D lyricTex, stripTex;
uniform float trailD[${Z.N_TRAIL}]; uniform float trailW[${Z.N_TRAIL}]; uniform int nTrail; uniform float trailSp, ringK; uniform sampler2D ringTex;
uniform float time;

const float R_OUT = ${f(Z.R_OUT)}, R_IN = ${f(Z.R_IN)}, H_TOP = ${f(Z.H_TOP)}, Y_FLOOR = ${f(Z.Y_FLOOR)};
const float SLIT_Y0 = ${f(Z.SLIT_Y0)}, SLIT_Y1 = ${f(Z.SLIT_Y1)}, SLIT_HW = ${f(Z.SLIT_HW)};
const float DELTA = TAU / ${Z.NS.toFixed(1)};
const float BAND_Y0 = ${f(Z.BAND_Y0)}, BAND_Y1 = ${f(Z.BAND_Y1)}, TEX_Y0 = ${f(Z.TEX_Y0)}, TEX_Y1 = ${f(Z.TEX_Y1)};
const float STRIP_Y0 = ${f(Z.STRIP_Y0)}, STRIP_Y1 = ${f(Z.STRIP_Y1)};
const vec3 LAMP = vec3(${Z.LAMP.map(f).join(',')}); const float LAMP_R = ${f(Z.LAMP_R)};
const float TABLE_Y = ${f(Z.TABLE_Y)}, BEAD_R = ${f(Z.BEAD_R)}, BEAD_r = ${f(Z.BEAD_r)};
const float LYR_W = 4096.0, LYR_H = 208.0, STR_W = 4096.0, STR_H = 170.0;

vec3 lampCol() { return mix(C_BONE, C_EMBER, 0.32); }

// ------------------------------------------------------------------ geometry
vec2 cyl(vec3 ro, vec3 rd, float r) {
  float a = dot(rd.xz, rd.xz);
  float b = dot(ro.xz, rd.xz);
  float c = dot(ro.xz, ro.xz) - r * r;
  float h = b * b - a * c;
  if (h < 0.0 || a < 1e-9) return vec2(1e9, -1e9);
  h = sqrt(h);
  return vec2((-b - h) / a, (-b + h) / a);
}
float sdRCylY(vec3 p, float r, float y0, float y1, float rr) {
  vec2 d = vec2(length(p.xz) - (r - rr), abs(p.y - 0.5 * (y0 + y1)) - (0.5 * (y1 - y0) - rr));
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - rr;
}
float sdTorY(vec3 p, float R, float r, float y) { return length(vec2(length(p.xz) - R, p.y - y)) - r; }
/** (distance, id): 1 top bead, 2 foot bead, 3 turned base (hub, collar, column, pedestal), 4 pin */
vec2 mapS(vec3 p) {
  float d = sdTorY(p, BEAD_R, BEAD_r, H_TOP); float id = 1.0;
  float d2 = sdTorY(p, 0.992, 0.017, 0.013); if (d2 < d) { d = d2; id = 2.0; }
  float rr = length(p.xz);
  if (rr < 0.62 && p.y < 0.01) {
    float b = sdRCylY(p, 0.24, -0.075, 0.0, 0.016);
    b = min(b, sdRCylY(p, 0.13, -0.17, -0.07, 0.012));
    b = min(b, sdRCylY(p, 0.066, -0.82, -0.16, 0.004));
    b = min(b, sdTorY(p, 0.074, 0.022, -0.30));
    b = min(b, sdTorY(p, 0.082, 0.03, -0.70));
    float ped = sdRCylY(p, 0.22, -0.875, -0.78, 0.028);
    ped = smin(ped, sdRCylY(p, 0.46, -0.945, -0.862, 0.036), 0.05);
    ped = smin(ped, sdRCylY(p, 0.56, -1.0, -0.94, 0.02), 0.022);
    b = smin(b, ped, 0.04);
    if (b < d) { d = b; id = 3.0; }
  } else d = min(d, max(rr - 0.6, p.y - 0.005) + 0.01);
  float pin = sdRCylY(p, 0.011, 0.02, 0.135, 0.004); if (pin < d) { d = pin; id = 4.0; }
  return vec2(d, id);
}
vec2 marchS(vec3 ro, vec3 rd, float tMin, float tMax) {
  vec2 bc = cyl(ro, rd, 1.02);
  float t0 = max(max(bc.x, tMin), 0.0), t1 = min(bc.y, tMax);
  if (abs(rd.y) > 1e-6) { float ta = (-1.005 - ro.y) / rd.y, tb = (0.71 - ro.y) / rd.y; t0 = max(t0, min(ta, tb)); t1 = min(t1, max(ta, tb)); }
  if (t0 >= t1) return vec2(1e9, 0.0);
  float t = t0;
  for (int i = 0; i < 120; i++) {
    vec2 h = mapS(ro + rd * t);
    if (h.x < 0.00035 * t) return vec2(t, h.y);
    t += h.x * 0.95;
    if (t > t1) break;
  }
  return vec2(1e9, 0.0);
}
vec3 normS(vec3 p, float t) {
  float e = 0.0004 * max(t, 1.0);
  vec2 k = vec2(1.0, -1.0);
  return normalize(k.xyy * mapS(p + k.xyy * e).x + k.yyx * mapS(p + k.yyx * e).x + k.yxy * mapS(p + k.yxy * e).x + k.xxx * mapS(p + k.xxx * e).x);
}

// ------------------------------------------------------------------ engraving (after the reference's ilya)
float hatchW(float u, float cov, float fw) {
  float d = 0.5 - abs(fract(u) - 0.5);
  float hw = 0.5 * clamp(cov, 0.0, 1.0);
  float aa = max(fw * 0.5, 1e-3);
  float l = clamp(min(d + aa, hw) - max(d - aa, -hw), 0.0, 2.0 * aa) / (2.0 * aa);
  return mix(l, clamp(cov, 0.0, 1.0), smoothstep(0.35, 0.8, fw));
}
/** lines at integer u, octave-LOD'd to stay >= ~5 logical px apart */
float hatchLOD(float u, float cov, float fw) {
  float lv = log2(max(fw * 5.0, 1e-5));
  float l0 = max(floor(lv), 0.0);
  float k = lv > 0.0 ? fract(lv) : 0.0;
  float s0 = exp2(l0), s1 = s0 * 2.0;
  float h0 = hatchW(u / s0, cov, fw / (s0 * PX_SCALE)), h1 = hatchW(u / s1, cov, fw / (s1 * PX_SCALE));
  return mix(h0, h1, smoothstep(0.1, 0.9, k));
}
/** world size of one logical pixel along axis, at a hit p with normal n (neighbour-ray / tangent-plane) */
float footprint(vec3 p, vec3 n, vec3 axis) {
  vec3 ro = camPos;
  float dn = dot(p - ro, n);
  vec3 d0 = normalize(p - ro);
  vec3 rx = normalize(d0 + camR / focal), ry = normalize(d0 + camU / focal);
  float ax = dot(rx, n), ay = dot(ry, n);
  vec3 px = ro + rx * (dn / (abs(ax) < 1e-4 ? -1e-4 : ax));
  vec3 py = ro + ry * (dn / (abs(ay) < 1e-4 ? -1e-4 : ay));
  return max(abs(dot(px - p, axis)), abs(dot(py - p, axis)));
}
float fpLen(vec3 p, vec3 n) {
  vec3 t1 = normalize(cross(n, abs(n.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  return max(footprint(p, n, t1), footprint(p, n, cross(n, t1)));
}
float rimOf(vec3 n, vec3 rd) {
  float nv = sat(dot(n, -rd));
  return pow(1.0 - nv, 3.0) * smoothstep(-0.1, 0.7, dot(n, rimDir)) * rimI;
}
/** bone lines of coverage cov, the rim turning them ember */
vec3 inkLines(float cov, float rim, float rl) {
  vec3 c = C_BONE * 0.78 * cov;
  c = mix(c, C_EMBER * 1.35 * max(rl, cov), smoothstep(0.06, 0.45, rim));
  return c + C_SIGNAL * 0.55 * pow(rim, 2.5);
}

// ------------------------------------------------------------------ light
/** the drum occludes a ray from p along L (outside the drum): walls between y 0..H */
float drumShadow(vec3 p, vec3 L) {
  vec2 c = cyl(p, L, R_OUT + 0.01);
  if (c.x > c.y || c.y < 0.0) return 1.0;
  float y0 = p.y + L.y * max(c.x, 0.0), y1 = p.y + L.y * c.y;
  float lo = min(y0, y1), hi = max(y0, y1);
  return (hi < -0.01 || lo > H_TOP + 0.02) ? 1.0 : 0.0;
}
float softShadowS(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.01;
  for (int i = 0; i < 26; i++) {
    float h = mapS(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.01, 0.12);
    if (res < 0.02 || t > 2.2) break;
  }
  return smoothstep(0.0, 1.0, sat(res));
}
/** key light reaching a point inside the drum: it has to come in over the rim */
float keyInside(vec3 p) {
  if (keyDir.y <= 0.01) return 0.0;
  float t = (H_TOP - p.y) / keyDir.y;
  vec2 q = p.xz + keyDir.xz * t;
  return smoothstep(R_IN + 0.004, R_IN - 0.03, length(q));
}
float lampAt(vec3 p, vec3 n) {
  vec3 L = LAMP - p; float d2 = dot(L, L);
  return lampI * max(dot(n, L * inversesqrt(d2)), 0.0) * 0.32 / (d2 + 0.03);
}
vec3 lampGlow(vec3 ro, vec3 rd, float tMax) {
  if (lampI <= 0.001) return vec3(0.0);
  vec3 lp = LAMP - ro; float tl = dot(lp, rd);
  if (tl <= 0.0 || tl > tMax + 0.05) return vec3(0.0);
  float apx = length(lp - rd * tl) / tl * focal;
  float rpx = LAMP_R / tl * focal;
  float core = exp(-apx * apx / max(rpx * rpx * 0.5, 2.0)) * 5.0;
  float halo = exp(-apx * apx / (rpx * rpx * 9.0 + 40.0)) * 0.6 + 0.05 / (1.0 + apx * apx / (rpx * rpx * 60.0 + 2000.0));
  return (vec3(1.0, 0.86, 0.7) * core + C_EMBER * halo) * lampI;
}

// ------------------------------------------------------------------ printed matter
vec4 lyricAt(float a, float y, float lod) {
  float v = (y - TEX_Y0) / (TEX_Y1 - TEX_Y0);
  float u = a / TAU;
  if (nTrail <= 1) return textureLod(lyricTex, vec2(u, v), lod);
  vec4 s = vec4(0.0);
  // each tap is itself smeared along the round (anisotropic filtering), so the taps join into streaks
  vec2 gx = vec2(max(trailSp / TAU, exp2(lod) / LYR_W), 0.0), gy = vec2(0.0, exp2(max(lod, 1.0)) / LYR_H);
  for (int i = 0; i < ${Z.N_TRAIL}; i++) {
    if (i >= nTrail) break;
    s += textureGrad(lyricTex, vec2(u + trailD[i] / TAU, v), gx, gy) * trailW[i];
  }
  return s;
}
/** the strip (frames) at drum angle a (frame j centred on slit j), height y; seen from inside */
vec3 stripAt(float a, float y, float lod) {
  float fj = (a - phiS) / DELTA + 0.5;
  float j = mod(floor(fj), 16.0);
  float lx = 1.0 - fract(fj);
  float v = (y - STRIP_Y0) / (STRIP_Y1 - STRIP_Y0);
  return textureLod(stripTex, vec2((j + lx) / 16.0, v), lod).rgb;
}
vec3 heatType(float h, vec3 bone) {
  vec3 c = mix(bone, C_SIGNAL * 1.25, smoothstep(0.0, 0.45, h));
  return mix(c, C_EMBER * 2.1, smoothstep(0.5, 1.0, h));
}

// ------------------------------------------------------------------ surfaces
/** slit offset: tangential distance from the nearest slit centre (world), p on a wall */
float slitDT(vec3 p, out float kIdx) {
  float a = atan(p.x, p.z) - th - phiS;
  float k = floor(a / DELTA + 0.5);
  kIdx = mod(k, 16.0);
  return length(p.xz) * sin(a - k * DELTA);
}

vec3 shadeOuter(vec3 p, vec3 rd, float veil) {
  vec3 n = vec3(p.x, 0.0, p.z) / R_OUT;
  vec3 tg = vec3(n.z, 0.0, -n.x);
  float a = atan(p.x, p.z) - th;
  float dif = max(dot(n, keyDir), 0.0);
  float tone = litK * keyI * (0.015 + 0.985 * pow(dif, 1.6));
  float spY = 0.0068;
  float fpY = footprint(p, n, vec3(0.0, 1.0, 0.0));
  float fpA = footprint(p, n, tg);
  float cov = hatchLOD(p.y / spY, pow(tone, 1.25) * 0.95, fpY / spY);
  // crossing lines in the lights: they run up the drum and turn with it (smeared when it spins)
  float spA = 0.016;
  float lbw = sat(tone * 1.7 - 1.0) * 0.7;
  float lb = mix(hatchLOD(a * R_OUT / spA, lbw, fpA / spA), lbw * 0.45, veil);
  float rim = rimOf(n, rd);
  float rl = hatchLOD(p.y / spY, sat(rim * 1.3) * 0.9, fpY / spY);
  bool band = p.y > BAND_Y0 && p.y < BAND_Y1;
  if (band) { cov *= 0.16; lb = 0.0; rl *= 0.3; }
  vec3 col = inkLines(max(cov, lb), rim * (band ? 0.35 : 1.0), rl);
  // heat travelling down the burin lines on the beats
  float bb = exp(-pow((p.y - beatBand.x) / beatBand.y, 2.0)) * beatBand.z;
  col += C_EMBER * 1.4 * bb * max(cov, 0.15 * float(!band)) * litK;
  // printed matter: the lyric band, rules, slit numbers
  if (p.y > TEX_Y0 && p.y < TEX_Y1) {
    float lod = log2(max(max(fpA * LYR_W / TAU, fpY * LYR_H / (TEX_Y1 - TEX_Y0)), 1e-4));
    vec4 tx = lyricAt(a, p.y, lod);
    float shadeT = litK * (0.58 + 0.42 * sqrt(dif));
    vec3 bone = C_BONE * 0.9 * shadeT;
    float fill = sat(tx.r);
    float h = tx.g / max(tx.r, 1e-3);
    // smeared into rings: the rows where the letters' strokes run (cap line, bars, baseline) stay lit
    float ring = texture(ringTex, vec2((p.y - TEX_Y0) / (TEX_Y1 - TEX_Y0), 0.5)).r;
    fill = mix(fill, ring * 0.95, ringK);
    h = mix(h, h * 0.8, ringK);
    col = mix(col, heatType(h * litK, bone), fill);
    col = mix(col, C_BONE * 0.3 * shadeT, sat(tx.b) * (1.0 - fill));
  }
  return col;
}

/** inside face of the wall (normal toward the axis). aStrip: drum angle for the strip lookup */
vec3 shadeInner(vec3 p, vec3 rd, float aStrip, float slitOpen) {
  vec3 n = -vec3(p.x, 0.0, p.z) / R_IN;
  float kv = keyInside(p) * max(dot(n, keyDir), 0.0) * keyI * litK;
  float lp = lampAt(p, n);
  vec3 E = vec3(kv * 0.95) + lampCol() * lp;
  vec3 tg = vec3(n.z, 0.0, -n.x);
  float fpY = footprint(p, n, vec3(0.0, 1.0, 0.0));
  if (p.y > STRIP_Y0 && p.y < STRIP_Y1) {
    float fpA = footprint(p, n, tg);
    float lod = log2(max(max(fpA * STR_W / (TAU * R_IN), fpY * STR_H / (STRIP_Y1 - STRIP_Y0)), 1e-4));
    vec3 paper = stripAt(aStrip, p.y, lod);
    return paper * (E * 0.95 + 0.004);
  }
  // black lacquer above the strip: engraved lines by the light that reaches it
  float tone = 1.0 - exp(-max(E.r, max(E.g, E.b)) * 1.6);
  float sp = 0.0075;
  float cov = hatchLOD(p.y / sp, pow(tone, 1.3) * 0.95, fpY / sp);
  vec3 lc = E / max(max(E.r, max(E.g, E.b)), 1e-4);
  vec3 col = C_BONE * 0.7 * cov * mix(vec3(1.0), lc, 0.6);
  // the far slits open onto the dark outside
  if (slitOpen > 0.0 && p.y > SLIT_Y0 && p.y < SLIT_Y1) {
    float k; float dt = slitDT(p, k);
    float fpT = footprint(p, n, tg);
    float c = sat((SLIT_HW - abs(dt)) / max(fpT, 1e-5) + 0.5);
    col = mix(col, C_INK * 0.05, c * slitOpen);
  }
  return col;
}

vec3 shadeFloor(vec3 p) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  float r = length(p.xz);
  float kv = keyInside(p) * max(keyDir.y, 0.0) * keyI * litK;
  float lp = lampAt(p, n);
  vec3 E = vec3(kv * 0.9) + lampCol() * lp;
  float tone = 1.0 - exp(-max(E.r, max(E.g, E.b)) * 1.5);
  vec3 radial = r > 1e-4 ? vec3(p.x, 0.0, p.z) / r : vec3(1.0, 0.0, 0.0);
  float sp = 0.0085;
  float cov = hatchLOD(r / sp, pow(tone, 1.35) * 0.9, footprint(p, n, radial) / sp);
  vec3 lc = E / max(max(E.r, max(E.g, E.b)), 1e-4);
  return C_BONE * 0.5 * cov * mix(vec3(1.0), lc, 0.6);
}

vec3 shadeS(vec3 p, vec3 rd, float t, float id) {
  vec3 n = normS(p, t);
  float r = length(p.xz);
  vec3 radial = r > 1e-4 ? vec3(p.x, 0.0, p.z) / r : vec3(1.0, 0.0, 0.0);
  float rim = rimOf(n, rd);
  if (id < 1.5) {
    // the rim bead (brass): lines round its section; the H6 ring lives on its crest
    float phi = atan(p.y - H_TOP, r - BEAD_R);
    vec3 tm = normalize(-sin(phi) * radial + vec3(0.0, cos(phi), 0.0));
    float dif = max(dot(n, keyDir), 0.0) * (p.y > H_TOP - 0.004 || dot(n, radial) > 0.0 ? 1.0 : keyInside(p));
    float spec = pow(max(dot(n, normalize(keyDir - rd)), 0.0), 40.0);
    float tone = litK * keyI * (0.02 + 0.98 * pow(dif, 1.5));
    float sp = 0.0045;
    float fp = footprint(p, n, tm) / sp;
    float cov = hatchLOD(phi * BEAD_r / sp, pow(tone, 1.2) * 1.0, fp);
    float rl = hatchLOD(phi * BEAD_r / sp, sat(rim * 1.3) * 0.9, fp);
    vec3 col = inkLines(cov, rim, rl) + C_BONE * 0.8 * smoothstep(0.35, 0.7, spec) * litK * keyI;
    // heat: the ring of the hand-off (a stroke of exactly 2 ringHW across the crest), a flash on the beats
    float fpR = max(footprint(p, n, radial), 1e-5);
    float stroke = sat((ringHW - abs(r - BEAD_R)) / fpR + 0.5) * step(H_TOP, p.y);
    float crest = smoothstep(0.55, 0.95, n.y);
    col = mix(col, C_SIGNAL * 1.0, stroke * sat(ringHeat * 1.5)) + C_SIGNAL * 0.25 * stroke * ringHeat;
    col += C_EMBER * 1.2 * beatBand.w * crest;
    return col;
  }
  if (id < 2.5) {
    float phi = atan(p.y - 0.013, r - 0.992);
    vec3 tm = normalize(-sin(phi) * radial + vec3(0.0, cos(phi), 0.0));
    float dif = max(dot(n, keyDir), 0.0);
    float tone = litK * keyI * (0.02 + 0.98 * pow(dif, 1.3));
    float sp = 0.0042;
    float fp = footprint(p, n, tm) / sp;
    return inkLines(hatchLOD(phi * 0.017 / sp, tone * 1.1, fp), rim, hatchLOD(phi * 0.017 / sp, sat(rim * 1.3) * 0.9, fp));
  }
  if (id < 3.5) {
    // turned base: lathe rings (constant y on the sides, constant r on the flats)
    float sh = drumShadow(p + n * 0.003, keyDir);
    if (sh > 0.0) sh *= softShadowS(p + n * 0.004, keyDir);
    float dif = max(dot(n, keyDir), 0.0) * sh;
    float tone = litK * keyI * (0.012 + 0.988 * pow(dif, 1.6)) * 0.9;
    bool flat_ = abs(n.y) > 0.62;
    float sp = flat_ ? 0.0085 : 0.0062;
    float u = flat_ ? r / sp : p.y / sp;
    float fp = footprint(p, n, flat_ ? radial : vec3(0.0, 1.0, 0.0)) / sp;
    float cov = hatchLOD(u, pow(tone, 1.25) * 0.95, fp);
    float rl = hatchLOD(u, sat(rim * 1.3) * 0.9, fp);
    return inkLines(cov, rim, rl);
  }
  // the pin: lit by its lamp
  float lp = lampAt(p, n);
  float kv = keyInside(p) * max(dot(n, keyDir), 0.0) * keyI * litK;
  return (C_BONE * 0.4 * kv + lampCol() * lp * 0.8);
}

vec3 shadeTable(vec3 p) {
  vec3 n = vec3(0.0, 1.0, 0.0);
  float r = length(p.xz);
  float sh = drumShadow(p + n * 0.002, keyDir);
  if (sh > 0.0 && r < 1.9) sh *= softShadowS(p + n * 0.004, keyDir);
  float dif = max(keyDir.y, 0.0) * sh;
  float fog = exp(-max(r - 0.9, 0.0) * 2.1);
  float tone = litK * keyI * tableK * (0.01 + 0.99 * dif) * 0.42 * fog;
  // contact darkening under the foot
  tone *= smoothstep(0.55, 0.72, r);
  float sp = 0.014;
  float cov = hatchLOD(p.x / sp, pow(tone, 1.2) * 0.9, footprint(p, n, vec3(1.0, 0.0, 0.0)) / sp);
  return C_BONE * 0.6 * cov;
}

vec3 bg(vec3 rd) { return C_INK * (0.55 + 0.25 * smoothstep(-0.3, 0.4, rd.y)) * litK; }

/**
 * A ray inside the drum (entered through the top or a slit at tEnter, psiN = world angle of the slit
 * it came through). strobe: 0 = the strip where it is now, 1 = where it was at the strobe instant.
 */
vec3 inside(vec3 ro, vec3 rd, float tEnter, float psiN, float strobe, out float tHit) {
  vec2 ci = cyl(ro, rd, R_IN);
  float tE = ci.y;
  vec3 pe = ro + rd * tE;
  float tF = rd.y < 0.0 ? (Y_FLOOR - ro.y) / rd.y : 1e9;
  float tT = rd.y > 0.0 ? (H_TOP - ro.y) / rd.y : 1e9;
  float tEnd = min(tE, min(tF, tT));
  vec2 s = marchS(ro, rd, tEnter, tEnd + 0.25);
  vec3 col;
  float tH;
  // the lamp itself
  vec3 oc = ro - LAMP; float b = dot(oc, rd), c = dot(oc, oc) - LAMP_R * LAMP_R, h = b * b - c;
  float tL = h > 0.0 ? -b - sqrt(h) : 1e9;
  if (tL > tEnter && tL < min(tEnd, s.x)) {
    tH = tL;
    col = vec3(1.0, 0.9, 0.76) * 5.0 * lampI + C_INK * 0.2;
  } else if (s.x < tEnd + 0.25 && s.x < 1e8 && (s.x < tEnd || tEnd == tT)) {
    tH = s.x;
    col = shadeS(ro + rd * s.x, rd, s.x, s.y);
  } else if (tEnd == tF) {
    tH = tF;
    col = shadeFloor(ro + rd * tF);
  } else if (tEnd == tE) {
    tH = tE;
    float psiF = atan(pe.x, pe.z);
    float aNow = psiF - th;
    float aStr = aNow;
    if (strobe > 0.0) {
      float k = floor((psiN - thQ - phiS) / DELTA + 0.5);
      aStr = psiF - psiN + k * DELTA + phiS;
    }
    // exact (the strip where it is) or the strobe image; the far slits close up as the drum blurs
    col = strobe > 0.999 ? shadeInner(pe, rd, aStr, 0.0) : strobe < 0.001 ? shadeInner(pe, rd, aNow, 1.0)
      : mix(shadeInner(pe, rd, aNow, 1.0), shadeInner(pe, rd, aStr, 0.0), strobe);
  } else {
    tH = tT;
    col = bg(rd);
  }
  tHit = tH;
  return col + lampGlow(ro, rd, tH);
}

/** rays that miss the drum's walls: base, beads, table, background */
vec3 outside(vec3 ro, vec3 rd, out float tHit) {
  float tTab = rd.y < 0.0 ? (TABLE_Y - ro.y) / rd.y : 1e9;
  vec2 s = marchS(ro, rd, 0.0, min(tTab, 1e3));
  if (s.x < tTab) { tHit = s.x; return shadeS(ro + rd * s.x, rd, s.x, s.y); }
  if (tTab < 1e8) { tHit = tTab; return mix(bg(rd), shadeTable(ro + rd * tTab), 1.0); }
  tHit = 1e9;
  return bg(rd);
}

vec3 trace(vec3 ro, vec3 rd) {
  vec2 co = cyl(ro, rd, R_OUT);
  float tOut = 1e9; vec3 pO = vec3(0.0);
  if (co.x < co.y && co.x > 0.0) { pO = ro + rd * co.x; if (pO.y > 0.0 && pO.y < H_TOP) tOut = co.x; }
  float tTopIn = 1e9;
  if (tOut > 1e8 && rd.y < 0.0) {
    float tt = (H_TOP - ro.y) / rd.y; vec3 q = ro + rd * tt;
    if (tt > 0.0 && dot(q.xz, q.xz) < R_IN * R_IN) tTopIn = tt;
  }
  float tLim = min(tOut, tTopIn);
  float tH;
  if (tLim > 1e8) return outside(ro, rd, tH);
  // beads (and the base) in front of the drum's walls
  vec2 s = marchS(ro, rd, 0.0, tLim);
  if (s.x < tLim) return shadeS(ro + rd * s.x, rd, s.x, s.y);
  if (tTopIn < 1e8) return inside(ro, rd, tTopIn, 0.0, 0.0, tH);
  // ---- the outer wall, its slits, and the persistence-of-vision window
  vec3 n = vec3(pO.x, 0.0, pO.z) / R_OUT;
  vec3 tg = vec3(n.z, 0.0, -n.x);
  float fpT = footprint(pO, n, tg), fpY = footprint(pO, n, vec3(0.0, 1.0, 0.0));
  float inBand = sat((pO.y - SLIT_Y0) / fpY + 0.5) * sat((SLIT_Y1 - pO.y) / fpY + 0.5);
  float open = 0.0;
  if (inBand > 0.0) {
    float k; float dt = slitDT(pO, k);
    // where the ray leaves the wall's inside face: the slit's walls close it with incidence
    vec2 ci = cyl(ro, rd, R_IN);
    vec3 pI = ro + rd * ci.x;
    float k2; float dt2 = ci.x < ci.y ? slitDT(pI, k2) : 1.0;
    float c1 = sat((SLIT_HW - abs(dt)) / max(fpT, 1e-5) + 0.5);
    float c2 = sat((SLIT_HW - abs(dt2)) / max(fpT, 1e-5) + 0.5);
    open = min(c1, c2) * inBand;
  }
  float tanInc = abs(dot(rd, tg)) / max(abs(dot(rd, n)), 1e-3);
  float win = inBand * strobeK * veilK * sat(1.0 - 1.25 * tanInc);   // the POV window
  vec3 wall = shadeOuter(pO, rd, strobeK);
  float through = mix(open, win, strobeK);
  if (through <= 0.0005) return wall;
  float tI;
  vec3 th_ = inside(ro, rd, co.x + 0.001, atan(pO.x, pO.z), strobeK, tI);
  // the gate: at the end the lit strip behind the one slit burns out to white
  th_ = mix(th_, vec3(1.0, 0.93, 0.82) * 1.9, gateF);
  // the slit's side walls where it is partly open
  return mix(wall * (1.0 - 0.6 * open * (1.0 - strobeK)), th_, through);
}

/** light blades: the lamp through the 16 slits, thin wedges of lit haze outside the drum */
vec3 blades(vec3 ro, vec3 rd) {
  if (bladeK <= 0.001) return vec3(0.0);
  vec2 co = cyl(ro, rd, R_OUT);
  float tOcc = rd.y < 0.0 ? (TABLE_Y - ro.y) / rd.y : 1e9;
  if (co.x < co.y && co.x > 0.0) {
    float y = ro.y + rd.y * co.x;
    if (y > -1.0 && y < H_TOP + 0.03) tOcc = min(tOcc, co.x);
    else if (rd.y < 0.0) { float tt = (H_TOP - ro.y) / rd.y; if (tt > co.x && tt < co.y) tOcc = min(tOcc, tt); }
  }
  vec3 acc = vec3(0.0);
  for (int k = 0; k < 16; k++) {
    float ang = th + phiS + float(k) * DELTA;
    vec2 dir = vec2(sin(ang), cos(ang));
    vec2 nk = vec2(cos(ang), -sin(ang));
    float dn = dot(rd.xz, nk);
    if (abs(dn) < 1e-5) continue;
    float t = -dot(ro.xz, nk) / dn;
    if (t <= 0.0 || t > tOcc) continue;
    vec3 X = ro + rd * t;
    float r = dot(X.xz, dir);
    if (r < R_OUT) continue;
    float yl = LAMP.y + (SLIT_Y0 - LAMP.y) * r, yh = LAMP.y + (SLIT_Y1 - LAMP.y) * r;
    float fy = smoothstep(yl, yl + 0.025 * r, X.y) * smoothstep(yh, yh - 0.025 * r, X.y);
    if (fy <= 0.0) continue;
    float path = min(2.0 * SLIT_HW * r / abs(dn), 0.35);
    float d2 = r * r + (X.y - LAMP.y) * (X.y - LAMP.y);
    float haze = 0.75 + 0.5 * snoise(vec3(X.xz * 1.3, X.y * 1.1 + time * 0.25));
    acc += vec3(fy * path / d2 * exp(-(r - 1.0) * 0.9) * haze * smoothstep(1.0, 1.35, r));
  }
  return lampCol() * acc * bladeK;
}

void main() {
  vec2 px0 = vUv * res - 0.5 * res;
  vec3 col = vec3(0.0);
  for (int k = ssK0(); k < ssK1(); k++) {
    vec2 px = px0 + rgss(k) / PX_SCALE;
    vec3 rd = normalize(camF * focal + camR * px.x + camU * px.y);
    col += trace(camPos, rd);
  }
  col *= ssWeight();
  col += blades(camPos, normalize(camF * focal + camR * px0.x + camU * px0.y));
  // the hand-off: everything but the one slit goes dark
  if (slitK > 0.0) {
    vec2 q = abs(px0) - vec2(${(6).toFixed(1)}, ${(150).toFixed(1)});
    float inside = sat(0.5 - max(q.x, q.y));
    float soft = exp(-max(max(q.x, q.y), 0.0) / 14.0);
    col *= mix(1.0, mix(0.12 * soft, 1.0, inside), slitK);
  }
  fragColor = vec4(col, 1.0);
}`;
