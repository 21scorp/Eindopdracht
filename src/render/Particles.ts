/**
 * Pooled particle system.
 *
 * Particles are plain structs in a fixed-size pool — no allocation during play,
 * which matters because the moments that spawn the most particles are exactly
 * the moments where a GC pause would be felt.
 *
 * Every particle is a textured quad drawn additively, so the bloom pass picks
 * them up for free. Real sprite sheets can replace the texture keys with no
 * change here.
 */

import { clamp01, TAU } from '../core/math';
import { fxRng } from '../core/Rng';
import type { Renderer } from './Renderer';
import type { TextureStore } from './TextureStore';

export interface ParticleSpec {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** Multiplied into velocity each second: 0.1 = heavy drag, 1 = none. */
  drag?: number;
  /** Pulled toward this point each second, at `gravityStrength` px/s^2. */
  gravityX?: number;
  gravityY?: number;
  gravityStrength?: number;
  life: number;
  size: number;
  /** Size multiplier at end of life. */
  endSize?: number;
  rotation?: number;
  spin?: number;
  texture: string;
  tint?: string;
  alpha?: number;
  /** Alpha multiplier at end of life. */
  endAlpha?: number;
  /** Stretch along the direction of travel; 1 = round, 3 = long streak. */
  stretch?: number;
  additive?: boolean;
  /** How strongly this feeds the bloom buffer. */
  glow?: number;
  /** Layer: particles with `behind = true` draw under gameplay entities. */
  behind?: boolean;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  drag: number;
  gx: number;
  gy: number;
  gs: number;
  age: number;
  life: number;
  size: number;
  endSize: number;
  rotation: number;
  spin: number;
  texture: string;
  tint: string | null;
  alpha: number;
  endAlpha: number;
  stretch: number;
  additive: boolean;
  glow: number;
  behind: boolean;
}

const DEFAULT_CAPACITY = 1400;

export class ParticleSystem {
  private pool: Particle[] = [];
  private cursor = 0;
  private liveCount = 0;

  constructor(
    private readonly textures: TextureStore,
    capacity = DEFAULT_CAPACITY,
  ) {
    for (let i = 0; i < capacity; i++) this.pool.push(makeParticle());
  }

  get count(): number {
    return this.liveCount;
  }

  get capacity(): number {
    return this.pool.length;
  }

  /**
   * Emit one particle. When the pool is exhausted the oldest slot is recycled,
   * which degrades gracefully instead of dropping the newest (and usually most
   * important) effect.
   */
  emit(spec: ParticleSpec): void {
    const p = this.acquire();
    p.active = true;
    p.x = spec.x;
    p.y = spec.y;
    p.vx = spec.vx ?? 0;
    p.vy = spec.vy ?? 0;
    p.drag = spec.drag ?? 1;
    p.gx = spec.gravityX ?? 0;
    p.gy = spec.gravityY ?? 0;
    p.gs = spec.gravityStrength ?? 0;
    p.age = 0;
    p.life = Math.max(0.016, spec.life);
    p.size = spec.size;
    p.endSize = spec.endSize ?? 0;
    p.rotation = spec.rotation ?? 0;
    p.spin = spec.spin ?? 0;
    p.texture = spec.texture;
    p.tint = spec.tint ?? null;
    p.alpha = spec.alpha ?? 1;
    p.endAlpha = spec.endAlpha ?? 0;
    p.stretch = spec.stretch ?? 1;
    p.additive = spec.additive ?? true;
    p.glow = spec.glow ?? 1;
    p.behind = spec.behind ?? false;
  }

  /** Radial burst — the most common emitter shape in the game. */
  burst(
    x: number,
    y: number,
    count: number,
    opts: Omit<ParticleSpec, 'x' | 'y' | 'vx' | 'vy'> & {
      speed?: number;
      speedVariance?: number;
      angle?: number;
      spread?: number;
      lifeVariance?: number;
      sizeVariance?: number;
    },
  ): void {
    const speed = opts.speed ?? 200;
    const speedVar = opts.speedVariance ?? 0.5;
    const baseAngle = opts.angle ?? 0;
    const spread = opts.spread ?? TAU;
    const lifeVar = opts.lifeVariance ?? 0.3;
    const sizeVar = opts.sizeVariance ?? 0.35;

    for (let i = 0; i < count; i++) {
      const a = baseAngle + (spread >= TAU ? fxRng.angle() : fxRng.signedRange(spread / 2));
      const s = speed * (1 + fxRng.signedRange(speedVar));
      this.emit({
        ...opts,
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        rotation: opts.rotation ?? a,
        life: opts.life * (1 + fxRng.signedRange(lifeVar)),
        size: opts.size * (1 + fxRng.signedRange(sizeVar)),
      });
    }
  }

  private acquire(): Particle {
    const pool = this.pool;
    for (let i = 0; i < pool.length; i++) {
      const idx = (this.cursor + i) % pool.length;
      const p = pool[idx]!;
      if (!p.active) {
        this.cursor = (idx + 1) % pool.length;
        this.liveCount++;
        return p;
      }
    }
    // Full: steal the slot at the cursor.
    const p = pool[this.cursor]!;
    this.cursor = (this.cursor + 1) % pool.length;
    return p;
  }

  update(dt: number): void {
    let live = 0;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        continue;
      }
      if (p.gs !== 0) {
        const dx = p.gx - p.x;
        const dy = p.gy - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * p.gs * dt;
        p.vy += (dy / d) * p.gs * dt;
      }
      if (p.drag !== 1) {
        const f = Math.pow(p.drag, dt);
        p.vx *= f;
        p.vy *= f;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.spin * dt;
      live++;
    }
    this.liveCount = live;
  }

  /** Draw one layer. Call with `behind = true` before entities, false after. */
  draw(renderer: Renderer, behind: boolean): void {
    const { ctx } = renderer;
    ctx.save();
    for (const p of this.pool) {
      if (!p.active || p.behind !== behind) continue;
      const t = clamp01(p.age / p.life);
      const size = p.size * (1 + (p.endSize - 1) * t);
      if (size <= 0.2) continue;
      const a = p.alpha + (p.endAlpha - p.alpha) * t;
      if (a <= 0.004) continue;

      const rot = p.stretch > 1 && (p.vx !== 0 || p.vy !== 0) ? Math.atan2(p.vy, p.vx) : p.rotation;
      const sx = p.stretch > 1 ? size * p.stretch : size;

      renderer.emissive(
        (c) => {
          c.save();
          c.globalCompositeOperation = p.additive ? 'lighter' : 'source-over';
          c.globalAlpha *= a;
          c.translate(p.x, p.y);
          c.rotate(rot);
          const tex = this.textures.get(p.texture);
          const opts = p.tint ? { tint: p.tint } : undefined;
          if (opts) {
            this.textures.draw(c, p.texture, 0, 0, { width: sx, height: size, tint: p.tint! });
          } else {
            c.drawImage(tex.image, tex.sx, tex.sy, tex.sw, tex.sh, -sx * tex.ax, -size * tex.ay, sx, size);
          }
          c.restore();
        },
        p.glow,
      );
    }
    ctx.restore();
  }

  clear(): void {
    for (const p of this.pool) p.active = false;
    this.liveCount = 0;
  }
}

function makeParticle(): Particle {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    drag: 1,
    gx: 0,
    gy: 0,
    gs: 0,
    age: 0,
    life: 1,
    size: 1,
    endSize: 0,
    rotation: 0,
    spin: 0,
    texture: 'fx/spark',
    tint: null,
    alpha: 1,
    endAlpha: 0,
    stretch: 1,
    additive: true,
    glow: 1,
    behind: false,
  };
}
