# Custom synth voices

A `VoiceSpec` is serializable data: stacked oscillators → filter → ADSR amplitude envelope → gain and drive/quantization. Each note has its own envelope and filter state. The channel then applies effects such as delay and reverb. You need no audio file and no voice registration; declare a plain object in the actual scene TSX or in a shared score module.

It supports home-made plucks, basses, pads, bells, noise percussion and retro synth voices. There is currently no FM algorithm, no arbitrary wavetable, no user DSP callback, no custom sample mapping and no general modulation matrix; `ratio` is a static frequency multiple, not FM. The filter envelope is approximated by crossfading between two fixed filter results. For recordings of real instruments use the [sampled voices](../references/instruments.md); for full speech and ambient recordings use audio files under `assets/`.

## Fields

Everything except oscillators and each oscillator's wave is optional. If you set filter you must give type/cutoff; if you set vibrato you must give rate/depthCents. Unknown fields and function values are not supported.

| Field | Default | Range and effect |
| --- | --- | --- |
| `oscillators` | required | 1–32 oscillators; at least one needs a non-zero gain to make sound |
| `oscillators[].wave` | required | sine (pure), triangle (soft), saw (bright), square (hollow), pulse (adjustable thickness), noise |
| `oscillators[].gain` | 1 | 0–16, relative mix weight; the sum is divided by the total weight. Set overall volume with voice.gain or the channel's gainDb |
| `oscillators[].ratio` | 1 | greater than 0, at most 64; 2 is an octave up, 0.5 an octave down, non-integer multiples give inharmonic color |
| `oscillators[].detuneCents` | 0 | −4800–4800 cents; ±5–15 thickens the sound; 100 cents = 1 semitone |
| `oscillators[].pulseWidth` | 0.5 | 0.02–0.98, pulse only; 0.5 is a square, 0.125/0.25 are thinner |
| `oscillators[].phase` | 0 | initial phase offset, 0–1 of a cycle |
| `envelope.attack` | 0.005 | 0–60 s, onset to peak |
| `envelope.decay` | 0.1 | 0–60 s, peak down to sustain |
| `envelope.sustain` | 0.8 | 0–1, the level held while the note is held; not a duration |
| `envelope.release` | 0.3 | 0–60 s, release after the note ends |
| `filter.type` | required | lowpass or highpass; omit the whole filter for no filtering |
| `filter.cutoff` | required | 20–20000 Hz, cutoff frequency; rendering is also limited by the sample rate |
| `filter.resonance` | 0 | 0–0.95; emphasis at the lowpass cutoff, sharper as it rises; the basic highpass ignores it |
| `filter.envAmount` | 0 | −20000–20000 Hz, approximated envelope-driven filter movement; recommended on lowpass, positive values make the attack brighter |
| `vibrato.rate` | required | 0–100 Hz, vibrato speed; 4–7 is typical |
| `vibrato.depthCents` | required | 0–2400 cents, vibrato depth; natural vibrato can start at 5–15 |
| `vibrato.delaySec` | 0 | 0–3600 s; after the delay, vibrato fades in over about 0.3 s |
| `gain` | 1 | 0–16, linear voice gain; 0 is silent |
| `drive` | 0 | 0–1, voice-level soft-clip saturation |
| `bitCrush` | off | integer 1–16, quantization bits; lower is grainier; omit to turn off |
| `sampleReduce` | 1 | integer 1–1024, output updates only every N samples; 1 is off, 2–4 gives a light retro roughness |

Note beat/duration values are in beats; envelope times are in seconds. Do not confuse them. Short notes need short attack/decay. The last note's release, delay and reverb need enough score.tailSec, otherwise they are cut at the declared end.

## Original voices and modified presets

Below is a Score you can use directly as a default export. To put it in a scene, add the score to the scene's `sounds` (as `{ id, kind: 'music', score, at }`), and have the animation reference the events in melody too. It contains an original metallic pluck, a modified pad preset and a home-made noise tick, with no external samples.

```ts
import { CHIPTUNE_VOICES, line, type Score, type VoiceSpec } from '@muspark/core';

export const melody = line(['C5', 'E5', 'G5', 'D5'], { step: 1, duration: 0.65 });
const metalPluck: VoiceSpec = {
  oscillators: [
    { wave: 'sine', gain: 1 },
    { wave: 'sine', ratio: 2.71, gain: 0.3, phase: 0.1 },
    { wave: 'triangle', ratio: 4.08, gain: 0.1, detuneCents: 5 },
  ],
  envelope: { attack: 0.003, decay: 0.2, sustain: 0.08, release: 0.35 },
  filter: { type: 'lowpass', cutoff: 1800, envAmount: 1000, resonance: 0.1 },
  gain: 0.7,
};

// Copy, then override the fields you need; do not mutate the shared CHIPTUNE_VOICES.
const base = CHIPTUNE_VOICES['synthwave-pad'];
const softPad: VoiceSpec = {
  ...base,
  oscillators: base.oscillators.map(osc => ({ ...osc })),
  envelope: { ...base.envelope, attack: 0.2, release: 0.6 },
  filter: { type: 'lowpass', cutoff: 1000 },
  vibrato: { rate: 5, depthCents: 6, delaySec: 0.3 },
  gain: 0.4,
};
const noiseTick: VoiceSpec = {
  oscillators: [{ wave: 'noise' }],
  envelope: { attack: 0.001, decay: 0.025, sustain: 0, release: 0.02 },
  filter: { type: 'highpass', cutoff: 2200 },
  drive: 0.1,
  bitCrush: 6,
  sampleReduce: 2,
  gain: 0.3,
};
const score: Score = {
  bpm: 120,
  durationBeats: 4,
  tailSec: 0.8,
  channels: [
    { id: 'lead', instrument: 'synth-lead', voice: metalPluck, notes: melody, gainDb: -8,
      effects: { delay: { timeBeats: 0.5, feedback: 0.2, mix: 0.12 }, reverb: 0.12 } },
    { id: 'pad', instrument: 'synth-pad', voice: softPad,
      chords: [{ symbol: 'Cmaj7', beat: 0, duration: 4 }], gainDb: -14 },
    { id: 'ticks', instrument: 'synth-lead', voice: noiseTick,
      notes: line(['C4', 'C4', 'C4', 'C4'], { step: 1, duration: 0.1 }), gainDb: -12 },
  ],
};
export default score;
```

A home-made noise percussion voice is still a melodic channel with a voice; on a noise wave, pitch does not change the pitch. For fixed drum sounds use hits. When you need several completely different home-made sounds, give each its own channel. notes[].instrument can switch the ordinary instrument, but it cannot switch the channel's voice per note.

## Order of adjustment

1. Choose the waveform first: sine/triangle for soft, saw/pulse for bright, noise for percussion. The static oscillator stack sets the overtones; it does not produce a melody.
2. Then set the envelope: plucks get a short attack and low sustain; pads get a slower attack and longer release. Use ratio to stack octaves or non-integer overtones, and slight detune to thicken.
3. Use a lowpass to tame harsh highs, a moderate resonance/envAmount to sharpen the attack, then decide whether to add vibrato, drive or quantization.
4. Mix last: the channel's gainDb (−60–12, default 0), pan (−1–1, default 0) and per-beat automation control the parts. voice is the per-note sound; effects are for the whole channel. effects do not go at the top level of the Score.

| Channel effects field | Default | Range |
| --- | --- | --- |
| drive | 0 | 0–1 |
| delay.timeBeats | 0.5 | 0.0625–8 beats |
| delay.feedback | 0.28 | 0–0.85 |
| delay.mix | 0 | 0–1; echo only when positive |
| reverb | 0 | 0–1 |

Run `anim check` to validate the score and render the audio, then check the sound against the picture. Live parameter automation currently covers only the channel's gainDb/pan; pointing a GSAP tween at a VoiceSpec will not change the already rendered audio.
