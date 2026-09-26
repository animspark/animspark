/**
 * Interpolator: any time t → the render state of every element. Pure functions, so seeking and exporting never differ.
 */
import type { CameraKeyframe, CompiledScene, ElementProps, Keyframe, ParamValue, Rect, Track } from '../core/types';
import { EASE, TONE_COLOR, type Tone } from '../core/tokens';
import { RHYTHM } from './rhythm';

const HEX = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

/**
 * Component name → set of param keys that are not tweened (filled in by the Registry when components register).
 * A morph jumps these keys straight to the target value instead of interpolating linearly (see ComponentDef.stepParams).
 */
const STEP_PARAMS = new Map<string, Set<string>>();

/** Called by the Registry when a component registers: records its stepParams (discrete params that jump during a morph). */
export function registerStepParams(component: string, keys: string[] | undefined): void {
  if (keys && keys.length) STEP_PARAMS.set(component, new Set(keys));
}

/**
 * Component name → its own interpolation function (path-level morph). For components that declare one, morph
 * in-between frames bypass the generic lerp and this function decides the a→b params at t (see ComponentDef.interpolate).
 */
type InterpFn = (a: ParamValue, b: ParamValue, t: number) => ParamValue;
const INTERPOLATORS = new Map<string, InterpFn>();

/** Called by the Registry when a component registers: records its own interpolator. */
export function registerInterpolator(component: string, fn: InterpFn | undefined): void {
  if (fn) INTERPOLATORS.set(component, fn);
}

/** Normalize color strings: #RGB → #RRGGBB; tone names (accent etc.) → the current theme's hex; anything else as is */
function toHex(s: string): string | null {
  if (HEX.test(s)) return s;
  if (HEX3.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const t = TONE_COLOR[s as Tone];
  return t && HEX.test(t) ? t : null;
}

export function lerpValue(a: ParamValue | undefined, b: ParamValue | undefined, t: number): ParamValue {
  if (a === undefined) return b ?? 0;
  if (b === undefined) return a;
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t;
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    const out: ParamValue[] = [];
    for (let i = 0; i < len; i++) out.push(lerpValue(a[i] ?? b[i], b[i] ?? a[i], t));
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ra = a as Record<string, ParamValue>;
    const rb = b as Record<string, ParamValue>;
    const out: Record<string, ParamValue> = {};
    for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
      out[k] = lerpValue(ra[k] ?? rb[k], rb[k] ?? ra[k], t);
    }
    return out;
  }
  if (typeof a === 'string' && typeof b === 'string' && a !== b) {
    // Color interpolation: supports #RRGGBB / #RGB / tone names (accent, primary, etc., resolved against the current theme)
    const ha = toHex(a);
    const hb = toHex(b);
    if (ha && hb) {
      const pa = [1, 3, 5].map(i => parseInt(ha.slice(i, i + 2), 16));
      const pb = [1, 3, 5].map(i => parseInt(hb.slice(i, i + 2), 16));
      return '#' + pa.map((v, i) => Math.max(0, Math.min(255, Math.round(v + ((pb[i] ?? v) - v) * t))).toString(16).padStart(2, '0')).join('');
    }
  }
  return t < 0.5 ? a : b;
}

export function lerpProps(a: ElementProps, b: ElementProps, t: number): ElementProps {
  let params = lerpValue(a.params, b.params, t) as ElementProps['params'];
  // Component-owned interpolation (path-level morph): if interpolate is declared, in-between frames are entirely up to it, bypassing the generic lerp/stepParams.
  const interp = INTERPOLATORS.get(a.component) ?? INTERPOLATORS.get(b.component);
  if (interp && a.component === b.component) {
    params = interp(a.params, b.params, t) as ElementProps['params'];
    return {
      component: t < 0.5 ? a.component : b.component,
      cx: a.cx + (b.cx - a.cx) * t,
      cy: a.cy + (b.cy - a.cy) * t,
      w: a.w + (b.w - a.w) * t,
      h: a.h + (b.h - a.h) * t,
      opacity: Math.max(0, Math.min(1, a.opacity + (b.opacity - a.opacity) * t)),
      scale: a.scale + (b.scale - a.scale) * t,
      rotation: (a.rotation ?? 0) + ((b.rotation ?? 0) - (a.rotation ?? 0)) * t,
      scaleAt: t < 0.5 ? a.scaleAt : (b.scaleAt ?? a.scaleAt),
      params,
      z: a.z ?? b.z,
    };
  }
  // Discrete params (stepParams): jump to the target as soon as the morph starts (t>0), with no in-between tween.
  // This avoids e.g. value: 0→999 flickering through hundreds of intermediate numbers.
  const stepKeys = STEP_PARAMS.get(a.component) ?? STEP_PARAMS.get(b.component);
  if (stepKeys && params && typeof params === 'object' && !Array.isArray(params)) {
    const pa = a.params as Record<string, ParamValue>;
    const pb = b.params as Record<string, ParamValue>;
    const merged = { ...(params as Record<string, ParamValue>) };
    for (const k of stepKeys) {
      const target = t > 0 ? pb[k] : pa[k];
      if (target !== undefined) merged[k] = target;
    }
    params = merged as ElementProps['params'];
  }
  return {
    component: t < 0.5 ? a.component : b.component,
    cx: a.cx + (b.cx - a.cx) * t,
    cy: a.cy + (b.cy - a.cy) * t,
    w: a.w + (b.w - a.w) * t,
    h: a.h + (b.h - a.h) * t,
    // Overshooting eases (backOut/elasticOut) can push t briefly outside [0,1], so opacity must be clamped
    opacity: Math.max(0, Math.min(1, a.opacity + (b.opacity - a.opacity) * t)),
    scale: a.scale + (b.scale - a.scale) * t,
    rotation: (a.rotation ?? 0) + ((b.rotation ?? 0) - (a.rotation ?? 0)) * t,
    // scaleAt is not tweened (it jumps when the content layer's transform origin changes, so the origin never slides across other parts)
    scaleAt: t < 0.5 ? a.scaleAt : (b.scaleAt ?? a.scaleAt),
    params,
    z: a.z ?? b.z,
  };
}

export function propsAt(track: Track, t: number): ElementProps {
  const kfs: Keyframe[] = track.keyframes;
  if (!kfs.length) throw new Error(`Empty track: ${track.id}`);
  const first = kfs[0]!;
  const last = kfs[kfs.length - 1]!;
  // The track's first keyframe is in the future: this id has not entered yet, so the future keyframe's opacity must not leak
  // into earlier times. (Typical case: a later shot's morph writes op=1 first, with a first-keyframe t far beyond the
  // current t; the old logic showed it by mistake at the start of the film.)
  if (t < first.t) return { ...first.props, opacity: 0 };
  if (t === first.t) return first.props;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]!;
    const b = kfs[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = Math.max(b.t - a.t, 1);
      const easeFn = (b.ease && EASE[b.ease as keyof typeof EASE]) || EASE.smooth;
      return lerpProps(a.props, b.props, easeFn((t - a.t) / span));
    }
  }
  return last.props;
}

export function cameraAt(camera: CameraKeyframe[], t: number): CameraKeyframe {
  const first = camera[0];
  if (!first) return { t: 0, cx: 960, cy: 540, zoom: 1 };
  if (t <= first.t) return first;
  for (let i = 0; i < camera.length - 1; i++) {
    const a = camera[i]!;
    const b = camera[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = Math.max(b.t - a.t, 1);
      const f = EASE.smooth((t - a.t) / span);
      return { t, cx: a.cx + (b.cx - a.cx) * f, cy: a.cy + (b.cy - a.cy) * f, zoom: a.zoom + (b.zoom - a.zoom) * f };
    }
  }
  return camera[camera.length - 1]!;
}

/** Full-frame render state (for the player/exporter) */
export interface FrameState {
  elements: Array<{ id: string; props: ElementProps }>;
  camera: CameraKeyframe;
  /** Current subtitle (may be null) */
  say: { text: string; progress: number; hitWord?: string } | null;
  /** Layout chrome context (kicker/page number/footer; the theme's chrome switch decides whether it is drawn) */
  chrome?: { filmTitle: string; shotTitle: string; shotNo: number; shotCount: number };
  /** Page kind (picks the background plate): cover / section / content */
  pageKind?: 'cover' | 'section' | 'content';
  /** Layout debug rects (legacy template slots or new frame boxes) */
  layoutSlots?: Array<{ name: string; rect: Rect }>;
  /** Current layout label (legacy template name or frame root id) */
  layoutTemplate?: string;
}

export function frameAt(scene: CompiledScene, t: number): FrameState {
  const elements: FrameState['elements'] = [];
  for (const track of scene.tracks) {
    const props = propsAt(track, t);
    if (props.opacity < 0.01) continue;
    elements.push({ id: track.id, props });
  }
  // Stacking: background cards (z=-1) at the bottom, content (z=0) on top; within a layer keep track order (stable sort)
  elements.sort((a, b) => (a.props.z ?? 0) - (b.props.z ?? 0));
  const cue = scene.says.find(s => t >= s.startMs - 200 && t <= s.startMs + s.durMs);
  let say: FrameState['say'] = null;
  if (cue) {
    const hit = cue.anchors.find(a => t >= a.tMs && t <= a.tMs + 700);
    if (cue.segments && cue.segments.length) {
      // Sentence by sentence: pick the segment of the current reading window (before the first → first, after the last → last), lighting up word by word.
      let seg = cue.segments[0]!;
      for (const s of cue.segments) {
        if (t >= s.startMs) seg = s;
      }
      const span = Math.max(seg.endMs - seg.startMs, 1);
      const progress = Math.max(0, Math.min(1, (t - seg.startMs) / span));
      const hitWord = hit?.word && seg.text.includes(hit.word) ? hit.word : undefined;
      say = { text: seg.text, progress, hitWord };
    } else {
      const speakMs = cue.durMs - RHYTHM.SAY_TAIL;
      const progress = Math.max(0, Math.min(1, (t - cue.startMs) / Math.max(speakMs, 1)));
      say = { text: cue.text, progress, hitWord: hit?.word };
    }
  }
  // Layout chrome context: current shot number/title (the renderer uses it per the theme's chrome switch)
  let shotIdx = 0;
  for (let i = 0; i < scene.shotMarks.length; i++) {
    if (t >= scene.shotMarks[i]!.tMs) shotIdx = i;
  }
  const mark = scene.shotMarks[shotIdx];
  const chrome = mark
    ? { filmTitle: scene.title, shotTitle: mark.title, shotNo: shotIdx + 1, shotCount: scene.shotMarks.length }
    : undefined;
  // Page kind: shot 1 = cover; layout template title = section page; everything else = content page
  const pageKind: FrameState['pageKind'] = shotIdx === 0
    ? 'cover'
    : mark?.template === 'title' ? 'section' : 'content';
  let layoutSlots: FrameState['layoutSlots'];
  let layoutTemplate: FrameState['layoutTemplate'];
  if (scene.layoutSlots?.length) {
    let slotIdx = 0;
    for (let i = 0; i < scene.layoutSlots.length; i++) {
      if (t >= scene.layoutSlots[i]!.t) slotIdx = i;
    }
    const slotKf = scene.layoutSlots[slotIdx];
    layoutSlots = slotKf?.slots;
    layoutTemplate = slotKf?.template;
  }
  return { elements, camera: cameraAt(scene.camera, t), say, chrome, pageKind, layoutSlots, layoutTemplate };
}
