import * as React from 'react';
import type { MediaTimeIndex } from './media-at';

/** The host supplies the visible parent interval; author components keep local time. */
export const MgCompositionContext = React.createContext<{
  durationSec: number;
  /**
   * The animation duration this MG declares itself (present only when the module exports
   * `duration`). When the clip is stretched longer than that on the timeline, the time fed to
   * the choreography is capped here: the animation reaches its end and holds that final moment,
   * instead of looping over and over because the source says `repeat: -1` or similar. Without
   * a declaration there is no cap (its "natural length" is simply its span on the timeline).
   */
  naturalSec?: number;
  startMs: number;
  fromMs: number;
  durMs: number;
  instanceId: string;
  loc: string;
  assets: MediaTimeIndex;
} | null>(null);

/** Seconds fed to the choreography: past this MG's declared duration it holds at the end (see naturalSec). */
export function useChoreoSeconds(localMs: number): number {
  const mg = React.useContext(MgCompositionContext);
  const sec = localMs / 1000;
  return mg?.naturalSec != null ? Math.min(sec, mg.naturalSec) : sec;
}
