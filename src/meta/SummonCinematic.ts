/**
 * The summon.
 *
 * This is the clip people post, so it is built around one idea: *anticipation
 * that pays off*. The sequence tells you what you got before it shows you, and
 * it takes its time doing it.
 *
 *   CHARGE   motes spiral in, the core brightens, the world darkens
 *   HOLD     everything stops. Silence. The longest beat in the game.
 *   TELL     a ring cracks outward in the rarity's colour — this is the reveal
 *   BURST    shockwaves, starburst, screen flash, chromatic split
 *   SETTLE   the light fades and hands off to the card reveal
 *
 * Higher rarities get a longer hold and a second burst. That escalation is the
 * whole reason a pull is watchable — a mythic must be recognisable from the
 * first frame of the tell, and unmistakable by the end.
 */

import { TAU, clamp01, lerp } from '../core/math';
import { fxRng } from '../core/Rng';
import { backOut, expoOut, quadIn, quadOut } from '../core/easing';
import type { Camera } from '../render/Camera';
import type { ParticleSystem } from '../render/Particles';
import type { Renderer } from '../render/Renderer';
import { COLORS, RARITY_STYLE, alpha, lighten, prismatic, type Rarity } from '../render/palette';
import type { TextureStore } from '../render/TextureStore';

type Stage = 'charge' | 'hold' | 'tell' | 'burst' | 'settle' | 'done';

interface Mote {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  hue: number;
  spin: number;
}

export interface SummonOptions {
  /** Highest rarity in the batch — drives the whole escalation. */
  topRarity: Rarity;
  /** How many Guardians are in this pull (1 or 10). */
  count: number;
  /** True when the batch contains the banner's featured Guardian. */
  featured: boolean;
  /** Called once the spectacle is over and the cards should appear. */
  onComplete: () => void;
  /** Called the moment the rarity tell fires, so audio can hit it exactly. */
  onTell?: (rarity: Rarity) => void;
}

export class SummonCinematic {
  done = false;

  private stage: Stage = 'charge';
  private t = 0;
  private total = 0;
  private motes: Mote[] = [];
  private tellFired = false;
  private completed = false;
  private shockwaves: Array<{ age: number; life: number; color: string; scale: number }> = [];

  private readonly drama: number;
  private readonly color: string;
  private readonly accent: string;
  private readonly prismaticTier: boolean;

  /** Stage durations in seconds, scaled by drama. */
  private readonly d: Record<Exclude<Stage, 'done'>, number>;

  constructor(
    private readonly renderer: Renderer,
    private readonly textures: TextureStore,
    private readonly particles: ParticleSystem,
    private readonly camera: Camera,
    private readonly opts: SummonOptions,
  ) {
    const style = RARITY_STYLE[opts.topRarity];
    this.drama = style.drama;
    this.color = style.color;
    this.accent = style.accent;
    this.prismaticTier = style.prismatic;

    this.d = {
      charge: 1.0 + this.drama * 0.55,
      // The hold is where the tension lives. A common pull barely pauses; a
      // mythic hangs for most of a second and the silence does the work.
      hold: 0.14 + this.drama * 0.72,
      tell: 0.34 + this.drama * 0.2,
      burst: 0.45 + this.drama * 0.35,
      settle: 0.4 + this.drama * 0.3,
    };

    this.spawnMotes();
  }

  private spawnMotes(): void {
    const n = Math.round(46 + this.drama * 70 + this.opts.count * 1.5);
    for (let i = 0; i < n; i++) {
      this.motes.push({
        angle: fxRng.angle(),
        radius: fxRng.range(0.55, 1.35),
        speed: fxRng.range(0.55, 1.5),
        size: fxRng.range(0.4, 1.6),
        hue: fxRng.next(),
        spin: fxRng.signedRange(1.6),
      });
    }
  }

  private get cx(): number {
    return this.renderer.view.cx;
  }
  private get cy(): number {
    return this.renderer.view.cy;
  }
  private get unit(): number {
    return this.renderer.view.minSide;
  }

  /** Current colour, animated for the prismatic (mythic) tier. */
  private hue(offset = 0): string {
    return this.prismaticTier ? prismatic(this.total * 1.4, offset) : this.color;
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    if (this.done) return;
    this.t += dt;
    this.total += dt;

    switch (this.stage) {
      case 'charge':
        this.updateCharge(dt);
        if (this.t >= this.d.charge) this.advance('hold');
        break;
      case 'hold':
        this.updateHold();
        if (this.t >= this.d.hold) this.advance('tell');
        break;
      case 'tell':
        this.updateTell(dt);
        if (this.t >= this.d.tell) this.advance('burst');
        break;
      case 'burst':
        if (this.t >= this.d.burst) this.advance('settle');
        break;
      case 'settle':
        if (this.t >= this.d.settle) {
          this.stage = 'done';
          this.done = true;
          this.complete();
        }
        break;
      case 'done':
        break;
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const w = this.shockwaves[i]!;
      w.age += dt;
      if (w.age >= w.life) this.shockwaves.splice(i, 1);
    }

    this.particles.update(dt);
  }

  private advance(next: Stage): void {
    this.stage = next;
    this.t = 0;
    if (next === 'tell') this.onTell();
    if (next === 'burst') this.onBurst();
  }

  private updateCharge(dt: number): void {
    const p = clamp01(this.t / this.d.charge);
    // Motes accelerate inward; the pull-in is what builds the pressure.
    for (const m of this.motes) {
      m.radius -= dt * m.speed * (0.35 + quadIn(p) * 1.5);
      m.angle += m.spin * dt * (0.4 + p * 2.4);
      if (m.radius < 0.04) {
        m.radius = fxRng.range(1.05, 1.5);
        m.angle = fxRng.angle();
      }
    }

    // The camera creeps in and the rumble builds.
    this.camera.setZoom(lerp(1, 1.06 + this.drama * 0.05, quadIn(p)));
    if (fxRng.next() < dt * (2 + this.drama * 6)) this.camera.addTrauma(0.04 + this.drama * 0.05);

    // Sparks fly off the core as it saturates.
    if (fxRng.next() < dt * (14 + this.drama * 40) * p) {
      const a = fxRng.angle();
      const r = this.unit * 0.06 * (0.6 + p);
      this.particles.emit({
        x: this.cx + Math.cos(a) * r,
        y: this.cy + Math.sin(a) * r,
        vx: Math.cos(a) * this.unit * fxRng.range(0.1, 0.4),
        vy: Math.sin(a) * this.unit * fxRng.range(0.1, 0.4),
        texture: 'fx/spark',
        tint: this.hue(m0(a)),
        life: fxRng.range(0.3, 0.7),
        size: this.unit * fxRng.range(0.006, 0.016),
        endSize: 0.05,
        drag: 0.1,
        stretch: 2.4,
        glow: 1.2,
      });
    }
  }

  private updateHold(): void {
    // Absolute stillness. Nothing moves, nothing spawns.
    this.camera.setZoom(1.06 + this.drama * 0.05);
  }

  private updateTell(dt: number): void {
    const p = clamp01(this.t / this.d.tell);
    this.camera.setZoom(lerp(1.06 + this.drama * 0.05, 0.94, expoOut(p)));
    if (fxRng.next() < dt * 40 * (0.4 + this.drama)) {
      const a = fxRng.angle();
      const r = this.unit * lerp(0.05, 0.62, p);
      this.particles.emit({
        x: this.cx + Math.cos(a) * r,
        y: this.cy + Math.sin(a) * r,
        vx: Math.cos(a) * this.unit * 0.9,
        vy: Math.sin(a) * this.unit * 0.9,
        texture: 'fx/spark',
        tint: this.hue(m0(a)),
        life: fxRng.range(0.4, 0.9),
        size: this.unit * fxRng.range(0.008, 0.02),
        endSize: 0.05,
        drag: 0.08,
        stretch: 3.4,
        glow: 1.5,
      });
    }
  }

  private onTell(): void {
    this.tellFired = true;
    this.opts.onTell?.(this.opts.topRarity);
    this.camera.addTrauma(0.2 + this.drama * 0.3);
    this.camera.addAberration(0.5 + this.drama * 0.5);
    this.shockwaves.push({ age: 0, life: 0.55, color: this.hue(), scale: 1 });
    this.renderer.flash = 0.2 + this.drama * 0.25;
    this.renderer.flashColor = this.color;
  }

  private onBurst(): void {
    this.camera.addTrauma(0.45 + this.drama * 0.5);
    this.camera.punch(1.2 + this.drama * 1.4);
    this.camera.addAberration(0.8 + this.drama * 0.2);
    this.renderer.flash = 0.45 + this.drama * 0.5;
    this.renderer.flashColor = this.drama >= 0.8 ? '#FFFFFF' : this.color;

    const waves = 1 + Math.round(this.drama * 3);
    for (let i = 0; i < waves; i++) {
      this.shockwaves.push({ age: -i * 0.09, life: 0.8, color: i === 0 ? '#FFFFFF' : this.hue(i * 0.3), scale: 1 + i * 0.35 });
    }

    // Radial spray. Count scales hard with rarity so the screen reads as
    // "something enormous happened" without any text.
    const count = Math.round(60 + this.drama * 160);
    this.particles.burst(this.cx, this.cy, count, {
      texture: 'fx/spark',
      tint: this.color,
      life: 1.4,
      size: this.unit * 0.018,
      endSize: 0.04,
      speed: this.unit * 1.5,
      speedVariance: 0.7,
      drag: 0.05,
      stretch: 3.8,
      glow: 1.4,
    });

    if (this.drama >= 0.55) {
      this.particles.burst(this.cx, this.cy, Math.round(14 + this.drama * 26), {
        texture: 'fx/shard',
        tint: this.accent,
        life: 2,
        size: this.unit * 0.03,
        endSize: 0.2,
        speed: this.unit * 0.7,
        drag: 0.1,
        spin: 6,
        glow: 1.1,
      });
    }

    this.particles.emit({
      x: this.cx,
      y: this.cy,
      texture: this.drama >= 0.85 ? 'fx/starburst-mythic' : this.drama >= 0.6 ? 'fx/starburst-legendary' : 'fx/starburst',
      tint: this.drama >= 0.6 ? undefined : this.color,
      life: 1.1,
      size: this.unit * 0.4,
      endSize: 3.2,
      alpha: 1,
      endAlpha: 0,
      rotation: fxRng.angle(),
      spin: 0.4,
      glow: 1.8,
    });
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    this.camera.setZoom(1);
    this.opts.onComplete();
  }

  /** Let the player skip straight to the cards. */
  skip(): void {
    if (this.done) return;
    if (!this.tellFired) this.onTell();
    this.onBurst();
    this.stage = 'done';
    this.done = true;
    this.complete();
  }

  // -------------------------------------------------------------------- draw

  draw(): void {
    const { ctx, view } = this.renderer;
    const cx = this.cx;
    const cy = this.cy;

    // Backdrop: darker than the arena, and it darkens further as we charge.
    const chargeP = this.stage === 'charge' ? clamp01(this.t / this.d.charge) : 1;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(view.width, view.height) * 0.8);
    g.addColorStop(0, alpha(this.hue(), 0.1 + chargeP * 0.14));
    g.addColorStop(0.4, '#05070F');
    g.addColorStop(1, '#020308');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.width, view.height);

    this.drawRunicRings(chargeP);
    if (this.stage === 'charge' || this.stage === 'hold') this.drawMotes(chargeP);
    this.drawCore();
    this.drawShockwaves();
    this.particles.draw(this.renderer, false);
    this.drawLetterbox();
  }

  /** Two counter-rotating rings that tighten as the charge builds. */
  private drawRunicRings(p: number): void {
    const { ctx } = this.renderer;
    const base = this.unit * 0.42;
    ctx.save();
    ctx.translate(this.cx, this.cy);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < 3; i++) {
      const shrink = this.stage === 'charge' ? lerp(1.35, 0.62, quadOut(p)) : 0.62;
      const r = base * shrink * (0.7 + i * 0.28);
      const rot = this.total * (i % 2 === 0 ? 0.55 : -0.42) + i;
      const a = (0.12 + this.drama * 0.16) * (this.stage === 'charge' ? 0.3 + p * 0.7 : 1);

      ctx.save();
      ctx.rotate(rot);
      ctx.strokeStyle = alpha(this.hue(i * 0.2), a);
      ctx.lineWidth = this.unit * 0.0035;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();

      // Tick marks around each ring.
      const ticks = 12 + i * 6;
      ctx.strokeStyle = alpha(lighten(this.hue(i * 0.2), 0.4), a * 1.7);
      ctx.lineWidth = this.unit * 0.005;
      for (let k = 0; k < ticks; k++) {
        const ang = (k / ticks) * TAU;
        const len = this.unit * 0.014;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * (r - len), Math.sin(ang) * (r - len));
        ctx.lineTo(Math.cos(ang) * (r + len), Math.sin(ang) * (r + len));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  private drawMotes(p: number): void {
    const { ctx } = this.renderer;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const m of this.motes) {
      const r = m.radius * this.unit * 0.55;
      const x = this.cx + Math.cos(m.angle) * r;
      const y = this.cy + Math.sin(m.angle) * r;
      const size = this.unit * 0.007 * m.size * (0.6 + p * 0.9);
      const a = clamp01(1 - m.radius / 1.5) * (0.35 + p * 0.65);
      this.textures.draw(ctx, 'fx/spark', x, y, {
        width: size * 4,
        height: size * 4,
        tint: this.hue(m.hue),
        alpha: a,
      });
    }
    ctx.restore();
  }

  private drawCore(): void {
    const { renderer } = this;
    let radius = this.unit * 0.055;
    let intensity = 1;

    if (this.stage === 'charge') {
      const p = clamp01(this.t / this.d.charge);
      radius *= 0.5 + quadIn(p) * 1.1;
      intensity = 0.5 + p * 1.4;
    } else if (this.stage === 'hold') {
      // A tight tremble, nothing more. Restraint here makes the burst land.
      radius *= 1.6 + Math.sin(this.total * 60) * 0.02;
      intensity = 2;
    } else if (this.stage === 'tell') {
      const p = clamp01(this.t / this.d.tell);
      radius *= lerp(1.6, 0.2, expoOut(p));
      intensity = lerp(2.4, 0.4, p);
    } else {
      const p = clamp01(this.t / (this.stage === 'burst' ? this.d.burst : this.d.settle));
      radius *= lerp(0.2, 0.02, p);
      intensity = lerp(1.2, 0, p);
    }

    if (intensity <= 0.01) return;
    const size = radius * 6;

    renderer.emissive(
      (c) => {
        c.save();
        c.globalCompositeOperation = 'lighter';
        this.textures.draw(c, 'fx/glow', this.cx, this.cy, {
          width: size,
          height: size,
          tint: this.hue(),
          alpha: clamp01(intensity * 0.55),
        });
        this.textures.draw(c, 'fx/glow', this.cx, this.cy, {
          width: size * 0.42,
          height: size * 0.42,
          alpha: clamp01(intensity * 0.9),
        });
        c.restore();
      },
      1.6,
    );
  }

  private drawShockwaves(): void {
    const { renderer } = this;
    for (const w of this.shockwaves) {
      if (w.age < 0) continue;
      const p = clamp01(w.age / w.life);
      const size = this.unit * lerp(0.1, 3.1, expoOut(p)) * w.scale;
      const a = (1 - p) * (1 - p);
      renderer.emissive(
        (c) => {
          c.save();
          c.globalCompositeOperation = 'lighter';
          this.textures.draw(c, 'fx/ring', this.cx, this.cy, {
            width: size,
            height: size,
            tint: w.color,
            alpha: a,
          });
          c.restore();
        },
        1.5 * a,
      );
    }
  }

  /** Cinematic bars. They frame the moment and mark it as *not gameplay*. */
  private drawLetterbox(): void {
    const { ctx, view } = this.renderer;
    const target = this.stage === 'settle' ? 1 - clamp01(this.t / this.d.settle) : 1;
    const grow = this.stage === 'charge' ? backOut(clamp01(this.t / 0.5)) : 1;
    const h = view.height * 0.055 * grow * target;
    if (h <= 0.5) return;
    ctx.save();
    ctx.fillStyle = '#04050B';
    ctx.fillRect(0, 0, view.width, h);
    ctx.fillRect(0, view.height - h, view.width, h);
    ctx.fillStyle = alpha(this.hue(), 0.35);
    ctx.fillRect(0, h - 1, view.width, 1);
    ctx.fillRect(0, view.height - h, view.width, 1);
    ctx.restore();
  }
}

/** Map an angle to 0..1 so per-particle hues vary smoothly around the circle. */
function m0(angle: number): number {
  return ((angle % TAU) + TAU) % TAU / TAU;
}

export { COLORS };
