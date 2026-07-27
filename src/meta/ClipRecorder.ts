/**
 * Highlight clips.
 *
 * A screenshot proves a score. A ten-second clip of the moment you held a boss
 * off at one integrity is the thing somebody actually posts — and the thing
 * somebody else actually watches. This records the end of a run to a real video
 * file, with the game's own audio on it, and puts it one tap from the share
 * sheet.
 *
 * Three constraints shaped the design:
 *
 *  - **It must not cost frames.** Recording the display canvas at device pixel
 *    ratio on a phone means encoding a 1600x3200 surface sixty times a second,
 *    which is how you turn a smooth game into a slideshow. Frames are copied
 *    into a capture canvas capped at 720x1280 and pushed at 30fps, and the
 *    whole thing abandons itself if the frame rate suffers anyway.
 *
 *  - **It must produce a file the platforms accept.** Instagram and TikTok do
 *    not take WebM. MP4 is preferred wherever the browser can encode it, and
 *    the UI says so when it cannot.
 *
 *  - **It must carry a mark.** A clip that travels without saying what game it
 *    is does nothing for the game. The wordmark is drawn into the frames, small
 *    and in the corner, not stamped across the middle.
 */

import type { AudioEngine } from '../audio/AudioEngine';

export interface ClipFormat {
  mimeType: string;
  extension: string;
  label: string;
  /** True when the container is one the big social apps will actually ingest. */
  social: boolean;
}

/** Best first. MP4 wins wherever it exists, because WebM cannot be uploaded. */
export const CLIP_FORMATS: ClipFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', label: 'MP4', social: true },
  { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4', label: 'MP4', social: true },
  { mimeType: 'video/mp4', extension: 'mp4', label: 'MP4', social: true },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', label: 'WebM', social: false },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm', label: 'WebM', social: false },
  { mimeType: 'video/webm', extension: 'webm', label: 'WebM', social: false },
];

export function pickFormat(
  isSupported: (type: string) => boolean,
  candidates: ClipFormat[] = CLIP_FORMATS,
): ClipFormat | null {
  for (const c of candidates) {
    try {
      if (isSupported(c.mimeType)) return c;
    } catch {
      // isTypeSupported throws on some older builds rather than returning false.
    }
  }
  return null;
}

/** Is clip capture possible at all in this browser? */
export function clipFormat(): ClipFormat | null {
  if (typeof MediaRecorder === 'undefined') return null;
  if (typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return pickFormat((t) => MediaRecorder.isTypeSupported(t));
}

export interface ClipSegment {
  parts: Blob[];
  seconds: number;
}

/**
 * Which of the two rolling segments to keep.
 *
 * The recorder cycles when a segment gets long, so at the end of a run the live
 * segment might be twenty seconds of boss fight or half a second of whatever
 * happened after the last cycle. Prefer the live one — it always contains the
 * ending — unless it is too short to be worth watching, in which case the
 * previous segment at least ends near the finale.
 */
export function chooseSegment(
  current: ClipSegment | null,
  previous: ClipSegment | null,
  minSeconds: number,
): ClipSegment | null {
  if (current && current.seconds >= minSeconds) return current;
  if (previous && (!current || previous.seconds > current.seconds)) return previous;
  return current ?? previous;
}

/** `aegis-vane-w12-84233.mp4` — sortable, self-describing, no spaces. */
export function clipFileName(
  stats: { wave: number; score: number; guardianId: string },
  extension: string,
): string {
  const slug = stats.guardianId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `aegis-${slug}-w${stats.wave}-${Math.round(stats.score)}.${extension}`;
}

export interface ClipResult {
  blob: Blob;
  format: ClipFormat;
  seconds: number;
  width: number;
  height: number;
}

export interface ClipRecorderOptions {
  /** Longest side of the recorded frame. 1280 keeps a 9:16 clip at 720x1280. */
  maxSide?: number;
  fps?: number;
  bitrate?: number;
  /** Cycle to a fresh segment after this long, so memory stays bounded. */
  segmentSeconds?: number;
  /** Below this, a segment is not worth offering. */
  minSeconds?: number;
  watermark?: string;
}

const DEFAULTS = {
  maxSide: 1280,
  fps: 30,
  bitrate: 4_500_000,
  segmentSeconds: 20,
  minSeconds: 3.5,
  watermark: 'AEGIS',
};

/** A canvas capture track, whose `requestFrame` some browsers do not implement. */
type FrameTrack = MediaStreamTrack & { requestFrame?: () => void };

export class ClipRecorder {
  readonly format: ClipFormat | null;

  private readonly opts: Required<ClipRecorderOptions>;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private stream: MediaStream | null = null;
  private videoTrack: FrameTrack | null = null;
  private manualFrames = false;
  /** Kept separately: the canvas is released before the result is packed. */
  private size = { width: 0, height: 0 };
  /** What the browser actually agreed to encode, which may not be the ask. */
  private activeMime = '';

  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private previous: ClipSegment | null = null;
  private segmentStart = 0;
  private lastFrameAt = 0;
  private cycling = false;
  private finishing: ((seg: ClipSegment | null) => void) | null = null;

  /** Set once a device has proven it cannot record without dropping frames. */
  private givenUp = false;

  constructor(
    private readonly source: HTMLCanvasElement,
    private readonly audio: AudioEngine,
    options: ClipRecorderOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
    this.format = clipFormat();
  }

  get supported(): boolean {
    return this.format !== null && !this.givenUp;
  }

  get recording(): boolean {
    return this.rec !== null;
  }

  get seconds(): number {
    return this.rec ? (performance.now() - this.segmentStart) / 1000 : 0;
  }

  /** Give up for the rest of the session — used when recording costs frames. */
  abandon(): void {
    this.givenUp = true;
    this.discard();
  }

  start(): boolean {
    if (!this.supported || this.rec) return false;
    try {
      this.ensureCanvas();
      this.openRecorder();
      return true;
    } catch (err) {
      console.warn('[ClipRecorder] could not start', err);
      this.givenUp = true;
      this.discard();
      return false;
    }
  }

  /**
   * Copy the presented frame. Called once per rendered frame; throttles itself
   * to the target rate, so the caller does not have to think about it.
   */
  frame(): void {
    if (!this.rec || !this.ctx || !this.canvas) return;
    const now = performance.now();
    if (now - this.lastFrameAt < 1000 / this.opts.fps - 1) return;
    this.lastFrameAt = now;

    const { width, height } = this.canvas;
    const ctx = this.ctx;
    ctx.drawImage(this.source, 0, 0, width, height);
    this.drawWatermark(ctx, width, height);
    if (this.manualFrames) this.videoTrack?.requestFrame?.();

    if (this.seconds >= this.opts.segmentSeconds) this.cycle();
  }

  /** Stop and hand back the best segment, or null if there is nothing worth it. */
  async finish(): Promise<ClipResult | null> {
    if (!this.rec) {
      const seg = chooseSegment(null, this.previous, this.opts.minSeconds);
      this.previous = null;
      return this.pack(seg);
    }
    const seg = await this.closeRecorder();
    const best = chooseSegment(seg, this.previous, this.opts.minSeconds);
    this.previous = null;
    this.release();
    return this.pack(best);
  }

  /** Throw everything away without producing a file. */
  discard(): void {
    if (this.rec) {
      try {
        this.rec.ondataavailable = null;
        this.rec.onstop = null;
        if (this.rec.state !== 'inactive') this.rec.stop();
      } catch {
        // A recorder that is already dead needs no help dying.
      }
    }
    this.rec = null;
    this.chunks = [];
    this.previous = null;
    this.finishing = null;
    this.release();
  }

  // ------------------------------------------------------------------ internals

  private pack(seg: ClipSegment | null): ClipResult | null {
    if (!seg || !this.format || seg.parts.length === 0) return null;
    if (seg.seconds < this.opts.minSeconds) return null;
    const blob = new Blob(seg.parts, { type: this.activeMime || this.format.mimeType });
    if (blob.size < 8_000) return null; // an empty container, not a clip
    return {
      blob,
      format: this.format,
      seconds: seg.seconds,
      width: this.size.width,
      height: this.size.height,
    };
  }

  private ensureCanvas(): void {
    const sw = this.source.width;
    const sh = this.source.height;
    const scale = Math.min(1, this.opts.maxSide / Math.max(sw, sh));
    // Even dimensions: H.264 encoders reject odd ones.
    const w = Math.max(2, Math.round((sw * scale) / 2) * 2);
    const h = Math.max(2, Math.round((sh * scale) / 2) * 2);

    if (this.canvas && this.canvas.width === w && this.canvas.height === h) return;

    // A resize means a new stream; the old one cannot change resolution.
    this.release();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('capture canvas unavailable');
    this.canvas = canvas;
    this.ctx = ctx;
    this.size = { width: w, height: h };

    // Ask for an explicitly-driven stream first: pushing frames ourselves keeps
    // the encoder in step with the game loop instead of sampling it blind.
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0] as FrameTrack | undefined;
    this.manualFrames = typeof track?.requestFrame === 'function';
    this.stream = this.manualFrames ? stream : canvas.captureStream(this.opts.fps);
    this.videoTrack = this.manualFrames ? (track ?? null) : null;
    if (!this.manualFrames) {
      for (const t of stream.getTracks()) t.stop();
    }

    const audioStream = this.audio.captureStream();
    if (audioStream) {
      for (const t of audioStream.getAudioTracks()) this.stream.addTrack(t);
    }
  }

  private openRecorder(): void {
    if (!this.stream || !this.format) throw new Error('no stream');
    const rec = this.construct(this.stream, this.format);
    this.activeMime = rec.mimeType || this.format.mimeType;
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.onstop = () => this.onStopped();
    rec.start(1000);
    this.rec = rec;
    this.segmentStart = performance.now();
  }

  /**
   * Build the recorder, degrading rather than failing.
   *
   * The full codec string names an audio codec, which some builds reject when
   * the stream has no audio track — and there is no audio track before the
   * player has interacted enough to unlock the AudioContext. Fall back to the
   * bare container, then to whatever the browser picks for itself; the
   * container is what determines the file extension, and that is what matters.
   */
  private construct(stream: MediaStream, format: ClipFormat): MediaRecorder {
    const container = format.mimeType.split(';')[0]!;
    const attempts: MediaRecorderOptions[] = [
      { mimeType: format.mimeType, videoBitsPerSecond: this.opts.bitrate, audioBitsPerSecond: 96_000 },
      { mimeType: container, videoBitsPerSecond: this.opts.bitrate },
      { mimeType: container },
      {},
    ];
    let last: unknown;
    for (const opts of attempts) {
      try {
        return new MediaRecorder(stream, opts);
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error('MediaRecorder refused every configuration');
  }

  private onStopped(): void {
    const seg: ClipSegment = { parts: this.chunks, seconds: (performance.now() - this.segmentStart) / 1000 };
    this.chunks = [];
    this.rec = null;

    if (this.finishing) {
      const done = this.finishing;
      this.finishing = null;
      done(seg);
      return;
    }
    if (this.cycling) {
      this.cycling = false;
      this.previous = seg;
      try {
        this.openRecorder();
      } catch (err) {
        console.warn('[ClipRecorder] could not re-open after a cycle', err);
        this.givenUp = true;
      }
    }
  }

  private cycle(): void {
    if (!this.rec || this.cycling) return;
    this.cycling = true;
    try {
      this.rec.stop();
    } catch {
      this.cycling = false;
    }
  }

  private closeRecorder(): Promise<ClipSegment | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    this.cycling = false;
    return new Promise((resolve) => {
      // A recorder that never fires `onstop` must not leave the results screen
      // waiting on a button that will never arrive.
      const timer = setTimeout(() => {
        this.finishing = null;
        resolve({ parts: this.chunks, seconds: (performance.now() - this.segmentStart) / 1000 });
      }, 2500);
      this.finishing = (seg) => {
        clearTimeout(timer);
        resolve(seg);
      };
      try {
        rec.stop();
      } catch {
        clearTimeout(timer);
        this.finishing = null;
        resolve(null);
      }
    });
  }

  private release(): void {
    if (this.stream) {
      // Audio tracks belong to the engine's destination node and are shared, so
      // only the video track this recorder created is ours to stop.
      for (const t of this.stream.getVideoTracks()) t.stop();
    }
    this.stream = null;
    this.videoTrack = null;
    this.canvas = null;
    this.ctx = null;
  }

  private drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const text = this.opts.watermark;
    if (!text) return;
    const size = Math.max(11, Math.round(Math.min(w, h) * 0.028));
    ctx.save();
    ctx.font = `600 ${size}px "Chakra Petch", system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = '#0A0E1A';
    ctx.fillText(text, w - size * 0.9 + 1, h - size * 0.9 + 1);
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = '#EAF2FF';
    ctx.fillText(text, w - size * 0.9, h - size * 0.9);
    ctx.restore();
  }
}

// --------------------------------------------------------------------- director

export interface HighlightState {
  integrity: number;
  combo: number;
  bossPresent: boolean;
  phase: string;
}

/**
 * When is a run worth recording?
 *
 * Not from the first wave: most of a run is warm-up, and twenty seconds of
 * warm-up is twenty seconds nobody watches. Arm on the three states that make a
 * clip — the last life, a boss on screen, a combo that is clearly going
 * somewhere — and once armed, stay armed, because the ending is always part of
 * the story.
 */
export const HIGHLIGHT_COMBO = 25;

export function shouldArm(s: HighlightState): boolean {
  if (s.phase !== 'playing' && s.phase !== 'dying') return false;
  return s.integrity <= 1 || s.bossPresent || s.combo >= HIGHLIGHT_COMBO;
}
