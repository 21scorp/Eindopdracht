/**
 * The sprite layer.
 *
 * Everything the game draws goes through a *texture key* — `'guardian/vex'`,
 * `'threat/lancer'`, `'fx/spark'`. A key resolves to a `Texture`, which is a
 * source image plus a source rectangle plus an anchor.
 *
 * Today every texture is produced procedurally at boot (see `procgen.ts`), so
 * the game ships complete with no art pipeline. When real sprite sheets arrive,
 * `loadAtlas()` overrides the same keys with atlas frames and *nothing else in
 * the codebase changes*. That is the whole point of this file: art can be
 * swapped without touching gameplay or UI code.
 *
 * Atlas format is the standard TexturePacker "JSON (Hash)" export, which every
 * common packer can emit.
 */

export interface Texture {
  key: string;
  image: CanvasImageSource;
  /** Source rect inside `image`. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Anchor in 0..1 of the frame. 0.5,0.5 is centred. */
  ax: number;
  ay: number;
  /** Natural draw size in logical pixels at scale 1. */
  w: number;
  h: number;
  /** True when this came from a real atlas rather than procedural generation. */
  fromAtlas: boolean;
}

export interface DrawOptions {
  rotation?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  alpha?: number;
  /** Hex colour. Applies a multiply-style tint through a cached offscreen pass. */
  tint?: string;
  /** 0..1 blend toward the tint colour. 1 = fully tinted. */
  tintAmount?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Overrides the texture's own anchor. */
  ax?: number;
  ay?: number;
  composite?: GlobalCompositeOperation;
  /** Draw at an explicit size instead of natural size * scale. */
  width?: number;
  height?: number;
}

export interface AnimationDef {
  name: string;
  frames: string[];
  fps: number;
  loop: boolean;
}

export type TextureGenerator = (key: string) => HTMLCanvasElement | Texture;

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
  rotated?: boolean;
  trimmed?: boolean;
  spriteSourceSize?: { x: number; y: number; w: number; h: number };
  sourceSize?: { w: number; h: number };
  pivot?: { x: number; y: number };
}

interface AtlasJson {
  frames: Record<string, AtlasFrame>;
  meta?: { image?: string; scale?: string | number };
}

/**
 * The tint cache is budgeted in *pixels*, not entries. Two hundred 64x64 spark
 * variants cost almost nothing; two hundred 512x512 sheets are two hundred
 * megabytes of backing store. Roughly 16MB at four bytes a pixel.
 */
const TINT_PIXEL_BUDGET = 4_000_000;

/**
 * Tint colours are quantised before they become a cache key.
 *
 * An animated accent — the arena crossfading to gold as Overdrive engages —
 * produces a different hex string every frame, so an exact-match cache
 * allocates a fresh canvas per frame and evicts something useful to store it.
 * Rounding each channel to the nearest 8 collapses that ramp onto a few dozen
 * keys and is not perceptible.
 */
const TINT_QUANTISE = 8;

export class TextureStore {
  private textures = new Map<string, Texture>();
  private generators = new Map<string, TextureGenerator>();
  private animations = new Map<string, AnimationDef>();
  private tintCache = new Map<string, HTMLCanvasElement>();
  private tintPixels = 0;
  private missing = new Set<string>();

  /** Set once an atlas has been loaded; used by tooling and the debug overlay. */
  atlasLoaded = false;

  /**
   * Register a procedural generator for a key. Generation is lazy so boot stays
   * fast — a texture is only rasterised the first time it is drawn.
   */
  define(key: string, generator: TextureGenerator): void {
    this.generators.set(key, generator);
  }

  /** Register many generators at once. */
  defineAll(defs: Record<string, TextureGenerator>): void {
    for (const [key, gen] of Object.entries(defs)) this.define(key, gen);
  }

  defineAnimation(def: AnimationDef): void {
    this.animations.set(def.name, def);
  }

  getAnimation(name: string): AnimationDef | undefined {
    return this.animations.get(name);
  }

  has(key: string): boolean {
    return this.textures.has(key) || this.generators.has(key);
  }

  /** Every key the store can resolve. Used by the manifest check. */
  keys(): string[] {
    return [...new Set([...this.generators.keys(), ...this.textures.keys()])].sort();
  }

  /**
   * Resolve a key to a texture, generating it on first use.
   * An unknown key yields a loud magenta placeholder rather than throwing, so a
   * missing asset never takes the game down mid-run.
   */
  get(key: string): Texture {
    const existing = this.textures.get(key);
    if (existing) return existing;

    const gen = this.generators.get(key);
    if (gen) {
      const produced = gen(key);
      const texture = isTexture(produced) ? produced : canvasToTexture(key, produced);
      this.textures.set(key, texture);
      return texture;
    }

    if (!this.missing.has(key)) {
      this.missing.add(key);
      console.warn(`[TextureStore] missing texture "${key}"`);
    }
    const placeholder = this.getPlaceholder();
    return { ...placeholder, key };
  }

  private placeholderTexture: Texture | null = null;
  private getPlaceholder(): Texture {
    if (this.placeholderTexture) return this.placeholderTexture;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#FF00FF';
    ctx.fillRect(0, 0, 32, 32);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillRect(16, 16, 16, 16);
    this.placeholderTexture = canvasToTexture('__missing__', c);
    return this.placeholderTexture;
  }

  /**
   * Load a sprite atlas and override any matching keys.
   *
   * @param jsonUrl  URL of the TexturePacker JSON-hash file.
   * @param imageUrl Optional override for the sheet path; defaults to `meta.image`
   *                 resolved relative to the JSON.
   * @param prefix   Optional prefix stripped from frame names, so a sheet that
   *                 exports `sprites/guardian/vex.png` maps onto `guardian/vex`.
   */
  async loadAtlas(jsonUrl: string, imageUrl?: string, prefix = ''): Promise<void> {
    const res = await fetch(jsonUrl);
    if (!res.ok) throw new Error(`Failed to load atlas ${jsonUrl}: ${res.status}`);
    const json = (await res.json()) as AtlasJson;

    const resolvedImage = imageUrl ?? new URL(json.meta?.image ?? 'atlas.png', new URL(jsonUrl, location.href)).href;
    const image = await loadImage(resolvedImage);

    let count = 0;
    for (const [rawName, frame] of Object.entries(json.frames)) {
      const key = normaliseFrameName(rawName, prefix);
      const sourceW = frame.sourceSize?.w ?? frame.frame.w;
      const sourceH = frame.sourceSize?.h ?? frame.frame.h;
      const pivotX = frame.pivot?.x ?? 0.5;
      const pivotY = frame.pivot?.y ?? 0.5;

      // Trimmed frames shift the anchor so the visual centre stays put.
      const offX = frame.spriteSourceSize?.x ?? 0;
      const offY = frame.spriteSourceSize?.y ?? 0;
      const ax = (pivotX * sourceW - offX) / frame.frame.w;
      const ay = (pivotY * sourceH - offY) / frame.frame.h;

      this.textures.set(key, {
        key,
        image,
        sx: frame.frame.x,
        sy: frame.frame.y,
        sw: frame.frame.w,
        sh: frame.frame.h,
        ax,
        ay,
        w: frame.frame.w,
        h: frame.frame.h,
        fromAtlas: true,
      });
      count++;
    }

    this.atlasLoaded = true;
    this.clearTints();
    console.info(`[TextureStore] atlas loaded: ${count} frames from ${jsonUrl}`);
  }

  /**
   * Try to load an atlas, falling back silently to procedural art.
   * This is what boot calls: ship without art, drop art in later, no code change.
   */
  async tryLoadAtlas(jsonUrl: string, imageUrl?: string, prefix = ''): Promise<boolean> {
    try {
      await this.loadAtlas(jsonUrl, imageUrl, prefix);
      return true;
    } catch {
      console.info('[TextureStore] no sprite atlas found — using procedural art');
      return false;
    }
  }

  /** Force-generate a set of keys, e.g. during a loading screen. */
  preload(keys: readonly string[]): void {
    for (const key of keys) this.get(key);
  }

  /** The main draw entry point. `x`/`y` is the anchor position in logical pixels. */
  draw(ctx: CanvasRenderingContext2D, key: string, x: number, y: number, opts: DrawOptions = {}): void {
    const tex = this.get(key);
    const scaleX = (opts.scaleX ?? opts.scale ?? 1) * (opts.flipX ? -1 : 1);
    const scaleY = (opts.scaleY ?? opts.scale ?? 1) * (opts.flipY ? -1 : 1);
    const w = opts.width ?? tex.w;
    const h = opts.height ?? tex.h;
    const ax = opts.ax ?? tex.ax;
    const ay = opts.ay ?? tex.ay;

    let image: CanvasImageSource = tex.image;
    let sx = tex.sx;
    let sy = tex.sy;
    const sw = tex.sw;
    const sh = tex.sh;

    if (opts.tint) {
      const tinted = this.getTinted(tex, opts.tint, opts.tintAmount ?? 1);
      image = tinted;
      sx = 0;
      sy = 0;
    }

    ctx.save();
    if (opts.composite) ctx.globalCompositeOperation = opts.composite;
    if (opts.alpha !== undefined) ctx.globalAlpha *= opts.alpha;
    ctx.translate(x, y);
    if (opts.rotation) ctx.rotate(opts.rotation);
    if (scaleX !== 1 || scaleY !== 1) ctx.scale(scaleX, scaleY);
    ctx.drawImage(image, sx, sy, sw, sh, -w * ax, -h * ay, w, h);
    ctx.restore();
  }

  /**
   * Draw a frame from a named animation.
   * `time` is seconds since the animation started.
   */
  drawAnimated(
    ctx: CanvasRenderingContext2D,
    animation: string,
    time: number,
    x: number,
    y: number,
    opts: DrawOptions = {},
  ): void {
    const key = this.frameAt(animation, time);
    if (key) this.draw(ctx, key, x, y, opts);
  }

  /** Which frame key an animation shows at `time`, or undefined once finished. */
  frameAt(animation: string, time: number): string | undefined {
    const def = this.animations.get(animation);
    if (!def || def.frames.length === 0) return undefined;
    const raw = Math.floor(time * def.fps);
    const index = def.loop ? ((raw % def.frames.length) + def.frames.length) % def.frames.length : Math.min(raw, def.frames.length - 1);
    if (!def.loop && raw >= def.frames.length) return undefined;
    return def.frames[index];
  }

  /**
   * Produce (and cache) a tinted copy of a frame.
   * Uses `source-atop` over the frame so transparency is preserved — the
   * standard Canvas2D tinting trick, cached because it is not cheap.
   */
  private getTinted(tex: Texture, tint: string, amount: number): HTMLCanvasElement {
    const colour = quantiseColour(tint);
    const step = Math.round(Math.max(0, Math.min(1, amount)) * 16) / 16;
    const cacheKey = `${tex.key}|${colour}|${step}`;
    const cached = this.tintCache.get(cacheKey);
    if (cached) {
      // Refresh insertion order so eviction is least-recently-used.
      this.tintCache.delete(cacheKey);
      this.tintCache.set(cacheKey, cached);
      return cached;
    }

    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(tex.sw));
    c.height = Math.max(1, Math.ceil(tex.sh));
    const ctx = c.getContext('2d')!;
    ctx.drawImage(tex.image, tex.sx, tex.sy, tex.sw, tex.sh, 0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = step;
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, c.width, c.height);

    const pixels = c.width * c.height;
    this.tintCache.set(cacheKey, c);
    this.tintPixels += pixels;

    while (this.tintPixels > TINT_PIXEL_BUDGET && this.tintCache.size > 1) {
      const oldestKey = this.tintCache.keys().next().value;
      if (oldestKey === undefined || oldestKey === cacheKey) break;
      const oldest = this.tintCache.get(oldestKey)!;
      this.tintPixels -= oldest.width * oldest.height;
      this.tintCache.delete(oldestKey);
    }
    return c;
  }

  /** Drop generated textures, e.g. after a quality change that alters resolution. */
  invalidate(predicate?: (key: string) => boolean): void {
    if (!predicate) {
      for (const [key, tex] of this.textures) if (!tex.fromAtlas) this.textures.delete(key);
      this.clearTints();
      return;
    }
    for (const [key, tex] of this.textures) {
      if (!tex.fromAtlas && predicate(key)) this.textures.delete(key);
    }
    this.clearTints();
  }

  private clearTints(): void {
    this.tintCache.clear();
    this.tintPixels = 0;
  }

  get stats(): {
    generated: number;
    generators: number;
    animations: number;
    tints: number;
    tintMegapixels: number;
    atlas: boolean;
  } {
    return {
      generated: this.textures.size,
      generators: this.generators.size,
      animations: this.animations.size,
      tints: this.tintCache.size,
      tintMegapixels: Math.round((this.tintPixels / 1_000_000) * 100) / 100,
      atlas: this.atlasLoaded,
    };
  }
}

function isTexture(value: HTMLCanvasElement | Texture): value is Texture {
  return (value as Texture).sw !== undefined;
}

/** Wrap a whole canvas as a centred texture. */
export function canvasToTexture(key: string, canvas: HTMLCanvasElement, ax = 0.5, ay = 0.5): Texture {
  return {
    key,
    image: canvas,
    sx: 0,
    sy: 0,
    sw: canvas.width,
    sh: canvas.height,
    ax,
    ay,
    w: canvas.width,
    h: canvas.height,
    fromAtlas: false,
  };
}

/** Round each channel to a coarser grid so near-identical tints share a key. */
function quantiseColour(hex: string): string {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return hex;
  const q = (v: number): number => Math.min(255, Math.round(v / TINT_QUANTISE) * TINT_QUANTISE);
  const r = q((n >> 16) & 255);
  const g = q((n >> 8) & 255);
  const b = q(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function normaliseFrameName(name: string, prefix: string): string {
  let key = name;
  if (prefix && key.startsWith(prefix)) key = key.slice(prefix.length);
  key = key.replace(/\.(png|webp|jpg|jpeg)$/i, '');
  return key.replace(/^\/+/, '');
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image ${url}`));
    img.src = url;
  });
}

/** The single shared store. */
export const textures = new TextureStore();
