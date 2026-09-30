// GLSL for plate `marquee`: the picture palace engraved like a banknote. Bone hairlines on ink whose
// brightness is the light that falls on them (the backlit letter board, the chase lamps, the TONIGHT! sign,
// the soffit downlights, the crowd's flashbulbs); the lines are revealed by the light switching on (a hot
// front), and rings on the beats heat them as they pass. World space: logical px at zoom 1, y down.
import { G, AT } from './marquee-kit';

const f = (x: number) => x.toFixed(1);

export const FRAG_MQ = /* glsl */ `
uniform vec4 uCam;       // centre x, y, zoom, roll
uniform float uT, uGo;
uniform float uBoard;    // board brightness (bone)
uniform float uBoardK;   // board detail (0 at the hand-off frame)
uniform sampler2D uAtlas;
uniform vec4 uRing[3];   // cx, cy, radius, amplitude
uniform vec4 uFlash[4];  // world x, y, intensity, radius
uniform float uLitX, uSockX, uSignK, uSignPulse, uChase, uTw, uRoseX, uNameHW;

#define BHW ${f(G.BOARD.hw)}
#define BHH ${f(G.BOARD.hh)}
#define FHW ${f(G.FACE.hw)}
#define FHH ${f(G.FACE.hh)}
#define CHW ${f(G.CANOPY.hw)}
#define CHH ${f(G.CANOPY.hh)}
#define SHW ${f(G.STRIP.hw)}
#define SHH ${f(G.STRIP.hh)}
#define SIGN_CY ${f(G.SIGN.cy)}
#define SIGN_HW ${f(G.SIGN.hw)}
#define SIGN_HH ${f(G.SIGN.hh)}
#define PL_Y0 ${f(G.PLINTH.y0)}
#define PL_Y1 ${f(G.PLINTH.y1)}
#define PL_HW ${f(G.PLINTH.hw)}
#define SO_Y0 ${f(G.SOFFIT.y0)}
#define SO_Y1 ${f(G.SOFFIT.y1)}
#define DO_Y1 ${f(G.DOORS.y1)}
#define KERB ${f(G.KERB)}
#define VPY ${f(G.VPY)}
#define ROOF ${f(G.ROOF)}
#define CBOT ${f(G.CORNICE_BOT)}
#define PIL_X ${f(G.PIL.x)}
#define PIL_HW ${f(G.PIL.hw)}
#define ROSE_Y ${f(G.ROSE.y)}
#define ROSE_R ${f(G.ROSE.r)}
#define MED_X ${f(G.MEDAL.x)}
#define MED_R ${f(G.MEDAL.r)}
#define NUM_X ${f(G.NUM.x)}
#define NUM_Y ${f(G.NUM.y)}
#define NAME_Y ${f(G.NAME.y)}
#define NAME_CAP ${f(G.NAME.cap)}
const vec4 AT = vec4(${f(AT.x0)}, ${f(AT.y0)}, ${f(AT.w)}, ${f(AT.h)});

float pxw; // world units per screen px

/** a hairline at distance d (world) of width ww (world); never thinner than 0.8 px (it fades instead) */
float eL(float d, float ww) {
  float wp = ww / pxw;
  float k = min(1.0, wp / 0.8);
  wp = max(wp, 0.8);
  return (1.0 - smoothstep(wp * 0.5 - 0.5, wp * 0.5 + 0.5, abs(d) / pxw)) * k;
}
/** parallel lines every sp world units along u (world), width ww; melts to the mean tone when too dense */
float par(float u, float sp, float ww) {
  float d = (fract(u / sp + 0.5) - 0.5) * sp;
  float lod = smoothstep(1.6, 3.2, sp / pxw);
  return mix(min(1.0, max(ww, 0.8 * pxw) / sp), eL(d, ww), lod);
}

// ---- guilloché
/** K interlaced curves r = R + a sin(n th + ph_k) */
float ros(vec2 q, float R, float a, float n, float K, float ww, float tw) {
  float r = length(q);
  if (abs(r - R) > a + ww + 2.0 * pxw) return 0.0;
  float th = atan(q.y, q.x);
  float c = 0.0;
  for (int k = 0; k < 20; k++) {
    if (float(k) >= K) break;
    float ph = float(k) * TAU / K + tw;
    float s = sin(n * th + ph), co = cos(n * th + ph);
    float sl = a * n * co / max(r, 1.0);
    c = max(c, eL((r - R - a * s) * inversesqrt(1.0 + sl * sl), ww));
  }
  return c;
}
/** two harmonics: lobes riding lobes */
float ros2(vec2 q, float R, float a, float n, float b, float m, float K, float ww, float tw) {
  float r = length(q);
  if (abs(r - R) > a + b + ww + 2.0 * pxw) return 0.0;
  float th = atan(q.y, q.x);
  float c = 0.0;
  for (int k = 0; k < 20; k++) {
    if (float(k) >= K) break;
    float ph = float(k) * TAU / K + tw;
    float s = a * sin(n * th + ph) + b * sin(m * th - 2.0 * ph);
    float sl = (a * n * cos(n * th + ph) + b * m * cos(m * th - 2.0 * ph)) / max(r, 1.0);
    c = max(c, eL((r - R - s) * inversesqrt(1.0 + sl * sl), ww));
  }
  return c;
}
float medal(vec2 q, float R, float tw) {
  float r = length(q);
  if (r > R * 1.2) return 0.0;
  float c = max(eL(r - R, 1.8), eL(r - R * 0.965, 0.7));
  c = max(c, eL(r - R * 1.17, 0.9));
  c = max(c, ros(q, R * 0.84, R * 0.085, 30.0, 14.0, 0.75, tw));
  c = max(c, ros2(q, R * 0.6, R * 0.13, 10.0, R * 0.035, 30.0, 12.0, 0.7, -tw * 1.4));
  c = max(c, ros(q, R * 0.36, R * 0.1, 7.0, 9.0, 0.7, tw * 0.8));
  c = max(c, eL(r - R * 0.2, 1.0));
  if (r < R * 0.19) c = max(c, hatch(r / 2.4, 0.3));
  return c;
}
float bigRose(vec2 q, float R, float tw) {
  float r = length(q);
  if (r > R * 1.26) return 0.0;
  float c = max(eL(r - R * 1.22, 1.8), eL(r - R * 1.18, 0.7));
  c = max(c, eL(r - R, 1.5));
  c = max(c, ros(q, R * 0.9, R * 0.075, 40.0, 16.0, 0.75, tw));
  c = max(c, ros2(q, R * 0.7, R * 0.11, 14.0, R * 0.035, 42.0, 14.0, 0.75, -tw * 1.2));
  c = max(c, ros(q, R * 0.49, R * 0.13, 9.0, 12.0, 0.75, tw * 0.7));
  c = max(c, ros(q, R * 0.3, R * 0.06, 18.0, 8.0, 0.7, -tw));
  c = max(c, eL(r - R * 0.18, 1.2));
  if (r < R * 0.17) c = max(c, hatch(r / 2.4, 0.35));
  return c;
}
/** a border chain of overlapping loops: along the edge (al), across it (ac, centre c0), radius rr, pitch p */
float chain(float al, float ac, float c0, float rr, float p, float ww) {
  float i0 = floor(al / p);
  float c = 0.0;
  for (int j = -1; j <= 1; j++) {
    float cx = (i0 + float(j) + 0.5) * p;
    c = max(c, eL(length(vec2(al - cx, ac - c0)) - rr, ww));
  }
  return c;
}
/** a woven band: two sine families crossing (centre line bw = 0) */
float woven(float al, float bw, float amp, float fr, float ww) {
  float s1 = amp * sin(al * fr), s2 = amp * 0.6 * sin(al * fr * 2.0 + 1.0);
  return max(max(eL(bw - s1, ww), eL(bw + s1, ww)), max(eL(bw - s2, ww * 0.8), eL(bw + s2, ww * 0.8)));
}

vec2 lightAt(vec2 w) {
  float I = 0.075, warm = 0.0;
  float dB = max(sdBox(w, vec2(BHW, BHH)), 0.0);
  I += 0.52 * exp(-dB / 230.0);
  float ch = uChase * 0.3 * exp(-abs(sdBox(w, vec2(SHW, SHH))) / 90.0);
  I += ch; warm += ch;
  vec2 q = (w - vec2(0.0, SIGN_CY)) * vec2(0.72, 1.0);
  float sg = uSignK * (0.62 * exp(-length(q) / 480.0) + 0.12 * exp(-length(q) / 1500.0)) * (1.0 + 0.35 * uSignPulse);
  I += sg; warm += sg * 1.3;
  if (w.y > SO_Y0) { float p = uChase * 0.4 * exp(-(w.y - SO_Y0) / 260.0) * smoothstep(1000.0, 760.0, abs(w.x)); I += p; warm += p * 0.9; }
  I += 0.2 * smoothstep(CBOT + 60.0, ROOF, w.y) * step(ROOF - 1.0, w.y);
  for (int i = 0; i < 4; i++) { vec4 fl = uFlash[i]; if (fl.z > 0.001) I += fl.z * exp(-length(w - fl.xy) / fl.w); }
  return vec2(I, sat(warm / max(I, 1e-3)));
}

void main() {
  vec2 sp = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  float z = uCam.z;
  pxw = 1.0 / z;
  vec2 dd = (sp - vec2(960.0, 540.0)) / z;
  float cs = cos(uCam.w), sn = sin(uCam.w);
  vec2 w = uCam.xy + vec2(cs * dd.x + sn * dd.y, -sn * dd.x + cs * dd.y);
  // atlas (sampled in uniform control flow)
  vec2 auv = (w - AT.xy) / AT.zw;
  float inAt = step(0.0, auv.x) * step(auv.x, 1.0) * step(0.0, auv.y) * step(auv.y, 1.0);
  vec4 A = texture(uAtlas, auv) * inAt;
  vec4 A2 = texture(uAtlas, (w - vec2(5.5, 5.5) - AT.xy) / AT.zw) * inAt;

  vec3 bg = C_INK * 0.5;
  vec3 col = bg;
  float cov = 0.0;       // bone line coverage
  float lift = 1.0;      // region brightness factor
  float roof = 0.0;      // the roofline: its own light
  float dB = sdBox(w, vec2(BHW, BHH));
  vec2 L = lightAt(w);

  if (w.y < ROOF - 1.0) {
    // ---- open night sky: a few faint stars
    vec2 cell = floor(w / 84.0);
    float hs = hash12(cell + 17.0);
    if (hs < 0.14 && w.y < ROOF - 40.0) {
      vec2 spp = (cell + 0.2 + 0.6 * hash22(cell)) * 84.0;
      float d = length(w - spp) / pxw;
      float b = (0.025 + 0.08 * hash12(cell + 3.0)) * (0.85 + 0.15 * sin(uT * 2.3 + hs * 40.0));
      col += C_BONE * b * exp(-d * d / 1.1);
    }
  } else if (w.y < CBOT) {
    // ---- the cornice (all along the block): roofline, corona, dentils, egg-and-dart, frieze
    float yy = w.y - ROOF;
    roof = eL(yy, 2.0);
    if (yy > 3.0 && yy < 30.0) cov = max(cov, par(w.y - ROOF, 3.4, 0.9) * 0.55);
    cov = max(cov, eL(yy - 30.0, 1.2));
    cov = max(cov, max(eL(yy - 34.0, 0.8), eL(yy - 38.0, 0.8)));
    if (yy > 42.0 && yy < 74.0) {
      float xm = mod(w.x, 34.0);
      float blk = step(xm, 20.0);
      cov = max(cov, max(eL(xm, 0.9), eL(xm - 20.0, 0.9)) * 0.9);
      cov = max(cov, blk * par(w.x, 3.2, 0.7) * 0.5);
      cov = max(cov, eL(yy - 74.0, 1.0) * blk);
    }
    cov = max(cov, eL(yy - 42.0, 1.0));
    if (yy > 78.0 && yy < 108.0) {
      float xm = mod(w.x, 36.0) - 18.0;
      vec2 e = vec2(xm, yy - 93.0);
      cov = max(cov, eL((length(e / vec2(12.5, 11.0)) - 1.0) * 11.0, 1.0));
      cov = max(cov, eL((length(e / vec2(8.0, 7.0)) - 1.0) * 7.0, 0.7) * 0.7);
      cov = max(cov, eL(abs(xm) - 18.0, 0.8) * step(abs(yy - 93.0), 9.0));
    }
    cov = max(cov, max(eL(yy - 110.0, 1.0), eL(yy - 114.0, 0.7)));
    if (yy > 118.0 && yy < 152.0) cov = max(cov, woven(w.x, yy - 135.0, 9.0, 0.06, 0.7) * 0.8);
    cov = max(cov, eL(yy - 160.0, 1.2));
  } else if (abs(w.x) < CHW && abs(w.y) < CHH) {
    // ---- the canopy: the note
    float dF = sdBox(w, vec2(FHW, FHH));
    float dO = sdBox(w, vec2(CHW, CHH));
    if (dF > 0.0) {
      cov = max(eL(dF, 1.3), eL(dO, 2.2));
      cov = max(cov, par(w.x + w.y, 5.0, 0.6) * 0.18);
    } else if (dB > 0.0) {
      float ac = -dF;
      cov = max(eL(ac, 2.2), eL(ac - 6.0, 0.8));
      bool side = (FHW - abs(w.x)) < (FHH - abs(w.y));
      float al = side ? w.y : w.x;
      cov = max(cov, chain(al, ac, 20.0, 8.5, 11.0, 0.7));
      cov = max(cov, max(eL(ac - 32.0, 0.9), eL(ac - 47.0, 0.9)));
      // the board's frame: rules and a woven band
      cov = max(cov, max(eL(dB - 3.0, 1.8), eL(dB - 8.0, 0.8)));
      float bal = (abs(w.x) - BHW > abs(w.y) - BHH) ? w.y : w.x;
      if (dB > 10.0 && dB < 30.0) cov = max(cov, woven(bal, dB - 20.0, 7.0, 0.075, 0.7));
      cov = max(cov, max(eL(dB - 31.0, 0.7), eL(dB - 40.0, 0.9)));
      if (ac > 48.0 && dB > 41.0) {
        // the lathe field (tint), centred on the board
        vec2 m = w / vec2(1.0, 0.5);
        float rr = length(m), an = atan(m.y, m.x);
        float fld = max(hatch((rr + 7.0 * sin(an * 18.0) + 4.0 * sin(an * 7.0 + rr * 0.01)) / 5.5, 0.14), hatch((rr - 7.0 * sin(an * 18.0 + 1.3)) / 5.5, 0.1));
        float field = fld * 0.27;
        // quiet the field under the lettering rows of the top and bottom bands
        field *= mix(1.0, 0.3, step(abs(w.x), 560.0) * (1.0 - smoothstep(18.0, 26.0, abs(abs(w.y) - 278.0))));
        vec2 mq = vec2(abs(w.x) - MED_X, w.y);
        float md = medal(mq, MED_R, uTw * sign(w.x) + 0.3);
        field *= smoothstep(MED_R * 1.0, MED_R * 1.2, length(mq));
        vec2 nq = vec2(abs(w.x) - NUM_X, abs(w.y) - NUM_Y);
        float nr = length(nq);
        float cart = max(ros(nq, 64.0, 3.5, 22.0, 6.0, 0.6, -uTw * 1.3), eL(nr - 70.0, 1.0));
        field *= smoothstep(66.0, 72.0, nr);
        cov = max(cov, max(field, max(md, cart)));
      }
    }
  } else if (sdBox(w - vec2(0.0, SIGN_CY), vec2(SIGN_HW, SIGN_HH)) < 0.0) {
    // ---- the TONIGHT! sign panel
    vec2 sq = w - vec2(0.0, SIGN_CY);
    float ac = -sdBox(sq, vec2(SIGN_HW, SIGN_HH));
    cov = max(eL(ac, 2.2), eL(ac - 6.0, 0.8));
    if (ac > 8.0 && ac < 32.0) cov = max(cov, par(w.x - w.y, 5.0, 0.6) * 0.16);
    cov = max(cov, eL(ac - 34.0, 0.9));
    bool side = (SIGN_HW - abs(sq.x)) < (SIGN_HH - abs(sq.y));
    cov = max(cov, chain(side ? sq.y : sq.x, ac, 46.0, 7.0, 10.0, 0.6));
    cov = max(cov, eL(ac - 58.0, 0.9));
    if (ac > 60.0) {
      vec2 m = sq / vec2(1.0, 0.3);
      float rr = length(m);
      cov = max(cov, hatch((rr + 5.0 * sin(atan(m.y, m.x) * 24.0)) / 6.0, 0.08) * 0.22);
    }
    // the painted lamp-letter faces: wired (dim, hatched) as the pen passes, lit (warm) as the lamps light
    float face = A.b;
    float wired = smoothstep(uSockX + 30.0, uSockX - 30.0, w.x);
    float lit = smoothstep(uLitX + 50.0, uLitX - 50.0, w.x) * step(0.001, uSignK);
    float fh = hatch((w.x - w.y) / 3.2, 0.34);
    cov = mix(cov, fh * 0.24, face * wired);
    col += face * lit * (C_SIGNAL * 0.05 + C_EMBER * 0.035 * fh) * (1.0 + 0.6 * uSignPulse);
  } else if (w.y > PL_Y0 && w.y < PL_Y1 && abs(w.x) < PL_HW) {
    // ---- the sign's plinth
    float yy = w.y - PL_Y0;
    cov = max(eL(yy, 1.2), eL(yy - 30.0, 1.2));
    cov = max(cov, eL(mod(w.x, 44.0) - 22.0, 0.8) * (step(yy, 7.0) + step(23.0, yy)));
  } else if (w.y > SO_Y0 && w.y < SO_Y1 && abs(w.x) < CHW) {
    // ---- soffit: coffers under the canopy
    cov = max(eL(w.y - SO_Y1, 1.2), par(w.x, 7.0, 0.7) * 0.35);
    cov = max(cov, eL(mod(w.x, 74.0) - 37.0, 1.0) * 0.8);
  } else if (w.y >= SO_Y1 && w.y < DO_Y1 && abs(w.x) < CHW) {
    // ---- the lobby behind the doors: dim, warm
    cov = par(w.y, 9.0, 0.6) * 0.2;
    col += C_BLOOD * 0.012 * smoothstep(DO_Y1, SO_Y1, w.y) * smoothstep(0.0, 0.2, uT - uGo);
  } else if (w.y >= DO_Y1) {
    // ---- the street, in hairlines: pavement joints to the vanishing point, the kerb, a carpet, the road
    float yy = w.y - VPY;
    if (w.y < KERB) {
      float u = w.x / yy / 0.36, du = 1.0 / (yy * 0.36);
      float dj = (fract(u + 0.5) - 0.5) / du;
      float v = (1.0 / yy) / 0.00042, dv = 1.0 / (yy * yy * 0.00042);
      float dt = (fract(v + 0.5) - 0.5) / dv;
      cov = max(eL(dj, 0.9), eL(dt, 0.9)) * 0.5;
      cov = max(cov, eL(w.y - DO_Y1, 1.4));
      // the carpet: constant width on the ground, so its edges run to the vanishing point
      float cx = abs(w.x) / yy;
      if (cx < 0.42) {
        float vv = (1.0 / yy) / 0.00009;
        float ct = (fract(vv + 0.5) - 0.5) / (1.0 / (yy * yy * 0.00009));
        cov = max(eL(ct, 0.7) * 0.45, par(w.x / yy * 700.0, 5.0, 0.8) * 0.12);
      }
      cov = max(cov, eL((cx - 0.42) * yy, 1.2) * 0.9);
    } else {
      cov = max(eL(w.y - KERB, 1.6), eL(w.y - KERB - 8.0, 1.0));
      if (w.y > KERB + 8.0 && w.y < KERB + 28.0) cov = max(cov, par(w.x, 6.0, 0.7) * 0.35);
      if (w.y > KERB + 28.0) {
        float v = (1.0 / yy) / 0.00011, dv = 1.0 / (yy * yy * 0.00011);
        cov = max(cov, eL((fract(v + 0.5) - 0.5) / dv, 0.7) * 0.28);
        cov = max(cov, eL(w.y - 1080.0, 3.0) * step(fract(w.x / 130.0), 0.5) * 0.8);
      }
    }
  } else {
    // ---- the facade: pilasters, rosettes, the house name, ashlar
    float pxd = abs(abs(w.x) - PIL_X);
    if (pxd < PIL_HW) {
      float u = abs(w.x) - PIL_X + PIL_HW;
      cov = max(eL(pxd - PIL_HW, 1.4), par(u, 10.0, 0.9) * 0.8);
      float yc = w.y - CBOT;
      if (yc < 70.0) cov = max(cov, par(w.y, 6.0, 0.9) * 0.9);
      cov = max(cov, eL(yc - 70.0, 1.2));
    } else {
      float course = floor((w.y - ROOF) / 56.0);
      float jy = (fract((w.y - ROOF) / 56.0) - 0.5) * 56.0;
      float off = mod(course, 2.0) * 75.0;
      float jx = (fract((w.x + off) / 150.0) - 0.5) * 150.0;
      float joints = max(eL(abs(jy) - 28.0, 0.9), eL(abs(jx) - 75.0, 0.9)) * 0.5;
      float tool = hatch(w.y / 4.2, 0.04 + 0.16 * sat(L.x)) * 0.3;
      cov = max(joints, tool);
      // the name panel
      float nhw = uNameHW + 60.0;
      vec2 nq = w - vec2(0.0, NAME_Y - NAME_CAP * 0.5 + 10.0);
      float dN = sdBox(nq, vec2(nhw, NAME_CAP * 0.5 + 75.0));
      if (dN < 0.0) {
        float ac = -dN;
        cov = max(eL(ac, 1.8), eL(ac - 6.0, 0.8));
        bool side = (nhw - abs(nq.x)) < (NAME_CAP * 0.5 + 75.0 - abs(nq.y));
        cov = max(cov, chain(side ? nq.y : nq.x, ac, 18.0, 7.0, 10.0, 0.6));
        cov = max(cov, eL(ac - 30.0, 0.9));
        if (ac > 31.0) cov = max(cov, par(w.y + 6.0 * sin(w.x * 0.02), 5.0, 0.6) * 0.18);
      }
      vec2 rq = vec2(abs(w.x) - uRoseX, w.y - ROSE_Y);
      float rl = length(rq);
      if (rl < ROSE_R * 1.26) { cov *= smoothstep(ROSE_R * 1.2, ROSE_R * 1.26, rl); cov = max(cov, bigRose(rq, ROSE_R, uTw * sign(w.x))); }
      lift = 0.85;
    }
  }

  // ---- atlas lettering: fine text (R), hatched banknote letters with a cross-hatched shadow (G)
  float g = A.g;
  float gl = g * hatch(w.y / 3.3, 0.45);
  float sh = A2.g * (1.0 - g) * hatch((w.x + w.y) / 2.6, 0.5) * 0.75;
  cov = mix(cov, max(gl, sh), max(g, A2.g * 0.9));
  cov = max(cov, A.r * 0.95);

  // ---- light, the reveal and heat
  float age = uT - (uGo + max(dB, 0.0) / 2400.0);
  float rv = smoothstep(0.0, 0.05, age);
  float hf = age > 0.0 ? exp(-age / 0.09) : 0.0;
  float hr = 0.0, ringLine = 0.0;
  for (int i = 0; i < 3; i++) {
    vec4 rg = uRing[i];
    if (rg.w < 0.001) continue;
    float dr = length(w - rg.xy) - rg.z;
    hr = max(hr, rg.w * (exp(-dr * dr / (2.0 * 30.0 * 30.0)) + 0.3 * exp(-max(-dr, 0.0) / 140.0) * step(dr, 0.0)));
    ringLine = max(ringLine, rg.w * eL(dr, 1.4) * step(ROOF, w.y));
  }
  float I = min(L.x, 0.95) * lift;
  vec3 lc = mix(C_BONE, C_EMBER * 0.9, L.y * 0.55) * I;
  col += lc * cov * rv;
  float h = max(hf, hr);
  col += cov * rv * (C_EMBER * 1.7 * h * h + C_SIGNAL * 1.1 * h) + C_EMBER * 0.6 * ringLine * rv;
  col += C_BONE * 0.5 * roof * rv;
  // the flashbulbs light the air a little
  for (int i = 0; i < 4; i++) { vec4 fl = uFlash[i]; if (fl.z > 0.001) col += C_BONE * 0.012 * fl.z * exp(-length(w - fl.xy) / (fl.w * 0.8)); }

  // ---- the letter board: a backlit bone panel (at the hand-off frame: exactly the lit screen)
  float bcv = 1.0 - smoothstep(-0.5 * pxw, 0.5 * pxw, dB);
  if (bcv > 0.0) {
    float tubes = 0.0;
    for (int k = 0; k < 4; k++) { float yk = -157.5 + 105.0 * float(k); tubes += exp(-pow((w.y - yk) / 50.0, 2.0)); }
    float edge = smoothstep(-70.0, 0.0, dB);
    vec3 bc = C_BONE * uBoard * (1.0 + uBoardK * (0.03 * tubes - 0.07 * edge - 0.02));
    col = mix(col, bc, bcv);
  }
  fragColor = vec4(col, 1.0);
}`;
