/**
 * Semantic instrument names -> General MIDI programs.
 *
 * Authors write 'violin' rather than 40: semantic names stay stable while the underlying sound bank can be swapped.
 * Covers all 128 GM melodic programs, plus the variation banks of GeneralUser GS;
 * all 19 values of animspark's existing MUSIC_INSTRUMENTS keep the same names, for a smooth migration.
 */

/** Variation programs need a bank select before the program change. */
export interface Patch {
  program: number;
  /** Bank MSB; defaults to 0, i.e. standard GM. */
  bank?: number;
}

const GM = {
  // ── Piano family ──
  piano: 0,
  'bright-piano': 1,
  'electric-grand': 2,
  'honky-tonk': 3,
  'electric-piano': 4,
  'fm-piano': 5,
  harpsichord: 6,
  clavinet: 7,

  // ── Chromatic percussion ──
  celesta: 8,
  glockenspiel: 9,
  'music-box': 10,
  vibraphone: 11,
  marimba: 12,
  xylophone: 13,
  bell: 14,
  'tubular-bells': 14,
  dulcimer: 15,

  // ── Organ family ──
  'drawbar-organ': 16,
  'percussive-organ': 17,
  'rock-organ': 18,
  organ: 19,
  'church-organ': 19,
  'reed-organ': 20,
  accordion: 21,
  harmonica: 22,
  bandoneon: 23,

  // ── Guitar family ──
  'nylon-guitar': 24,
  guitar: 25,
  'steel-guitar': 25,
  'jazz-guitar': 26,
  'clean-guitar': 27,
  'muted-guitar': 28,
  'overdrive-guitar': 29,
  'distortion-guitar': 30,
  'guitar-harmonics': 31,

  // ── Bass family ──
  bass: 32,
  'acoustic-bass': 32,
  'finger-bass': 33,
  'pick-bass': 34,
  'fretless-bass': 35,
  'slap-bass': 36,
  'slap-bass-2': 37,
  'synth-bass': 38,
  'synth-bass-2': 39,

  // ── String family ──
  violin: 40,
  viola: 41,
  cello: 42,
  contrabass: 43,
  'tremolo-strings': 44,
  pluck: 45,
  pizzicato: 45,
  harp: 46,
  timpani: 47,
  strings: 48,
  'slow-strings': 49,
  'synth-strings': 50,
  'synth-strings-2': 51,

  // ── Voice ──
  choir: 52,
  'voice-oohs': 53,
  'synth-voice': 54,
  'orchestra-hit': 55,

  // ── Brass family ──
  trumpet: 56,
  trombone: 57,
  tuba: 58,
  'muted-trumpet': 59,
  'french-horn': 60,
  brass: 61,
  'synth-brass': 62,
  'synth-brass-2': 63,

  // ── Reeds and woodwinds ──
  'soprano-sax': 64,
  saxophone: 65,
  'tenor-sax': 66,
  'baritone-sax': 67,
  oboe: 68,
  'english-horn': 69,
  bassoon: 70,
  clarinet: 71,
  piccolo: 72,
  flute: 73,
  recorder: 74,
  'pan-flute': 75,
  'bottle-blow': 76,
  shakuhachi: 77,
  whistle: 78,
  ocarina: 79,

  // ── Synth lead ──
  'synth-lead': 80,
  'square-lead': 80,
  'saw-lead': 81,
  'calliope-lead': 82,
  'chiff-lead': 83,
  'charang-lead': 84,
  'voice-lead': 85,
  'fifths-lead': 86,
  'bass-lead': 87,

  // ── Synth pad ──
  'synth-pad': 88,
  'warm-pad': 89,
  'polysynth-pad': 90,
  'choir-pad': 91,
  'bowed-pad': 92,
  'metal-pad': 93,
  'halo-pad': 94,
  'sweep-pad': 95,

  // ── Sound effects and textures ──
  'fx-rain': 96,
  'fx-soundtrack': 97,
  'fx-crystal': 98,
  'fx-atmosphere': 99,
  'fx-brightness': 100,
  'fx-goblins': 101,
  'fx-echoes': 102,
  'fx-scifi': 103,

  // ── Ethnic instruments ──
  sitar: 104,
  banjo: 105,
  shamisen: 106,
  koto: 107,
  kalimba: 108,
  bagpipe: 109,
  fiddle: 110,
  /** Suona / shehnai; the piercing double reed of Chinese and Indian styles. */
  shenai: 111,
  suona: 111,

  // ── Percussive and sound effects ──
  'tinkle-bell': 112,
  agogo: 113,
  'steel-drums': 114,
  woodblock: 115,
  'taiko-drum': 116,
  'melodic-tom': 117,
  'synth-drum': 118,
  'reverse-cymbal': 119,
  'fret-noise': 120,
  'breath-noise': 121,
  seashore: 122,
  birds: 123,
  telephone: 124,
  helicopter: 125,
  applause: 126,
  gunshot: 127,
} as const satisfies Record<string, number>;

/** GeneralUser GS variation programs; these need a bank select. */
const VARIATIONS = {
  'square-wave': { program: 80, bank: 1 },
  'saw-wave': { program: 81, bank: 1 },
  'synth-bass-101': { program: 38, bank: 1 },
  'trumpet-2': { program: 56, bank: 1 },
  'trombone-2': { program: 57, bank: 1 },
  'solo-french-horn': { program: 60, bank: 1 },
  'brass-mono': { program: 61, bank: 1 },
  'strings-mono': { program: 48, bank: 1 },
  'slow-strings-mono': { program: 49, bank: 1 },
  'concert-choir': { program: 52, bank: 1 },
  'synth-mallet': { program: 98, bank: 1 },
  thunder: { program: 122, bank: 2 },
  wind: { program: 122, bank: 3 },
  rain: { program: 122, bank: 1 },
} as const satisfies Record<string, Patch>;

export const SAMPLED_PATCHES = { ...GM, ...VARIATIONS };

export type SampledInstrument = keyof typeof SAMPLED_PATCHES;

export function patchOf(name: SampledInstrument): Patch {
  const entry = SAMPLED_PATCHES[name] as number | Patch;
  return typeof entry === 'number' ? { program: entry } : entry;
}

/**
 * Percussion pieces -> note numbers on the GM percussion channel.
 * GM reserves channel 9 for percussion, where the pitch is the drum piece number.
 */
export const SAMPLED_DRUM_NOTES = {
  kick: 36,
  'kick-soft': 35,
  snare: 38,
  'snare-electric': 40,
  'side-stick': 37,
  clap: 39,
  'closed-hat': 42,
  'pedal-hat': 44,
  'open-hat': 46,
  crash: 49,
  'crash-2': 57,
  ride: 51,
  'ride-bell': 53,
  splash: 55,
  china: 52,
  /** Neutral name used by existing animspark scores; maps to the mid tom. */
  tom: 45,
  'tom-low': 41,
  'tom-mid': 45,
  'tom-high': 50,
  'tom-floor': 43,
  'tom-hi-mid': 47,
  'tom-hi': 48,
  tambourine: 54,
  cowbell: 56,
  vibraslap: 58,
  shaker: 70,
  maracas: 70,
  cabasa: 69,
  triangle: 81,
  'triangle-mute': 80,
  'conga-high': 62,
  'conga-mute': 63,
  'conga-low': 64,
  bongo: 60,
  'bongo-low': 61,
  timbale: 65,
  'timbale-low': 66,
  'agogo-high': 67,
  'agogo-low': 68,
  claves: 75,
  'wood-block': 76,
  'wood-block-low': 77,
  cuica: 78,
  whistle: 71,
  guiro: 73,
  castanets: 85,
  surdo: 86,
} as const;

export type SampledDrum = keyof typeof SAMPLED_DRUM_NOTES;

/** The percussion channel defined by GM. */
export const DRUM_CHANNEL = 9;

export function drumNoteOf(name: SampledDrum): number {
  return SAMPLED_DRUM_NOTES[name];
}

export const SAMPLED_INSTRUMENTS = Object.keys(SAMPLED_PATCHES) as SampledInstrument[];
export const SAMPLED_DRUMS = Object.keys(SAMPLED_DRUM_NOTES) as SampledDrum[];

/** Grouped by family, for display in docs and pickers. */
export const SAMPLED_FAMILIES: Record<string, SampledInstrument[]> = {
  'Piano': ['piano', 'bright-piano', 'electric-grand', 'honky-tonk', 'electric-piano', 'fm-piano', 'harpsichord', 'clavinet'],
  'Chromatic percussion': ['celesta', 'glockenspiel', 'music-box', 'vibraphone', 'marimba', 'xylophone', 'bell', 'dulcimer'],
  'Organ': ['drawbar-organ', 'percussive-organ', 'rock-organ', 'organ', 'reed-organ', 'accordion', 'harmonica', 'bandoneon'],
  'Guitar': ['nylon-guitar', 'guitar', 'jazz-guitar', 'clean-guitar', 'muted-guitar', 'overdrive-guitar', 'distortion-guitar', 'guitar-harmonics'],
  'Bass': ['bass', 'finger-bass', 'pick-bass', 'fretless-bass', 'slap-bass', 'slap-bass-2', 'synth-bass', 'synth-bass-2'],
  'Strings': ['violin', 'viola', 'cello', 'contrabass', 'tremolo-strings', 'pizzicato', 'harp', 'timpani', 'strings', 'slow-strings', 'synth-strings', 'synth-strings-2'],
  'Voice': ['choir', 'voice-oohs', 'synth-voice', 'orchestra-hit', 'concert-choir'],
  'Brass': ['trumpet', 'trombone', 'tuba', 'muted-trumpet', 'french-horn', 'brass', 'synth-brass', 'synth-brass-2', 'solo-french-horn'],
  'Woodwinds': ['soprano-sax', 'saxophone', 'tenor-sax', 'baritone-sax', 'oboe', 'english-horn', 'bassoon', 'clarinet', 'piccolo', 'flute', 'recorder', 'pan-flute', 'shakuhachi', 'whistle', 'ocarina'],
  'Synth lead': ['synth-lead', 'saw-lead', 'calliope-lead', 'chiff-lead', 'charang-lead', 'voice-lead', 'fifths-lead', 'bass-lead', 'square-wave', 'saw-wave'],
  'Synth pad': ['synth-pad', 'warm-pad', 'polysynth-pad', 'choir-pad', 'bowed-pad', 'metal-pad', 'halo-pad', 'sweep-pad'],
  'Effects and textures': ['fx-rain', 'fx-soundtrack', 'fx-crystal', 'fx-atmosphere', 'fx-brightness', 'fx-goblins', 'fx-echoes', 'fx-scifi', 'thunder', 'wind', 'seashore', 'birds'],
  'World': ['sitar', 'banjo', 'shamisen', 'koto', 'kalimba', 'bagpipe', 'fiddle', 'shenai', 'suona', 'steel-drums', 'taiko-drum', 'agogo', 'woodblock'],
};
