/**
 * Game feel.
 *
 * This module is the entire reason a block feels different from a parry. It
 * subscribes to gameplay events and answers each one with particles, camera
 * response and floating text. Nothing here changes the simulation — pull the
 * whole file out and the game still plays identically, it just feels dead.
 *
 * The budget rule: a common event (block) gets a small, cheap response. A rare
 * event (perfect pulse on a cluster, boss kill) gets everything. If every event
 * shakes the screen, none of them land.
 */

import { TAU, clamp01 } from '../core/math';
import { fxRng } from '../core/Rng';
import { FEEL } from '../data/balance';
import type { Camera } from '../render/Camera';
import type { ParticleSystem } from '../render/Particles';
import type { Renderer } from '../render/Renderer';
import { COLORS, alpha, lighten } from '../render/palette';
import type { GameSession } from './GameSession';
import type { GameEvents } from './events';
import { threatColor } from './GameRenderer';

export type TextStyle = 'score' | 'label' | 'banner' | 'warning';

interface FloatingText {
  active: boolean;
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  style: TextStyle;
  rotation: number;
}

const TEXT_POOL_SIZE = 48;

export class Vfx {
  private texts: FloatingText[] = [];
  private disposers: Array<() => void> = [];
  private time = 0;

  /** A short-lived big banner in the middle of the screen ("WAVE 7", "OVERDRIVE"). */
  private banner = { text: '', sub: '', age: 0, life: 0, color: COLORS.aegis };

  constructor(
    private readonly session: GameSession,
    private readonly particles: ParticleSystem,
    private readonly camera: Camera,
    private readonly renderer: Renderer,
  ) {
    for (let i = 0; i < TEXT_POOL_SIZE; i++) {
      this.texts.push({
        active: false,
        text: '',
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        age: 0,
        life: 1,
        size: 16,
        color: '#FFFFFF',
        style: 'score',
        rotation: 0,
      });
    }
    this.subscribe();
  }

  private on<K extends keyof GameEvents>(event: K, listener: (payload: GameEvents[K]) => void): void {
    this.disposers.push(this.session.events.on(event, listener));
  }

  private subscribe(): void {
    const on = <K extends keyof GameEvents>(event: K, listener: (payload: GameEvents[K]) => void): void =>
      this.on(event, listener);

    on('hit', (e) => this.onHit(e.quality, e.x, e.y, e.angle, e.score, e.threat.size, e.multiplier));
    on('threatKilled', (e) => this.onKilled(e.x, e.y, e.threat.size, threatColor(e.threat), e.byUltimate));
    on('damage', (e) => this.onDamage(e.x, e.y, e.fatal));
    on('comboBreak', (e) => {
      if (e.combo >= 12) this.spawnText('COMBO LOST', this.cx, this.cy - this.unit * 0.22, COLORS.threat, 'warning');
    });
    on('overdriveStart', () => this.onOverdrive());
    on('pulse', (e) => this.onPulse(e.success, e.caught));
    on('waveStart', (e) => this.onWaveStart(e.wave, e.boss));
    on('waveClear', (e) => this.onWaveClear(e.wave, e.bonus));
    on('bossSpawn', () => this.showBanner('WARDEN', 'incoming', COLORS.mythic, 2.2));
    on('bossKilled', (e) => this.onBossKilled(e.x, e.y));
    on('ultimateReady', () => this.showBanner('ULTIMATE READY', 'two-finger tap', COLORS.ultimate, 1.4));
    on('ultimateFired', () => this.onUltimate());
    on('lastStand', () => this.showBanner('LAST STAND', 'one hit left', COLORS.threat, 1.8));
    on('comboMilestone', (e) => {
      if (e.multiplier >= 3) {
        this.spawnText(`x${e.multiplier.toFixed(1)}`, this.cx, this.cy - this.unit * 0.16, COLORS.overdrive, 'label');
      }
    });
  }

  private get cx(): number {
    return this.session.arena.cx;
  }
  private get cy(): number {
    return this.session.arena.cy;
  }
  private get unit(): number {
    return this.session.arena.unit;
  }

  // ------------------------------------------------------------------ events

  private onHit(
    quality: 'block' | 'perfect' | 'parry' | 'chain',
    x: number,
    y: number,
    angle: number,
    score: number,
    size: number,
    multiplier: number,
  ): void {
    const outward = angle;

    switch (quality) {
      case 'block': {
        this.particles.burst(x, y, 5, {
          texture: 'fx/spark-aegis',
          life: 0.26,
          size: size * 0.9,
          endSize: 0.1,
          speed: size * 11,
          angle: outward,
          spread: 1.5,
          drag: 0.02,
          stretch: 2.2,
        });
        this.camera.addTrauma(FEEL.traumaBlock);
        this.camera.freeze(FEEL.hitstopBlock);
        break;
      }
      case 'perfect': {
        this.particles.burst(x, y, 11, {
          texture: 'fx/spark-parry',
          life: 0.34,
          size: size * 1.1,
          endSize: 0.08,
          speed: size * 15,
          angle: outward,
          spread: 1.9,
          drag: 0.02,
          stretch: 2.6,
        });
        this.ringFlash(x, y, size * 5.5, COLORS.aegis, 0.3);
        this.camera.addTrauma(FEEL.traumaPerfect);
        this.camera.punch(FEEL.punchPerfect);
        this.camera.freeze(FEEL.hitstopPerfect);
        this.spawnText('PERFECT', x, y, COLORS.parry, 'label');
        break;
      }
      case 'parry': {
        this.particles.burst(x, y, 18, {
          texture: 'fx/spark-parry',
          life: 0.45,
          size: size * 1.3,
          endSize: 0.06,
          speed: size * 20,
          angle: outward,
          spread: 2.4,
          drag: 0.015,
          stretch: 3,
        });
        this.particles.burst(x, y, 6, {
          texture: 'fx/shard',
          life: 0.7,
          size: size * 0.8,
          endSize: 0.2,
          speed: size * 9,
          drag: 0.08,
          spin: 8,
        });
        this.starburst(x, y, size * 9, COLORS.parry);
        this.ringFlash(x, y, size * 8, COLORS.parry, 0.42);
        this.camera.addTrauma(FEEL.traumaParry);
        this.camera.punch(FEEL.punchParry);
        this.camera.freeze(FEEL.hitstopParry);
        this.camera.addAberration(0.5);
        this.renderer.flash = Math.max(this.renderer.flash, 0.16);
        this.renderer.flashColor = COLORS.parry;
        this.spawnText('PARRY', x, y, COLORS.parry, 'label');
        break;
      }
      case 'chain': {
        this.particles.burst(x, y, 8, {
          texture: 'fx/spark',
          life: 0.3,
          size: size * 0.9,
          endSize: 0.1,
          speed: size * 13,
          drag: 0.03,
          stretch: 2,
          tint: COLORS.overdrive,
        });
        this.camera.addTrauma(FEEL.traumaBlock * 0.8);
        this.spawnText('CHAIN', x, y, COLORS.overdrive, 'label');
        break;
      }
    }

    if (score >= 1) {
      const bright = multiplier >= 3;
      this.spawnText(
        `+${Math.round(score)}`,
        x + fxRng.signedRange(size * 0.6),
        y - size * 0.9,
        bright ? COLORS.overdrive : '#DDE9FF',
        'score',
      );
    }
  }

  private onKilled(x: number, y: number, size: number, color: string, byUltimate: boolean): void {
    this.particles.burst(x, y, byUltimate ? 14 : 9, {
      texture: 'fx/spark',
      tint: color,
      life: 0.4,
      size: size * 1.1,
      endSize: 0.05,
      speed: size * 12,
      drag: 0.04,
      stretch: 1.8,
    });
    this.particles.burst(x, y, 3, {
      texture: 'fx/smoke',
      life: 0.75,
      size: size * 1.6,
      endSize: 2.4,
      speed: size * 2.2,
      alpha: 0.28,
      endAlpha: 0,
      drag: 0.1,
      additive: false,
      behind: true,
      glow: 0.2,
    });
  }

  private onDamage(x: number, y: number, fatal: boolean): void {
    this.camera.addTrauma(fatal ? 0.85 : FEEL.traumaDamage);
    this.camera.punch(FEEL.punchDamage);
    this.camera.freeze(FEEL.hitstopDamage);
    this.camera.addAberration(0.85);
    this.renderer.flash = Math.max(this.renderer.flash, fatal ? 0.5 : 0.26);
    this.renderer.flashColor = COLORS.threat;

    this.particles.burst(x, y, 22, {
      texture: 'fx/spark-threat',
      life: 0.6,
      size: this.unit * 0.02,
      endSize: 0.05,
      speed: this.unit * 0.55,
      drag: 0.05,
      stretch: 2.4,
    });
    // A shockwave off the nexus itself, so the damage reads as *the core* being hit.
    this.ringFlash(this.cx, this.cy, this.unit * 0.5, COLORS.threat, 0.6);
    if (!fatal) this.spawnText('INTEGRITY', this.cx, this.cy + this.unit * 0.1, COLORS.threat, 'warning');
  }

  private onPulse(success: boolean, caught: number): void {
    if (!success) return;
    this.camera.addTrauma(0.06 + Math.min(0.2, caught * 0.03));
    if (caught >= 4) {
      this.showBanner(`${caught}x PARRY`, 'clean sweep', COLORS.parry, 1.2);
      this.camera.punch(0.7);
      this.renderer.flash = Math.max(this.renderer.flash, 0.22);
      this.renderer.flashColor = COLORS.parry;
    }
  }

  private onOverdrive(): void {
    this.showBanner('OVERDRIVE', 'double score', COLORS.overdrive, 1.8);
    this.camera.punch(1.1);
    this.camera.addTrauma(0.32);
    this.renderer.flash = Math.max(this.renderer.flash, 0.3);
    this.renderer.flashColor = COLORS.overdrive;
    this.ringFlash(this.cx, this.cy, this.unit * 1.3, COLORS.overdrive, 0.9);
    this.particles.burst(this.cx, this.cy, 40, {
      texture: 'fx/spark',
      tint: COLORS.overdrive,
      life: 0.9,
      size: this.unit * 0.016,
      endSize: 0.05,
      speed: this.unit * 0.75,
      drag: 0.06,
      stretch: 3,
    });
  }

  private onUltimate(): void {
    this.camera.addTrauma(FEEL.traumaUltimate);
    this.camera.punch(FEEL.punchUltimate);
    this.camera.freeze(0.09);
    this.camera.addAberration(0.9);
    this.renderer.flash = Math.max(this.renderer.flash, 0.45);
    this.renderer.flashColor = COLORS.ultimate;
    this.ringFlash(this.cx, this.cy, this.unit * 1.8, COLORS.ultimate, 1);
    this.showBanner(this.session.guardian.ultimate.toUpperCase(), this.session.guardian.name, COLORS.ultimate, 1.5);
    this.particles.burst(this.cx, this.cy, 54, {
      texture: 'fx/spark',
      tint: COLORS.ultimate,
      life: 1.1,
      size: this.unit * 0.018,
      endSize: 0.05,
      speed: this.unit * 1.05,
      drag: 0.05,
      stretch: 3.4,
    });
  }

  private onWaveStart(wave: number, boss: boolean): void {
    if (boss) return; // the boss banner is louder and fires separately
    this.showBanner(`WAVE ${wave}`, '', this.overdriveColor(), 1.1);
  }

  private onWaveClear(wave: number, bonus: number): void {
    this.spawnText(`WAVE ${wave} CLEAR  +${Math.round(bonus)}`, this.cx, this.cy + this.unit * 0.17, COLORS.heal, 'label');
    this.particles.burst(this.cx, this.cy, 22, {
      texture: 'fx/spark-aegis',
      life: 0.8,
      size: this.unit * 0.012,
      endSize: 0.05,
      speed: this.unit * 0.5,
      drag: 0.05,
      stretch: 2.4,
    });
  }

  private onBossKilled(x: number, y: number): void {
    this.camera.addTrauma(FEEL.traumaBossKill);
    this.camera.punch(1.8);
    this.camera.freeze(FEEL.hitstopBossKill);
    this.camera.addAberration(1);
    this.renderer.flash = Math.max(this.renderer.flash, 0.62);
    this.renderer.flashColor = '#FFFFFF';
    this.session.slow(0.3, 0.55);
    this.showBanner('WARDEN DOWN', '', COLORS.parry, 2);

    this.starburst(x, y, this.unit * 0.9, COLORS.mythic);
    this.particles.burst(x, y, 70, {
      texture: 'fx/spark',
      tint: COLORS.mythic,
      life: 1.3,
      size: this.unit * 0.02,
      endSize: 0.04,
      speed: this.unit * 1.1,
      drag: 0.045,
      stretch: 3.6,
    });
    this.particles.burst(x, y, 18, {
      texture: 'fx/shard-threat',
      life: 1.5,
      size: this.unit * 0.03,
      endSize: 0.3,
      speed: this.unit * 0.6,
      drag: 0.08,
      spin: 7,
    });
    for (let i = 0; i < 3; i++) {
      this.ringFlash(x, y, this.unit * (0.5 + i * 0.45), i === 0 ? '#FFFFFF' : COLORS.mythic, 0.9 - i * 0.2);
    }
  }

  private overdriveColor(): string {
    return this.session.overdrive ? COLORS.overdrive : COLORS.aegis;
  }

  // ----------------------------------------------------------------- helpers

  private ringFlash(x: number, y: number, size: number, color: string, strength: number): void {
    this.particles.emit({
      x,
      y,
      texture: 'fx/ring',
      tint: color,
      life: 0.38,
      size: size * 0.25,
      endSize: 4.2,
      alpha: strength,
      endAlpha: 0,
      glow: 1.4,
    });
  }

  private starburst(x: number, y: number, size: number, color: string): void {
    this.particles.emit({
      x,
      y,
      texture: 'fx/starburst',
      tint: color,
      life: 0.5,
      size,
      endSize: 1.6,
      alpha: 0.95,
      endAlpha: 0,
      rotation: fxRng.angle(),
      spin: 1.2,
      glow: 1.6,
    });
  }

  spawnText(text: string, x: number, y: number, color: string, style: TextStyle): void {
    let slot: FloatingText | null = null;
    let oldest: FloatingText = this.texts[0]!;
    for (const t of this.texts) {
      if (!t.active) {
        slot = t;
        break;
      }
      if (t.age / t.life > oldest.age / oldest.life) oldest = t;
    }
    const f = slot ?? oldest;
    f.active = true;
    f.text = text;
    f.x = x;
    f.y = y;
    f.vx = fxRng.signedRange(this.unit * 0.03);
    f.vy = -this.unit * (style === 'score' ? 0.12 : 0.07);
    f.age = 0;
    f.life = style === 'score' ? 0.72 : 0.95;
    f.color = color;
    f.style = style;
    f.rotation = style === 'label' ? fxRng.signedRange(0.05) : 0;
    f.size =
      style === 'score'
        ? this.unit * 0.028
        : style === 'label'
          ? this.unit * 0.034
          : style === 'warning'
            ? this.unit * 0.03
            : this.unit * 0.05;
  }

  showBanner(text: string, sub: string, color: string, life: number): void {
    this.banner = { text, sub, age: 0, life, color };
  }

  // ------------------------------------------------------------------ update

  update(dt: number): void {
    this.time += dt;
    for (const t of this.texts) {
      if (!t.active) continue;
      t.age += dt;
      if (t.age >= t.life) {
        t.active = false;
        continue;
      }
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.vy *= Math.pow(0.06, dt);
    }
    if (this.banner.life > 0) {
      this.banner.age += dt;
      if (this.banner.age >= this.banner.life) this.banner.life = 0;
    }
  }

  /** Draw floating text and banners. Called after the arena, before the HUD. */
  draw(): void {
    const { ctx } = this.renderer;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const t of this.texts) {
      if (!t.active) continue;
      const p = t.age / t.life;
      const a = p < 0.12 ? p / 0.12 : 1 - Math.pow((p - 0.12) / 0.88, 2.2);
      const scale = t.style === 'score' ? 1 : 1 + (1 - Math.pow(1 - Math.min(1, p * 5), 3)) * 0.16;

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rotation);
      ctx.scale(scale, scale);
      ctx.font = `800 ${t.size}px ${FONT_STACK}`;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = alpha('#04050B', 0.85 * a);
      ctx.lineWidth = t.size * 0.24;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = alpha(lighten(t.color, 0.25), a);
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }

    this.drawBanner();
    ctx.restore();
  }

  private drawBanner(): void {
    if (this.banner.life <= 0) return;
    const { ctx } = this.renderer;
    const p = clamp01(this.banner.age / this.banner.life);
    const inT = clamp01(p / 0.16);
    const outT = clamp01((p - 0.7) / 0.3);
    const a = Math.min(1 - Math.pow(outT, 1.8), 1 - Math.pow(1 - inT, 3));
    if (a <= 0.01) return;

    const y = this.cy - this.unit * 0.3;
    const size = this.unit * 0.062;
    const scale = 1 + (1 - Math.pow(1 - inT, 3)) * 0.08 + outT * 0.1;

    ctx.save();
    ctx.translate(this.cx, y);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Backing sweep so the text never fights the arena behind it.
    const g = ctx.createLinearGradient(-this.unit * 0.5, 0, this.unit * 0.5, 0);
    g.addColorStop(0, alpha(this.banner.color, 0));
    g.addColorStop(0.5, alpha(this.banner.color, 0.16 * a));
    g.addColorStop(1, alpha(this.banner.color, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-this.unit * 0.5, -size * 0.85, this.unit, size * 1.7);

    ctx.font = `900 ${size}px ${FONT_STACK}`;
    ctx.letterSpacing = `${size * 0.08}px`;
    ctx.strokeStyle = alpha('#04050B', 0.9 * a);
    ctx.lineWidth = size * 0.18;
    ctx.lineJoin = 'round';
    ctx.strokeText(this.banner.text, 0, 0);

    const tg = ctx.createLinearGradient(0, -size * 0.6, 0, size * 0.6);
    tg.addColorStop(0, alpha('#FFFFFF', a));
    tg.addColorStop(1, alpha(this.banner.color, a));
    ctx.fillStyle = tg;
    ctx.fillText(this.banner.text, 0, 0);

    if (this.banner.sub) {
      ctx.font = `600 ${size * 0.32}px ${FONT_STACK}`;
      ctx.letterSpacing = `${size * 0.14}px`;
      ctx.fillStyle = alpha('#C8D6F5', a * 0.8);
      ctx.fillText(this.banner.sub.toUpperCase(), 0, size * 0.82);
    }
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  /** Ambient particles that make the arena feel alive between waves. */
  ambient(dt: number): void {
    if (fxRng.next() > dt * 7) return;
    const a = fxRng.angle();
    const r = this.unit * fxRng.range(0.4, 0.95);
    this.particles.emit({
      x: this.cx + Math.cos(a) * r,
      y: this.cy + Math.sin(a) * r,
      vx: Math.cos(a + Math.PI / 2) * this.unit * 0.01,
      vy: Math.sin(a + Math.PI / 2) * this.unit * 0.01,
      texture: 'fx/glow',
      tint: this.session.overdrive ? COLORS.overdrive : COLORS.aegis,
      life: fxRng.range(1.6, 3.4),
      size: this.unit * fxRng.range(0.004, 0.012),
      endSize: 0.3,
      alpha: 0.35,
      endAlpha: 0,
      behind: true,
      glow: 0.5,
    });
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }
}

export const FONT_STACK =
  "'Chakra Petch', 'Rajdhani', 'Eurostile', 'DIN Alternate', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

/** Draw an angled tick around a circle. Shared by HUD widgets. */
export function tick(ctx: CanvasRenderingContext2D, angle: number, r0: number, r1: number): void {
  ctx.moveTo(Math.cos(angle) * r0, Math.sin(angle) * r0);
  ctx.lineTo(Math.cos(angle) * r1, Math.sin(angle) * r1);
}

export { TAU };
