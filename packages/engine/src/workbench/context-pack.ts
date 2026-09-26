/**
 * Task workspace setup.
 *
 * prepareTaskBootstrap writes the private bootstrap config and the upload directory outside code/;
 * materializeContextPack writes the starter film.json (empty, stage only), assets/, and the task
 * config outside the workspace. Both run before the agent starts, so the workspace is ready on the
 * agent's first turn and it does not spend a turn probing an empty directory.
 *
 * Nothing else goes into code/: no BRIEF.md, no manual, no refs/, no scenes/. The agent gets its
 * instructions and the request through its prompt. The one exception is externalAgentDocs
 * (external-agent workspaces created by `anim new`): those agents have no prompt-injection channel,
 * so they get their context from CLAUDE.md / AGENTS.md on disk.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { WorkbenchTaskConfig } from './workspace-env';
import { workspaceRuntimeDir, writeTaskConfig } from './workspace-env';
import { isolateWorkspaceInternals } from './workspace-internals';
import { renderAgentManual } from './agent-manual';
import { ensureAssetsDir } from '../scene/workspace-assets';
import { FILM_DOC_FILE, parseFilmDoc, serializeFilmDoc } from '@animspark/core';
import { ASSET_INDEX_JSONL_PATH } from '@animspark/film-build';

export interface ContextPackOptions {
  /** The coding agent's code root. */
  dest: string;
  /** Allow an existing film (AI edits, resuming an interrupted run). */
  allowExistingShots?: boolean;
  prompt: string;
  title?: string;
  stage?: { w: number; h: number; aspect: string };
  /** Requested length in seconds. Written into task.json, which the agent reads before it starts. */
  durationSec?: number;
  /** Whether that length is a hard constraint or a target (see WorkbenchTaskConfig.durationStrict). */
  durationStrict?: boolean;
  contentLocale?: string;
  /** Session host (default `local`); `agent` makes receipts omit the local watchUrl. */
  host?: WorkbenchTaskConfig['host'];
  /** Uploaded files already on disk (workspace-relative paths); the agent decides which ones to ingest. */
  uploadedAssets?: readonly string[];
  /** The images among them were also attached to the first message as image blocks, so the brief should not ask the agent to read them. */
  uploadedImagesInline?: boolean;
  /** Links found in the user's prompt; the agent decides whether to fetch them. */
  promptUrls?: readonly string[];
  /**
   * External coding-agent workspace (`anim new`): write CLAUDE.md / AGENTS.md (the agent manual)
   * into the code root. External agents have no system-prompt channel, so they get their context
   * from files on disk; they read the request and task parameters from `../runtime/task.json`
   * themselves (runtime/ is reachable in this setup). Off by default: other workspaces get no docs.
   */
  externalAgentDocs?: boolean;
}

export interface ContextPackResult {
  dest: string;
}

export interface TaskBootstrap {
  version: 1;
  options: Omit<ContextPackOptions, 'dest'>;
}

export const TASK_BOOTSTRAP_FILENAME = 'bootstrap.json';

/** The film's stage. Defaults to 16:9; buildTaskConfig and the scaffold both use this, so the default is defined once. */
function stageOf(opts: ContextPackOptions): { w: number; h: number; aspect: string } {
  return opts.stage ?? { w: 1920, h: 1080, aspect: '16:9' };
}

function buildTaskConfig(opts: ContextPackOptions): WorkbenchTaskConfig {
  const stage = stageOf(opts);
  return {
    prompt: opts.prompt,
    stage,
    ...(opts.durationSec ? { durationSec: opts.durationSec } : {}),
    /* Without a length there is nothing to be strict about; writing the flag alone would make the check compare against undefined. */
    ...(opts.durationSec && opts.durationStrict ? { durationStrict: true } : {}),
    contentLocale: opts.contentLocale,
    ...(opts.host ? { host: opts.host } : {}),
  };
}

function optionsForBootstrap(opts: ContextPackOptions): TaskBootstrap['options'] {
  const { dest: _dest, ...serializable } = opts;
  return serializable;
}

export function prepareTaskBootstrap(opts: ContextPackOptions): ContextPackResult {
  const dest = resolve(opts.dest);
  const runtimeDir = workspaceRuntimeDir(dest);
  mkdirSync(dest, { recursive: true });
  ensureAssetsDir(dest);
  mkdirSync(runtimeDir, { recursive: true });
  const bootstrap: TaskBootstrap = {
    version: 1,
    options: optionsForBootstrap(opts),
  };
  writeFileSync(
    join(runtimeDir, TASK_BOOTSTRAP_FILENAME),
    `${JSON.stringify(bootstrap, null, 2)}\n`,
    'utf8',
  );
  return { dest };
}

/** TypeScript project file for the workspace: type resolution for the allowed imports (for editors and agents; not read at runtime). */
const WORKSPACE_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": false,
    "noEmit": true,
    "allowJs": false,
    "types": []
  },
  "include": ["mg/**/*", "assets/audio/**/*.ts", "*.ts", "*.tsx", "types/**/*"]
}
`;

/**
 * Ambient types for the modules the engine provides (loose `any` stubs, only so import statements
 * resolve and hover docs are readable; runtime behavior is described in the agent manual).
 * Keep in sync with the compiler's import allowlist (film/vendor-allowlist.ts).
 */
const WORKSPACE_TYPES_DTS = `/**
 * AnimSpark workspace ambient types (generated by the engine to match what the runtime provides; do not edit).
 *
 * Available npm packages (standard imports; bundled by the engine at pinned versions, and only what you import goes into the bundle):
 *   gsap · @gsap/react · gsap/<plugin> · three · @muspark/core · @muspark/ui · p5 · matter-js ·
 *   individual d3-* packages such as d3-geo · roughjs · highlight.js · simplex-noise · topojson-client ·
 *   world-atlas/<file>.json · react ·
 *   @animspark/stem
 * Animate with the official useGSAP (from '@gsap/react'). The host attaches the animations in that context to the film clock.
 */
declare module 'gsap' { export const gsap: any; export default gsap; }
declare module '@gsap/react' { export const useGSAP: any; }
declare module 'gsap/*' { const plugin: any; export default plugin;
  export const CustomEase: any, CustomBounce: any, CustomWiggle: any,
    EasePack: any, SlowMo: any, RoughEase: any, ExpoScaleEase: any,
    DrawSVGPlugin: any, Flip: any, MorphSVGPlugin: any, MotionPathPlugin: any,
    Physics2DPlugin: any, PhysicsPropsPlugin: any, ScrambleTextPlugin: any,
    SplitText: any, TextPlugin: any;
}
declare module 'three' { const THREE: any; export = THREE; }
/* Shorthand declaration (no body): any named member imported from this module is any.
   The addons export hundreds of names (EffectComposer / Sky / ...); listing them one by one would always miss some. */
declare module 'three/addons/*';
declare module '@muspark/core' {
  export interface Score {
    bpm: number;
    durationBeats: number;
    tailSec?: number;
    channels: Channel[];
    key?: string;
    timeSignature?: [number, number];
  }
  interface ChannelBase {
    id: string; label?: string; gainDb?: number; pan?: number; mute?: boolean; solo?: boolean;
    automation?: Array<{ beat: number; gainDb?: number; pan?: number }>;
    effects?: { drive?: number; delay?: { timeBeats?: number; feedback?: number; mix?: number }; reverb?: number };
  }
  export type Channel = ChannelBase & ({
    instrument: string; bank?: Bank; voice?: VoiceRef; notes?: Note[];
    chords?: Array<ChordSpan & { velocity?: number; octave?: number; inversion?: number; voices?: number; instrument?: string }>;
    tablature?: { tuning?: Pitch[]; events: Array<{ string: number; fret: number; beat: number; duration: number; velocity?: number }> };
    hits?: never;
  } | { hits: DrumHit[]; bank?: Bank; kit?: 'chip'; instrument?: never });
  export function validateScore(value: unknown): Score;
  export function scoreTime(score: Score, beat: number): number;
  export function scoreDuration(score: Score): number;

  /** Note name ('C4' / 'F#5' / 'Bb3') or MIDI number. */
  export type Pitch = string | number;
  export interface Note { pitch: Pitch; beat: number; duration: number; velocity?: number; instrument?: string }
  export interface DrumHit { drum: string; beat: number; velocity?: number }
  /** The span one chord occupies on the timeline. */
  export interface ChordSpan { symbol: string; beat: number; duration: number }

  /** Lay a list of pitches out as evenly spaced notes; null is a rest: line(['C4','E4',null,'G4'], { step: 0.5 }). */
  export function line(
    pitches: Array<Pitch | null>,
    options: { start?: number; step: number; duration?: number; velocity?: number },
  ): Note[];
  /** Free rhythm given as [pitch, length] pairs; null is a rest: seq([['C4',1],[null,0.5],['E4',0.5]]). */
  export function seq(
    events: Array<[Pitch | null, number]>,
    options?: { start?: number; velocity?: number; legato?: number },
  ): Note[];
  /** Stack pitches at the same moment into a harmony (chord tones given by hand). */
  export function stack(
    pitches: Pitch[],
    options: { beat: number; duration: number; velocity?: number },
  ): Note[];
  /** Lay a chord sequence out on the timeline at a fixed length each; the result feeds arpeggio / blockChord / bassLine. */
  export function layChords(
    symbols: string[],
    options: { startBeat?: number; beatsEach: number },
  ): ChordSpan[];
  /**
   * Chords to arpeggio notes; accepts one ChordSpan or a whole list. shape is the pattern as chord-tone indices:
   * 0 is the lowest chord tone, and indices past the number of chord tones wrap up an octave
   * ([0,1,2,1], root-third-fifth-third back and forth, is the classic pattern and the default).
   */
  export function arpeggio(
    spans: ChordSpan | ChordSpan[],
    options: { step: number; shape?: number[]; octave?: number; voices?: number; velocity?: number; accent?: number },
  ): Note[];
  /** Chords to block chords (notes sounding together), one or a list; sustain leaves breathing room, 0.9 means 90% of the length. */
  export function blockChord(
    spans: ChordSpan | ChordSpan[],
    options?: { octave?: number; inversion?: number; voices?: number; velocity?: number; sustain?: number },
  ): Note[];
  /** Chord sequence to a bass part. */
  export function bassLine(
    spans: ChordSpan[],
    options?: { octave?: number; velocity?: number; style?: 'root' | 'root-fifth' | 'walking' | 'octave'; step?: number },
  ): Note[];
  /** Lay a drum pattern template out as percussion events: drumPattern('rock', { bars: 4 }). */
  export function drumPattern(
    template: 'rock' | 'ballad' | 'swing' | 'gentle' | Record<string, number[]>,
    options: { bars: number; startBeat?: number; beatsPerBar?: number; velocity?: number; accent?: number },
  ): DrumHit[];
  /** The four built-in drum templates (rock/ballad/swing/gentle); keys are drums, values are beat offsets within the bar. */
  export const DRUM_TEMPLATES: Record<string, Record<string, number[]>>;
  /** Shift all beat positions. */
  export function shift(notes: Note[], deltaBeats: number): Note[];
  /** Transpose everything (semitones). */
  export function transpose(notes: Note[], semitones: number): Note[];
  /** Loop a number of times with the given period. */
  export function repeat(notes: Note[], times: number, periodBeats: number): Note[];

  /** Roman-numeral degrees to chord symbols: progression('C major', ['I','V','vi','IV']). */
  export function progression(key: string, numerals: string[]): string[];
  /** A common progression in a specific key: namedProgression('C major', 'pop'). */
  export function namedProgression(key: string, name: string): string[];
  /** Named progressions: canon/pop/sad/jazz/blues/andalusian/fifties/edm. */
  export const PROGRESSIONS: Record<string, readonly string[]>;
  /** The seven diatonic triads of a key. */
  export function diatonicChords(key: string): string[];
  /** Chord symbol to MIDI pitches voiced from low to high. */
  export function voiceChord(symbol: string, options?: { octave?: number; inversion?: number; voices?: number }): number[];
  /** MIDI pitch of the chord root. */
  export function chordRoot(symbol: string, octave?: number): number;
  /** Note names of the key (one octave), with sharps or flats per the key signature. */
  export function scaleNotes(key: string, octave?: number): string[];
  /** Note name to MIDI number (C4 = 60). */
  export function midiOf(pitch: Pitch): number;
  /** MIDI number to note name. */
  export function nameOf(midi: number, preferFlats?: boolean): string;
  /** MIDI number to frequency (Hz), A4 = 440. */
  export function hzOf(midi: number): number;
  /** Shift by octaves. */
  export function transposeOctave(pitch: Pitch, delta: number): number;
  /** Pitch class 0–11. */
  export function pitchClassOf(name: string): number | null;
  /** Parse a chord symbol into its root and interval set. */
  export function parseChord(symbol: string): { rootClass: number; root: string; intervals: number[]; bassClass?: number };

  /**
   * Sound backend.
   *
   * 'synth' computes waveforms live and keeps the sharp edges of square and sawtooth waves intact; use it for electronic music and chiptune.
   * 'sampled' plays real recordings from the GM sound bank; use it for acoustic instruments such as piano, strings and brass.
   * When a channel has no bank, it is inferred from the name: the 19 oscillator instruments use synth, everything else uses sampled.
   * Many names exist in both sets, so for a real piano recording you must write bank: 'sampled' explicitly.
   */
  export type Bank = 'synth' | 'sampled';

  /** The 19 oscillator instrument names. */
  export const INSTRUMENTS: readonly string[];
  /** The 9 oscillator drum names. */
  export const INSTRUMENT_DRUMS: readonly string[];
  /** The 149 GM sampled instrument names (available with bank: 'sampled'). */
  export const SAMPLED_INSTRUMENTS: readonly string[];
  /** The 45 GM sampled drum names (available with bank: 'sampled'). */
  export const SAMPLED_DRUMS: readonly string[];
  /** Sampled instruments grouped by family: piano / strings / brass / woodwinds / ethnic ... */
  export const SAMPLED_FAMILIES: Record<string, readonly string[]>;
  /** Whether the name is a GM sampled instrument. */
  export function isSampledInstrument(name: string): boolean;
  /** Whether the name is a built-in oscillator instrument. */
  export function isBuiltinInstrument(name: string): boolean;
  /** Chip / synth voice presets (NES / GameBoy / SID / synthwave / acid ...) for a channel's voice field; always oscillator-based. */
  export const CHIPTUNE_VOICES: Record<string, unknown>;
  /** List of chip voice names. */
  export const CHIPTUNE_VOICE_NAMES: readonly string[];
  /** Chip drum kit: chip-kick / chip-snare / chip-hat; they only sound when the channel sets kit: 'chip'. */
  export const CHIPTUNE_DRUMS: Record<string, unknown>;
  /**
   * Value of a channel's voice field: a chip preset name, or a custom voice description.
   *
   * A custom voice needs at least one oscillator; wave can be sine/square/saw/triangle/pulse/noise.
   * A channel with voice cannot also set bank: 'sampled'; sample playback cannot play a custom voice.
   */
  export type VoiceRef = string | VoiceSpec;
  export interface VoiceSpec {
    oscillators: Array<{
      wave: string;
      gain?: number;
      /** Multiple of the base frequency; 2 is an octave up. */
      ratio?: number;
      /** Detune in cents; two slightly detuned oscillators sound thicker. */
      detuneCents?: number;
      /** Pulse wave only; 0.5 equals a square wave. */
      pulseWidth?: number;
      phase?: number;
    }>;
    envelope?: { attack?: number; decay?: number; sustain?: number; release?: number };
    filter?: {
      type: 'lowpass' | 'highpass';
      /** Cutoff frequency (Hz). */
      cutoff: number;
      /** Resonance 0–0.95; higher is sharper. Lowpass only. */
      resonance?: number;
      /** Envelope modulation of the cutoff (Hz); the source of the synth "wah". */
      envAmount?: number;
    };
    vibrato?: { rate: number; depthCents: number; delaySec?: number };
    gain?: number;
    /** Bit-crush depth; lower is grittier. */
    bitCrush?: number;
    drive?: number;
    sampleReduce?: number;
  }
}
/* Score views (Score / PianoRoll / ...) take a score and a controlled progress (in beats); see the @muspark/ui skill. */
declare module '@muspark/*';
declare module 'p5' { const p5: any; export default p5; }
/* Only individual d3-* packages (d3-geo / d3-scale / d3-shape / ...); the bare 'd3' bundle is not installed. */
declare module 'd3-*';
declare module 'matter-js' { const Matter: any; export = Matter; }
declare module 'roughjs' { const rough: any; export default rough; }
declare module 'roughjs/*' { const rough: any; export default rough; }
declare module 'highlight.js' { const hljs: any; export default hljs; }
declare module 'highlight.js/*' { const hljs: any; export default hljs; }
declare module 'simplex-noise' {
  export function createNoise2D(seed?: () => number): (x: number, y: number) => number;
  export function createNoise3D(seed?: () => number): (x: number, y: number, z: number) => number;
  export function createNoise4D(seed?: () => number): (x: number, y: number, z: number, w: number) => number;
}
declare module 'topojson-client' { const topojson: any; export = topojson; }
/* Subpaths only: world-atlas has no main entry, and a bare import fails to compile. */
declare module 'world-atlas/*' { const atlas: any; export default atlas; }
/* React hooks have generic signatures: a shorthand module (all any) would make
   useRef<HTMLCanvasElement>(null) fail with "untyped function calls may not accept type arguments". */
declare module 'react' {
  export type CSSProperties = Record<string, string | number | undefined>;
  export const Fragment: unique symbol;
  export function createElement(...args: unknown[]): unknown;
  export function useRef<T = any>(initial: T): { current: T };
  export function useRef<T = any>(initial?: T | null): { current: T | null };
  export function useMemo<T>(make: () => T, deps?: readonly unknown[]): T;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useState<T = any>(initial?: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void];
  export function useCallback<T>(fn: T, deps?: readonly unknown[]): T;
  export function useContext(context: any): any;
  const React: any;
  export default React;
}
declare module 'react/jsx-runtime' { export const jsx: any, jsxs: any, Fragment: any; }
/* WICG HTML-in-Canvas (drawElementImage): enabled in the engine's render browser, not yet in TypeScript's lib. */
interface HTMLCanvasElement {
  requestPaint(): void;
  onpaint: ((this: HTMLCanvasElement, ev: Event) => void) | null;
}
interface CanvasRenderingContext2D {
  drawElementImage(el: Element, dx: number, dy: number, dw?: number, dh?: number): void;
  drawElementImage(
    el: Element, sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;
}
/* Shorthand (no body): any named member is any, so named imports (at / useSharedRenderer) resolve. */
declare module '@animspark/*';

/* MG scenes use standard imports: gsap from 'gsap', useGSAP from '@gsap/react'.
 * Use scope / dependencies / revertOnUpdate / contextSafe with the official hook semantics.
 * A clip's play range is set by time: [start, end] in film.json; the component only needs to default-export a plain React function.
 * A component can export sounds: a file sound sets src, procedural music sets score (a Score from @muspark/core); use one or the other.
 * A Score is rendered offline to a complete WAV and cached, and the player mixes it with everything else; use cue(sound, phraseOrEvent) and duration(sound) to place and trim sounds within the clip.
 * A film-wide soundtrack is a plain .ts/.js file whose default export is a Score, referenced by src on an audio track in film.json; no extra MG component is needed.
 * Import three / p5 / d3 directly in each MG that uses them (they are bundled into that MG's own output).
 */
`;

function stageFromFilmDoc(source: string): { w: number; h: number } | null {
  let stage: unknown;
  try {
    stage = (JSON.parse(source) as { stage?: unknown }).stage;
  } catch {
    return null;
  }
  const s = stage as { w?: unknown; h?: unknown } | undefined;
  return typeof s?.w === 'number' && typeof s.h === 'number' ? { w: s.w, h: s.h } : null;
}

export function isFilmDocScaffold(source: string, stage: { w: number; h: number }): boolean {
  const want = filmDocTemplateOf(stage.w, stage.h).trim();
  if (source.trim() === want) return true;
  /* Besides the exact text, also compare after parsing. The template gains fields over time
     (track ids, for example), while the file on disk may have been written by an older version;
     an exact comparison would treat it as the user's film, and an empty project would stop counting
     as empty. Parsing brings both versions to the same shape (missing fields are filled in by the
     current rules). Source that does not parse is not the template. */
  try {
    return serializeFilmDoc(parseFilmDoc(source)).trim() === want;
  } catch {
    return false;
  }
}

/**
 * Is this workspace still the starter scaffold the engine wrote, i.e. is the film still empty?
 *
 * Changing the stage relies on this: an empty project may switch to a new canvas (see /film/stage).
 *
 * The question is whether the film has any content, not whether files on disk match the templates
 * we wrote. So a project whose clips have all been deleted can change its stage again.
 */
export function isWorkspaceScaffold(root: string, stage?: { w: number; h: number }): boolean {
  let doc: string;
  try {
    doc = readFileSync(join(root, FILM_DOC_FILE), 'utf8');
  } catch {
    return false;
  }
  const s = stage ?? stageFromFilmDoc(doc);
  return !!s && isFilmDocScaffold(doc, s);
}

/**
 * Write the current starter: a `film.json` with only the stage.
 *
 * No `mg/`: git does not track empty directories (the new project is committed as the root commit),
 * so an empty mg/ would not survive a clone anyway, and keeping it would suggest it is a convention.
 * The agent creates it when it writes the first MG.
 */
export function writeFilmScaffold(root: string, w: number, h: number): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, FILM_DOC_FILE), filmDocTemplate(w, h), 'utf8');
}

/**
 * Normalize an empty film written in an older format to the current template.
 *
 * Only the scaffold is touched: once the agent has changed anything it is no longer the template,
 * and rewriting it would delete the user's film.
 *
 * **Older projects that carry the starter card (`mg/hello`) are deliberately out of reach.** That
 * clip counts as content (see isWorkspaceScaffold), so they are treated as the user's film and left
 * untouched. Misjudging the other way would silently delete part of the user's film.
 */
export function refreshFilmScaffold(root: string): boolean {
  if (!isWorkspaceScaffold(root)) return false;
  const doc = readFileSync(join(root, FILM_DOC_FILE), 'utf8');
  const s = stageFromFilmDoc(doc);
  if (!s) return false;
  const nextDoc = filmDocTemplate(s.w, s.h);
  if (doc.trim() === nextDoc.trim()) return false;
  writeFilmScaffold(root, s.w, s.h);
  return true;
}

export function filmDocTemplate(w: number, h: number): string {
  return filmDocTemplateOf(w, h);
}

function filmDocTemplateOf(w: number, h: number): string {
  /* Use serializeFilmDoc instead of building the string by hand: scaffold detection compares
     text exactly (see isFilmDocScaffold), and the first edit re-serializes the whole film through
     serializeFilmDoc. With two separate formats, an empty project would stop counting as empty
     after its first edit. */
  return serializeFilmDoc({
    stage: { w, h },
    /* No clips: a new project opens on a black stage at its aspect ratio. An empty film is a valid
       state (it is also what you get after deleting every track); evaluation, bundling and the
       runtime all accept it.
       **Do not omit `stage`.** The aspect ratio is the one thing that cannot be inferred from the
       content (see filmStageSchema), and without a `film.json` every `/film/*` request returns 404. */
    tracks: [],
  });
}

function writeIfChanged(path: string, contents: string): void {
  try {
    if (readFileSync(path, 'utf8') === contents) return;
  } catch { /* missing: write it */ }
  writeFileSync(path, contents, 'utf8');
}

/** Materialize the starter film.json (empty), assets/, and the task config outside the workspace. Reference films are not written (see below). */
export function materializeContextPack(opts: ContextPackOptions): ContextPackResult {
  const dest = resolve(opts.dest);
  const hasRoot = existsSync(join(dest, FILM_DOC_FILE));
  if (!opts.allowExistingShots && hasRoot) {
    throw new Error(`target already has a film (${dest}); will not overwrite an existing project.`);
  }
  mkdirSync(dest, { recursive: true });
  ensureAssetsDir(dest);
  /* Create the grep-able asset index, empty. Grepping a missing file reports "no such file", not
     "no assets"; an empty file keeps the two cases apart. Only when missing, never overwritten: the
     index is output from earlier runs (narration files, measured durations), not a template. */
  if (!existsSync(join(dest, ASSET_INDEX_JSONL_PATH))) {
    writeFileSync(join(dest, ASSET_INDEX_JSONL_PATH), '', 'utf8');
  }
  /* Write the starter project now, before the agent's first command.
     A workspace is ready when the root and the assets directory exist: `anim check` must be able to
     evaluate a tree first; on an empty directory it can only report "not a workspace", which wastes
     a whole turn.

     If a root already exists, touch nothing. This step also runs on resumed and edit runs
     (allowExistingShots), when the film on disk is all there is. Overwriting it with the starter
     template would delete the user's film without any error, and the agent would see an empty
     project and start over. */
  if (!hasRoot) {
    const { w, h } = stageOf(opts);
    writeFilmScaffold(dest, w, h);
  } else {
    /* Normalize an empty film written in an older format. Films the agent has touched, and older
       projects with the starter card, are not recognized as the scaffold, so no one's film is
       touched (see refreshFilmScaffold). */
    refreshFilmScaffold(dest);
  }
  // Only external-agent workspaces get the editor project files. Otherwise, move internal files left by older versions out of code/ so bash and the file tools see the same tree.
  if (opts.externalAgentDocs) {
    mkdirSync(join(dest, 'types'), { recursive: true });
    writeIfChanged(join(dest, 'tsconfig.json'), WORKSPACE_TSCONFIG);
    writeIfChanged(join(dest, 'types', 'animspark.d.ts'), WORKSPACE_TYPES_DTS);
  } else {
    if (basename(dest) === 'code') mkdirSync(workspaceRuntimeDir(dest), { recursive: true });
    isolateWorkspaceInternals(dest);
  }

  writeTaskConfig(dest, buildTaskConfig(opts));

  // External-agent workspaces (anim new) also get the manual, since they have no system-prompt
  // channel (Claude Code reads CLAUDE.md automatically; AGENTS.md serves other agents).
  if (opts.externalAgentDocs) {
    const manual = renderAgentManual();
    writeFileSync(join(dest, 'CLAUDE.md'), manual, 'utf8');
    writeFileSync(join(dest, 'AGENTS.md'), manual, 'utf8');
  }

  return { dest };
}
