/**
 * What the timeline draws inside clips: waveform peaks for sound, frames for video.
 * Both are computed in the browser from the workspace files (they are local, so fetching
 * them is cheap) and cached per file revision for the life of the page.
 */

/** Peaks at a fixed resolution of the source: max |sample| per PEAK_MS. */
export const PEAK_MS = 5;

export interface Peaks {
  /** 0..1, one per PEAK_MS of source audio. */
  values: Float32Array;
  durationMs: number;
}

const peakCache = new Map<string, Promise<Peaks | null>>();
let decoder: AudioContext | null = null;

export function loadPeaks(url: string, revision = ''): Promise<Peaks | null> {
  const key = `${url}#${revision}`;
  let job = peakCache.get(key);
  if (!job) {
    job = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const bytes = await res.arrayBuffer();
        decoder ??= new AudioContext();
        const audio = await decoder.decodeAudioData(bytes);
        const per = Math.max(1, Math.round((audio.sampleRate * PEAK_MS) / 1000));
        const n = Math.ceil(audio.length / per);
        const values = new Float32Array(n);
        for (let c = 0; c < audio.numberOfChannels; c += 1) {
          const data = audio.getChannelData(c);
          for (let i = 0; i < n; i += 1) {
            let peak = 0;
            const end = Math.min(data.length, (i + 1) * per);
            for (let j = i * per; j < end; j += 1) { const v = Math.abs(data[j]!); if (v > peak) peak = v; }
            if (peak > values[i]!) values[i] = peak;
          }
        }
        return { values, durationMs: audio.duration * 1000 };
      } catch {
        return null;
      }
    })();
    peakCache.set(key, job);
  }
  return job;
}

/**
 * Draw one clip's slice of the source: `[inMs, inMs + durMs × rate)` into the canvas.
 * Symmetric bars, gain-scaled, with a soft floor so near-silence still reads as a line.
 */
export function drawPeaks(canvas: HTMLCanvasElement, peaks: Peaks, opts: {
  inMs: number; durMs: number; rate?: number; gain?: number; color: string;
}): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = opts.color;
  const rate = opts.rate ?? 1;
  const gain = opts.gain ?? 1;
  const mid = height / 2;
  const span = opts.durMs * rate;
  for (let x = 0; x < width; x += 1) {
    const from = opts.inMs + (x / width) * span;
    const to = opts.inMs + ((x + 1) / width) * span;
    let peak = 0;
    for (let i = Math.floor(from / PEAK_MS); i < Math.ceil(to / PEAK_MS) && i < peaks.values.length; i += 1) {
      const v = peaks.values[i] ?? 0;
      if (v > peak) peak = v;
    }
    const h = Math.max(0.5, Math.min(1, Math.sqrt(peak * gain)) * (height / 2 - 1));
    ctx.fillRect(x, mid - h, 1, h * 2);
  }
}

/* ── video frames ─────────────────────────────────────────────────────── */

const frameCache = new Map<string, Promise<ImageBitmap | null>>();
const probes = new Map<string, { video: HTMLVideoElement; queue: Promise<unknown> }>();

function probeFor(url: string): { video: HTMLVideoElement; queue: Promise<unknown> } {
  let probe = probes.get(url);
  if (!probe) {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.src = url;
    probe = { video, queue: new Promise((done) => {
      video.addEventListener('loadeddata', done, { once: true });
      video.addEventListener('error', done, { once: true });
    }) };
    probes.set(url, probe);
  }
  return probe;
}

/** One frame of a video file at `ms`, `height` px tall. Seeks are serialized per file. */
export function videoFrame(url: string, ms: number, height: number): Promise<ImageBitmap | null> {
  const key = `${url}@${Math.round(ms / 40)}@${height}`;
  let job = frameCache.get(key);
  if (!job) {
    const probe = probeFor(url);
    job = probe.queue.then(() => new Promise<ImageBitmap | null>((resolve) => {
      const { video } = probe;
      if (!video.videoWidth) { resolve(null); return; }
      let target = Math.min(Math.max(0, ms / 1000), Math.max(0, video.duration - 0.05));
      const grab = () => {
        const w = Math.max(1, Math.round((video.videoWidth / video.videoHeight) * height));
        createImageBitmap(video, { resizeWidth: w, resizeHeight: height, resizeQuality: 'medium' }).then(resolve, () => resolve(null));
      };
      /* Always seek: a detached video that has only loaded its first frame is not yet
         "usable" as an image source until a seek has completed. */
      if (Math.abs(video.currentTime - target) < 0.001) target += 0.001;
      video.addEventListener('seeked', grab, { once: true });
      video.currentTime = target;
    }));
    probe.queue = job.catch(() => null);
    frameCache.set(key, job);
  }
  return job;
}
