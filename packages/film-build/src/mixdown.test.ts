import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { soundsStemManifest } from '@animspark/core';

import { audibleSources, mixPlan, mixdownFilm } from './mixdown';

test('files without an audio stream stay out of the mix; unprobeable files stay in', async () => {
  const resolved = new Map([
    ['assets/voice/vo.m4a', '/w/vo.m4a'],
    ['assets/video/screen.mp4', '/w/screen.mp4'],
    ['assets/video/broken.mp4', '/w/broken.mp4'],
  ]);
  const audible = await audibleSources(resolved, async (path) => {
    if (path.endsWith('broken.mp4')) throw new Error('ffprobe timed out');
    return { hasAudio: !path.endsWith('screen.mp4') };
  });
  assert.deepEqual([...audible.keys()].sort(), ['assets/video/broken.mp4', 'assets/voice/vo.m4a']);

  const manifest = soundsStemManifest([
    { key: 'c_vo', kind: 'voice', src: 'assets/voice/vo.m4a', startMs: 0, durMs: 2000, inMs: 0 },
    { key: 'c_scr', kind: 'sfx', src: 'assets/video/screen.mp4', startMs: 0, durMs: 2000, inMs: 0 },
  ]);
  const plan = mixPlan(manifest, { mapSrc: (src) => audible.get(src) ?? null });
  assert.ok(plan);
  assert.deepEqual(plan.inputs, ['/w/vo.m4a']);
});

const HAS_FFMPEG = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

test('a film with a silent video clip still mixes (real ffmpeg)', { skip: !HAS_FFMPEG && 'ffmpeg not installed' }, async () => {
  const ws = mkdtempSync(join(tmpdir(), 'mixdown-silent-'));
  try {
    const ff = (args: string[]) => execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args], { cwd: ws });
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', 'bars.mp4']);
    ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', 'tone.wav']);
    const out = join(ws, 'mix.m4a');
    const result = await mixdownFilm({
      workspace: ws, out, totalMs: 2000,
      sounds: [
        { key: 'c_tone', kind: 'music', src: 'tone.wav', startMs: 0, durMs: 2000, inMs: 0 },
        { key: 'c_bars', kind: 'sfx', src: 'bars.mp4', startMs: 0, durMs: 2000, inMs: 0 },
      ],
    });
    assert.equal(result, out);
    assert.ok(existsSync(out));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
