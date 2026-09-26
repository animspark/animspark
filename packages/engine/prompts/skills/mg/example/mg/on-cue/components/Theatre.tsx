import { useRef } from 'react';
import type { Children } from './types';
import '../style.css';
import { aim, type Shot } from '../lib/camera';
import { paintGlow, paintHouse, paintScrim, type Rig } from '../lib/rig';
import { type } from '../theme';

/**
 * The house every scene plays in: a back canvas (walls, floor, proscenium), the DOM world the lens
 * moves, a scrim canvas that darkens the world except where lamps fall, and a glow canvas for beams.
 * One `paint(rig, shot, t)` repaints all three from the current state; scenes call it every frame.
 */
export function useTheatre() {
  const root = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const scrim = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLCanvasElement>(null);
  const paint = (rig: Rig, shot: Shot, t: number) => {
    aim(world.current, shot);
    const b = back.current?.getContext('2d'), s = scrim.current?.getContext('2d'), g = glowRef.current?.getContext('2d');
    if (b) paintHouse(b, rig, shot, t);
    if (s) paintScrim(s, rig, shot, t);
    if (g) paintGlow(g, rig, shot, t);
  };
  return { root, world, back, scrim, glow: glowRef, paint };
}

export type TheatreHandle = ReturnType<typeof useTheatre>;

export function Theatre({ theatre, children, above }: { theatre: TheatreHandle; children: Children; above?: Children }) {
  return (
    <div ref={theatre.root} className="oc">
      <canvas ref={theatre.back} className="oc-canvas" width={1920} height={1080} />
      <div ref={theatre.world} className="oc-world">{children}</div>
      <canvas ref={theatre.scrim} className="oc-canvas" width={1920} height={1080} />
      <canvas ref={theatre.glow} className="oc-canvas oc-glow" width={1920} height={1080} />
      {above}
      <span className="oc-fontwarm" style={{ fontFamily: type.marquee }}>Aa</span>
      <span className="oc-fontwarm" style={{ fontFamily: type.label, fontWeight: 600 }}>Aa</span>
      <span className="oc-fontwarm" style={{ fontFamily: type.typewriter }}>Aa</span>
      <span className="oc-fontwarm" style={{ fontFamily: type.hand }}>Aa</span>
      <span className="oc-fontwarm" style={{ fontFamily: type.display, fontWeight: 700 }}>Aa</span>
    </div>
  );
}
