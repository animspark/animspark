// The edit: which plate plays when. Boundaries come from lyric words and the beat grid (handoff.ts CUT).
import type { TimelineEntry } from '../px/engine';
import type { SceneClass } from '../px/scene';
import type { Lyrics } from '../px/lyrics';
import type { AudioData } from '../px/audio';
import { CUT } from './handoff';

/** the outro plays until its line has retracted into the caret (where its rewind used to start); then the
 *  caret turns into the mark and the address, and the film ends a little after the song */
/** the intro's second hit (beat 4): the rewind, run forward, has landed; the construction sheet starts */
export const INTRO_HIT2 = 0.102 + 4 * (60 / 122);
export const BRAND_T = sparkPlan().parkT + 0.27;
export const FILM_END = 90.9;
import Unfold from './unfold';
import Construct from './construct';
import { sparkPlan } from './premiere-kit';
import BrandOut from './brandout';
import Prompt from './prompt';
import Ridge from './ridge';
import City from './city';
import Plot from './plot';
import Hook from './hookmontage';
import Zoetrope from './zoetrope';
import Beam from './beam';
import Marquee from './marquee';
import Sky from './sky';
import Mix from './mix';
import Stadium from './stadium';
import Edit from './edit';
import Earth from './earth';
import Premiere from './premiere';
import Outro from './outro';

const mod = (c: SceneClass) => () => Promise.resolve({ default: c });

export function makeTimeline(_ly: Lyrics, _au: AudioData): TimelineEntry[] {
  return [
    { id: 'unfold', load: mod(Unfold), start: 0, end: INTRO_HIT2 },
    { id: 'construct', load: mod(Construct), start: INTRO_HIT2, end: CUT.prompt },
    { id: 'prompt', load: mod(Prompt), start: CUT.prompt, end: CUT.ridge },
    { id: 'ridge', load: mod(Ridge), start: CUT.ridge, end: CUT.city },
    { id: 'city', load: mod(City), start: CUT.city, end: CUT.plot },
    { id: 'plot', load: mod(Plot), start: CUT.plot, end: CUT.hook },
    { id: 'hook1', load: mod(Hook), start: CUT.hook, end: CUT.zoetrope, params: { n: 1 } },
    { id: 'zoetrope', load: mod(Zoetrope), start: CUT.zoetrope, end: CUT.beam },
    { id: 'beam', load: mod(Beam), start: CUT.beam, end: CUT.marquee },
    { id: 'marquee', load: mod(Marquee), start: CUT.marquee, end: CUT.sky },
    { id: 'sky', load: mod(Sky), start: CUT.sky, end: CUT.mix },
    { id: 'mix', load: mod(Mix), start: CUT.mix, end: CUT.stadium },
    { id: 'stadium', load: mod(Stadium), start: CUT.stadium, end: CUT.edit },
    { id: 'edit', load: mod(Edit), start: CUT.edit, end: CUT.hook2 },
    { id: 'hook2', load: mod(Hook), start: CUT.hook2, end: CUT.earth, params: { n: 2 } },
    { id: 'earth', load: mod(Earth), start: CUT.earth, end: CUT.premiere },
    { id: 'premiere', load: mod(Premiere), start: CUT.premiere, end: CUT.outro },
    { id: 'outro', load: mod(Outro), start: CUT.outro, end: BRAND_T },
    { id: 'brand', load: mod(BrandOut), start: BRAND_T, end: FILM_END },
  ];
}
