import { duration } from '@animspark/runtime';

/** A sound as a scene declares it. Every time is in the owning scene's seconds. */
export interface Sound {
  id: string;
  kind: 'voice' | 'sfx' | 'music';
  src: string;
  at: number;
  time?: readonly [number, number];
  volume?: number;
}

export function voice(name: string, at: number, volume = 1): Sound {
  return { id: `vo-${name}`, kind: 'voice', src: `assets/audio/vo/${name}.m4a`, at, volume };
}

/**
 * Effects with one clear transient. `attack` is where the audible hit sits in the file: the value
 * `anim audio sfx` printed and wrote to assets/index.jsonl (a file with no `attack` field hits
 * within its first 40 ms, so 0). `hit` trims to it and the attack lands exactly on the requested
 * second. `length` is how much tail to keep; `gain` levels quiet files (see `peakDb`). Both by ear.
 */
const HITS = {
  relay: { file: 'relay.mp3', attack: 0.045, length: 0.5, gain: 0.7 },
  switch: { file: 'switch.mp3', attack: 2.02, length: 0.3, gain: 0.9 },
  go: { file: 'go.mp3', attack: 1.215, length: 0.32, gain: 1.2 },
  bulb: { file: 'bulb-on.mp3', attack: 1.04, length: 0.35, gain: 2.6 },
  ping: { file: 'ping.mp3', attack: 0.0, length: 0.5, gain: 2.4 },
  spot: { file: 'spot-on.mp3', attack: 0.0, length: 0.45, gain: 2.4 },
  chalkTap: { file: 'chalk-tap.mp3', attack: 0.3, length: 0.18, gain: 1.4 },
  battenStop: { file: 'batten-stop.mp3', attack: 1.51, length: 0.5, gain: 1.6 },
  crate: { file: 'crate-land.mp3', attack: 1.52, length: 0.6, gain: 1.6 },
  thud: { file: 'thud.mp3', attack: 1.52, length: 0.6, gain: 1.6 },
  tape: { file: 'tape.mp3', attack: 0.07, length: 0.36, gain: 0.7 },
  tick: { file: 'tick.mp3', attack: 0.215, length: 0.25, gain: 0.55 },
  page: { file: 'page.mp3', attack: 0.2, length: 0.3, gain: 1.4 },
  dust: { file: 'dust.mp3', attack: 0.0, length: 0.45, gain: 1.5 },
} as const;

/** Continuous textures: no single attack, just a usable span in the file. */
const TEXTURES = {
  chalk: { file: 'chalk.mp3', from: 0, length: 0.85, gain: 1 },
  pencil: { file: 'pencil.mp3', from: 0.04, length: 1.1, gain: 1.1 },
  curtain: { file: 'curtain.mp3', from: 0.05, length: 1.6, gain: 0.55 },
  rope: { file: 'fly-rope.mp3', from: 0.5, length: 1.7, gain: 0.7 },
  scrape: { file: 'scrape.mp3', from: 0.15, length: 1.6, gain: 0.6 },
  slide: { file: 'crate-land.mp3', from: 0.1, length: 0.9, gain: 1.3 },
  whoosh: { file: 'whoosh.mp3', from: 0, length: 0.9, gain: 0.45 },
  buzz: { file: 'bulb-buzz.mp3', from: 0.6, length: 11, gain: 0.5 },
  hum: { file: 'hum.mp3', from: 0.1, length: 4.2, gain: 0.4 },
  house: { file: 'house.mp3', from: 0.1, length: 2.7, gain: 1.4 },
} as const;

export type HitName = keyof typeof HITS;
export type TextureName = keyof typeof TEXTURES;

/**
 * `length` shortens the tail when hits follow closely, so one never rings over the next. The cut
 * never runs past the end of the file (`duration(src)` is its measured length).
 */
export function hit(id: string, name: HitName, at: number, volume = 1, length?: number): Sound {
  const s = HITS[name];
  if (!s) throw new Error(`hit: no entry for "${name}" in HITS`);
  const src = `assets/audio/sfx/${s.file}`;
  const pre = Math.min(0.006, s.attack, at);
  const end = Math.min(s.attack + (length ?? s.length), duration(src));
  return { id, kind: 'sfx', src, at: at - pre, time: [s.attack - pre, end], volume: volume * s.gain };
}

/**
 * A run of the same hit: battens landing in turn, chips popping, pins going in. The same file
 * stacked on itself reads as an echo, so hits closer than `minGap` to the last kept one are dropped,
 * and every kept hit is trimmed to end before the next. Steps may be given in any order.
 */
export function run(name: HitName, steps: readonly { id: string; at: number; volume?: number }[], length?: number, minGap = 0.08): Sound[] {
  let lastAt = -Infinity;
  const kept = [...steps].sort((a, b) => a.at - b.at).filter((s) => {
    if (s.at - lastAt < minGap) return false;
    lastAt = s.at;
    return true;
  });
  return kept.map((s, i) => {
    const next = kept[i + 1];
    const room = next ? next.at - s.at - 0.012 : Infinity;
    return hit(s.id, name, s.at, s.volume ?? 1, Math.min(length ?? HITS[name].length, room));
  });
}

export function texture(id: string, name: TextureName, at: number, volume = 1, length?: number, from?: number): Sound {
  const s = TEXTURES[name];
  if (!s) throw new Error(`texture: no entry for "${name}" in TEXTURES`);
  const src = `assets/audio/sfx/${s.file}`;
  const start = s.from + (from ?? 0);
  const end = Math.min(s.from + s.length, start + (length ?? s.length), duration(src));
  return { id, kind: 'sfx', src, at, time: [start, end], volume: volume * s.gain };
}

/** Scene length: the last sound or action plus a breath, rounded up to whole milliseconds. */
export function sceneLength(sounds: readonly Sound[], tail: number, atLeast = 0): number {
  const end = Math.max(atLeast, ...sounds.map((s) => s.at + duration(s)));
  return Math.ceil((end + tail) * 1000) / 1000;
}
