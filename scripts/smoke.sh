#!/bin/sh
# End-to-end smoke test: new → check → look → render on a tiny film with a muspark score.
#
#   sh scripts/smoke.sh                 run the CLI from this checkout
#   ANIM="anim" sh scripts/smoke.sh     run an installed CLI instead
#   SMOKE_DIR=/tmp/x sh scripts/smoke.sh   keep the workspace somewhere known
#
# Needs Node 22+, ffmpeg/ffprobe on PATH and Playwright's Chromium
# (npx playwright install chromium). Exits non-zero on the first failure.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ANIM=${ANIM:-"node $ROOT/packages/engine/bin/anim.mjs"}
FPS=24
SEC=4
EXPECT_FRAMES=$((FPS * SEC))

WORK=${SMOKE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/anim-smoke.XXXXXX")}
mkdir -p "$WORK"
say() { printf '\n== %s\n' "$*"; }
fail() { printf '\nsmoke: FAIL: %s\n' "$*" >&2; exit 1; }

for tool in node ffmpeg ffprobe; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is not on PATH"
done

say "anim new ($WORK)"
cd "$WORK"
rm -rf film
$ANIM new "Smoke test: a title card over a short score" --sec "$SEC" --dir film
cd film/code

say "write a scene and a score"
mkdir -p mg assets/audio/music
cat > mg/title.tsx <<'EOF'
import { useRef } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { cue, useStage } from '@animspark/runtime';
import score, { hits } from '../assets/audio/music/bed';

gsap.registerPlugin(useGSAP);
export const durationSec = 4;
/* The same score the film's audio track plays, read here only to put motion on its beats. */
const music = { score, time: [0, 4] as const };

export default function Title() {
  const ref = useRef<HTMLDivElement>(null);
  const { h } = useStage();
  useGSAP(() => {
    const tl = gsap.timeline();
    tl.from('.word', { y: h * 0.08, opacity: 0, duration: 0.6, ease: 'power3.out', stagger: 0.12 }, 0.1);
    hits.forEach((hit, i) => {
      tl.fromTo('.pulse', { scale: 1.12 }, { scale: 1, duration: 0.3, ease: 'power2.out' }, cue(music, { beat: hit.beat, duration: 0.2 }).start);
      if (i === 0) tl.to('.bar', { scaleX: 1, duration: 2.4, ease: 'power2.inOut' }, 0.4);
    });
  }, { scope: ref });
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#10131a', color: '#f4efe6' }}>
      <div className="pulse" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: h * 0.12, fontFamily: 'Inter', fontWeight: 600 }}>
          <span className="word" style={{ display: 'inline-block' }}>Smoke</span>{' '}
          <span className="word" style={{ display: 'inline-block' }}>test</span>
        </div>
        <div className="bar" style={{ height: h * 0.01, background: '#ff6b3d', transform: 'scaleX(0)', transformOrigin: 'left' }} />
      </div>
    </div>
  );
}
EOF
cat > assets/audio/music/bed.ts <<'EOF'
import { arpeggio, layChords, type Score } from '@muspark/core';

const harmony = layChords(['C', 'G', 'Am', 'F'], { beatsEach: 2 });
export const hits = [0, 2, 4, 6].map((beat) => ({ drum: 'kick' as const, beat }));
const score: Score = {
  bpm: 120,
  durationBeats: 8,
  channels: [
    { id: 'keys', instrument: 'piano', notes: arpeggio(harmony, { shape: [0, 1, 2, 1], step: 0.5, octave: 4 }), gainDb: -8 },
    { id: 'drums', hits, gainDb: -10 },
  ],
};
export default score;
EOF
cat > film.json <<'EOF'
{
  "stage": { "w": 1280, "h": 720 },
  "tracks": [
    { "kind": "mg", "clips": [{ "id": "title", "src": "mg/title", "at": 0 }] },
    { "kind": "audio", "clips": [{ "id": "bed", "src": "assets/audio/music/bed.ts", "at": 0, "time": [0, 4], "volume": 0.6 }] }
  ]
}
EOF

say "anim check"
out=$($ANIM check) || { echo "$out"; fail "anim check exited non-zero"; }
echo "$out"
echo "$out" | grep -q '"status": "Pass"' || fail "anim check did not pass"

say "anim look"
out=$($ANIM look) || { echo "$out"; fail "anim look exited non-zero"; }
echo "$out"
sheet=$(echo "$out" | sed -n 's/.*"path": "\(.*\)".*/\1/p' | head -n 1)
[ -n "$sheet" ] && [ -s "$sheet" ] || fail "anim look wrote no contact sheet"

say "anim render --fps $FPS"
rm -rf .anim-out
out=$($ANIM render --fps "$FPS") || { echo "$out"; fail "anim render exited non-zero"; }
echo "$out"
mp4=.anim-out/film.mp4
[ -s "$mp4" ] || fail "no $mp4"

say "ffprobe $mp4"
frames=$(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=nw=1:nk=1 "$mp4")
audio=$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of default=nw=1:nk=1 "$mp4" | head -n 1)
size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of default=nw=1:nk=1 "$mp4" | paste -sd x -)
echo "video: $size, $frames frames; audio stream: ${audio:-none}"
[ "$frames" = "$EXPECT_FRAMES" ] || fail "expected $EXPECT_FRAMES frames, got $frames"
[ "$size" = "1280x720" ] || fail "expected 1280x720, got $size"
[ "$audio" = "audio" ] || fail "the score is on the timeline but the mp4 has no audio stream"
peak=$(ffmpeg -hide_banner -nostats -i "$mp4" -map 0:a -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(.*\) dB/\1/p')
echo "audio peak: ${peak} dB"
case "$peak" in -inf|-9[0-9]*|"") fail "the audio stream is silent (peak ${peak:-?} dB)";; esac

say "smoke: OK ($WORK)"
