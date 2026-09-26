import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { SCORE_RENDERER_VERSION, compileScore, ensureSoundFont, hasSampledEvents, renderScoreWavAsync, soundfontDigest, type Score } from '@muspark/core/server';
import { mgScoreJson, mgScoreSrc } from '@animspark/runtime';
import { updateAssetIndex } from './asset-index';

const SAMPLE_RATE = 44100;
const pending = new Map<string, Promise<void>>();

/** Prepare declarative scores once; placement, trimming and clip volume remain live. */
export async function syncScoreAudio(workspace: string, declarations: Record<string, unknown> = {}): Promise<void> {
  const scores = new Map<string, Score>();
  for (const [module, sounds] of Object.entries(declarations)) {
    if (sounds === undefined) continue;
    if (!Array.isArray(sounds)) throw new Error(`${module}: sounds must be an array.`);
    for (const sound of sounds) {
      if (sound?.score === undefined) continue;
      if (sound.src !== undefined) throw new Error(`${module}: provide exactly one of src or score.`);
      if (!['music', 'sfx'].includes(sound.kind)) throw new Error(`${module}: a score must have kind music or sfx.`);
      scores.set(mgScoreSrc(sound.score), sound.score);
    }
  }
  for (const [src, score] of scores) {
    const key = join(workspace, src);
    let job = pending.get(key);
    if (!job) {
      job = prepareScore(workspace, src, score).finally(() => pending.delete(key));
      pending.set(key, job);
    }
    await job;
  }
}

async function prepareScore(workspace: string, src: string, score: Score): Promise<void> {
  const plan = compileScore(score);
  const sampled = hasSampledEvents(plan.events);
  if (sampled) await ensureSoundFont();
  const hash = createHash('sha256').update(JSON.stringify({
    score: mgScoreJson(score), renderer: SCORE_RENDERER_VERSION, sampleRate: SAMPLE_RATE,
    soundfont: sampled ? soundfontDigest() : null,
  })).digest('hex');
  const path = join(workspace, src);
  const sidecar = join(workspace, '.anim', 'music', `${src.split('/').at(-1)}.json`);
  const saved = await readFile(sidecar, 'utf8').then(JSON.parse).catch(() => null);
  const exists = await stat(path).then(info => info.isFile() && info.size === saved?.bytes && info.mtimeMs === saved?.mtimeMs).catch(() => false);
  let wavHash = saved?.wavHash;
  if (!exists || saved?.hash !== hash) {
    const wav = await renderScoreWavAsync(score, { sampleRate: SAMPLE_RATE });
    wavHash = createHash('sha256').update(wav).digest('hex');
    await mkdir(dirname(path), { recursive: true });
    await mkdir(dirname(sidecar), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, wav);
    await rename(temp, path);
    const metaTemp = `${sidecar}.${randomUUID()}.tmp`;
    await writeFile(metaTemp, JSON.stringify({ hash, wavHash, bytes: wav.length, mtimeMs: (await stat(path)).mtimeMs }));
    await rename(metaTemp, sidecar);
  }
  updateAssetIndex(workspace, entries => {
    const prior = entries[src];
    if (prior?.source_sha256 === wavHash && prior?.dur === plan.durationSec
      && (prior?.origin as { renderHash?: string } | undefined)?.renderHash === hash) return null;
    entries[src] = { ...prior, src, kind: 'audio', dur: plan.durationSec, source_sha256: wavHash,
      origin: { mode: 'synth', provider: '@muspark/core', bpm: score.bpm,
        durationBeats: score.durationBeats, tailSec: plan.tailSec, renderHash: hash },
    };
    return entries;
  });
}
