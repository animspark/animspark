// Plate `beam`: the cinema hall, raymarched and shaded as a white-line engraving, with the projector's
// beam as importance-sampled volumetric haze (samples only where the ray is inside the beam's frustum).
//  - the house: raked floor, 25 rows of seats (hairline rims lit from the screen), fluted side walls with
//    pilasters and EXIT signs, a coffered ceiling, the proscenium with its fascia, the stage and black masking;
//  - the booth port in the back wall: the douser's blades and, through their gap, the lamp;
//  - the screen: an area light (Lambert's polygon form factor) whose image is the lit rectangle, the word
//    "a light" (coverage texture, per-glyph colour and alpha as uniforms) and the beam's footprint.
// World units are metres, y up; the screen is the plane z = 0 facing +z.
import { SS_TAP_GLSL } from '../px/gl';
import { HALL, APEX, SG, GATE_HH, GATE_HW } from './beam-kit';

const f = (x: number) => x.toFixed(5);
const v3 = (a: readonly number[]) => `vec3(${a.map(f).join(', ')})`;

export const EXITS: [number, number, number][] = [[-8.97, 3.15, 7.0], [8.97, 3.15, 7.0], [-8.97, 6.25, 24.5], [8.97, 6.25, 24.5]];

export const HALL_FRAG = /* glsl */ `
${SS_TAP_GLSL}
uniform vec2 res;
uniform vec3 camPos, camR, camU, camF; uniform float focal;
uniform float time, jit;
uniform float openK, gateI, hazeK, beamI, scrS, scrLum, imageK, endMask, fillI, exitI, gain;
uniform vec4 fr[6];
uniform float gA[6]; uniform vec3 gCol[6]; uniform float gB[7];
uniform sampler2D imgTex;
uniform vec4 maskR; // centre x, y (y down), half w, half h — logical px

const vec3 SC = ${v3(HALL.SC)};
const float SHW = ${f(HALL.SHW)}, SHH = ${f(HALL.SHH)};
const vec3 APEX = ${v3(APEX)};
const vec3 GATE = ${v3(HALL.G)};
const float GZ = ${f(HALL.G[2])};
const float GATE_HH = ${f(GATE_HH)}, GATE_HW = ${f(GATE_HW)}, SG = ${f(SG)};
const float BACKZ = ${f(HALL.backZ)};
const float RAKE0 = ${f(HALL.rake0)}, RAKEK = ${f(HALL.rakeK)};
const float ROW0 = ${f(HALL.row0)}, ROWP = ${f(HALL.rowP)}, NROW = ${f(HALL.NROW)};
const float SEATP = ${f(HALL.seatP)};
const float WALLX = ${f(HALL.wallX)}, CEILY = ${f(HALL.ceilY)};
const vec3 EXIT0 = ${v3(EXITS[0]!)}, EXIT1 = ${v3(EXITS[1]!)}, EXIT2 = ${v3(EXITS[2]!)}, EXIT3 = ${v3(EXITS[3]!)};
const vec3 LAMP = vec3(1.0, 0.93, 0.82) * 1.9;

float floorY(float z) { return RAKEK * max(z - RAKE0, 0.0); }
float sdRBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }

// ------------------------------------------------------------------ geometry
float mapSeats(vec3 p) {
  float band = p.y - (floorY(p.z + 0.4) + 1.05);
  if (band > 0.25 || p.z < ROW0 - 0.8 || p.z > ROW0 + NROW * ROWP) return max(band, 0.05) * 0.9;
  float k = clamp(floor((p.z - ROW0) / ROWP + 0.5), 0.0, NROW - 1.0);
  float zk = ROW0 + k * ROWP;
  float yk = floorY(zk);
  float sx = p.x >= 0.0 ? 1.0 : -1.0;
  float j = clamp(floor((abs(p.x) - 1.12) / SEATP + 0.5), 0.0, 11.0);
  float xc = sx * (1.12 + j * SEATP);
  vec3 q = vec3(p.x - xc, p.y - yk, p.z - zk);
  float back = sdRBox(q - vec3(0.0, 0.64, 0.27), vec3(0.245, 0.34, 0.05), 0.045);
  float seat = sdRBox(q - vec3(0.0, 0.47, 0.07), vec3(0.22, 0.19, 0.045), 0.04);   // folded up: nobody
  vec3 qa = vec3(abs(q.x) - 0.28, q.y, q.z);
  float arm = sdRBox(qa - vec3(0.0, 0.6, 0.06), vec3(0.028, 0.035, 0.25), 0.02);
  float std_ = sdRBox(qa - vec3(0.0, 0.3, 0.12), vec3(0.022, 0.3, 0.06), 0.01);
  return min(min(back, seat), min(arm, std_));
}
float mapProsc(vec3 p) {
  vec3 pp = p - vec3(0.0, 0.0, 1.3);
  float d = max(sdBox3(pp - vec3(0.0, 5.3, 0.0), vec3(9.5, 5.3, 0.2)), -sdBox3(pp - vec3(0.0, 4.2, 0.0), vec3(7.6, 4.2, 1.0)));
  d = min(d, sdRBox(vec3(abs(pp.x) - 7.9, pp.y - 4.3, pp.z - 0.26), vec3(0.32, 4.3, 0.1), 0.02));       // pilasters
  d = min(d, sdRBox(vec3(abs(pp.x) - 7.9, pp.y - 8.72, pp.z - 0.3), vec3(0.4, 0.14, 0.14), 0.02));      // capitals
  d = min(d, sdRBox(vec3(abs(pp.x) - 7.9, pp.y - 0.12, pp.z - 0.3), vec3(0.4, 0.12, 0.14), 0.02));      // plinths
  d = min(d, sdRBox(pp - vec3(0.0, 9.42, 0.3), vec3(8.3, 0.52, 0.1), 0.02));                             // fascia
  d = min(d, sdRBox(pp - vec3(0.0, 10.02, 0.36), vec3(8.6, 0.07, 0.16), 0.02));                          // cornice
  return d;
}
float mapExit(vec3 p) {
  float d = sdBox3(p - EXIT0, vec3(0.04, 0.12, 0.3));
  d = min(d, sdBox3(p - EXIT1, vec3(0.04, 0.12, 0.3)));
  d = min(d, sdBox3(p - EXIT2, vec3(0.04, 0.12, 0.3)));
  return min(d, sdBox3(p - EXIT3, vec3(0.04, 0.12, 0.3)));
}
// materials: 1 floor, 2 side wall, 3 ceiling, 4 back wall, 5 douser, 7 screen, 8 masking, 9 proscenium,
// 10 stage, 11 seats, 12 exit signs
float map(vec3 p, out float m) {
  float d = (p.y - floorY(p.z)) * 0.984; m = 1.0;
  float dd;
  float ax = abs(p.x);
  float zr = mod(p.z - 1.75, 3.5) - 1.75;
  dd = min(WALLX - ax, sdBox(vec2(ax - WALLX, zr), vec2(0.3, 0.32)));
  if (dd < d) { d = dd; m = 2.0; }
  float zc = mod(p.z, 3.5) - 1.75;
  dd = min(CEILY - p.y, sdBox(vec2(p.y - CEILY, zc), vec2(0.42, 0.2)));
  if (dd < d) { d = dd; m = 3.0; }
  dd = max(BACKZ - p.z, -sdBox3(p - vec3(GATE.x, GATE.y, 28.45), vec3(0.55, 0.38, 0.5)));
  if (dd < d) { d = dd; m = 4.0; }
  if (p.z > 27.5) {
    float gw = max(GATE_HW * openK, 0.0005);
    dd = max(sdBox3(p - vec3(GATE.x, GATE.y, GZ + 0.002), vec3(0.56, 0.39, 0.002)), -sdBox3(p - GATE, vec3(gw, GATE_HH, 0.05)));
    if (dd < d) { d = dd; m = 5.0; }
  }
  if (p.z < 2.5) {
    dd = p.z + 0.06; if (dd < d) { d = dd; m = 8.0; }
    dd = sdBox3(p - vec3(SC.xy, -0.03), vec3(SHW, SHH, 0.03)); if (dd < d) { d = dd; m = 7.0; }
    dd = mapProsc(p); if (dd < d) { d = dd; m = 9.0; }
    dd = sdBox3(p - vec3(0.0, 0.45, 0.6), vec3(7.6, 0.45, 0.66)); if (dd < d) { d = dd; m = 10.0; }
  } else d = min(d, p.z - 2.45);   // (a bound: never overstep into the front of house)
  dd = mapSeats(p); if (dd < d) { d = dd; m = 11.0; }
  if (ax > 8.5) { dd = mapExit(p); if (dd < d) { d = dd; m = 12.0; } }
  else d = min(d, 8.9 - ax);
  return d;
}
vec3 calcNormal(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float e = 0.0008;
  float m;
  return normalize(k.xyy * map(p + k.xyy * e, m) + k.yyx * map(p + k.yyx * e, m) + k.yxy * map(p + k.yxy * e, m) + k.xxx * map(p + k.xxx * e, m));
}
float march(vec3 ro, vec3 rd, out float mat) {
  float t = 0.01;
  mat = 0.0;
  for (int i = 0; i < 170; i++) {
    vec3 p = ro + rd * t;
    float m;
    float d = map(p, m);
    if (d < 0.00012 * t + 0.00003) { mat = m; return t; }
    t += d * 0.92;
    if (t > 70.0) break;
  }
  return -1.0;
}

// ------------------------------------------------------------------ the screen
/** radiance of the screen at s (−1..1 across the screen, y up) */
vec3 screenRad(vec2 s) {
  vec2 uv = s * 0.5 + 0.5;
  float foot = sat((openK - abs(s.x)) / 0.006 + 0.5);
  float cov = texture(imgTex, uv).r;
  int gi = 0;
  for (int k = 1; k < 6; k++) if (uv.x > gB[k]) gi = k;
  vec3 bg = C_BONE * scrS;
  return mix(bg, gCol[gi], cov * gA[gi]) * foot;
}
float screenLumAt(vec2 s) {
  vec3 c = screenRad(s);
  return max(c.r, max(c.g, c.b));
}

// ------------------------------------------------------------------ light
float edgeT(vec3 a, vec3 b, vec3 n) {
  float c = clamp(dot(a, b), -0.99999, 0.99999);
  vec3 cr = cross(a, b);
  float l = length(cr);
  return l < 1e-6 ? 0.0 : acos(c) * dot(cr / l, n);
}
/** form factor of the lit part of the screen from p (normal n) */
float screenFF(vec3 p, vec3 n) {
  if (p.z <= 0.002) return 0.0;
  float hw = SHW * openK;
  vec3 c0 = SC + vec3(-hw, -SHH, 0.0), c1 = SC + vec3(hw, -SHH, 0.0), c2 = SC + vec3(hw, SHH, 0.0), c3 = SC + vec3(-hw, SHH, 0.0);
  vec3 v0 = normalize(c0 - p), v1 = normalize(c1 - p), v2 = normalize(c2 - p), v3 = normalize(c3 - p);
  float s = edgeT(v0, v1, n) + edgeT(v1, v2, n) + edgeT(v2, v3, n) + edgeT(v3, v0, n);
  return max(-s, 0.0) / TAU;
}
/** the beam as a line light (the light it scatters falls on what is near it) */
vec3 beamFill(vec3 p, vec3 n) {
  vec3 a = GATE, b = SC;
  vec3 ab = b - a;
  float h = sat(dot(p - a, ab) / dot(ab, ab));
  vec3 c = a + ab * h;
  vec3 L = c - p; float d = length(L); L /= max(d, 1e-4);
  float lam = mix(SG, 1.0, h);
  float w = openK * (0.25 + 0.75 * openK);
  return mix(C_BONE, C_EMBER, 0.12) * (0.035 / (0.35 + d * d * 0.35)) * (0.3 + 0.7 * max(dot(n, L), 0.0)) * (0.35 / (lam + 0.15)) * w;
}
vec3 exitLight(vec3 p, vec3 n, vec3 e) {
  vec3 L = e - p; float d2 = dot(L, L);
  return C_SIGNAL * 0.035 / (0.03 + d2) * max(dot(n, L * inversesqrt(d2)), 0.0);
}
vec3 lightAt(vec3 p, vec3 n) {
  vec3 E = vec3(0.0);
  if (scrLum > 0.0) E += mix(C_BONE, C_EMBER, 0.08) * screenFF(p, n) * scrLum * 2.6;
  E += beamFill(p, n) * beamI * hazeK;
  if (exitI > 0.0) E += (exitLight(p, n, EXIT0) + exitLight(p, n, EXIT1) + exitLight(p, n, EXIT2) + exitLight(p, n, EXIT3)) * exitI;
  // the lamp's spill round the port (only through the opened gap)
  vec3 Lg = GATE + vec3(0.0, 0.0, -0.25) - p; float dg = dot(Lg, Lg);
  E += LAMP * gateI * openK * 0.0025 / (0.02 + dg) * max(dot(n, Lg * inversesqrt(dg)), 0.0);
  E += vec3(fillI);
  return E;
}

// ------------------------------------------------------------------ engraving
float hatchW(float u, float cov, float fw) {
  float d = 0.5 - abs(fract(u) - 0.5);
  float hw = 0.5 * clamp(cov, 0.0, 1.0);
  float aa = max(fw * 0.5, 1e-3);
  float l = clamp(min(d + aa, hw) - max(d - aa, -hw), 0.0, 2.0 * aa) / (2.0 * aa);
  return mix(l, clamp(cov, 0.0, 1.0), smoothstep(0.35, 0.8, fw));
}
float hatchLOD(float u, float cov, float fw) {
  float lv = log2(max(fw * 3.2, 1e-5));
  float l0 = max(floor(lv), 0.0);
  float k = lv > 0.0 ? fract(lv) : 0.0;
  float s0 = exp2(l0), s1 = s0 * 2.0;
  float h0 = hatchW(u / s0, cov, fw / (s0 * PX_SCALE)), h1 = hatchW(u / s1, cov, fw / (s1 * PX_SCALE));
  return mix(h0, h1, smoothstep(0.1, 0.9, k));
}
float footprint(vec3 p, vec3 n, vec3 axis) {
  vec3 ro = camPos;
  float dn = dot(p - ro, n);
  vec3 rx = normalize(normalize(p - ro) + camR / focal), ry = normalize(normalize(p - ro) + camU / focal);
  float ax = dot(rx, n), ay = dot(ry, n);
  vec3 px = ro + rx * (dn / (abs(ax) < 1e-4 ? -1e-4 : ax));
  vec3 py = ro + ry * (dn / (abs(ay) < 1e-4 ? -1e-4 : ay));
  return max(abs(dot(px - p, axis)), abs(dot(py - p, axis)));
}
float toneOf(vec3 E) { float l = max(E.r, max(E.g, E.b)); return 1.0 - exp(-l * 2.4); }

vec3 shade(vec3 ro, vec3 rd, float t, float mat) {
  vec3 p = ro + rd * t;
  if (mat > 6.5 && mat < 7.5 && p.z > -0.004) return screenRad(vec2(p.x / SHW, (p.y - SC.y) / SHH));
  if (mat > 11.5) return C_SIGNAL * 1.6 * exitI + C_INK * 0.2;
  if (mat > 3.5 && mat < 4.5 && p.z > 28.93) {                       // through the gap: the lamp
    vec2 q = abs(p.xy - GATE.xy) / vec2(0.5, 0.34);
    return LAMP * gateI * (1.0 - 0.35 * smoothstep(0.4, 1.0, max(q.x, q.y)));
  }
  vec3 n = calcNormal(p);
  if (dot(n, rd) > 0.0) n = -n;
  vec3 E = lightAt(p, n);
  float tone = toneOf(E);
  vec3 lc = E / max(max(E.r, max(E.g, E.b)), 1e-4);
  vec3 ink = C_BONE * 0.78 * mix(vec3(1.0), lc, 0.55);
  vec3 bgc = C_INK * 0.22;
  vec3 axis = vec3(0.0, 1.0, 0.0); float sp = 0.05;
  if (mat < 1.5) {                        // floor: carpet runs down the aisles, boards elsewhere
    axis = vec3(0.0, 0.0, 1.0); sp = 0.045;
    if (abs(p.x) < 0.84 || abs(p.x) > 7.7) { axis = vec3(1.0, 0.0, 0.0); sp = 0.03; tone *= 0.8; }
    tone *= 0.8;
  } else if (mat < 2.5) {                 // side walls: fluted pilasters, a dado
    float zr = mod(p.z - 1.75, 3.5) - 1.75;
    if (abs(zr) < 0.33 && abs(p.x) < WALLX - 0.01) { axis = vec3(0.0, 0.0, 1.0); sp = 0.055; }
    else if (p.y < floorY(p.z) + 1.25) { axis = vec3(0.0, 1.0, 0.0); sp = 0.03; tone *= 0.8; }
    else { axis = vec3(0.0, 0.0, 1.0); sp = 0.07; }
    tone *= 0.7;
    float rail = abs(p.y - floorY(p.z) - 1.25);
    tone *= 1.0 - 0.8 * (1.0 - smoothstep(0.015, 0.03, rail));
  } else if (mat < 3.5) {                 // ceiling: coffers
    axis = vec3(1.0, 0.0, 0.0); sp = 0.08;
    if (p.y < CEILY - 0.01) { axis = vec3(0.0, 1.0, 0.0); sp = 0.04; }
    tone *= 0.9;
  } else if (mat < 4.5) {                 // back wall, the port's reveal
    axis = vec3(0.0, 1.0, 0.0); sp = 0.045;
    if (p.z > BACKZ + 0.005) { axis = vec3(0.0, 0.0, 1.0); sp = 0.02; }
  } else if (mat < 5.5) {                 // the douser's blades: dark blued steel
    axis = vec3(0.0, 1.0, 0.0); sp = 0.006;
    tone *= 0.6;
  } else if (mat < 8.5) {                 // masking and the screen's edges: black velvet
    return C_INK * (0.1 + 0.25 * tone);
  } else if (mat < 9.5) {                 // proscenium
    axis = vec3(0.0, 1.0, 0.0); sp = 0.04;
    if (abs(abs(p.x) - 7.9) < 0.34 && p.y < 8.55 && p.y > 0.3) { axis = vec3(1.0, 0.0, 0.0); sp = 0.045; }
  } else if (mat < 10.5) {                // stage
    axis = vec3(0.0, 1.0, 0.0); sp = 0.03;
    if (p.y > 0.89) { axis = vec3(1.0, 0.0, 0.0); sp = 0.12; }
    tone *= 0.85;
  } else {                                // seats: backs hatched across, rims lit from the screen
    axis = vec3(0.0, 1.0, 0.0); sp = 0.022;
    vec3 toS = normalize(SC - p);
    float rim = pow(sat(dot(n, toS)), 3.0) * smoothstep(0.2, 0.9, n.y + 0.45);
    tone = max(tone * 0.75, 0.0) + rim * sat(scrLum * 1.4) * 0.55;
  }
  float fp = footprint(p, n, axis) / sp;
  float cov = hatchLOD(dot(p, axis) / sp, tone * 1.05, fp);
  return mix(bgc, ink, cov);
}

// ------------------------------------------------------------------ haze (inside the beam only)
float hazeDens(vec3 x) {
  float a = snoise(x * vec3(0.32, 0.55, 0.22) + vec3(0.0, time * 0.05, -time * 0.11));
  float b = snoise(x * vec3(1.3, 2.1, 0.7) + vec3(time * 0.13, 0.0, time * 0.2));
  return 0.35 + 0.45 * (0.5 + 0.5 * a) + 0.2 * b;
}
float hg(float c, float g) { float k = 1.0 + g * g - 2.0 * g * c; return (1.0 - g * g) / (k * sqrt(k)) / ((1.0 - g * g) / pow(1.0 + g * g, 1.5)); }
vec3 volume(vec3 ro, vec3 rd, float tEnd, float j) {
  if (hazeK <= 0.0) return vec3(0.0);
  float t0 = 0.0, t1 = tEnd < 0.0 ? 80.0 : tEnd;
  for (int i = 0; i < 6; i++) {
    float a = dot(fr[i].xyz, ro) + fr[i].w, b = dot(fr[i].xyz, rd);
    if (abs(b) < 1e-7) { if (a > 0.0) return vec3(0.0); }
    else { float tt = -a / b; if (b > 0.0) t1 = min(t1, tt); else t0 = max(t0, tt); }
  }
  if (t1 <= t0) return vec3(0.0);
  const int N = 26;
  float dt = (t1 - t0) / float(N);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 x = ro + rd * (t0 + (float(i) + j) * dt);
    float lam = max(1.0 - x.z / APEX.z, 1e-3);
    vec3 q = APEX + (x - APEX) / lam;                 // where this bit of the beam lands on the screen
    vec2 s = vec2((q.x - SC.x) / SHW, (q.y - SC.y) / SHH);
    float edge = smoothstep(1.0, 0.86, abs(s.x) / max(openK, 1e-3)) * smoothstep(1.0, 0.9, abs(s.y));
    float I = min(0.16 / (lam * lam), 7.0);
    float ct = dot(normalize(x - APEX), -rd);
    float img = imageK > 0.0 ? mix(1.0, 0.25 + 1.5 * screenLumAt(s), imageK) : 1.0;
    float v = I * hazeDens(x) * hg(ct, 0.42) * edge * img;
    acc += mix(C_BONE * 0.95, C_EMBER * 1.3, smoothstep(2.0, 7.0, I)) * v * dt;
  }
  return acc * hazeK * beamI * 0.055;
}

vec3 pixel(vec2 px, out float tHit) {
  vec3 rd = normalize(camF * focal + camR * px.x + camU * px.y);
  float mat;
  float t = march(camPos, rd, mat);
  tHit = t;
  return t > 0.0 ? shade(camPos, rd, t, mat) : C_INK * 0.2;
}

void main() {
  vec2 px0 = vUv * res - 0.5 * res;
  vec3 col = vec3(0.0);
  float tc = -1.0;
  for (int k = ssK0(); k < ssK1(); k++) {
    float th;
    col += pixel(px0 + rgss(k) / PX_SCALE, th);
    if (k == ssK0()) tc = th;
  }
  col *= ssWeight();
  vec3 rd = normalize(camF * focal + camR * px0.x + camU * px0.y);
  float j = hash12(gl_FragCoord.xy + jit * 13.1);
  col += volume(camPos, rd, tc, j);
  col *= gain;
  // the hand-off: everything but the lit screen goes dark
  if (endMask > 0.0) {
    vec2 fp = vec2(FRAG_PX.x, res.y - FRAG_PX.y);
    vec2 q = abs(fp - maskR.xy) - maskR.zw;
    float inside = sat(0.5 - max(q.x, q.y));
    col *= mix(1.0, inside, endMask);
  }
  fragColor = vec4(col, 1.0);
}`;
