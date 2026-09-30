import * as THREE from 'three';
import { useLayoutEffect, useRef } from 'react';
import { registerFilmPending, useFilmPlaying, useLocal, useSharedPaint } from '@animspark/runtime';
import { Engine, type AdaptiveSampling } from './px/engine';
import { Lyrics } from './px/lyrics';
import { LINES, WORDS } from './lyrics';
import { makeTimeline } from './plates/timeline';
import { loadJSON } from './px/load';

/*
 * One Prompt, rebuilt on a WebGL film engine (ported from mexicat/pdoom-video, MIT): scenes render
 * linear HDR into render targets, the engine averages motion-blur sub-frames and runs the post chain
 * (bloom on the signal colour only, halation, radial CA, grain, shoulder). This component only hosts it.
 */
export const durationSec = 90.9; // = timeline FILM_END: the song ends at 89.05, the mark and the address finish after it


/**
 * export sampling comes from assets/data/render.json ({ min, max, tol } sub-frames): work-in-progress
 * stills use a few fixed sub-frames, the final export adaptive motion blur. The live player uses one.
 */
let EXPORT: AdaptiveSampling | number = { min: 12, max: 108, tol: 3 };
const SHUTTER = 0.25;

let ENGINE: Engine | null = null;
let READY: Promise<void> | null = null;
const factory = () => new THREE.WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });

export default function Film() {
  const t = useLocal();
  const playing = useFilmPlaying();
  const cv = useRef<HTMLCanvasElement>(null);
  const paint = useSharedPaint(cv, factory);
  useLayoutEffect(() => {
    // the live player (tools/live) sets __opLive: one sample per frame, like the editor's playback
    const live = playing || (window as unknown as { __opLive?: boolean }).__opLive === true;
    const draw = () => paint((r) => { ENGINE!.render(Math.min(t, durationSec - 1e-3), 1 / 60, true, live ? 1 : EXPORT, SHUTTER); });
    if (!READY) {
      paint((r) => {
        if (ENGINE) return;
        ENGINE = new Engine(r as THREE.WebGLRenderer, makeTimeline, () => Lyrics.fromTables(WORDS, LINES));
        READY = Promise.all([ENGINE.init(), loadJSON<{ min: number; max: number; tol?: number }>('assets/data/render.json').then((c) => { EXPORT = c.min === c.max ? c.min : { min: c.min, max: c.max, tol: c.tol ?? 3 }; }, () => {})]).then(() => {});
      });
    }
    if (!READY) return;
    let done = false;
    READY.then(() => { done = true; });
    registerFilmPending(READY.then(draw));
    if (done) draw();
  }, [t, paint, playing]);
  return <canvas ref={cv} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />;
}
