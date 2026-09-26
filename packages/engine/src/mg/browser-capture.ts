/** Pixel exchange keeps a sandboxed project opaque to its parent document. */
import { toCanvas } from 'html-to-image';

export async function capturePreparedSurface(root: HTMLElement, width?: number): Promise<string> {
  const restores: Array<() => void> = [];
  try {
    for (const source of root.querySelectorAll('canvas,video')) {
      let canvas: HTMLCanvasElement;
      if (source instanceof HTMLVideoElement) {
        if (source.readyState < 2 || !source.videoWidth) throw new Error('MG video frame is not ready.');
        canvas = document.createElement('canvas');
        canvas.width = source.videoWidth; canvas.height = source.videoHeight;
        canvas.getContext('2d')!.drawImage(source, 0, 0);
      } else canvas = source as HTMLCanvasElement;
      const img = document.createElement('img');
      img.src = canvas.toDataURL('image/png');
      img.className = source.className;
      img.style.cssText = (source as HTMLElement).style.cssText;
      const style = getComputedStyle(source);
      for (const name of ['width', 'height', 'position', 'left', 'top', 'object-fit', 'transform']) img.style.setProperty(name, style.getPropertyValue(name));
      source.replaceWith(img); restores.push(() => img.replaceWith(source));
    }
    const w = root.offsetWidth; const h = root.offsetHeight;
    if (!(w > 0 && h > 0)) throw new Error('MG has no drawable surface.');
    const canvas = await toCanvas(root, { width: w, height: h,
      pixelRatio: width ? Math.min(1, width / w) : 1,
      style: { transform: 'none', margin: '0' } });
    return canvas.toDataURL('image/png');
  } finally { restores.reverse().forEach(restore => restore()); }
}

/** Temporarily cover opaque iframes with the child's own current pixels. Never detach
 * an iframe: reinserting it reloads the project and loses its acknowledged clock. */
export async function inlinePreparedSurfaces(root: HTMLElement, width?: number): Promise<() => void> {
  const restores: Array<() => void> = [];
  try {
    for (const frame of root.querySelectorAll<HTMLIFrameElement>('iframe[data-mg-surface]')) {
      const seq = 'capture-' + crypto.randomUUID();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timer); removeEventListener('message', receive); };
        const receive = (event: MessageEvent) => {
          if (event.source !== frame.contentWindow || event.data?.source !== 'animspark-mg-surface' || event.data?.type !== 'captured' || event.data.seq !== seq) return;
          cleanup();
          if (event.data.error) { reject(new Error(String(event.data.error))); return; }
          const data = event.data.dataUrl;
          if (typeof data !== 'string' || !data.startsWith('data:image/png;base64,') || data.length > 64 * 1024 * 1024) reject(new Error('Invalid MG frame response.'));
          else resolve(data);
        };
        const timer = setTimeout(() => { cleanup(); reject(new Error('MG frame capture timed out.')); }, 20000);
        addEventListener('message', receive);
        frame.contentWindow?.postMessage({ source: 'animspark-mg-host', type: 'capture', seq, width }, '*');
      });
      const img = document.createElement('img');
      img.src = dataUrl;
      img.style.cssText = frame.style.cssText;
      const visibility = frame.style.visibility;
      frame.style.visibility = 'hidden';
      frame.after(img);
      restores.push(() => { img.remove(); frame.style.visibility = visibility; });
      await img.decode();
    }
    return () => restores.reverse().forEach(restore => restore());
  } catch (error) { restores.reverse().forEach(restore => restore()); throw error; }
}
