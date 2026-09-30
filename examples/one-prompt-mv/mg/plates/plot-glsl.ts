// GLSL for plate `plot` ("Lights, camera, action!").
//  MAIN: an engraved coaxial object traced analytically (orthographic): a stack of six rings (solid or
//        tube), a recessed glass disc and four barn-door leaves. At morph 0 the stack is a 2K Fresnel
//        (a can split into five segments, a bezel, the stepped lens and its doors); at morph 1 the same
//        six rings are a cine lens barrel (mount, T-stop ring, body, focus ring, name band, front ring),
//        the glass a coated front element with a nine-blade iris behind it. Bone lines on ink whose width
//        is the light (hatch along the surface's own parameters), the lamp's light recolouring the lines
//        ember, shockwaves that push the drawing.
//  SLATE: the clapperboard (board, fixed and hinged sticks, chalk dust, printed rules) plus the light
//        beam and its pool, output premultiplied for ONE / ONE_MINUS_SRC_ALPHA blending.
// Object space: x right, y UP, z toward the viewer (front of the lamp/lens at z = 0).
// View plane ("world"): logical px, y DOWN; camera maps it to the screen.
import { SS_TAP_GLSL } from '../px/gl';

export const LINE_GLSL = /* glsl */ `
vec2 rotv(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
float eline(float u, float w) {
  float d = abs(u - floor(u + 0.5));
  float aa = max(fwidth(u), 1e-4) * 0.7;
  return rampLine(d, w * 0.5, aa) * smoothstep(0.0, 0.05, w);
}
// nested densities: the lines keep ~px logical px apart on screen whatever the zoom
float elineLod(float u, float w, float px) {
  float fu = max(fwidth(u), 1e-5) * PX_SCALE;
  float k = clamp(-log2(fu * px), -2.0, 3.0);
  float kf = floor(k), kr = k - kf;
  return mix(eline(u * exp2(kf), w), eline(u * exp2(kf + 1.0), w), smoothstep(0.0, 1.0, kr));
}
`;

export const MAIN_FRAG = /* glsl */ `
${LINE_GLSL}
uniform vec4 uCam;            // view-plane centre xy, zoom, roll
uniform vec3 uObj;            // object origin in the view plane (xy) and scale
uniform mat3 uM;              // object -> view rotation
uniform vec4 uRing[6];        // R, Ri, z0, z1
uniform float uMorph;
uniform vec4 uGlass;          // Rg, zg, zIris, iris opening (fraction of Rg)
uniform vec4 uGlass2;         // iris rotation, preheat level, lamp on, detail (0 at the hand-off frame)
uniform vec3 uLH[4]; uniform vec3 uLE1[4]; uniform vec3 uLE2[4]; uniform vec4 uLD[4]; // hinge, along, across, (L, hw0, hw1, on)
uniform float uAmb;           // key light level (0: only the lit window)
uniform vec3 uKey; uniform vec3 uRim; uniform float uRimK;
uniform vec4 uShock[2];       // view-plane centre xy, radius, amplitude
uniform vec2 uRot2;           // focus ring, T-stop ring rotation
uniform sampler2D uSkin;
uniform float uDim;           // whole world
uniform float uObjK;          // the object's brightness (recedes behind the slate)
uniform float uT;
uniform float uGhost;         // the lamp's reflection in the front element

struct Hit { float t; vec3 p; vec3 n; float id; float face; };

vec3 shadeAt(vec2 fp) {
  vec2 sp = vec2(fp.x, 1080.0 - fp.y);
  vec2 P = uCam.xy + rotv((sp - vec2(960.0, 540.0)) / uCam.z, -uCam.w);
  float pxw = 1.0 / uCam.z; // view units per screen px
  // shockwaves push the drawing outward
  vec3 ringAdd = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec4 s = uShock[i];
    if (s.w <= 0.001) continue;
    vec2 d = P - s.xy; float r = length(d) + 1e-4;
    float sw = exp(-pow((r - s.z) / 70.0, 2.0)) * s.w;
    P += d / r * sw * 26.0;
    float hl = pxLine(abs(r - s.z) / pxw, 0.6, 1.8);
    ringAdd += (C_EMBER * 1.5 * hl + C_SIGNAL * 0.035 * exp(-max(s.z - r, 0.0) / 60.0) * step(r, s.z)) * s.w;
  }

  // ---- trace the object (orthographic, along -z of the view)
  vec2 v = vec2(P.x - uObj.x, -(P.y - uObj.y)) / uObj.z;
  mat3 Mt = transpose(uM);
  vec3 ro = Mt * vec3(v, 4000.0), rd = Mt * vec3(0.0, 0.0, -1.0);
  Hit h; h.t = 1e9; h.face = 0.0; h.id = 0.0; h.p = vec3(0.0); h.n = vec3(0.0, 0.0, 1.0);
  float a = dot(rd.xy, rd.xy);
  float b = dot(ro.xy, rd.xy);
  for (int k = 0; k < 6; k++) {
    vec4 rg = uRing[k];
    float R = rg.x, Ri = rg.y, z0 = rg.z, z1 = rg.w;
    if (R < 1.0) continue;
    if (a > 1e-7) {
      float c = dot(ro.xy, ro.xy) - R * R, disc = b * b - a * c;
      if (disc > 0.0) {
        float t = (-b - sqrt(disc)) / a; vec3 p = ro + rd * t;
        if (t < h.t && p.z >= z0 && p.z <= z1) { h.t = t; h.p = p; h.n = vec3(p.xy / R, 0.0); h.id = float(k); h.face = 1.0; }
      }
      if (Ri > 1.0) {
        float ci = dot(ro.xy, ro.xy) - Ri * Ri, di = b * b - a * ci;
        if (di > 0.0) {
          float t = (-b + sqrt(di)) / a; vec3 p = ro + rd * t;
          if (t < h.t && p.z >= z0 && p.z <= z1) { h.t = t; h.p = p; h.n = vec3(-p.xy / Ri, 0.0); h.id = float(k); h.face = 3.0; }
        }
      }
    }
    if (rd.z < -1e-5) {
      float t = (z1 - ro.z) / rd.z; vec3 p = ro + rd * t; float r = length(p.xy);
      if (t < h.t && r <= R && r >= Ri) { h.t = t; h.p = p; h.n = vec3(0.0, 0.0, 1.0); h.id = float(k); h.face = 2.0; }
    }
  }
  // glass
  float Rg = uGlass.x, zg = uGlass.y;
  {
    float t = (zg - ro.z) / rd.z; vec3 p = ro + rd * t;
    if (t < h.t && length(p.xy) <= Rg) { h.t = t; h.p = p; h.n = vec3(0.0, 0.0, 1.0); h.face = 4.0; }
  }
  // barn-door leaves
  vec2 leafUV = vec2(0.0); float leafHW = 1.0;
  for (int i = 0; i < 4; i++) {
    vec4 D = uLD[i];
    if (D.w < 0.01 || D.x < 1.0) continue;
    vec3 H = uLH[i], e1 = uLE1[i], e2 = uLE2[i];
    vec3 n = cross(e1, e2);
    float den = dot(rd, n);
    if (abs(den) < 1e-5) continue;
    float t = dot(H - ro, n) / den; vec3 p = ro + rd * t;
    float u = dot(p - H, e1) / D.x, vv = dot(p - H, e2);
    float hw = mix(D.y, D.z, sat(u));
    if (t < h.t && u >= 0.0 && u <= 1.0 && abs(vv) <= hw) {
      h.t = t; h.p = p; h.id = float(i);
      h.face = den < 0.0 ? 5.0 : 6.0;
      h.n = den < 0.0 ? n : -n;
      leafUV = vec2(u, vv); leafHW = hw;
    }
  }

  // ---- shade
  float m = uMorph;
  vec3 col = C_INK;
  vec3 lampP = vec3(0.0, 0.0, zg);
  float lampOn = uGlass2.z;
  if (h.face > 0.5) {
    vec3 n = h.n, p = h.p;
    float lam = max(dot(n, uKey), 0.0);
    float light = uAmb * (0.16 + 0.84 * lam);
    float rim = pow(1.0 - abs(dot(n, -rd)), 2.0) * max(dot(n, uRim), 0.0) * uRimK;
    float ink = 0.0;       // bone line coverage
    float hot = 0.0;       // 0..1: the lines are recoloured ember by the lamp
    vec3 extra = vec3(0.0);
    int id = int(h.id + 0.5);
    if (h.face < 1.5) {
      // ---- ring side (cylinder): axial lines around, circumferential seams
      float R = uRing[id].x, z0 = uRing[id].z, z1 = uRing[id].w;
      float ang = atan(p.y, p.x);
      float arc = ang * R;
      float vz = (p.z - z0) / max(z1 - z0, 1.0);
      float wA = pow(sat(light), 1.2) * 0.85;
      float axial = elineLod(arc / 6.0, wA, 6.0);
      float seam = pxLine(min(p.z - z0, z1 - p.z) / max(fwidth(p.z), 1e-4), 0.8, 1.8);
      // lamp: vents on the upper can, a rib at every segment joint
      float vent = 0.0;
      if (id < 5) vent = (1.0 - m) * step(0.5, sin(ang)) * smoothstep(0.62, 0.66, sin(ang)) * step(fract(p.z / 34.0), 0.42);
      float lampInk = max(axial * (1.0 - vent), 0.0);
      // barrel: per-ring engraving
      float bInk = axial;
      if (id == 1) {
        // T-stop ring: coarse grip ridges behind, the scale in front
        float grip = elineLod(arc / 16.0, 0.55 * (0.35 + 0.65 * sat(light * 1.4)), 16.0) * step(vz, 0.42);
        vec2 st = vec2(fract((ang + uRot2.y) / TAU), 0.5 + 0.5 * sat((vz - 0.42) / 0.58));
        float sk = texture(uSkin, vec2(1.0 - st.x, 1.0 - st.y)).a * step(0.42, vz);
        bInk = max(max(grip, axial * 0.6 * step(0.42, vz)), sk * (0.35 + 0.65 * sat(uAmb)));
      } else if (id == 3) {
        // focus ring: gear teeth at the back, distance scale in front
        float teeth = elineLod(arc / 9.0, 0.6 * (0.3 + 0.7 * sat(light * 1.3)), 9.0) * step(vz, 0.26);
        vec2 st = vec2(fract((ang + uRot2.x) / TAU), 0.5 * sat((vz - 0.26) / 0.74));
        float sk = texture(uSkin, vec2(1.0 - st.x, 1.0 - st.y)).a * step(0.26, vz);
        float band = pxLine(abs(vz - 0.26) * (z1 - z0) / max(fwidth(p.z), 1e-4), 0.8, 1.8);
        bInk = max(max(teeth, axial * 0.55 * step(0.26, vz)), max(sk * (0.35 + 0.65 * sat(uAmb)), band * 0.6));
      } else if (id == 4) {
        // name band: fine axial lines; the witness mark (signal) at the top
        bInk = elineLod(arc / 4.0, wA * 0.8, 4.0);
        float wm = exp(-pow((ang - 0.75) * R / 2.2, 2.0)) * smoothstep(0.55, 0.9, vz);
        extra += C_SIGNAL * 1.1 * wm * m * sat(uAmb * 1.5);
      } else if (id == 5) {
        bInk = elineLod(arc / 3.5, 0.55 * (0.3 + 0.7 * sat(light * 1.3)), 3.5);
      } else if (id == 0) {
        bInk = elineLod(arc / 5.0, wA * 0.7, 5.0);
      }
      ink = mix(lampInk, bInk, m);
      ink = max(ink, seam * 0.8 * sat(uAmb * 2.0));
      // the lamp's rear can reads warm where the rim light rakes it
      hot = sat(rim * 1.2);
    } else if (h.face < 2.5) {
      // ---- ring cap (annulus): concentric lines
      float r = length(p.xy);
      float R = uRing[id].x, Ri = uRing[id].y;
      float wA = pow(sat(light), 1.1) * 0.8;
      ink = elineLod(r / 5.0, wA, 5.0);
      float edge = pxLine(min(R - r, r - Ri) / max(fwidth(r), 1e-4), 0.7, 1.7);
      ink = max(ink, edge * 0.9 * sat(uAmb * 2.0));
      // the bezel's hinge lugs (lamp) / the lens name ring (barrel: lettered in the overlay)
      float ang = atan(p.y, p.x);
      float lug = (1.0 - m) * step(abs(fract(ang / (TAU / 4.0)) - 0.5), 0.05) * step(Ri + 50.0, r);
      ink = max(ink, lug * 0.45 * sat(uAmb * 2.0));
      hot = (1.0 - m) * lampOn * 0.35 * exp(-(r - Ri) / 30.0);
    } else if (h.face < 3.5) {
      // ---- inner wall of a tube: baffle rings, lit by the lamp
      float R = uRing[id].y;
      float lk = lampOn * (1.0 - m) * exp(-abs(p.z - zg) / 60.0);
      ink = elineLod(p.z / 5.0, 0.18 + 0.6 * lk + 0.3 * light, 5.0) * sat(uAmb * 0.8 + lk * 2.0);
      hot = lk;
    } else if (h.face < 4.5) {
      // ---- glass
      float r = length(p.xy) / Rg;
      // Fresnel: stepped zones, blazing core
      float zr = r * 9.0, f = fract(zr);
      float fine = elineLod(r * Rg / 4.0, 0.22, 4.0);
      float riser = pxLine((1.0 - f) * (Rg / 9.0) / max(fwidth(r * Rg), 1e-4), 0.8, 2.2);
      vec3 pre = C_EMBER * uGlass2.y * (1.0 - uGlass2.w * 0.3 * fine + uGlass2.w * 0.2 * riser);
      float x = 0.56 + 0.44 * exp(-r * r / 0.05);
      x *= 0.8 + 0.2 * f * f;
      x += 0.06 * riser * (1.0 - r);
      vec3 blaze = heat(x) * (1.0 + 2.4 * exp(-r * r / 0.03));
      blaze *= (1.0 - 0.4 * fine * (1.0 - exp(-r * r / 0.04))) * (1.0 - 0.45 * pxLine(f * (Rg / 9.0) / max(fwidth(r * Rg), 1e-4), 1.0, 2.5) * (1.0 - exp(-r * r / 0.02)));
      vec3 fres = mix(pre, blaze, lampOn);
      // barrel: coated element, iris behind with parallax
      float ti = (uGlass.z - ro.z) / rd.z; vec2 q = (ro + rd * ti).xy / Rg;
      float rq = length(q);
      float op = max(uGlass.w, 0.02);
      float N = 9.0, seg = TAU / N;
      float spiral = 0.9 * (rq - op);
      float aa = atan(q.y, q.x) - uGlass2.x + spiral;
      float a2 = mod(aa, seg) - 0.5 * seg;
      float apR = op * cos(0.5 * seg) / cos(a2);
      apR = mix(apR, op, 0.25); // blades are curved: rounder than a polygon
      float fwq = max(fwidth(rq), 1e-4);
      float inside = 1.0 - smoothstep(apR - fwq, apR + fwq, rq);
      float bid = floor(aa / seg);
      float tone = 0.18 + 0.22 * hash11(bid * 7.13 + 3.0);
      vec2 bdir = vec2(cos(bid * seg + uGlass2.x), sin(bid * seg + uGlass2.x));
      float bl = elineLod(dot(q * Rg, vec2(-bdir.y, bdir.x)) / 4.0, tone * sat(uAmb * 1.2 + 0.3), 4.0);
      float seamB = pxLine((0.5 * seg - abs(a2)) * rq * Rg / max(fwidth(aa) * rq * Rg, 1e-3), 0.5, 1.4);
      float edgeB = pxLine(abs(rq - apR) / fwq, 0.6, 1.6);
      vec3 blades = C_BONE * (0.5 * bl + 0.5 * edgeB) * 0.75 * sat(uAmb + 0.2);
      blades *= 1.0 - 0.8 * seamB;
      vec3 gate = C_INK * 0.2 + C_SIGNAL * 0.22 * exp(-rq * rq / (op * op * 0.35)) * sat(uAmb);
      vec3 iris = mix(blades, gate, inside);
      // coating: element rings, the lamp's reflection
      float rings = 0.0;
      for (int j = 0; j < 4; j++) {
        float rr = j == 0 ? 0.34 : j == 1 ? 0.56 : j == 2 ? 0.79 : 0.94;
        rings += pxLine(abs(r - rr) * Rg / max(fwidth(r * Rg), 1e-4), 0.5, 1.4);
      }
      vec2 gp = p.xy / Rg - vec2(-0.36, 0.34);
      float gr = length(gp);
      float ghost = 0.0;
      for (int j = 0; j < 4; j++) ghost += pxLine(abs(gr - 0.035 - 0.03 * float(j)) * Rg / max(fwidth(gr * Rg), 1e-4), 0.5, 1.3) * (1.0 - 0.2 * float(j));
      ghost += exp(-gr * gr / 0.0006) * 1.5;
      float arcHi = exp(-pow((r - 0.66) / 0.015, 2.0)) * exp(-pow((atan(p.y, p.x) - 2.35) / 0.3, 2.0));
      vec3 lens = iris * 0.85 + C_BONE * 0.16 * rings * sat(uAmb) + C_EMBER * (0.9 * ghost * uGhost + 0.7 * arcHi * sat(uAmb));
      col = mix(fres, lens, m);
      ink = -1.0;
    } else {
      // ---- barn-door leaf
      vec4 D = uLD[id];
      float u = leafUV.x, vv = leafUV.y;
      float Lu = u * D.x;
      float ed = min(min(Lu, D.x - Lu), leafHW - abs(vv));
      float edge = pxLine(ed / max(fwidth(ed), 1e-4), 0.7, 1.8);
      if (h.face < 5.5) {
        // outer face: painted steel, lines parallel to the hinge
        float wA = pow(sat(light), 1.15) * 0.8;
        ink = elineLod(Lu / 6.0, wA, 6.0);
        ink = max(ink, edge * 0.85 * sat(uAmb * 2.0));
        // pull tab at the tip
        float tab = step(D.x - 26.0, Lu) * step(abs(vv), 40.0);
        ink = mix(ink, 0.12 * sat(uAmb), tab * (1.0 - edge));
      } else {
        // inner face: lit by the lens, the lines turn ember
        vec3 L = normalize(lampP - p);
        float lk = lampOn * max(dot(h.n, L), 0.0) * exp(-length(lampP - p) / 420.0) * 1.6;
        float w = sat(0.12 * uAmb + lk);
        ink = elineLod(Lu / 6.0, w, 6.0);
        ink = max(ink, edge * sat(uAmb * 2.0 + lk));
        hot = sat(lk * 1.4);
      }
      ink *= D.w;
    }
    if (ink >= 0.0) {
      vec3 lineCol = mix(C_BONE * 0.74, C_EMBER * 0.95, hot);
      col = C_INK + lineCol * ink + extra;
      col += C_SIGNAL * 0.5 * pow(rim, 3.0) * uAmb;
    }
    col *= uObjK;
  }
  // the lamp's warm spill on the dark around the lens
  float dl = length(P - (uObj.xy + vec2((uM * lampP).x, -(uM * lampP).y) * uObj.z));
  col += C_BLOOD * 0.05 * lampOn * (1.0 - m) * exp(-dl / 380.0) * step(h.face, 0.5);
  col *= uDim;
  col += ringAdd * uDim;
  return col;
}
${SS_TAP_GLSL}
void main() {
  vec3 c = vec3(0.0);
  for (int k = ssK0(); k < ssK1(); k++) c += shadeAt(FRAG_PX + rgss(k) / PX_SCALE);
  fragColor = vec4(c * ssWeight(), 1.0);
}`;

export const SLATE_FRAG = /* glsl */ `
${LINE_GLSL}
uniform mat3 uInv;          // screen px (y down) -> slate local px
uniform float uStick;       // clapstick opening angle (rad)
uniform float uOn;          // slate opacity
uniform float uHeat;        // impact heat
uniform vec2 uImp;          // impact point (local)
uniform vec4 uShockS;       // local centre, radius, amplitude
uniform float uSlDim;
uniform float uLocalPx;     // local px per screen px
uniform vec4 uBeam;         // source xy (screen), axis angle, half angle
uniform float uBeamK;
uniform float uBeamEnd;     // 0..1: the beam stops at the pool (spotted down onto the caret)
uniform vec4 uPool;         // centre xy (screen), radius, strength
uniform float uT;

const vec2 PIV = vec2(-580.0, -392.0);

float sdRBox(vec2 p, vec2 c, vec2 hs, float r) { return sdBox(p - c, hs - r) - r; }

vec3 stripes(vec2 p, float dir, float heatK, out float edge) {
  float s = (p.x + dir * p.y) / 110.0;
  float fs = fract(s);
  float isBone = step(0.5, fs);
  float e = min(abs(fs - 0.5), min(fs, 1.0 - fs)) * 110.0 * 0.7071;
  edge = pxLine(e / max(uLocalPx, 1e-3), 0.6, 1.6);
  float grain = elineLod((p.x - dir * p.y) / 5.0, 0.3, 5.0);
  vec3 bone = C_BONE * 0.72 * (1.0 - 0.35 * grain);
  vec3 inkc = C_INK2 * 1.1 + C_BONE * 0.04 * grain;
  vec3 hotc = heat(0.5 + 0.5 * heatK) * (1.0 + 1.8 * heatK);
  bone = mix(bone, hotc, sat(heatK * 1.3));
  return mix(inkc, bone, isBone);
}

void main() {
  vec2 sp = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  vec3 add = vec3(0.0);
  // ---- light beam (screen space) and its pool
  if (uBeamK > 0.001) {
    vec2 d = sp - uBeam.xy;
    vec2 ax = vec2(cos(uBeam.z), sin(uBeam.z));
    float al = dot(d, ax);
    float ang = abs(atan(ax.x * d.y - ax.y * d.x, al));
    float inside = (1.0 - smoothstep(uBeam.w * 0.72, uBeam.w, ang)) * smoothstep(0.0, 200.0, al);
    inside *= 1.0 - uBeamEnd * smoothstep(-40.0, 120.0, dot(sp - uPool.xy, ax));
    float hz = 0.55 + 0.45 * fbm(vec3(sp * 0.0022, uT * 0.08), 3);
    add += (C_EMBER * 0.06 + C_BONE * 0.035) * inside * hz * uBeamK * (0.6 + 0.4 * exp(-al / 1800.0));
  }
  if (uPool.w > 0.001) {
    vec2 d = sp - uPool.xy;
    add += (C_EMBER * 0.16 + C_BONE * 0.05) * exp(-dot(d, d) / (uPool.z * uPool.z)) * uPool.w;
  }
  if (uOn <= 0.001) { fragColor = vec4(add, 0.0); return; }

  vec2 lp = (uInv * vec3(sp, 1.0)).xy;
  // impact shockwave: pushes the board's drawing
  float shl = 0.0;
  if (uShockS.w > 0.001) {
    vec2 d = lp - uShockS.xy; float r = length(d) + 1e-4;
    float sw = exp(-pow((r - uShockS.z) / 60.0, 2.0)) * uShockS.w;
    lp += d / r * sw * 14.0;
    shl = pxLine(abs(r - uShockS.z) / uLocalPx, 0.6, 1.8) * uShockS.w;
  }
  float pw = uLocalPx;
  vec3 col = vec3(0.0); float cov = 0.0;
  // ---- board
  float dB = sdRBox(lp, vec2(0.0, 50.0), vec2(580.0, 350.0), 16.0);
  float cB = 1.0 - smoothstep(-pw, pw, dB);
  if (cB > 0.0) {
    float dust = fbm(lp * 0.0035 + 3.1, 4) * 0.5 + 0.5;
    float swirl = 0.5 + 0.5 * sin(length(lp - vec2(240.0, 140.0)) * 0.045 + fbm(lp * 0.01, 2) * 3.0);
    vec3 c = C_INK2 * 0.9 + C_BONE * (0.018 + 0.03 * dust * dust + 0.012 * swirl * smoothstep(0.4, 0.8, dust));
    // printed rules
    float ln = 0.0;
    float inset = abs(sdRBox(lp, vec2(0.0, 50.0), vec2(560.0, 330.0), 10.0));
    ln = max(ln, pxLine(inset / pw, 1.0, 2.2));
    ln = max(ln, pxLine(abs(lp.y + 148.0) / pw, 0.6, 1.5) * step(abs(lp.x), 560.0));
    ln = max(ln, pxLine(abs(lp.y - 238.0) / pw, 0.6, 1.5) * step(abs(lp.x), 560.0));
    ln = max(ln, pxLine(abs(abs(lp.x) - 190.0) / pw, 0.6, 1.5) * step(238.0, lp.y) * step(lp.y, 380.0));
    c += C_BONE * 0.34 * ln;
    // bevel of the board's edge
    c += C_BONE * 0.3 * pxLine(abs(dB + 2.0) / pw, 0.6, 1.6);
    float hk = uHeat * exp(-length(lp - uImp) / 260.0) * (1.0 - smoothstep(-300.0, -80.0, lp.y));
    c += heat(0.4 + 0.5 * hk) * hk * 0.8 * pxLine(abs(dB + 2.0) / pw, 0.6, 2.4);
    col = c; cov = cB;
  }
  // ---- fixed stick
  float dF = sdRBox(lp, vec2(0.0, -349.0), vec2(580.0, 43.0), 5.0);
  float cF = 1.0 - smoothstep(-pw, pw, dF);
  if (cF > 0.0) {
    float e;
    float hk = uHeat * exp(-length(lp - uImp) / 420.0);
    vec3 c = stripes(lp, -1.0, hk, e);
    c *= 1.0 - 0.6 * e;
    c += C_BONE * 0.4 * pxLine(abs(dF + 1.5) / pw, 0.6, 1.5);
    col = mix(col, c, cF); cov = max(cov, cF);
  }
  // ---- hinged stick (rotated about the pivot by -uStick)
  vec2 q = PIV + rotv(lp - PIV, uStick);
  float dM = sdRBox(q, vec2(0.0, -435.0), vec2(580.0, 43.0), 5.0);
  float cM = 1.0 - smoothstep(-pw, pw, dM);
  if (cM > 0.0) {
    float e;
    float hk = uHeat * exp(-length(q - uImp) / 420.0);
    vec3 c = stripes(q, 1.0, hk, e);
    c *= 1.0 - 0.6 * e;
    c += C_BONE * 0.4 * pxLine(abs(dM + 1.5) / pw, 0.6, 1.5);
    // underside shadow line while open
    col = mix(col, c, cM); cov = max(cov, cM);
  }
  // shadow of the hinged stick's lower edge onto the fixed stick while open
  // ---- hinge bolt
  float dH = length(lp - PIV - vec2(26.0, -4.0)) - 24.0;
  float cH = 1.0 - smoothstep(-pw, pw, dH);
  if (cH > 0.0) {
    float rr = length(lp - PIV - vec2(26.0, -4.0));
    vec3 c = C_INK2 + C_BONE * 0.5 * elineLod(rr / 4.0, 0.35, 4.0) + C_BONE * 0.5 * pxLine(abs(dH + 1.0) / pw, 0.6, 1.5);
    col = mix(col, c, cH); cov = max(cov, cH);
  }
  col += (C_EMBER * 1.4 * shl) * cov;
  // the beam lights the board
  col *= uSlDim * (1.0 + 3.0 * length(add));
  fragColor = vec4(col * cov * uOn + add, cov * uOn);
}`;
