/**
 * The rendering pipeline.
 *
 * Canvas2D on its own looks flat, so we run a real post-processing chain:
 *
 *   scene buffer  (full res)  <- everything opaque and lit
 *   glow buffer   (half res)  <- only emissive shapes, redrawn here by callers
 *        |
 *        +-- gaussian-ish blur via ctx.filter
 *        +-- additive composite back onto the scene   => bloom
 *
 *   display canvas <- scene, offset by camera shake, optionally split into
 *                     red/cyan copies for chromatic aberration on big hits,
 *                     then vignette + film grain on top.
 *
 * Callers draw emissive things twice: once to `ctx` for the crisp shape, once
 * to `glow` for the halo. `Renderer.emissive()` wraps that so it reads as one
 * call at the site.
 */

import { clamp, clamp01 } from '../core/math';
import { alpha } from './palette';

export type Quality = 'low' | 'medium' | 'high';

export interface ViewInfo {
  /** Logical width in CSS pixels. */
  width: number;
  /** Logical height in CSS pixels. */
  height: number;
  /** Centre of the viewport — the nexus lives here. */
  cx: number;
  cy: number;
  /** Scale factor relative to the 720px reference design, clamped for sanity. */
  scale: number;
  /** Shortest viewport dimension; the arena is sized from this. */
  minSide: number;
  /** True on tall/narrow viewports, i.e. phones held upright. */
  portrait: boolean;
}

const REFERENCE_SIDE = 760;

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(w));
  canvas.height = Math.max(1, Math.floor(h));
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('Canvas2D is unavailable in this browser');
  return { canvas, ctx };
}

export class Renderer {
  readonly display: HTMLCanvasElement;
  private displayCtx: CanvasRenderingContext2D;

  private sceneCanvas!: HTMLCanvasElement;
  /** Main drawing target. Already transformed so 1 unit = 1 CSS pixel. */
  ctx!: CanvasRenderingContext2D;

  private glowCanvas!: HTMLCanvasElement;
  /** Emissive drawing target. Same logical coordinate space as `ctx`. */
  glow!: CanvasRenderingContext2D;

  private blurCanvas!: HTMLCanvasElement;
  private blurCtx!: CanvasRenderingContext2D;

  private grainCanvas: HTMLCanvasElement | null = null;

  view: ViewInfo = { width: 1, height: 1, cx: 0, cy: 0, scale: 1, minSide: 1, portrait: true };

  dpr = 1;
  quality: Quality = 'high';

  /** Bloom knobs, tuned per quality tier but exposed for cinematic moments. */
  bloomStrength = 1;
  bloomRadius = 1;

  // Per-frame post-process state, set by the camera each frame.
  shakeX = 0;
  shakeY = 0;
  zoom = 1;
  rotation = 0;
  /** 0..1 white flash over the whole screen. */
  flash = 0;
  flashColor = '#FFFFFF';
  /** 0..1 amount of red/cyan channel separation. */
  aberration = 0;
  /** 0..1 extra vignette on top of the base amount. */
  vignetteBoost = 0;
  /**
   * Scales the two effects that are hardest on photosensitive players: the
   * full-screen flash and the chromatic split. The accessibility setting drives
   * this rather than removing the effects entirely, so impacts still register.
   */
  effectScale = 1;

  private glowScale = 0.5;
  private resizeObserver: ResizeObserver | null = null;
  private onResizeCallbacks: Array<(view: ViewInfo) => void> = [];

  constructor(display: HTMLCanvasElement) {
    this.display = display;
    const ctx = display.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas2D is unavailable in this browser');
    this.displayCtx = ctx;

    this.applyQuality(detectQuality());
    this.resize();

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(display);
    } else {
      window.addEventListener('resize', () => this.resize());
    }
  }

  onResize(cb: (view: ViewInfo) => void): void {
    this.onResizeCallbacks.push(cb);
  }

  applyQuality(q: Quality): void {
    this.quality = q;
    switch (q) {
      case 'low':
        this.glowScale = 0.34;
        this.bloomStrength = 0.75;
        this.bloomRadius = 0.8;
        break;
      case 'medium':
        this.glowScale = 0.45;
        this.bloomStrength = 0.95;
        this.bloomRadius = 1;
        break;
      case 'high':
        this.glowScale = 0.55;
        this.bloomStrength = 1.1;
        this.bloomRadius = 1.15;
        break;
    }
    // Buffers depend on glowScale, so rebuild them.
    if (this.sceneCanvas) this.resize();
  }

  get maxDpr(): number {
    return this.quality === 'low' ? 1.25 : this.quality === 'medium' ? 1.75 : 2;
  }

  resize(): void {
    const rect = this.display.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || window.innerWidth));
    const cssH = Math.max(1, Math.round(rect.height || window.innerHeight));
    const dpr = clamp(window.devicePixelRatio || 1, 1, this.maxDpr);

    this.dpr = dpr;
    this.display.width = Math.floor(cssW * dpr);
    this.display.height = Math.floor(cssH * dpr);

    const scene = makeCanvas(cssW * dpr, cssH * dpr);
    this.sceneCanvas = scene.canvas;
    this.ctx = scene.ctx;

    const gw = Math.max(1, Math.floor(cssW * dpr * this.glowScale));
    const gh = Math.max(1, Math.floor(cssH * dpr * this.glowScale));
    const glow = makeCanvas(gw, gh);
    this.glowCanvas = glow.canvas;
    this.glow = glow.ctx;

    const blur = makeCanvas(gw, gh);
    this.blurCanvas = blur.canvas;
    this.blurCtx = blur.ctx;

    const minSide = Math.min(cssW, cssH);
    this.view = {
      width: cssW,
      height: cssH,
      cx: cssW / 2,
      cy: cssH / 2,
      scale: clamp(minSide / REFERENCE_SIDE, 0.55, 1.9),
      minSide,
      portrait: cssH >= cssW,
    };

    this.grainCanvas = null; // regenerate lazily at the new size
    for (const cb of this.onResizeCallbacks) cb(this.view);
  }

  /** Clear both buffers and set up the logical coordinate transform. */
  begin(): void {
    const { ctx, glow, dpr, view } = this;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.clearRect(0, 0, view.width, view.height);

    const gs = dpr * this.glowScale;
    glow.setTransform(gs, 0, 0, gs, 0, 0);
    glow.globalCompositeOperation = 'lighter';
    glow.globalAlpha = 1;
    glow.filter = 'none';
    glow.setTransform(1, 0, 0, 1, 0, 0);
    glow.clearRect(0, 0, this.glowCanvas.width, this.glowCanvas.height);
    glow.setTransform(gs, 0, 0, gs, 0, 0);
  }

  /**
   * Draw the same shape to both the scene and the glow buffer.
   * `intensity` scales only the glow contribution.
   */
  emissive(draw: (c: CanvasRenderingContext2D) => void, intensity = 1): void {
    draw(this.ctx);
    if (this.bloomStrength <= 0 || intensity <= 0) return;
    const g = this.glow;
    g.save();
    g.globalAlpha = clamp01(intensity);
    draw(g);
    g.restore();
  }

  /** Draw only into the glow buffer — for halos with no crisp counterpart. */
  glowOnly(draw: (c: CanvasRenderingContext2D) => void, intensity = 1): void {
    if (this.bloomStrength <= 0 || intensity <= 0) return;
    const g = this.glow;
    g.save();
    g.globalAlpha = clamp01(intensity);
    draw(g);
    g.restore();
  }

  /** Resolve bloom, apply camera transform and screen effects, present. */
  composite(): void {
    const { displayCtx: out, dpr } = this;

    // --- bloom ---
    if (this.bloomStrength > 0) {
      const radiusPx = 7 * this.bloomRadius * this.glowScale * dpr;
      this.blurCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.blurCtx.clearRect(0, 0, this.blurCanvas.width, this.blurCanvas.height);
      this.blurCtx.filter = `blur(${radiusPx.toFixed(2)}px)`;
      this.blurCtx.drawImage(this.glowCanvas, 0, 0);
      this.blurCtx.filter = 'none';

      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      // Two taps at different scales approximate a wider, softer falloff than
      // a single blur pass can give us at this buffer size.
      ctx.globalAlpha = 0.85 * this.bloomStrength;
      ctx.drawImage(this.blurCanvas, 0, 0, this.sceneCanvas.width, this.sceneCanvas.height);
      ctx.globalAlpha = 0.45 * this.bloomStrength;
      const spread = 0.06 * this.bloomRadius;
      ctx.drawImage(
        this.blurCanvas,
        -this.sceneCanvas.width * spread * 0.5,
        -this.sceneCanvas.height * spread * 0.5,
        this.sceneCanvas.width * (1 + spread),
        this.sceneCanvas.height * (1 + spread),
      );
      ctx.restore();
    }

    // --- present with camera effects ---
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalCompositeOperation = 'source-over';
    out.globalAlpha = 1;
    out.filter = 'none';
    out.fillStyle = '#04050B';
    out.fillRect(0, 0, this.display.width, this.display.height);

    const zoom = this.zoom;
    out.save();
    out.translate(this.display.width / 2, this.display.height / 2);
    if (this.rotation !== 0) out.rotate(this.rotation);
    out.scale(zoom, zoom);
    out.translate(this.shakeX * dpr, this.shakeY * dpr);
    out.translate(-this.display.width / 2, -this.display.height / 2);

    const aberration = this.aberration * this.effectScale;
    if (aberration > 0.001 && this.quality !== 'low') {
      const off = aberration * 9 * dpr;
      out.globalCompositeOperation = 'source-over';
      out.drawImage(this.sceneCanvas, 0, 0);
      out.globalCompositeOperation = 'lighter';
      out.globalAlpha = clamp01(aberration * 0.55);
      out.filter = 'url(#aegis-red)';
      out.drawImage(this.sceneCanvas, -off, 0);
      out.filter = 'url(#aegis-cyan)';
      out.drawImage(this.sceneCanvas, off, 0);
      out.filter = 'none';
      out.globalAlpha = 1;
      out.globalCompositeOperation = 'source-over';
    } else {
      out.drawImage(this.sceneCanvas, 0, 0);
    }
    out.restore();

    // --- vignette ---
    const vig = 0.55 + this.vignetteBoost;
    const grad = out.createRadialGradient(
      this.display.width / 2,
      this.display.height / 2,
      Math.min(this.display.width, this.display.height) * 0.32,
      this.display.width / 2,
      this.display.height / 2,
      Math.max(this.display.width, this.display.height) * 0.78,
    );
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, `rgba(2,3,8,${clamp01(vig).toFixed(3)})`);
    out.fillStyle = grad;
    out.fillRect(0, 0, this.display.width, this.display.height);

    // --- film grain ---
    if (this.quality !== 'low') {
      const grain = this.getGrain();
      out.save();
      out.globalCompositeOperation = 'overlay';
      out.globalAlpha = 0.05;
      const gx = -Math.floor(Math.random() * 64);
      const gy = -Math.floor(Math.random() * 64);
      const pattern = out.createPattern(grain, 'repeat');
      if (pattern) {
        out.fillStyle = pattern;
        out.translate(gx, gy);
        out.fillRect(-gx, -gy, this.display.width + 64, this.display.height + 64);
      }
      out.restore();
    }

    // --- full screen flash ---
    const flash = this.flash * this.effectScale;
    if (flash > 0.001) {
      out.save();
      out.globalCompositeOperation = 'lighter';
      out.fillStyle = alpha(this.flashColor, clamp01(flash));
      out.fillRect(0, 0, this.display.width, this.display.height);
      out.restore();
    }
  }

  private getGrain(): HTMLCanvasElement {
    if (this.grainCanvas) return this.grainCanvas;
    const size = 128;
    const { canvas, ctx } = makeCanvas(size, size);
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 110 + Math.random() * 60;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    this.grainCanvas = canvas;
    return canvas;
  }

  /** Reset per-frame post state. Call after composite. */
  endFrame(): void {
    this.flash *= 0.82;
    if (this.flash < 0.002) this.flash = 0;
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.onResizeCallbacks = [];
  }
}

/**
 * Pick a starting quality tier. We deliberately guess conservatively on
 * unknown mobile hardware and let the adaptive monitor raise it if the frame
 * budget allows.
 */
export function detectQuality(): Quality {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (mem <= 2 || cores <= 2) return 'low';
  if (coarse && (mem <= 4 || cores <= 4)) return 'medium';
  return 'high';
}
