import { ink } from '../theme';

/**
 * The main curtain: two velvet panels that meet in the middle. Folds are a repeating gradient with a
 * fabric nap on top; the hem catches the footlights. `.oc-curtain-l` / `.oc-curtain-r` are translated
 * by GSAP: xPercent −100 / 100 is open, 0 is closed.
 *
 * It lives in the Theatre's `above` layer, in screen space: the lens does not move it, and when it is
 * closed it fills the frame edge to edge, so nothing of the world shows above or below it.
 */
export function Curtain({ className = '' }: { className?: string }) {
  const fold = `repeating-linear-gradient(90deg, ${ink.velvetLo} 0 16px, ${ink.velvet} 16px 54px, ${ink.velvetHi} 54px 76px, ${ink.velvet} 76px 108px, ${ink.velvetLo} 108px 124px)`;
  const nap = 'repeating-linear-gradient(0deg, rgba(255,255,255,.035) 0 1px, transparent 1px 3px)';
  const shade = 'linear-gradient(180deg, rgba(0,0,0,.35), rgba(0,0,0,0) 18%, rgba(0,0,0,0) 78%, rgba(0,0,0,.45))';
  const panel = (side: 'l' | 'r') => (
    <div className={`oc-abs oc-curtain-${side}`} style={{ left: side === 'l' ? 0 : 960, top: 0, width: 980, height: 1080, backgroundImage: `${shade}, ${nap}, ${fold}`, boxShadow: side === 'l' ? '16px 0 40px rgba(0,0,0,.6)' : '-16px 0 40px rgba(0,0,0,.6)' }}>
      <div className="oc-abs" style={{ left: 0, right: 0, bottom: 0, height: 26, background: `linear-gradient(180deg, ${ink.brassLo}, ${ink.brass} 50%, ${ink.brassLo})`, opacity: 0.75 }} />
      <div className="oc-abs" style={{ left: side === 'l' ? 'auto' : 0, right: side === 'l' ? 0 : 'auto', top: 0, width: 40, height: '100%', background: side === 'l' ? 'linear-gradient(90deg, rgba(0,0,0,0), rgba(0,0,0,.5))' : 'linear-gradient(270deg, rgba(0,0,0,0), rgba(0,0,0,.5))' }} />
    </div>
  );
  return (
    <div className={`oc-abs oc-curtain ${className}`} style={{ left: 0, top: 0, width: 1920, height: 1080, overflow: 'hidden', pointerEvents: 'none' }}>
      {panel('l')}
      {panel('r')}
    </div>
  );
}
