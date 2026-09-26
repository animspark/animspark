/**
 * Interrogate a component tree without running a browser.
 *
 * This step is what makes code-only films viable at all. Export needs a real audio track, and
 * audio can't be obtained from screenshots - we have to know "how long is this film, and what
 * sounds when" **without starting a browser**. We do it by rendering the tree once in node with
 * `renderToStaticMarkup`, letting the audio components register themselves during render.
 *
 * Why render and not an effect: `renderToStaticMarkup` never runs effects. That also draws a
 * constraint - **audio components must not sit under a branch on the current time**
 * (`{t > 2000 && <Sfx/>}`), or this pass won't see them. In collect mode `Seq` always renders its
 * subtree to keep that constraint as narrow as possible: time windows don't affect collection,
 * only an `if` you write yourself does.
 *
 * The picture is wasted in this pass (a lump of HTML nobody looks at), and that's fine - the
 * picture is the browser's job anyway.
 */

import * as React from 'react';

import {
  FilmRoot,
  type CaptionEntry,
  type MediaEntry,
  type SceneSpan,
  type Sink,
  type SoundEntry,
} from './stage';

export interface FilmSummary {
  /** Film duration: the later of the last picture and the last sound. */
  durationMs: number;
  /** When the picture ends - audio running past it is a black tail. */
  visualEndMs: number;
  sounds: SoundEntry[];
  scenes: SceneSpan[];
  /** Every video segment in the film. The export frame rate follows the footage from these, and the timeline's video track is built from them. */
  videos: MediaEntry[];
  /** Captions. Not burned into the picture - exported as SRT and laid out by the player. */
  captions: CaptionEntry[];
  /**
   * Every workspace path this film **asks for**, whether or not it exists on disk.
   *
   * This is a different kind of list from the ones above: those answer "what does the film look
   * like", this one answers "what does it need". The difference is sharpest for images - an image
   * is a plain `<img>`, with no component and no registration, so it's in none of the lists above,
   * yet it can just as well point at a file that isn't on disk.
   *
   * It exists so the missing pieces can be put on the canvas to be generated. Without it, a
   * missing image shows up as a broken-image icon in the picture and the software knows nothing -
   * the user has to dig the path out of the source and make an image with that name themselves.
   * So this over-reports on purpose: anything reported that is actually on disk cancels out when
   * the other side compares.
   */
  assets: string[];
}

/** Run one collection. `render` is a function that renders a tree to a string (node passes `renderToStaticMarkup`). */
export function collectFilm(
  node: React.ReactNode,
  render: (element: React.ReactElement) => string,
  stage?: { w: number; h: number } | null,
): FilmSummary {
  const sounds = new Map<string, SoundEntry>();
  const scenes = new Map<string, SceneSpan>();
  const videos = new Map<string, MediaEntry>();
  const captions = new Map<string, CaptionEntry>();
  const sink: Sink = {
    sound: (entry) => { sounds.set(entry.key, entry); },
    scene: (span) => { scenes.set(span.key, span); },
    media: (entry) => { videos.set(entry.key, entry); },
    caption: (entry) => { captions.set(entry.key, entry); },
  };

  /* Two passes. On the first the duration isn't known yet (it's exactly what we're collecting), so
     the root window is 0 - which makes segments that "run to the end of the outer window when no
     dur is given" come out 0 long. The second pass reruns with the duration from the first, and
     they get their proper length. The only thing that still changes after two passes is the
     pathological "duration depends on duration" pattern, which shouldn't work anyway. */
  let durationMs = 0;
  let markup = '';
  for (let pass = 0; pass < 2; pass += 1) {
    sounds.clear();
    scenes.clear();
    videos.clear();
    captions.clear();
    markup = render(
      React.createElement(FilmRoot, { timeMs: 0, durationMs, sink, stage, children: node }),
    );
    durationMs = spanEnd([...scenes.values()], [...sounds.values()]);
  }

  const sceneList = [...scenes.values()].sort((a, b) => a.startMs - b.startMs);
  const soundList = [...sounds.values()].sort((a, b) => a.startMs - b.startMs);
  const videoList = [...videos.values()].sort((a, b) => a.startMs - b.startMs);
  const captionList = [...captions.values()].sort((a, b) => a.startMs - b.startMs);
  /* speaker is there to tell voices apart: in a dialogue film two names alternate so the reader
     knows who is talking. When the whole film has one voice it distinguishes nothing, yet the
     three downstream consumers (burned-in captions, preview overlay, SRT) all join it as
     `speaker: text` - every line of a single-narrator film opened with "narrator:", printing an
     internal cast label as dialogue. So it's removed here, where the final list is assembled: with
     one speaker it's dropped for the whole film; only with two or more do names belong on screen. */
  const speakers = new Set(captionList.map((c) => c.speaker).filter(Boolean));
  if (speakers.size <= 1) for (const c of captionList) delete c.speaker;
  return {
    durationMs,
    visualEndMs: sceneList.reduce((max, s) => Math.max(max, s.startMs + s.durMs), 0),
    sounds: soundList,
    scenes: sceneList,
    videos: videoList,
    captions: captionList,
    assets: [...new Set([
      ...soundList.map((s) => s.src),
      ...videoList.map((v) => v.src),
      ...markupAssets(markup),
    ])].filter(isWorkspacePath).sort(),
  };
}

/* Attributes are always double-quoted - this HTML comes from renderToStaticMarkup, not a person.
   And `url(...)` often lives inside `style="..."`, where its own quotes have already been escaped
   to `&quot;`, so we capture the whole value first, then decode, then strip quotes. */
const SRC_RE = /(?:src|poster)="([^"]*)"/g;
const URL_RE = /url\(\s*([^)]*?)\s*\)/g;

const ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', '#39': "'", '#x27': "'",
};

/**
 * Pick the paths out of the rendered HTML.
 *
 * Images in this runtime are plain `<img>` elements (see the top of media.tsx): no component, no
 * registration, so the sink receives nothing for them. Yet they are exactly the kind most likely
 * to be missing - "shot 3 needs a hero-closeup" is about an image.
 *
 * The collection pass already renders the whole tree to a string (that's how the audio components
 * get to run; the picture is wasted), so one scan over it is free. What we get this way is **the
 * URLs the browser will actually fetch**, more accurate than inferring from a component list:
 * background images, `poster`, `url(...)` in inline styles - none are missed.
 */
function markupAssets(markup: string): string[] {
  const out: string[] = [];
  for (const m of markup.matchAll(SRC_RE)) out.push(decode(m[1]!));
  for (const m of markup.matchAll(URL_RE)) out.push(unquote(decode(m[1]!)));
  return out;
}

/** Decoding a whole attribute value doesn't work (`&quot;` would become a real quote and cut the attribute short), so only the captured value is decoded. */
function decode(raw: string): string {
  return raw.replace(/&(amp|quot|apos|lt|gt|#39|#x27);/gi, (whole, name: string) =>
    ENTITIES[name.toLowerCase()] ?? whole);
}

function unquote(raw: string): string {
  const first = raw[0];
  return (first === '"' || first === "'") && raw.endsWith(first) && raw.length > 1
    ? raw.slice(1, -1)
    : raw;
}

/**
 * Does this URL point at a file in the workspace?
 *
 * Only relative paths count. Anything with a scheme (remote images, inline `data:`, images
 * embedded at compile time) isn't this project's asset; reporting it would only put a gap on the
 * canvas that can never be filled. Absolute paths likewise - they bypass `<base>` and don't point
 * into the workspace at all.
 */
function isWorkspacePath(src: string): boolean {
  return !!src && !src.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(src);
}

function spanEnd(scenes: SceneSpan[], sounds: SoundEntry[]): number {
  let end = 0;
  for (const s of scenes) end = Math.max(end, s.startMs + s.durMs);
  /* Sounds of unknown length (not yet ffprobed at collection time, durMs is Infinity) don't count
     toward film duration - the evaluator recomputes after measuring them. Letting them count
     would make the duration Infinity and blow up every step after. */
  for (const s of sounds) {
    if (Number.isFinite(s.durMs)) end = Math.max(end, s.startMs + s.durMs);
  }
  return Math.round(end);
}
