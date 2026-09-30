// Plate `stadium`: the plan shader. One pass draws the whole engineer's seating plan through a 2D camera:
// the drafting sheet, the bowl (every seat a dot, one person each: rows, aisles with stairs, the cross-aisle,
// vomitories, section boundaries, roof edge and façade), the pitch (mown stripes, markings, goals), the front
// rails (LED boards), the floodlight towers with their aiming lines and beams, and the lyric lettered in the
// plan's own projection (pitch paint, a card stunt, the rain's imprint) from a mask texture. Crowd motion
// (impact ripples, stadium waves, card-flip races, the kick pulse) is computed per seat, at the seat centre.
import { G, TOWERS, MASK } from './stadium-kit';
import { SS_TAP_GLSL } from '../px/gl';

const f = (x: number) => x.toFixed(4);

export const PLAN_FRAG = /* glsl */ `
${SS_TAP_GLSL}
uniform vec4 uCam;          // centre x, y (m), roll, zoom (px per m)
uniform float uT;
uniform sampler2D uMask;
uniform vec4 uRev0;         // rail draw (m along the corner path), seat front (m behind the rail), pitch markings radius (m), sheet alpha
uniform vec4 uRev1;         // extension heat (1 = hot signal rails), towers alpha, arrivals t0, arrivals s per m
uniform vec4 uOnX;          // ON: x0, w, start, dur
uniform vec4 uEvX;          // EVERY
uniform vec4 uCrX;          // CROWD
uniform float uPaintSplit;  // world y between ON and EVERY
uniform vec2 uRainSplit;    // world x between Rain|it and it|down
uniform vec3 uRainT;        // imprint (flip) time per rain word
uniform float uRainK;       // imprint strength
uniform float uCardK;       // card stunt strength (1 = held)
uniform vec4 uRip[8];       // impacts: x, y, t0, amp
uniform vec4 uWave[8];      // waves round the bowl: angle0, t0, angular speed, amp (> 0 people stand, < 0 cards flip to signal)
uniform float uPulse;       // the crowd's pulse on the kicks
uniform vec4 uFlood;        // tower strobe
uniform float uLamp, uBoard, uBlack, uLineExt;

const vec2 PH = vec2(${f(G.PL)}, ${f(G.PW)});
const vec2 CC = vec2(${f(G.CCX)}, ${f(G.CCY)});
const float AX = ${f(G.AX)}, AY = ${f(G.AY)}, RC = ${f(G.RC)};
const float D0 = ${f(G.D0)}, ROWH = ${f(G.ROWH)}, NLOW = ${f(G.NLOW)}, DX0 = ${f(G.DX0)}, DX1 = ${f(G.DX1)}, DBACK = ${f(G.DBACK)}, DOUT = ${f(G.DOUT)};
const float SEC = ${f(G.SEC)}, AISLE = ${f(G.AISLE)}, SEAT = ${f(G.SEAT)};
const vec4 MR = vec4(${f(MASK.x0)}, ${f(MASK.y0)}, ${f(MASK.w)}, ${f(MASK.h)});
const vec2 TW[4] = vec2[4](${TOWERS.map(([x, y]) => `vec2(${f(x)}, ${f(y)})`).join(', ')});

vec4 maskAt(vec2 p) { return textureLod(uMask, (p - MR.xy) / MR.zw, 0.0); }
/** a line of wPx logical px around distance dM (m) */
float ln(float dM, float wPx, float ps) { return sat(0.5 * wPx - dM / ps + 0.5); }
float dashes(float a, float on, float period) { return step(fract(a / period), on / period); }
/** fresh ink: white-hot tip → ember → signal wake → base in ~0.3 s */
vec3 hotC(float age, vec3 base) {
  if (age < 0.0) return base;
  float tip = exp(-age / 0.05), wake = 1.0 - smoothstep(0.05, 0.32, age);
  vec3 c = mix(base, C_SIGNAL * 1.25, wake);
  c = mix(c, C_EMBER * 1.7, tip * 0.7);
  return c + vec3(1.0, 0.82, 0.62) * tip * tip * 1.1;
}
float wrapA(float a) { return a - TAU * floor(a / TAU + 0.5); }
/** own hatch (no derivatives: safe in branches). u in line units, aa = u per px */
float hatchN(float u, float dark, float aa) {
  float x = 0.5 - abs(fract(u) - 0.5), hw = 0.5 * sat(dark);
  return (1.0 - smoothstep(hw - aa, hw + aa, x)) * sat(1.6 - aa * 3.0);
}

// ---------------------------------------------------------------- the pitch markings (distance, m)
float markings(vec2 p) {
  vec2 q = abs(p);
  float dd = abs(sdBox(p, PH));
  dd = min(dd, sdSegment(p, vec2(0.0, -PH.y), vec2(0.0, PH.y)));
  dd = min(dd, abs(length(p) - 9.15));
  dd = min(dd, abs(sdBox(q - vec2(PH.x - 8.25, 0.0), vec2(8.25, 20.16))));
  dd = min(dd, abs(sdBox(q - vec2(PH.x - 2.75, 0.0), vec2(2.75, 9.16))));
  if (q.x < PH.x - 16.5) dd = min(dd, abs(length(q - vec2(PH.x - 11.0, 0.0)) - 9.15));
  if (q.x < PH.x && q.y < PH.y) dd = min(dd, abs(length(q - PH) - 1.0));
  return dd;
}

vec3 shade(vec2 p, float ps) {
  vec3 col = C_INK;
  float sheet = uRev0.w;
  float t = uT;
  // ---- drafting sheet: 10 m / 50 m grid
  vec2 g10 = abs(fract(p / 10.0 + 0.5) - 0.5) * 10.0, g50 = abs(fract(p / 50.0 + 0.5) - 0.5) * 50.0;
  float gmin = max(ln(g10.x, 1.0, ps), ln(g10.y, 1.0, ps)), gmaj = max(ln(g50.x, 1.0, ps), ln(g50.y, 1.0, ps));
  col = mix(col, C_GRAPHITE, max(0.075 * gmin, 0.16 * gmaj) * sheet);

  vec2 q = abs(p);
  vec2 sg = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  vec2 v = q - CC;
  float d = length(max(v, 0.0)) + min(max(v.x, v.y), 0.0) - RC; // behind the front rail (m)
  float front = uRev0.y;
  float standK = smoothstep(front + 0.5, front - 0.5, d);         // the plan resolves outward from the rails

  // ---- the esplanade outside the bowl: paving, the outer ring, the façade columns
  if (d > DOUT) {
    float esp = smoothstep(DOUT + 26.0, DOUT + 25.0, d) * sheet;
    float pav = hatchN((p.x + p.y) / 2.2, 0.08, ps / 2.2) + hatchN((p.x - p.y) / 2.2, 0.08, ps / 2.2);
    col = mix(col, C_INK2, 0.6 * esp);
    col = mix(col, C_GRAPHITE, 0.12 * sat(pav) * esp);
    col = mix(col, C_ASH * 0.8, 0.45 * ln(abs(d - (DOUT + 25.0)), 1.0, ps) * sheet);
  }

  // ---- the bowl
  if (d > 0.0 && d < DOUT + 1.0) {
    // along-row coordinate, section, and the frame at this point
    float a, secI, loc, secLen = 1e9; vec2 tA, nR; int seg;
    if (v.x <= 0.0) { seg = 0; a = p.x; tA = vec2(1.0, 0.0); nR = vec2(0.0, sg.y); }
    else if (v.y <= 0.0) { seg = 1; a = p.y; tA = vec2(0.0, 1.0); nR = vec2(sg.x, 0.0); }
    else { seg = 2; float th = atan(v.y, v.x); float R = length(v); secI = floor(th / (PI / 6.0)); loc = (th - secI * PI / 6.0) * R; secLen = PI / 6.0 * R;
           nR = normalize(v) * sg; tA = vec2(-nR.y, nR.x); a = th * R; }
    float L = seg == 0 ? CC.x : CC.y;
    if (seg != 2) { secI = floor(a / SEC + 0.5); loc = (a / SEC + 0.5 - secI) * SEC; }
    bool inTierL = d >= D0 && d < DX0, inTierU = d >= DX1 && d < DBACK;
    float rowF = inTierL ? (d - D0) / ROWH : (d - DX1) / ROWH + NLOW;
    float row = floor(rowF), fr = rowF - row;
    bool aisle = loc < AISLE || (seg != 2 && abs(a) > L - 0.3);
    float seatF = (loc - AISLE) / SEAT, seatI = floor(seatF), su = seatF - seatI;
    if (seg == 2 && seatI + 1.0 > floor((secLen - AISLE) / SEAT)) aisle = true;
    bool vom = inTierL && seg != 2 && row >= ${G.VOM0}.0 && row < ${G.VOM1}.0 && mod(secI, 2.0) < 0.5 && loc >= 5.4 && loc <= 8.4;

    vec3 sc = C_INK;
    float structA = standK * 0.9;
    // cross-aisle walkway and back of the stand
    if (d >= DX0 && d < DX1) sc = C_INK2 * 1.2;
    if (d >= DBACK) sc = C_INK2 * 0.9 + C_GRAPHITE * 0.06 * hatchN((a + d) / 1.2, 0.3, ps / 1.2);
    col = mix(col, sc, structA);
    // tier lines, back wall, façade, roof edge above (hidden line, dashed)
    float lines = 0.0;
    lines = max(lines, 0.55 * ln(abs(d - DX0), 1.0, ps));
    lines = max(lines, 0.7 * ln(abs(d - DX1), 1.2, ps));
    lines = max(lines, 0.7 * ln(abs(d - DBACK), 1.6, ps));
    lines = max(lines, 0.5 * ln(abs(d - DOUT), 1.0, ps));
    lines = max(lines, 0.45 * ln(abs(d - 14.0), 1.0, ps) * dashes(a, 2.4, 4.0));
    col = mix(col, C_ASH * 0.75, lines * standK);
    // façade columns every 9 m on the outer line
    float colm = ln(max(abs(d - (DOUT - 0.9)) - 0.6, abs(fract(a / 9.0 + 0.5) - 0.5) * 9.0 - 0.6), 1.0, ps);
    col = mix(col, C_ASH * 0.55, 0.6 * colm * standK * step(DBACK, d));

    if ((inTierL || inTierU)) {
      // section boundaries (aisles): stairs as ticks, edges as hairlines
      if (aisle && !vom) {
        float stair = ln(min(fr, 1.0 - fr) * ROWH, 1.0, ps) * sat(ROWH / ps / 3.0 - 0.3);
        float edge = ln(min(loc, abs(AISLE - loc)), 1.0, ps);
        col = mix(col, C_GRAPHITE * 1.1, (0.55 * stair + 0.35 * edge) * standK);
      } else if (vom) {
        vec2 vl = vec2(loc - 6.9, d - (D0 + ${f((G.VOM0 + G.VOM1) / 2)} * ROWH));
        float bx = abs(sdBox(vl, vec2(1.5, ${f(((G.VOM1 - G.VOM0) * G.ROWH) / 2)})));
        float hat = hatchN((vl.x + vl.y) / 0.9, 0.22, ps / 0.9);
        col = mix(col, C_INK, standK);
        col = mix(col, C_GRAPHITE, 0.45 * hat * standK);
        col = mix(col, C_ASH * 0.8, 0.8 * ln(bx, 1.2, ps) * standK);
      } else {
        // ---- a seat, and whoever is in it
        float dc = d - (fr - 0.5) * ROWH;
        vec2 cen;
        if (seg == 2) {
          float Rc = RC + dc, thc = secI * PI / 6.0 + (AISLE + (seatI + 0.5) * SEAT) / Rc;
          cen = (CC + Rc * vec2(cos(thc), sin(thc))) * sg;
        } else {
          float ac = (secI - 0.5) * SEC + AISLE + (seatI + 0.5) * SEAT;
          cen = seg == 0 ? vec2(ac, sg.y * (AY + dc)) : vec2(sg.x * (AX + dc), ac);
        }
        vec2 dv = vec2((su - 0.5) * SEAT, (fr - 0.5) * ROWH);
        float h = hash12(cen * 3.17 + 0.5);
        float seatOn = smoothstep(front + 0.4, front - 0.4, dc);
        float tArr = uRev1.z + dc * uRev1.w + h * 0.05;
        float here = step(tArr, t);
        // the crowd moves: impact ripples, stadium waves, the kick
        float J = 0.0, Hh = 0.0, race = 0.0;
        for (int i = 0; i < 8; i++) {
          vec4 r = uRip[i];
          float dt = t - r.z;
          if (r.w > 0.0 && dt > 0.0 && dt < 3.0) {
            float dist = length(cen - r.xy), rad = dt * 72.0;
            float band = exp(-pow((dist - rad) / 5.5, 2.0)) * exp(-dt * 1.2);
            J += r.w * band;
            Hh += r.w * (exp(-dist / 16.0) * exp(-dt / 0.28) + 0.55 * band * exp(-dt / 0.6));
          }
        }
        float ang = atan(cen.y * 1.2, cen.x);
        for (int i = 0; i < 8; i++) {
          vec4 w = uWave[i];
          float dt = t - w.y;
          if (w.w != 0.0 && dt > 0.0 && abs(w.z) * dt < TAU + 1.0) {
            float da = wrapA(ang - (w.x + w.z * dt));
            if (w.w > 0.0) J += w.w * exp(-pow(da / 0.16, 2.0)) * (0.6 + 0.4 * h);
            else {
              // a band of flipped cards racing round: flips over at the front, back again at the tail
              float rel = da * sign(w.z); // > 0 ahead of the band's centre
              race = max(race, -w.w * smoothstep(0.11, 0.06, abs(da)));
              Hh = max(Hh, -w.w * 0.9 * smoothstep(0.11, 0.08, rel) * step(0.06, rel));
            }
          }
        }
        float pulse = uPulse * (0.55 + 0.9 * h);
        // cards: the stunt on the south stand, the rain's imprint on the north stand, the build's races
        vec4 m = maskAt(cen);
        float flip = 0.0; vec3 cardC = C_INK2; float cardAge = -1.0;
        if (cen.y > AY + 2.0 && uCardK > 0.0) {
          float tf = uCrX.z + sat((cen.x - uCrX.x) / uCrX.y) * uCrX.w + h * 0.035;
          float letter = step(0.5, m.g);
          flip = sat((t - tf) / 0.09) * uCardK;
          cardAge = t - tf - 0.05;
          cardC = letter > 0.5 ? hotC(cardAge, C_BONE * 0.86) : C_INK2 * 0.55;
          // anticipation: the letter's holders stand ready (dim)
          J += letter * 0.35 * smoothstep(tf - 0.4, tf, t) * (1.0 - step(tf, t));
        }
        if (cen.y < -AY - 2.0 && m.b > 0.5 && uRainK > 0.0) {
          float ti = (cen.x < uRainSplit.x ? uRainT.x : cen.x < uRainSplit.y ? uRainT.y : uRainT.z) + h * 0.06;
          float k = sat((t - ti) / 0.09) * uRainK;
          if (k > flip) { flip = k; cardAge = t - ti - 0.05; cardC = hotC(cardAge * 0.6, C_BONE * 0.8); }
        }
        if (race > 0.01) { flip = max(flip, race); cardC = mix(cardC, C_SIGNAL * (0.85 + 0.5 * h), race); }
        // the dot (a person) or the card they hold up; flipping squashes it along the row
        float fk = flip < 0.5 ? flip : 1.0 - flip;
        float squash = abs(cos(PI * fk));
        float rad = 0.19 * (1.0 + 0.6 * min(J, 2.0) + 0.3 * pulse) * here;
        float cov;
        float lod = smoothstep(0.2, 0.36, ps);
        if (flip >= 0.5) {
          vec2 hb = vec2(0.27 * squash, 0.35);
          cov = mix(sat(0.5 - sdBox(dv, hb) / ps), 4.0 * hb.x * hb.y / (SEAT * ROWH), lod);
        } else {
          vec2 dd = dv * vec2(1.0 / max(squash, 0.05), 1.0);
          cov = mix(sat(0.5 - (length(dd) - rad) / ps), 3.1416 * rad * rad / (SEAT * ROWH), lod);
        }
        float bright = (0.52 + 0.3 * h) * (1.0 + 1.5 * min(J, 2.0) + 0.55 * pulse);
        vec3 person = C_ASH * bright;
        person = mix(person, heat(0.45 + 0.5 * sat(Hh)), sat(Hh * 1.25));
        float aAge = t - tArr; // a person arriving: a hot flick, gone in ~0.2 s
        person = mix(person, C_SIGNAL * 0.95, (1.0 - smoothstep(0.0, 0.2, aAge)) * 0.75);
        person += vec3(1.0, 0.7, 0.45) * exp(-aAge / 0.03) * step(0.0, aAge) * 0.6;
        vec3 pc = flip >= 0.5 ? cardC : person;
        // an empty seat before its person arrives: a ring
        float ring = ln(abs(length(dv) - 0.2), 1.0, ps) * (1.0 - here) * (1.0 - lod);
        col = mix(col, C_GRAPHITE * 0.9, 0.7 * ring * seatOn);
        col = mix(col, pc, cov * seatOn);
      }
    }
    // the resolve front: a hot hairline sweeping out through the rows
    col = mix(col, C_SIGNAL * 1.4, 0.85 * ln(abs(d - front), 1.4, ps) * step(0.3, front) * (1.0 - smoothstep(DOUT - 2.0, DOUT + 2.0, front)));
  }

  // ---- inside the rails: run-off, pitch, benches, goals
  if (d <= 0.0) {
    float pr = uRev0.z;
    float pk = smoothstep(pr, pr - 3.0, length(p));
    float pHeat = exp(-max(pr - length(p), 0.0) / 4.0) * pk * (1.0 - smoothstep(60.0, 70.0, pr));
    col = mix(col, C_INK2 * 0.75, pk * 0.9);
    vec2 pp = q - PH;
    if (max(pp.x, pp.y) < 0.0) {
      float stripe = mod(floor((p.x + PH.x) / 5.25), 2.0);
      vec2 hd = stripe > 0.5 ? vec2(0.7071, 0.7071) : vec2(0.7071, -0.7071);
      float hA = hatchN(dot(p, hd) / 0.85, 0.2, ps / 0.85);
      vec3 grass = C_INK2 * (stripe > 0.5 ? 1.3 : 0.8) + C_GRAPHITE * 0.14 * hA;
      col = mix(col, grass, pk);
    }
    // goals and nets behind the goal lines
    vec2 gq = q - vec2(PH.x + 1.0, 0.0);
    float gb = sdBox(gq, vec2(1.0, 3.66));
    if (gb < 0.0) col = mix(col, C_GRAPHITE * 0.8, 0.5 * max(hatchN(gq.x / 0.4, 0.15, ps / 0.4), hatchN(gq.y / 0.4, 0.15, ps / 0.4)) * pk);
    col = mix(col, C_ASH, 0.7 * ln(abs(gb), 1.0, ps) * pk * step(PH.x, q.x));
    // benches and technical areas (south touchline)
    vec2 bq = vec2(q.x - 11.0, p.y - 39.4);
    float bench = abs(sdBox(bq, vec2(6.0, 1.1)));
    float tech = abs(sdBox(bq - vec2(0.0, -1.9), vec2(7.0, 3.0))) ;
    col = mix(col, C_ASH * 0.8, 0.7 * ln(bench, 1.0, ps) * pk);
    col = mix(col, C_GRAPHITE, 0.7 * ln(tech, 1.0, ps) * dashes(bq.x + bq.y, 0.8, 1.6) * pk);
    // the lettering painted on the grass
    vec4 m = maskAt(p);
    float e = clamp(0.5 * 8.0 * ps, 0.06, 0.5);
    float paint = smoothstep(0.5 - e, 0.5 + e, m.r);
    vec4 wd = p.y < uPaintSplit ? uOnX : uEvX;
    float tr = wd.z + sat((p.x - wd.x) / wd.y) * wd.w;
    float age = t - tr;
    float guide = smoothstep(wd.z - 0.4, wd.z, t) * step(age, 0.0);
    float wear = 0.86 + 0.14 * snoise(p * 3.1);
    col = mix(col, C_GRAPHITE * 0.9, 0.35 * paint * guide);
    col = mix(col, hotC(age, C_BONE * 0.8 * wear), paint * step(0.0, age) * (1.0 - uBlack));
    // markings drawn outward from the centre spot, hot at the front
    float mkd = markings(p);
    float mk = max(ln(mkd, 1.3, ps), sat(0.5 - min(length(p) - 0.3, length(q - vec2(PH.x - 11.0, 0.0)) - 0.3) / ps));
    col = mix(col, C_BONE * 0.7 + C_SIGNAL * 1.4 * pHeat, mk * pk);
  }

  // ---- centre lines of the plan (dash-dot), both axes, drawn over everything
  float ax1 = ln(abs(p.y), 1.0, ps) * max(dashes(p.x, 5.0, 8.0), step(abs(mod(p.x, 8.0) - 6.5), 0.3));
  float ax2 = ln(abs(p.x), 1.0, ps) * max(dashes(p.y, 5.0, 8.0), step(abs(mod(p.y, 8.0) - 6.5), 0.3));
  float axK = d < 0.0 ? uRev0.z / 70.0 : step(DOUT + 1.0, d);
  col = mix(col, C_ASH * 0.8, 0.55 * sat(ax1 + ax2) * sheet * sat(axK));

  // ---- front rails: the LED boards (RAILS_H12 at the first frame)
  {
    float s;
    if (v.x <= 0.0) s = -1.0;
    else if (v.y <= 0.0) s = RC * PI * 0.5 + (CC.y - q.y);
    else s = (PI * 0.5 - atan(v.y, v.x)) * RC;
    float drawn = step(s, uRev0.x);
    float fh = exp(-max(uRev0.x - s, 0.0) / 2.5) * drawn * step(0.0, s);
    float hw = max(0.275 / ps, 0.6);
    float board = sat(hw - abs(d) / ps + 0.5) * drawn;
    float scroll = mix(1.0, 0.82 + 0.18 * step(0.5, fract((s < 0.0 ? p.x * sg.y : s) / 3.0 - t * 1.6)), 1.0 - uRev1.x);
    col = mix(col, C_SIGNAL * (uBoard * scroll + 1.6 * fh), board * (1.0 - uBlack));
    // beyond the corners the rails run on across the sheet: hot at the hand-off, then extension lines
    if (q.x > CC.x) {
      float hot = uRev1.x;
      float wpx = mix(1.0, 2.0 * max(0.275 / ps, 0.6), hot);
      float ext = sat(0.5 * wpx - abs(q.y - AY) / ps + 0.5);
      float gapK = max(hot, step(DOUT + 3.0, d)) * max(hot, sheet);
      vec3 ec = mix(C_GRAPHITE * 0.9, C_SIGNAL * uBoard, hot);
      col = mix(col, ec, ext * gapK * (1.0 - uBlack) * mix(0.7, 1.0, hot));
    }
  }

  // ---- floodlight towers: mast, head of lamps aimed at the pitch, aiming lines, beams on the strobe
  float tk = uRev1.y;
  for (int i = 0; i < 4; i++) {
    vec2 tp = TW[i];
    vec2 fw = normalize(-tp), rt = vec2(-fw.y, fw.x);
    vec2 lp = vec2(dot(p - tp, rt), dot(p - tp, fw));
    float fl = uFlood[i];
    float mast = abs(sdBox(lp - vec2(0.0, -3.2), vec2(1.7)));
    float head = sdBox(lp, vec2(7.6, 1.5));
    vec2 lg = vec2(lp.x - clamp(floor(lp.x / 2.0 + 0.5), -3.0, 3.0) * 2.0, abs(lp.y) - 0.7);
    float lamp = length(lg) - 0.5;
    col = mix(col, C_INK, step(head, 0.0) * tk);
    col = mix(col, C_ASH * 0.8, 0.8 * max(ln(mast, 1.2, ps), ln(abs(head), 1.2, ps)) * tk);
    col = mix(col, C_GRAPHITE, 0.6 * ln(sdSegment(lp, vec2(0.0, -1.5), vec2(0.0, -4.9)), 1.0, ps) * tk);
    col = mix(col, C_EMBER * (uLamp + 3.2 * fl), sat(0.5 - lamp / ps) * step(head, 0.0) * tk);
    // aiming lines to three points on the pitch
    for (int k = 0; k < 3; k++) {
      vec2 sgn = sign(tp);
      vec2 aim = k == 0 ? sgn * vec2(40.0, 20.0) : k == 1 ? sgn * vec2(14.0, -12.0) : sgn * vec2(-12.0, 24.0);
      float sd = sdSegment(p, tp + fw * 1.5, aim);
      float al = ln(sd, 1.0, ps) * dashes(length(p - tp), 1.2, 2.4);
      col = mix(col, mix(C_GRAPHITE, C_EMBER * 1.2, sat(fl)), (0.28 + 0.6 * fl) * al * tk);
    }
    // the beam
    if (fl > 0.001) {
      float dist = length(lp), an = atan(lp.x, lp.y);
      float wedge = smoothstep(0.5, 0.28, abs(an)) * smoothstep(3.0, 12.0, dist) * exp(-dist / 150.0) * step(0.0, lp.y);
      col += (C_BONE * 0.05 + C_EMBER * 0.03) * fl * wedge;
    }
  }

  // ---- lights out: only the touchlines and the long axis stay, and run out across the sheet (TRACKS_H13)
  col = mix(col, C_INK, uBlack);
  if (uBlack > 0.0) {
    float dl = min(abs(q.y - PH.y), abs(p.y));
    float l3 = ln(dl, 1.5, ps) * step(q.x, uLineExt);
    col = mix(col, C_BONE * 0.78, l3 * uBlack);
  }
  return col;
}

void main() {
  vec2 s0 = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  float cr = cos(uCam.z), sr = sin(uCam.z), ps = 1.0 / uCam.w;
  vec3 acc = vec3(0.0);
  for (int k = ssK0(); k < ssK1(); k++) {
    vec2 s = s0 + rgss(k) / PX_SCALE - vec2(960.0, 540.0);
    vec2 u = s / uCam.w;
    vec2 p = uCam.xy + vec2(cr * u.x + sr * u.y, -sr * u.x + cr * u.y);
    acc += shade(p, ps);
  }
  fragColor = vec4(acc * ssWeight(), 1.0);
}`;
