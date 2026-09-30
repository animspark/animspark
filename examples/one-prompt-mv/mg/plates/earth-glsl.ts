// Plate `earth`: the engraved globe, analytic (ray–sphere) in one fullscreen pass.
// Bone-on-ink engraving: parallels lifted by relief (width = tone, octave LOD), waterlines hugging the
// coasts, elevation contours with Tanaka light, the graticule, terminator crosshatch, city lights on the
// night side (thousands, cell-hashed, ignited by waves), the limb, a dawn rim, a banknote rosette, stars.
import { SS_TAP_GLSL } from '../px/gl';
import { LAND_GLSL } from './earth-geo';

export const FRAG_EARTH = /* glsl */ `
${SS_TAP_GLSL}
uniform vec2 res;
uniform vec3 camPos, camR, camU, camF;
uniform float focal;
uniform mat3 uM;          // earth -> world
uniform vec3 uSun;        // world
uniform float uTime;
uniform float uGratA;     // graticule opacity
uniform float uGratHead;  // 0..1 graticule draw (meridians north -> south, parallels west -> east)
uniform float uRev;       // land reveal: angle (rad) from the sub-camera point
uniform float uSurf;      // surface engraving opacity (descent fades it)
uniform float uStars;
uniform float uLimbA, uLimbW;
uniform float uRos;       // banknote rosette opacity
uniform float uRosPh;
uniform float uDawn;
uniform float uLights;    // city lights opacity
uniform float uLitBase;   // fraction of night lights on before any wave
uniform vec4 uWave[5];    // earth dir xyz, start time (s)
uniform float uWaveSp;    // rad / s
uniform vec4 uHole;       // earth dir xyz, radius (rad): no ambient lights (the descent's city stands alone)
${LAND_GLSL}

float contourL(float c, float wpx) {
  float fwP = max(fwidth(c), 1e-5), fw = fwP * PX_SCALE;
  float d = abs(fract(c + 0.5) - 0.5) / fwP;
  float cov = pxLine(d, wpx * 0.5 - 0.5, wpx * 0.5 + 0.5);
  float mean = clamp(wpx * fw, 0.0, 1.0);
  return mix(cov, mean * 0.45, smoothstep(0.18, 0.45, fw));
}
/** engraved lines along x (world-angle units) with a spacing that keeps ~sp px at any zoom (octave LOD) */
float elines(float x, float tone, float sp) {
  float fw = max(fwidth(x) * PX_SCALE, 1e-7);
  float lev = log2(fw * sp / 0.004);
  float l0 = floor(lev), k = fract(lev);
  float s0 = 0.004 * exp2(l0);
  float a = hatch(x / s0, tone), b = hatch(x / (s0 * 2.0), tone);
  // hairlines can't get thinner than a pixel: below that, tone is carried by the line's ink
  return mix(a, b, smoothstep(0.1, 0.9, k)) * mix(0.25, 1.0, smoothstep(0.02, 0.3, tone));
}

vec3 shade(vec2 fp) {
  vec2 sp = fp - 0.5 * res;
  vec3 rd = normalize(camF * focal + camR * sp.x + camU * sp.y);
  vec3 ro = camPos;
  float b = dot(ro, rd);
  float r2 = dot(ro, ro);
  float dmin = sqrt(max(r2 - b * b, 0.0));
  float disc = 1.0 - dmin * dmin;
  float tHit = -b - sqrt(max(disc, 0.0));
  vec3 p = disc > 0.0 ? ro + rd * tHit : normalize(ro - rd * b);
  float fwd = max(fwidth(dmin), 1e-6);
  float cov = 1.0 - smoothstep(-0.7, 0.7, (dmin - 1.0) / fwd);
  if (b > 0.0) cov = 0.0;

  // ---- sky: stars fixed at infinity
  vec3 col = C_INK;
  if (uStars > 0.0) {
    vec3 g = rd * 64.0;
    vec3 id = floor(g);
    vec3 h = hash33(id);
    if (h.x < 0.16) {
      vec3 sd = normalize((id + 0.2 + 0.6 * hash33(id + 3.1)) / 64.0);
      float a = length(cross(sd, rd)) * focal;
      float br = mix(0.08, 0.5, pow(h.y, 3.0)) * uStars;
      col += C_BONE * br * exp(-a * a / mix(0.35, 1.1, h.z));
    }
  }

  // ---- surface (computed for every pixel on the continuous clamped point, so fwidth stays defined)
  vec3 q = transpose(uM) * p;
  float lat = asin(clamp(q.y, -1.0, 1.0));
  float lon = atan(q.z, q.x);
  float lon2 = atan(-q.z, -q.x);
  float Hh = landH(q);
  vec3 east = normalize(vec3(-q.z, 0.0, q.x) + vec3(0.0, 0.0, 1e-6));
  vec3 north = cross(east, q);
  const float E = 0.0035;
  float Hx = (landH(normalize(q + east * E)) - Hh) / E;
  float Hy = (landH(normalize(q + north * E)) - Hh) / E;
  vec3 Le = transpose(uM) * uSun;
  vec2 Lt = vec2(dot(Le, east), dot(Le, north));
  Lt /= max(length(Lt), 1e-4);
  vec2 gr = vec2(Hx, Hy);
  float slope = length(gr);
  float tanaka = 0.5 + 0.5 * dot(-gr / max(slope, 1e-4), Lt) * sat(slope * 1.5);
  float lam = dot(p, uSun);
  float day = smoothstep(-0.1, 0.16, lam);
  vec3 nrm = normalize(q - (east * Hx + north * Hy) * 0.06);
  float lamL = sat(dot(nrm, Le));
  float land = smoothstep(-0.004, 0.004, Hh);
  vec3 vc = normalize(camPos);
  float angV = acos(clamp(dot(p, vc), -1.0, 1.0));
  float rev = smoothstep(uRev + 0.02, uRev - 0.02, angV);
  float front = exp(-max(uRev - angV, 0.0) / 0.09) * rev;

  // land: parallels lifted by the relief, width = light
  float xl = lat + Hh * 0.05;
  float toneL = mix(0.06, 0.1 + 0.46 * lamL, day);
  float landL = elines(xl, toneL, 6.0);
  // sea: plain parallels, faint; waterlines hug the coast
  float toneS = mix(0.03, 0.05 + 0.14 * sat(lam), day);
  float seaL = elines(lat, toneS, 6.0);
  float wl = contourL(Hh / 0.021, 0.9) * smoothstep(-0.13, -0.015, Hh) * (1.0 - land);
  float coast = pxLine(abs(Hh) / max(fwidth(Hh), 1e-6), 0.3, 1.3);
  float elev = contourL(Hh / 0.055, 1.0) * land * smoothstep(0.02, 0.05, Hh);
  // terminator crosshatch (the shade line engraved in diagonals)
  float lb = lam / 0.13;
  float band = exp(-lb * lb);
  float xh = elines(lat * 0.7 + lon * cos(lat) * 0.7, 0.22 * band, 4.0);

  vec3 sc = C_INK + C_INK2 * (0.25 + 0.55 * day) * (1.0 - land) + C_INK2 * 0.6 * land * day;
  sc += C_GRAPHITE * seaL * 0.8 * (1.0 - land);
  sc += C_ASH * wl * mix(0.18, 0.5, day);
  sc += C_BONE * landL * 0.62 * land;
  sc += C_BONE * elev * (0.1 + 0.5 * tanaka) * mix(0.25, 1.0, day);
  sc += C_BONE * coast * mix(0.3, 0.88, day);
  sc += C_GRAPHITE * xh * 0.6;
  sc = min(sc, vec3(0.8));
  // reveal: the engraving comes up from the sub-camera point, its front hot
  vec3 hotC = mix(C_SIGNAL * 1.4, C_EMBER * 2.4, front);
  float ink = sat(luma(sc - C_INK) * 2.2);
  sc = mix(C_INK, sc, rev);
  sc += hotC * front * ink * 0.6;

  // ---- graticule (15°), drawn in: meridians north -> south, parallels west -> east
  float d15 = 0.261799;
  float fl = max(fwidth(lat), 1e-6), fo = max(min(fwidth(lon), fwidth(lon2)), 1e-6);
  float dl = abs(fract(lat / d15 + 0.5) - 0.5) * d15 / fl;
  float dlo = abs(fract(lon / d15 + 0.5) - 0.5) * d15 / fo;
  float isEq = step(abs(lat), 0.13), isPm = step(abs(lon), 0.13);
  float par = pxLine(dl, mix(0.15, 0.5, isEq), mix(1.0, 1.4, isEq));
  float mer = pxLine(dlo, mix(0.15, 0.5, isPm), mix(1.0, 1.4, isPm)) * smoothstep(1.48, 1.3, abs(lat));
  float latHead = mix(1.6, -1.6, uGratHead);
  float merOn = step(latHead, lat);
  float lonHead = mix(-3.2, 3.2, uGratHead);
  float parOn = step(lon, lonHead);
  float gHot = exp(-max(lat - latHead, 0.0) / 0.12) * merOn * mer + exp(-max(lonHead - lon, 0.0) / 0.25) * parOn * par;
  float grat = max(par * parOn, mer * merOn);
  vec3 gc = mix(C_GRAPHITE * 0.9, C_ASH * 0.75, day) * mix(1.0, 1.35, max(isEq * par, isPm * mer));
  sc = mix(sc, gc, grat * uGratA * 0.85);
  sc += C_EMBER * 2.0 * gHot * uGratA * step(uGratHead, 0.999);
  sc *= uSurf;

  // ---- city lights on the night side: cell-hashed lights, ignited by the word waves
  float night = smoothstep(0.03, -0.12, lam);
  vec3 lights = vec3(0.0);
  if (night > 0.0 && uLights > 0.0 && disc > 0.0) {
    const float CS = 0.0095;
    float pxw = focal / max(tHit, 1e-3);
    float row0 = floor((lat + 1.5707963) / CS);
    for (int di = -1; di <= 1; di++) {
      float row = row0 + float(di);
      float latC = (row + 0.5) * CS - 1.5707963;
      float nc = max(3.0, floor(6.2831853 * cos(latC) / CS));
      float col0 = floor((lon + 3.1415926) / 6.2831853 * nc);
      for (int dj = -1; dj <= 1; dj++) {
        float cl = mod(col0 + float(dj), nc);
        vec2 id = vec2(row, cl);
        vec3 hh = hash33(vec3(id, 7.0));
        float la = (row + 0.15 + 0.7 * hh.x) * CS - 1.5707963;
        float lo = (cl + 0.15 + 0.7 * hh.y) / nc * 6.2831853 - 3.1415926;
        vec3 ql = vec3(cos(la) * cos(lo), sin(la), cos(la) * sin(lo));
        float hl = landH(ql);
        if (hl < 0.004) continue;
        float dens = sat(0.18 + 0.55 * (snoise(ql * 7.0) * 0.5 + 0.5) + 0.45 * exp(-hl / 0.05)) * sat(1.0 - abs(la) * 0.55);
        if (hh.z > dens) continue;
        if (uHole.w > 0.0 && dot(ql, uHole.xyz) > cos(uHole.w)) continue;
        vec3 h2 = hash33(vec3(id, 13.0));
        // on: a base fraction, then every word's wave lights everything it reaches
        float on = step(h2.x, uLitBase);
        float heat = 0.0;
        for (int k = 0; k < 5; k++) {
          if (uWave[k].w > 90.0 || uTime < uWave[k].w) continue;
          float dk = acos(clamp(dot(ql, uWave[k].xyz), -1.0, 1.0));
          float r = (uTime - uWave[k].w) * uWaveSp;
          float arr = r - dk + 0.05 * h2.y;
          if (arr > 0.0) { on = 1.0; heat = max(heat, exp(-arr / 0.07)); }
        }
        if (on < 0.5) continue;
        float d = length(ql - q) * pxw;
        float sz = mix(0.75, 1.7, h2.z * h2.z);
        float a = exp(-d * d / (sz * sz));
        float I = mix(0.35, 1.25, h2.y * h2.y);
        vec3 lc = mix(C_EMBER, C_SIGNAL, h2.x) * I * (1.0 + 1.6 * heat) + vec3(1.0, 0.85, 0.7) * heat * 0.6;
        lights += lc * a;
      }
    }
  }
  sc += lights * night * uLights;

  col = mix(col, sc, cov);

  // ---- the limb, atmosphere hairlines, dawn rim, banknote rosette
  float dpx = (dmin - 1.0) / fwd;
  col = mix(col, C_BONE, pxLine(abs(dpx), uLimbW * 0.5 - 0.5, uLimbW * 0.5 + 0.5) * uLimbA);
  if (dmin > 1.0) {
    vec3 pc = normalize(ro - rd * b);
    float sf = dot(pc, uSun);
    float up = dmin - 1.0;
    col += (C_EMBER * 1.3 * exp(-up / 0.008) + C_SIGNAL * 0.35 * exp(-up / 0.03)) * smoothstep(-0.35, 0.5, sf) * uDawn;
    col += C_ASH * 0.35 * pxLine(abs((dmin - 1.018) / fwd), 0.0, 0.9) * uLimbA * uSurf * uGratA;
    if (uRos > 0.0 && dmin < 1.26) {
      float ang = atan(dot(pc, camU), dot(pc, camR));
      float ink = 0.0;
      for (int k = 0; k < 10; k++) {
        float ph = float(k) * 0.6283185 + uRosPh;
        float rk = 1.135 + 0.028 * sin(24.0 * ang + ph);
        ink = max(ink, pxLine(abs(dmin - rk) / fwd, 0.0, 0.8));
        float rj = 1.16 + 0.04 * sin(-12.0 * ang + ph * 0.5 + 0.4);
        ink = max(ink, pxLine(abs(dmin - rj) / fwd, 0.0, 0.7) * 0.6);
      }
      float band2 = smoothstep(1.085, 1.1, dmin) * smoothstep(1.215, 1.2, dmin);
      float rules = pxLine(abs(dmin - 1.08) / fwd, 0.2, 1.2) + pxLine(abs(dmin - 1.225) / fwd, 0.1, 1.0);
      col += C_ASH * (0.2 * ink * band2 + 0.3 * rules) * uRos;
    }
  }
  return col;
}

void main() {
  vec3 acc = vec3(0.0);
  for (int k = ssK0(); k < ssK1(); k++) acc += shade(FRAG_PX + rgss(k));
  fragColor = vec4(acc * ssWeight(), 1.0);
}`;
