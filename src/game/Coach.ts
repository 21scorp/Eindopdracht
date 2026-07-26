/**
 * First-run coaching.
 *
 * No tutorial level, no modal wall of text, no "tap to continue" x6. The game
 * starts immediately and four hints appear over the arena, each triggered by
 * the situation it explains and each dismissed by the player doing the thing.
 *
 * Rules this follows:
 *  - never block input, never pause the game
 *  - a hint disappears the moment the player performs the action
 *  - the whole sequence is one run long and never returns
 *  - a hint that has not been satisfied within its patience window gives up
 *    rather than nagging
 *
 * The same steps back the always-available "How to play" screen, so the text
 * exists in exactly one place.
 */

import { TAU, clamp01 } from '../core/math';
import { COLORS, alpha, lighten } from '../render/palette';
import type { Renderer } from '../render/Renderer';
import type { GameSession } from './GameSession';
import { FONT_STACK } from './Vfx';

export interface CoachStep {
  id: string;
  title: string;
  body: string;
  /** Which affordance to highlight. */
  focus: 'shield' | 'pulse' | 'combo' | 'ultimate';
  /** True once the player has demonstrated the skill. */
  isSatisfied(session: GameSession): boolean;
  /** True when the situation calls for this hint. */
  isRelevant(session: GameSession): boolean;
  /** Seconds to keep showing it before moving on regardless. */
  patience: number;
}

export const COACH_STEPS: CoachStep[] = [
  {
    id: 'aim',
    title: 'DRAG TO AIM',
    body: 'Your shield follows your thumb around the nexus. Put it in front of what is coming.',
    focus: 'shield',
    isRelevant: () => true,
    isSatisfied: (s) => s.blocksLanded >= 1,
    patience: 14,
  },
  {
    id: 'perfect',
    title: 'CENTRE IS BETTER',
    body: 'Contact at the middle of the arc is a PERFECT — double score, and it breaks armour.',
    focus: 'shield',
    isRelevant: (s) => s.blocksLanded >= 1,
    isSatisfied: (s) => s.perfectsLanded >= 2,
    patience: 16,
  },
  {
    id: 'pulse',
    title: 'TAP TO PULSE',
    body: 'A ring sweeps out from the nexus. Anything it touches is PARRIED, whatever angle it came from.',
    focus: 'pulse',
    isRelevant: (s) => s.perfectsLanded >= 1 || s.elapsed > 18,
    isSatisfied: (s) => s.parriesLanded >= 1,
    patience: 20,
  },
  {
    id: 'combo',
    title: 'KEEP THE CHAIN',
    body: 'What you block flies back out and kills what it hits. Combo multiplies everything — losing integrity breaks it.',
    focus: 'combo',
    isRelevant: (s) => s.combo >= 8,
    isSatisfied: (s) => s.combo >= 20,
    patience: 12,
  },
];

export class Coach {
  /** Set false once the player has seen the sequence. */
  enabled = false;

  private index = 0;
  private visible = false;
  private age = 0;
  private fade = 0;
  private finished = false;
  private onFinish?: () => void;

  constructor(private readonly renderer: Renderer) {}

  /** Begin the sequence. Call at the start of a run for a first-time player. */
  start(onFinish?: () => void): void {
    this.enabled = true;
    this.index = 0;
    this.visible = false;
    this.age = 0;
    this.fade = 0;
    this.finished = false;
    this.onFinish = onFinish;
  }

  stop(): void {
    this.enabled = false;
    this.visible = false;
    this.fade = 0;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  get currentStep(): CoachStep | null {
    return this.enabled && this.visible ? (COACH_STEPS[this.index] ?? null) : null;
  }

  update(dt: number, session: GameSession): void {
    if (!this.enabled || this.finished) {
      this.fade = Math.max(0, this.fade - dt * 4);
      return;
    }

    const step = COACH_STEPS[this.index];
    if (!step) {
      this.complete();
      return;
    }

    if (!this.visible) {
      if (step.isRelevant(session)) {
        this.visible = true;
        this.age = 0;
      }
      return;
    }

    this.age += dt;
    this.fade = Math.min(1, this.fade + dt * 3.5);

    // Satisfied, or the player has had long enough — either way, move on.
    if ((step.isSatisfied(session) && this.age > 1.2) || this.age > step.patience) {
      this.index++;
      this.visible = false;
      this.fade = 0;
      if (this.index >= COACH_STEPS.length) this.complete();
    }
  }

  private complete(): void {
    this.finished = true;
    this.enabled = false;
    this.onFinish?.();
  }

  draw(session: GameSession): void {
    if (this.fade <= 0.01) return;
    const step = COACH_STEPS[this.index] ?? COACH_STEPS[COACH_STEPS.length - 1]!;
    const { ctx, view } = this.renderer;
    const a = this.fade;
    const unit = view.minSide;

    this.drawFocus(step, session, a);

    // Card sits high, clear of the arena and clear of the thumb.
    const cardW = Math.min(view.width - unit * 0.1, unit * 0.86);
    const cardH = unit * 0.2;
    const x = view.cx - cardW / 2;
    const y = Math.max(unit * 0.14, view.cy - session.arena.shieldR - cardH - unit * 0.14);

    ctx.save();
    ctx.globalAlpha = a;

    ctx.fillStyle = alpha('#070A14', 0.9);
    ctx.strokeStyle = alpha(COLORS.aegis, 0.42);
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, cardW, cardH, unit * 0.028);
    ctx.fill();
    ctx.stroke();

    // Accent bar down the leading edge.
    ctx.fillStyle = alpha(COLORS.parry, 0.9);
    roundRect(ctx, x, y + cardH * 0.22, unit * 0.007, cardH * 0.56, unit * 0.004);
    ctx.fill();

    const padX = x + unit * 0.045;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    ctx.font = `800 ${unit * 0.038}px ${FONT_STACK}`;
    ctx.letterSpacing = `${unit * 0.004}px`;
    ctx.fillStyle = COLORS.parry;
    ctx.fillText(step.title, padX, y + cardH * 0.36);
    ctx.letterSpacing = '0px';

    ctx.font = `500 ${unit * 0.028}px ${FONT_STACK}`;
    ctx.fillStyle = COLORS.textDim;
    wrapText(ctx, step.body, padX, y + cardH * 0.58, cardW - unit * 0.09, unit * 0.036);

    ctx.restore();
  }

  /** A pointer that draws attention to whichever control the hint is about. */
  private drawFocus(step: CoachStep, session: GameSession, a: number): void {
    const { ctx, view } = this.renderer;
    const unit = view.minSide;
    const t = performance.now() / 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.4);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'lighter';

    if (step.focus === 'shield') {
      // A travelling highlight around the shield radius.
      const arena = session.arena;
      const sweep = (t * 0.9) % TAU;
      const grad = ctx.createRadialGradient(arena.cx, arena.cy, arena.shieldR * 0.9, arena.cx, arena.cy, arena.shieldR * 1.12);
      grad.addColorStop(0, alpha(COLORS.parry, 0));
      grad.addColorStop(1, alpha(COLORS.parry, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = unit * 0.01;

      ctx.strokeStyle = alpha(COLORS.parry, 0.35 + pulse * 0.3);
      ctx.setLineDash([unit * 0.03, unit * 0.03]);
      ctx.lineDashOffset = -sweep * arena.shieldR;
      ctx.beginPath();
      ctx.arc(arena.cx, arena.cy, arena.shieldR * 1.14, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (step.focus === 'pulse') {
      // Echo the pulse button with an expanding ring.
      const r = unit * 0.052;
      const bx = view.cx;
      const by = view.height - Math.max(16, unit * 0.045) - r;
      for (let i = 0; i < 2; i++) {
        const p = ((t * 1.1 + i * 0.5) % 1);
        ctx.strokeStyle = alpha(COLORS.parry, (1 - p) * 0.65);
        ctx.lineWidth = unit * 0.005;
        ctx.beginPath();
        ctx.arc(bx, by, r * (1 + p * 0.9), 0, TAU);
        ctx.stroke();
      }
    } else if (step.focus === 'combo') {
      const x = view.width - Math.max(16, unit * 0.045);
      const y = Math.max(16, unit * 0.045) + unit * 0.03;
      ctx.strokeStyle = alpha(COLORS.overdrive, 0.4 + pulse * 0.4);
      ctx.lineWidth = unit * 0.005;
      roundRect(ctx, x - unit * 0.19, y - unit * 0.03, unit * 0.19, unit * 0.09, unit * 0.014);
      ctx.stroke();
    }

    ctx.restore();
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/** Naive word wrap. Fine for two short lines of hint text. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const words = text.split(' ');
  let line = '';
  let cursorY = y;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, cursorY);
      line = word;
      cursorY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line) ctx.fillText(line, x, cursorY);
}

export { lighten, clamp01 };
