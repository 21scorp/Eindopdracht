/**
 * Performance overlay.
 *
 * Enabled from Settings. Shows the frame rate as a number *and* as a rolling
 * graph, because an average of 58 hides the thing that actually matters: the
 * occasional 40ms frame that makes a parry feel like it did not register.
 *
 * Deliberately cheap — a handful of rects and two strings — so switching it on
 * does not change what it is measuring.
 */

import { clamp, clamp01 } from '../core/math';
import { COLORS, alpha } from './palette';
import type { Renderer } from './Renderer';

const HISTORY = 90;
const FONT = "600 11px 'Chakra Petch', ui-monospace, monospace";

export interface DebugStats {
  fps: number;
  quality: string;
  entities: number;
  particles: number;
  textures: number;
  atlas: boolean;
}

export class DebugOverlay {
  enabled = false;

  private frames = new Float32Array(HISTORY);
  private cursor = 0;
  private worst = 0;
  private worstDecay = 0;

  constructor(private readonly renderer: Renderer) {}

  /** Record a frame. `dt` is real elapsed seconds. */
  sample(dt: number): void {
    if (!this.enabled) return;
    const ms = dt * 1000;
    this.frames[this.cursor] = ms;
    this.cursor = (this.cursor + 1) % HISTORY;

    // The worst frame sticks around for a couple of seconds so a spike is
    // readable rather than gone before you look up.
    if (ms > this.worst) {
      this.worst = ms;
      this.worstDecay = 2.5;
    } else {
      this.worstDecay -= dt;
      if (this.worstDecay <= 0) this.worst = ms;
    }
  }

  /** Draw onto the presented canvas, after the post chain. */
  draw(stats: DebugStats): void {
    if (!this.enabled) return;
    const ctx = this.renderer.overlayCtx;
    const view = this.renderer.view;
    const dpr = this.renderer.dpr;

    const w = 132;
    const h = 74;
    const x = view.width - w - 10;
    const y = view.height - h - 10;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.9;

    ctx.fillStyle = 'rgba(4,5,11,0.82)';
    ctx.strokeStyle = alpha(COLORS.aegis, 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.stroke();

    // Frame-time graph. 16.7ms is the line to stay under.
    const gx = x + 6;
    const gy = y + 24;
    const gw = w - 12;
    const gh = 26;
    const scale = 40; // ms at full height

    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(gx, gy, gw, gh);

    const budgetY = gy + gh - (16.7 / scale) * gh;
    ctx.strokeStyle = alpha(COLORS.heal, 0.4);
    ctx.beginPath();
    ctx.moveTo(gx, budgetY);
    ctx.lineTo(gx + gw, budgetY);
    ctx.stroke();

    const barW = gw / HISTORY;
    for (let i = 0; i < HISTORY; i++) {
      const idx = (this.cursor + i) % HISTORY;
      const ms = this.frames[idx]!;
      if (ms <= 0) continue;
      const bh = clamp01(ms / scale) * gh;
      ctx.fillStyle = ms > 33 ? COLORS.threat : ms > 18 ? COLORS.overdrive : COLORS.aegis;
      ctx.fillRect(gx + i * barW, gy + gh - bh, Math.max(1, barW - 0.5), bh);
    }

    ctx.font = FONT;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = stats.fps < 50 ? COLORS.overdrive : COLORS.text;
    ctx.fillText(`${stats.fps.toFixed(0)} fps`, x + 7, y + 15);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.textDim;
    ctx.fillText(`worst ${this.worst.toFixed(1)}ms`, x + w - 7, y + 15);

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.textFaint;
    ctx.fillText(
      `${stats.quality}${stats.atlas ? ' · atlas' : ''}  e${stats.entities} p${stats.particles}`,
      x + 7,
      y + h - 8,
    );

    ctx.restore();
    void clamp;
  }
}
