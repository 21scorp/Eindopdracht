/**
 * In-run HUD.
 *
 * Drawn on the canvas rather than in the DOM so it shares the bloom pass and
 * the camera shake — a HUD that sits perfectly still while the world shakes
 * immediately reads as a separate, cheaper layer.
 *
 * Layout rules:
 *  - Nothing important sits in the bottom third: that is where the thumb is.
 *  - Score is the only element allowed to be large; everything else is a hint.
 *  - Numbers use tabular spacing so a rising score does not jitter.
 */

import { clamp, clamp01, damp, TAU } from '../core/math';
import { COLORS, alpha, lighten, mix } from '../render/palette';
import type { Renderer } from '../render/Renderer';
import type { TextureStore } from '../render/TextureStore';
import type { GameSession } from './GameSession';
import { getResonance } from '../data/resonance';
import { FONT_STACK } from './Vfx';

export interface HudHitAreas {
  ultimate: { x: number; y: number; r: number };
  pause: { x: number; y: number; r: number };
}

export class Hud {
  /** Smoothed score so the readout counts up instead of snapping. */
  private displayScore = 0;
  private displayCombo = 0;
  private time = 0;
  private ultPulse = 0;
  private safeTop = 0;

  /** Mirrors the action buttons for left-handed play. */
  mirrored = false;

  /** Score to beat during a challenge run. Zero means no challenge. */
  challengeTarget = 0;

  hit: HudHitAreas = {
    ultimate: { x: 0, y: 0, r: 0 },
    pause: { x: 0, y: 0, r: 0 },
  };

  constructor(
    private readonly renderer: Renderer,
    private readonly textures: TextureStore,
  ) {
    this.safeTop = readSafeAreaTop();
    // The inset changes when the device rotates, so it cannot be read once.
    renderer.onResize(() => {
      this.safeTop = readSafeAreaTop();
    });
  }

  reset(): void {
    this.displayScore = 0;
    this.displayCombo = 0;
  }

  update(dt: number, session: GameSession): void {
    this.time += dt;
    this.displayScore = damp(this.displayScore, session.score, 0.09, dt);
    if (Math.abs(this.displayScore - session.score) < 1) this.displayScore = session.score;
    this.displayCombo = damp(this.displayCombo, session.combo, 0.06, dt);
    this.ultPulse = session.ultimateReady ? Math.min(1, this.ultPulse + dt * 3) : Math.max(0, this.ultPulse - dt * 4);
  }

  draw(session: GameSession, accent: string): void {
    const { ctx, view } = this.renderer;
    const pad = Math.max(16, view.minSide * 0.045);
    const top = pad + this.safeTop;

    ctx.save();
    ctx.textBaseline = 'middle';

    this.drawScore(session, view.cx, top + view.minSide * 0.012, accent);
    this.drawWave(session, pad, top, accent);
    this.drawCombo(session, view.width - pad, top, accent);
    this.drawPulseMeter(session, view, pad, accent);
    this.drawUltimate(session, view, pad);
    this.drawPauseButton(view, pad, top);
    this.drawResonance(session, pad, top + view.minSide * 0.115);

    ctx.restore();
  }

  // ------------------------------------------------------------------ score

  private drawScore(session: GameSession, cx: number, y: number, accent: string): void {
    const { ctx, view } = this.renderer;
    const size = view.minSide * 0.075;
    const value = Math.round(this.displayScore);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `800 ${size}px ${FONT_STACK}`;
    ctx.letterSpacing = `${size * 0.02}px`;

    const text = formatScore(value);
    const grow = session.overdrive ? 1 + Math.sin(this.time * 9) * 0.012 : 1;
    ctx.translate(cx, y + size * 0.5);
    ctx.scale(grow, grow);

    ctx.strokeStyle = alpha('#04050B', 0.75);
    ctx.lineWidth = size * 0.16;
    ctx.lineJoin = 'round';
    ctx.strokeText(text, 0, 0);

    const g = ctx.createLinearGradient(0, -size * 0.55, 0, size * 0.55);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(1, session.overdrive ? COLORS.overdrive : lighten(accent, 0.2));
    ctx.fillStyle = g;
    ctx.fillText(text, 0, 0);

    // Challenge target, directly under the score, with a bar that fills as you
    // close on it. A number alone does not convey "nearly there".
    if (this.challengeTarget > 0) {
      const p = clamp01(value / this.challengeTarget);
      const beaten = value >= this.challengeTarget;
      const w = size * 3.4;
      const yy = size * 0.62;
      const barH = Math.max(2, size * 0.045);

      ctx.font = `600 ${size * 0.2}px ${FONT_STACK}`;
      ctx.letterSpacing = `${size * 0.05}px`;
      ctx.fillStyle = beaten ? COLORS.heal : COLORS.textDim;
      ctx.fillText(beaten ? 'TARGET BEATEN' : `TARGET ${formatScore(this.challengeTarget)}`, 0, yy);

      ctx.fillStyle = alpha('#FFFFFF', 0.12);
      roundRect(ctx, -w / 2, yy + size * 0.12, w, barH, barH / 2);
      ctx.fill();
      ctx.fillStyle = beaten ? COLORS.heal : accent;
      roundRect(ctx, -w / 2, yy + size * 0.12, Math.max(barH, w * p), barH, barH / 2);
      ctx.fill();
    }

    // Multiplier chip, tucked under the score.
    if (session.multiplier > 1.001) {
      const mSize = size * 0.3;
      ctx.font = `800 ${mSize}px ${FONT_STACK}`;
      const label = `x${session.multiplier.toFixed(1).replace(/\.0$/, '')}`;
      const w = ctx.measureText(label).width + mSize * 1.1;
      const h = mSize * 1.6;
      const yy = this.challengeTarget > 0 ? size * 0.9 : size * 0.72;
      ctx.fillStyle = alpha(session.overdrive ? COLORS.overdrive : accent, 0.16);
      ctx.strokeStyle = alpha(session.overdrive ? COLORS.overdrive : accent, 0.6);
      ctx.lineWidth = Math.max(1, mSize * 0.08);
      roundRect(ctx, -w / 2, yy, w, h, h / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = session.overdrive ? COLORS.overdrive : lighten(accent, 0.35);
      ctx.fillText(label, 0, yy + h / 2);
    }
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // ------------------------------------------------------------------- wave

  private drawWave(session: GameSession, x: number, y: number, accent: string): void {
    const { ctx, view } = this.renderer;
    const size = view.minSide * 0.026;
    ctx.save();
    ctx.textAlign = 'left';

    ctx.font = `600 ${size * 0.72}px ${FONT_STACK}`;
    ctx.letterSpacing = `${size * 0.14}px`;
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText('WAVE', x, y + size * 0.4);

    ctx.font = `800 ${size * 1.5}px ${FONT_STACK}`;
    ctx.letterSpacing = '0px';
    ctx.fillStyle = COLORS.text;
    const waveLabel = String(Math.max(1, session.director.wave));
    ctx.fillText(waveLabel, x, y + size * 1.75);

    // Progress rail.
    const railW = view.minSide * 0.14;
    const railY = y + size * 2.9;
    const railH = Math.max(2, size * 0.14);
    ctx.fillStyle = alpha('#FFFFFF', 0.1);
    roundRect(ctx, x, railY, railW, railH, railH / 2);
    ctx.fill();
    const p = session.director.waveProgress;
    if (p > 0) {
      ctx.fillStyle = session.director.isBossWave ? COLORS.mythic : accent;
      roundRect(ctx, x, railY, Math.max(railH, railW * p), railH, railH / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // -------------------------------------------------------------- resonance

  /**
   * The cards this run is holding, as a column of sigils under the wave rail.
   *
   * Icons only. A player mid-wave has no attention for words, and the point of
   * showing them at all is not to be read — it is so the build has a presence
   * on screen, and so the next draft is a decision about something visible
   * rather than about something remembered.
   */
  private drawResonance(session: GameSession, x: number, y: number): void {
    const held = session.resonance;
    if (held.length === 0) return;
    const { ctx, view } = this.renderer;
    const size = Math.max(14, view.minSide * 0.042);
    const step = size * 1.12;

    ctx.save();
    ctx.globalAlpha = 0.82;
    for (let i = 0; i < held.length; i++) {
      const def = getResonance(held[i]!);
      if (!def) continue;
      // Wrap into a second column rather than running off the bottom of a
      // short landscape viewport.
      const perColumn = Math.max(3, Math.floor((view.height * 0.42) / step));
      const col = Math.floor(i / perColumn);
      const row = i % perColumn;
      this.textures.draw(ctx, def.icon, x + size / 2 + col * step, y + size / 2 + row * step, {
        width: size,
        height: size,
      });
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ combo

  private drawCombo(session: GameSession, x: number, y: number, accent: string): void {
    if (session.combo < 2) return;
    const { ctx, view } = this.renderer;
    const size = view.minSide * 0.026;
    const combo = Math.round(this.displayCombo);
    const hot = session.overdrive;

    ctx.save();
    ctx.textAlign = 'right';

    ctx.font = `600 ${size * 0.72}px ${FONT_STACK}`;
    ctx.letterSpacing = `${size * 0.14}px`;
    ctx.fillStyle = hot ? COLORS.overdrive : COLORS.textDim;
    ctx.fillText('COMBO', x, y + size * 0.4);

    const bump = 1 + clamp01((session.combo - this.displayCombo) / 6) * 0.25;
    ctx.font = `800 ${size * 1.85 * bump}px ${FONT_STACK}`;
    ctx.letterSpacing = '0px';
    ctx.fillStyle = hot ? COLORS.overdrive : lighten(accent, 0.2);
    ctx.fillText(String(combo), x, y + size * 1.85);
    ctx.restore();
  }

  // ------------------------------------------------------------------ pulse

  private drawPulseMeter(session: GameSession, view: { cx: number; height: number; minSide: number }, pad: number, accent: string): void {
    const { ctx } = this.renderer;
    const r = view.minSide * 0.052;
    const x = view.cx;
    const y = view.height - pad - r - readSafeAreaBottom();
    const ready = session.pulseCooldown <= 0;
    const p = session.pulseProgress;

    ctx.save();
    ctx.translate(x, y);

    // Track.
    ctx.strokeStyle = alpha('#FFFFFF', 0.1);
    ctx.lineWidth = r * 0.16;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();

    // Fill.
    ctx.strokeStyle = ready ? COLORS.parry : alpha(accent, 0.75);
    ctx.lineWidth = r * 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp01(p));
    ctx.stroke();

    if (ready) {
      const glow = 0.5 + 0.5 * Math.sin(this.time * 4);
      ctx.globalCompositeOperation = 'lighter';
      this.textures.draw(ctx, 'fx/glow-parry', 0, 0, { width: r * 4, height: r * 4, alpha: 0.22 + glow * 0.18 });
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.textAlign = 'center';
    ctx.font = `800 ${r * 0.42}px ${FONT_STACK}`;
    ctx.letterSpacing = `${r * 0.05}px`;
    ctx.fillStyle = ready ? COLORS.parry : COLORS.textDim;
    ctx.fillText('PULSE', 0, 0);
    ctx.font = `600 ${r * 0.24}px ${FONT_STACK}`;
    ctx.fillStyle = alpha(COLORS.textFaint, 0.9);
    ctx.fillText('TAP', 0, r * 0.42);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  // --------------------------------------------------------------- ultimate

  private drawUltimate(session: GameSession, view: { width: number; height: number; minSide: number }, pad: number): void {
    const { ctx } = this.renderer;
    const r = view.minSide * 0.066;
    const x = this.mirrored ? pad + r : view.width - pad - r;
    const y = view.height - pad - r - readSafeAreaBottom();
    this.hit.ultimate = { x, y, r: r * 1.25 };

    const ready = session.ultimateReady;
    const p = session.ultProgress;
    const active = session.ult.timer > 0;

    ctx.save();
    ctx.translate(x, y);

    if (ready) {
      const glow = 0.5 + 0.5 * Math.sin(this.time * 6);
      ctx.globalCompositeOperation = 'lighter';
      this.textures.draw(ctx, 'fx/glow-ultimate', 0, 0, { width: r * 5, height: r * 5, alpha: 0.3 + glow * 0.25 });
      ctx.globalCompositeOperation = 'source-over';
    }

    // Body.
    ctx.fillStyle = alpha(ready ? COLORS.ultimate : '#0E1424', ready ? 0.28 : 0.72);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = alpha('#FFFFFF', 0.1);
    ctx.lineWidth = r * 0.13;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();

    // Charge ring.
    ctx.strokeStyle = active ? COLORS.parry : ready ? COLORS.ultimate : mix(COLORS.ultimate, '#31405E', 0.55);
    ctx.lineWidth = r * 0.13;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const shown = active ? clamp01(session.ult.duration > 0 ? session.ult.timer / session.ult.duration : 0) : p;
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * shown);
    ctx.stroke();

    const scale = ready ? 1 + Math.sin(this.time * 6) * 0.045 : 1;
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.font = `900 ${r * 0.34}px ${FONT_STACK}`;
    ctx.letterSpacing = `${r * 0.04}px`;
    ctx.fillStyle = ready ? '#FFFFFF' : alpha(COLORS.textDim, 0.85);
    ctx.fillText(session.guardian ? session.guardian.ultimate.toUpperCase().slice(0, 8) : 'ULT', 0, -r * 0.06);
    ctx.font = `600 ${r * 0.2}px ${FONT_STACK}`;
    ctx.fillStyle = alpha(ready ? COLORS.parry : COLORS.textFaint, 0.95);
    ctx.fillText(ready ? 'READY' : `${Math.round(p * 100)}%`, 0, r * 0.34);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  private drawPauseButton(view: { width: number; minSide: number }, pad: number, top: number): void {
    const { ctx } = this.renderer;
    const r = view.minSide * 0.032;
    const x = this.mirrored ? pad + r : view.width - pad - r;
    const y = top + r + view.minSide * 0.09;
    // The drawn circle is small on purpose — pause is a corner affordance, not
    // a control anybody should be aiming at during a wave. What presses it is
    // still a thumb, and a thumb is 44px wide no matter how small the phone is.
    // Grow the target, not the glyph: on a 320px screen `r * 1.4` was a 29px
    // target on the one button you reach for while panicking.
    this.hit.pause = { x, y, r: Math.max(22, r * 1.4) };

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = alpha('#FFFFFF', 0.25);
    ctx.lineWidth = Math.max(1, r * 0.1);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    const bw = r * 0.19;
    const bh = r * 0.62;
    ctx.fillRect(-bw * 1.6, -bh / 2, bw, bh);
    ctx.fillRect(bw * 0.6, -bh / 2, bw, bh);
    ctx.restore();
  }

  /** True if a point lands on a HUD button. */
  hitTest(x: number, y: number, area: { x: number; y: number; r: number }): boolean {
    return Math.hypot(x - area.x, y - area.y) <= area.r;
  }
}

export function formatScore(v: number): string {
  return v.toLocaleString('en-US');
}

/** Compact form for tight spaces: 12.4K, 1.2M. */
export function formatCompact(v: number): string {
  if (v < 1000) return String(Math.round(v));
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}K`;
  return `${(v / 1_000_000).toFixed(v < 10_000_000 ? 2 : 1)}M`;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

function readSafeAreaTop(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function readSafeAreaBottom(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom');
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

export { clamp };
