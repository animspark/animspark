// Plate `sky`: the background pass. Night sky (stars as the marquee left them), the comp viewer's
// transparency checker where the sky has been keyed out above the matte line, and the holdout below it:
// the picture palace's cornice (the marquee plate's last frame, redrawn as the plate that is kept).
// World coordinates are logical px of the first frame (y down); uCam = (centre x, centre y, zoom, roll).
export const FRAG_SKY = /* glsl */ `
uniform vec4 uCam;
uniform float uT;
uniform float uChkY;   // the keyer's wipe front (world y): the checker shows between it and the roofline
uniform float uChkA;   // checker opacity
uniform float uStar;   // star brightness
uniform float uHold;   // holdout hatch (VFX overlay on the kept plate)
uniform float uRoofA;  // cornice brightness
uniform float uDark;   // global multiplier (the exit goes dark)
uniform float uGlow;   // violet skyglow above the roofline (the paint lighting the haze)

const float ROOF = 900.0;
float pxw;
// a hairline of w screen px at signed distance d (world units)
float eL(float d, float w) { return pxLine(abs(d) / pxw, w * 0.5 - 0.5, w * 0.5 + 0.5); }

void main() {
  vec2 sp = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  float z = uCam.z;
  pxw = 1.0 / z;
  vec2 dd = (sp - vec2(960.0, 540.0)) / z;
  float cs = cos(uCam.w), sn = sin(uCam.w);
  vec2 w = uCam.xy + vec2(cs * dd.x + sn * dd.y, -sn * dd.x + cs * dd.y);

  vec3 col = C_INK * 0.5;
  if (w.y < ROOF - 1.0) {
    // haze toward the horizon, lit faintly violet by the paint
    float hz = smoothstep(ROOF - 700.0, ROOF, w.y);
    col += C_INK2 * 0.35 * hz;
    col += C_ACID * 0.018 * uGlow * hz * hz;
    // the keyed-out sky: the viewer's alpha checker (32 px), below the keyer's front
    if (w.y > uChkY) {
      vec2 q = floor(w / 32.0);
      float par = mod(q.x + q.y, 2.0);
      col += C_GRAPHITE * (0.018 + 0.03 * par) * uChkA * smoothstep(uChkY, uChkY + 40.0, w.y);
    }
    // the front itself: a thin ash line racing up
    col += C_ASH * 0.35 * eL(w.y - uChkY, 1.2) * uChkA * step(uChkY, ROOF - 4.0) * step(1.0, uChkY);
    // stars (same field as the marquee's sky)
    vec2 cell = floor(w / 84.0);
    float hs = hash12(cell + 17.0);
    if (hs < 0.14 && w.y < ROOF - 40.0) {
      vec2 spp = (cell + 0.2 + 0.6 * hash22(cell)) * 84.0;
      float d = length(w - spp) / pxw;
      float b = (0.025 + 0.08 * hash12(cell + 3.0)) * (0.85 + 0.15 * sin(uT * 2.3 + hs * 40.0));
      col += C_BONE * b * exp(-d * d / 1.1) * uStar;
    }
  } else {
    // ---- the holdout: cornice of the picture palace, warm grey in its own lamps' light
    float yy = w.y - ROOF;
    vec3 warm = mix(C_BONE, C_EMBER, 0.42) * 0.4;
    float cov = 0.0;
    cov = max(cov, eL(yy, 2.0) * 1.6);                                   // the roofline
    if (yy > 3.0 && yy < 18.0) cov = max(cov, 0.35 * eL(mod(yy, 3.4) - 1.7, 0.8)); // corona, ruled
    cov = max(cov, eL(yy - 18.6, 1.0));
    cov = max(cov, max(eL(yy - 21.0, 0.7), eL(yy - 23.6, 0.7)) * 0.8);
    if (yy > 26.0 && yy < 46.0) {                                         // dentils
      float xm = mod(w.x, 21.1);
      float blk = step(xm, 12.4);
      cov = max(cov, max(eL(xm, 0.8), eL(xm - 12.4, 0.8)) * 0.8);
      cov = max(cov, blk * 0.3);
    }
    cov = max(cov, eL(yy - 46.0, 1.0));
    {                                                                     // egg row: rings
      vec2 c = vec2(mod(w.x, 21.1) - 10.5, yy - 57.0);
      float r = length(c);
      if (yy > 48.0 && yy < 66.0) cov = max(cov, max(eL(r - 6.0, 0.9), eL(r - 3.6, 0.7)) * 0.85);
    }
    cov = max(cov, eL(yy - 68.0, 1.0));
    {                                                                     // cable moulding
      float a = sin(w.x / 21.1 * 3.14159) * 4.5;
      cov = max(cov, max(eL(yy - 83.0 - a, 0.8), eL(yy - 83.0 + a, 0.8)) * 0.7);
    }
    cov = max(cov, eL(yy - 98.0, 0.8) * 0.6);
    cov = max(cov, eL(yy - 110.0, 1.0));
    if (yy > 112.0) cov = max(cov, 0.22 * eL(mod(yy, 5.0) - 2.5, 0.7) * (1.0 - smoothstep(112.0, 420.0, yy))); // facade, engraved
    col = mix(col, warm, sat(cov) * uRoofA);
    // the VFX overlay on the kept plate: a diagonal holdout hatch
    float hh = eL(mod(w.x + w.y, 18.0) - 9.0, 0.9);
    col += C_GRAPHITE * 0.05 * hh * uHold * step(4.0, yy);
  }
  fragColor = vec4(col * uDark, 1.0);
}`;
