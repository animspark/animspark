import type { ComponentDef, Params, ParamValue } from './types';
import { clamp, esc, videoScale } from './music-utils';
import { musicBeatsViewportOf, musicChannelOf } from './track-view';

export interface MusicScoreParams extends Params {
  score: ParamValue;
  channel: string;
  progress: number;
  title: string;
  keySignature: string;
  meter: string;
}

function renderScore(params: MusicScoreParams, width: number, height: number): string {
  const w = Math.max(420, width);
  const h = Math.max(240, height);
  const scale = videoScale(w, h);
  const left = 172 * scale;
  const right = w - 64 * scale;
  /* The staff is centered between the title and footer, with line spacing tightened in short boxes - with a fixed
     position of 270·scale, a 1680×430 slot pushes the staff onto the footer and low notes are drawn outside the card. */
  const headerH = 130 * scale;
  const footerH = 70 * scale;
  const avail = Math.max(0, h - headerH - footerH);
  const above = 80 * scale;   // playhead dot, phrase labels
  const below = 100 * scale;  // bar numbers, low notes up to a second below the staff
  let staffGap = 34 * scale;
  if (above + staffGap * 4 + below > avail) staffGap = Math.max(12 * scale, (avail - above - below) / 4);
  const staffTop = headerH + above + Math.max(0, (avail - above - staffGap * 4 - below) / 2);
  const staffBottom = staffTop + staffGap * 4;
  const notes = musicChannelOf(params.score, params.channel, 'notes')?.notes ?? [];
  const duration = musicBeatsViewportOf(params.score);
  const progress = clamp(Number(params.progress) || 0, 0, duration);
  const beatWidth = (right - left) / duration;
  /* The staff's pitch origin follows this channel's median pitch (the same idea as choosing a clef): with E4 fixed on
     the bottom line, an arpeggio an octave lower is drawn entirely outside the card. Extreme notes are then clamped to within three line spaces above/below the staff. */
  const sorted = notes.map((n) => n.pitch).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 68;
  const base = median - 4;
  const noteY = (pitch: number) => clamp(
    staffBottom - (pitch - base) * (staffGap / 2),
    staffTop - staffGap * 3,
    staffBottom + staffGap * 3,
  );
  const playheadX = left + progress * beatWidth;

  const pieces: string[] = [
    `<rect width="${w}" height="${h}" rx="${24 * scale}" fill="#f7f2e8"/>`,
    `<rect x="${1 * scale}" y="${1 * scale}" width="${w - 2 * scale}" height="${h - 2 * scale}" rx="${23 * scale}" fill="none" stroke="#d8cebd" stroke-width="${2 * scale}"/>`,
    `<text x="${64 * scale}" y="${78 * scale}" fill="#25231f" font-family="ui-serif, Georgia, serif" font-size="${34 * scale * 1.3}" font-weight="700">${esc(params.title || 'Theme in C major')}</text>`,
    `<text x="${64 * scale}" y="${112 * scale}" fill="#817665" font-family="ui-monospace, monospace" font-size="${14 * scale * 1.3}" letter-spacing="${1.8 * scale}">${esc(params.keySignature || 'C MAJOR')} · ${esc(params.meter || '4/4')} · ${duration.toFixed(0)} BEATS</text>`,
    `<text x="${77 * scale}" y="${staffTop + staffGap * 3.72}" fill="#28241e" font-family="Georgia, serif" font-size="${154 * scale * 1.3}">𝄞</text>`,
  ];

  for (let line = 0; line < 5; line += 1) {
    const y = staffTop + line * staffGap;
    pieces.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="#70695d" stroke-width="${1.6 * scale}"/>`);
  }

  for (let beat = 0; beat <= duration; beat += 1) {
    const x = left + beat * beatWidth;
    if (beat % 4 === 0) {
      pieces.push(
        `<line x1="${x}" y1="${staffTop - 4 * scale}" x2="${x}" y2="${staffBottom + 4 * scale}" stroke="#5e584d" stroke-width="${2 * scale}"/>`,
        `<text x="${x + 8 * scale}" y="${staffBottom + 52 * scale}" fill="#a19684" font-family="ui-monospace, monospace" font-size="${13 * scale * 1.3}">${beat / 4 + 1}</text>`,
      );
    } else {
      pieces.push(`<line x1="${x}" y1="${staffBottom + 22 * scale}" x2="${x}" y2="${staffBottom + 32 * scale}" stroke="#c7bcaa" stroke-width="${1 * scale}"/>`);
    }
  }

  notes.forEach((note, index) => {
    const x = left + (note.beat + note.duration * 0.5) * beatWidth;
    const y = noteY(note.pitch);
    const hasPassed = progress >= note.beat;
    const isActive = progress >= note.beat && progress < note.beat + note.duration;
    const fill = isActive ? '#e6543f' : hasPassed ? '#2f665d' : '#39362f';
    const opacity = hasPassed || isActive ? 1 : 0.28;
    const stemUp = note.pitch < 71;
    const stemX = x + (stemUp ? 10 : -10) * scale;
    const stemEnd = y + (stemUp ? -72 : 72) * scale;
    pieces.push(
      `<ellipse cx="${x}" cy="${y}" rx="${13 * scale}" ry="${9 * scale}" transform="rotate(-18 ${x} ${y})" fill="${fill}" opacity="${opacity}"/>`,
      `<line x1="${stemX}" y1="${y}" x2="${stemX}" y2="${stemEnd}" stroke="${fill}" stroke-width="${2.6 * scale}" opacity="${opacity}"/>`,
    );
    if (note.duration <= 0.5) {
      const flagY = stemEnd + (stemUp ? 0 : -24 * scale);
      pieces.push(`<path d="M ${stemX} ${flagY} q ${30 * scale} ${stemUp ? 10 : -10} ${18 * scale} ${36 * scale}" fill="none" stroke="${fill}" stroke-width="${3 * scale}" opacity="${opacity}"/>`);
    }
    if (note.label) {
      pieces.push(`<text x="${x}" y="${staffTop - (34 + (index % 2) * 22) * scale}" text-anchor="middle" fill="${fill}" opacity="${opacity}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${13 * scale * 1.3}" font-weight="650">${esc(note.label)}</text>`);
    }
  });

  pieces.push(
    `<line x1="${playheadX}" y1="${staffTop - 62 * scale}" x2="${playheadX}" y2="${staffBottom + 62 * scale}" stroke="#e6543f" stroke-width="${3 * scale}"/>`,
    `<circle cx="${playheadX}" cy="${staffTop - 72 * scale}" r="${7 * scale}" fill="#e6543f"/>`,
    `<text x="${64 * scale}" y="${h - 58 * scale}" fill="#817665" font-family="ui-sans-serif, system-ui, sans-serif" font-size="${16 * scale * 1.3}">Pitch · duration · measure · playback position</text>`,
    `<text x="${w - 64 * scale}" y="${h - 58 * scale}" text-anchor="end" fill="#2f665d" font-family="ui-monospace, monospace" font-size="${15 * scale * 1.3}" font-weight="700">BEAT ${progress.toFixed(1)}</text>`,
  );
  return pieces.join('');
}

export const MUSIC_SCORE_DEF: ComponentDef<MusicScoreParams> = {
  name: 'score',
  doc: 'Staff-notation view: reads the notes of a score channel directly and shows pitch, duration, bars, and a synced playhead.',
  details: [
    'score: pass the same Score used for playback; channel selects a channel id (default: the first channel with notes).',
    'progress is set by the controlled progress, in beats.',
    'Decorative music notes do not need this component; use it only when pitch and meter must be musically accurate.',
  ].join('\n'),
  example: `<Score id="theme" score={score} channel="melody" progress={0} />`,
  paramDocs: {
    score: 'The same Score used for playback.',
    channel: 'Channel id; defaults to the first channel with notes.',
    progress: 'Current beat, set by the controlled progress.',
    title: 'Score title.',
    keySignature: 'Key signature label.',
    meter: 'Time signature label.',
  },
  defaults: {
    score: { bpm: 120, durationBeats: 4, channels: [{ id: 'melody', instrument: 'piano', notes: [{ pitch: 'C4', beat: 0, duration: 1 }, { pitch: 'E4', beat: 1, duration: 1 }, { pitch: 'G4', beat: 2, duration: 2 }] }] },
    channel: '',
    progress: 0,
    title: 'Theme',
    keySignature: 'C major',
    meter: '4/4',
  },
  intrinsic: () => [1280, 720],
  fill: true,
  render: renderScore,
  contentDebugRect: (_params, w, h) => [0, 0, w, h],
};
