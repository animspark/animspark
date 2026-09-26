import type { ComponentDef, Params, ParamValue } from './types';
import { clamp, esc, videoScale } from './music-utils';
import { musicBeatsViewportOf, musicBpmOf, musicChannelsOf, pitchNameOf, type ViewNote } from './track-view';

export interface PianoRollParams extends Params {
  score: ParamValue;
  channel: string;
  progress: number;
  title: string;
}

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

/** Empty channel = merge the notes of all channels (all voices in one piano roll); a given id shows only that channel. */
function rollNotesOf(track: ParamValue, channelId: string): ViewNote[] {
  const wanted = String(channelId ?? '').trim();
  return musicChannelsOf(track)
    .filter((channel) => !wanted || channel.id === wanted)
    .flatMap((channel) => channel.notes);
}

function renderPianoRoll(params: PianoRollParams, width: number, height: number): string {
  const w = Math.max(440, width);
  const h = Math.max(260, height);
  const scale = videoScale(w, h);
  const keyboardW = 112 * scale;
  const gridLeft = 142 * scale;
  const gridRight = w - 52 * scale;
  const gridTop = 158 * scale;
  const gridBottom = h - 82 * scale;
  const notes = rollNotesOf(params.score, params.channel);
  const minPitch = Math.min(48, ...notes.map((note) => note.pitch));
  const maxPitch = Math.max(71, ...notes.map((note) => note.pitch));
  const rows = maxPitch - minPitch + 1;
  const rowH = (gridBottom - gridTop) / rows;
  const duration = musicBeatsViewportOf(params.score);
  const progress = clamp(Number(params.progress) || 0, 0, duration);
  const beatW = (gridRight - gridLeft) / duration;
  const playheadX = gridLeft + progress * beatW;

  const pieces: string[] = [
    `<rect width="${w}" height="${h}" rx="${24 * scale}" fill="#08111e"/>`,
    `<rect x="${1 * scale}" y="${1 * scale}" width="${w - 2 * scale}" height="${h - 2 * scale}" rx="${23 * scale}" fill="none" stroke="#23354b" stroke-width="${2 * scale}"/>`,
    `<text x="${52 * scale}" y="${66 * scale}" fill="#edf5ff" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${31 * scale * 1.3}" font-weight="760">${esc(params.title || 'Piano roll')}</text>`,
    `<text x="${52 * scale}" y="${100 * scale}" fill="#70869e" font-family="ui-monospace, monospace" font-size="${14 * scale * 1.3}" letter-spacing="${1.8 * scale}">${Math.round(musicBpmOf(params.score))} BPM · ${duration.toFixed(0)} BEATS · ${notes.length} NOTES</text>`,
    `<rect x="${gridLeft}" y="${gridTop}" width="${gridRight - gridLeft}" height="${gridBottom - gridTop}" fill="#0c1828" stroke="#26384e" stroke-width="${1 * scale}"/>`,
  ];

  for (let pitch = minPitch; pitch <= maxPitch; pitch += 1) {
    const row = maxPitch - pitch;
    const y = gridTop + row * rowH;
    const black = BLACK_KEYS.has(pitch % 12);
    pieces.push(
      `<rect x="${52 * scale}" y="${y}" width="${keyboardW}" height="${rowH}" fill="${black ? '#182231' : '#edf2f5'}" stroke="#2d3948" stroke-width="${0.6 * scale}"/>`,
      `<line x1="${gridLeft}" y1="${y}" x2="${gridRight}" y2="${y}" stroke="${black ? '#1a2b3f' : '#26384e'}" stroke-width="${0.8 * scale}"/>`,
    );
    if (pitch % 12 === 0) {
      pieces.push(`<text x="${gridLeft - 8 * scale}" y="${y + rowH * 0.72}" text-anchor="end" fill="${black ? '#91a2b5' : '#475568'}" font-family="ui-monospace, monospace" font-size="${10 * scale}">${pitchNameOf(pitch)}</text>`);
    }
  }

  for (let beat = 0; beat <= duration; beat += 1) {
    const x = gridLeft + beat * beatW;
    const major = beat % 4 === 0;
    pieces.push(
      `<line x1="${x}" y1="${gridTop}" x2="${x}" y2="${gridBottom}" stroke="${major ? '#40546b' : '#21344a'}" stroke-width="${major ? 1.5 : 0.8}"/>`,
      `<text x="${x + 6 * scale}" y="${gridTop - 18 * scale}" fill="${major ? '#8094aa' : '#53677d'}" font-family="ui-monospace, monospace" font-size="${11 * scale}">${beat + 1}</text>`,
    );
  }

  notes.forEach((note) => {
    const x = gridLeft + note.beat * beatW + 2 * scale;
    const y = gridTop + (maxPitch - note.pitch) * rowH + 2 * scale;
    const noteW = Math.max(8 * scale, note.duration * beatW - 4 * scale);
    const active = progress >= note.beat && progress < note.beat + note.duration;
    const passed = progress >= note.beat + note.duration;
    const fill = active ? '#f9c74f' : passed ? '#3bc7a6' : '#7188ff';
    pieces.push(
      `<rect x="${x}" y="${y}" width="${noteW}" height="${Math.max(4, rowH - 4 * scale)}" rx="${4 * scale}" fill="${fill}" opacity="${0.42 + note.velocity * 0.58}"/>`,
      active ? `<rect x="${x}" y="${y}" width="${noteW}" height="${Math.max(4, rowH - 4 * scale)}" rx="${4 * scale}" fill="none" stroke="#fff4bf" stroke-width="${2 * scale}"/>` : '',
    );
  });

  pieces.push(
    `<line x1="${playheadX}" y1="${gridTop - 20 * scale}" x2="${playheadX}" y2="${gridBottom + 14 * scale}" stroke="#ff6f91" stroke-width="${3 * scale}"/>`,
    `<path d="M ${playheadX - 7 * scale} ${gridTop - 24 * scale} L ${playheadX + 7 * scale} ${gridTop - 24 * scale} L ${playheadX} ${gridTop - 12 * scale} Z" fill="#ff6f91"/>`,
    `<text x="${w - 52 * scale}" y="${h - 38 * scale}" text-anchor="end" fill="#ff8fab" font-family="ui-monospace, monospace" font-size="${14 * scale * 1.3}" font-weight="700">BEAT ${progress.toFixed(2)}</text>`,
  );
  return pieces.join('');
}

export const PIANO_ROLL_DEF: ComponentDef<PianoRollParams> = {
  name: 'pianoRoll',
  doc: 'Piano-roll view: reads the score notes directly and shows durations, velocities, and a synced playhead on a pitch-time grid.',
  details: [
    'score: pass the same Score used for playback; channel defaults to merging all channels, and a given id shows only that channel.',
    'progress is set by the controlled progress, in beats.',
    'Plain colored rectangles do not need this component; use it only when pitch and rhythm must keep their musical meaning.',
  ].join('\n'),
  example: `<PianoRoll id="roll" score={score} progress={0} />`,
  paramDocs: {
    score: 'The same Score used for playback.',
    channel: 'Channel id; defaults to merging the notes of all channels.',
    progress: 'Current beat, set by the controlled progress.',
    title: 'Piano-roll title.',
  },
  defaults: {
    score: { bpm: 120, durationBeats: 4, channels: [{ id: 'melody', instrument: 'piano', notes: [{ pitch: 'C4', beat: 0, duration: 1 }, { pitch: 'E4', beat: 1, duration: 1 }, { pitch: 'G4', beat: 2, duration: 2 }] }] },
    channel: '',
    progress: 0,
    title: 'Piano roll',
  },
  intrinsic: () => [1280, 720],
  fill: true,
  render: renderPianoRoll,
  contentDebugRect: (_params, w, h) => [0, 0, w, h],
};
