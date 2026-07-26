/**
 * Arena geometry.
 *
 * All gameplay distances derive from the shortest viewport side, so the game
 * plays identically on a phone in portrait and a desktop window — the arena is
 * always the same size relative to the screen, and the shield always sits under
 * a comfortable thumb reach.
 */

import type { ViewInfo } from '../render/Renderer';
import { ARENA } from '../data/balance';

export class Arena {
  cx = 0;
  cy = 0;
  /** Radius of the nexus itself. */
  nexusR = 0;
  /** Radius the shield band is centred on. */
  shieldR = 0;
  /** Half-thickness of the shield band. */
  shieldHalfThickness = 0;
  /** Radius to the furthest screen corner, plus the spawn margin. */
  spawnR = 0;
  /** Radius past which deflected threats are removed. */
  despawnR = 0;
  /** One "unit" — the shortest side. Multiply fractional constants by this. */
  unit = 0;

  private halfW = 0;
  private halfH = 0;

  update(view: ViewInfo): void {
    this.cx = view.cx;
    this.cy = view.cy;
    this.unit = view.minSide;
    this.nexusR = view.minSide * ARENA.nexusRadius;
    this.shieldR = view.minSide * ARENA.shieldRadius;
    this.shieldHalfThickness = (view.minSide * ARENA.shieldThickness) / 2;
    this.halfW = view.width / 2 + ARENA.spawnMargin;
    this.halfH = view.height / 2 + ARENA.spawnMargin;
    const corner = Math.hypot(view.width, view.height) / 2;
    this.spawnR = corner + ARENA.spawnMargin;
    this.despawnR = this.spawnR * ARENA.despawnFactor;
  }

  /**
   * Distance from the centre to the screen edge along `angle`, plus the spawn
   * margin.
   *
   * Threats spawn on this *rectangle*, not on a circle. On a tall phone a
   * circle inscribed to the corners puts side-spawns 380px off-screen and
   * top-spawns 130px off-screen — so a threat from the left would appear with
   * almost no warning while one from above drifts in for four seconds. Entering
   * on the screen edge makes every direction fair and every approach the same
   * length of warning.
   */
  edgeRadius(angle: number): number {
    const c = Math.abs(Math.cos(angle));
    const s = Math.abs(Math.sin(angle));
    const tx = c > 1e-6 ? this.halfW / c : Number.POSITIVE_INFINITY;
    const ty = s > 1e-6 ? this.halfH / s : Number.POSITIVE_INFINITY;
    return Math.min(tx, ty);
  }

  /** True once a deflected shot is comfortably off-screen. */
  isOffscreen(x: number, y: number): boolean {
    return (
      Math.abs(x - this.cx) > this.halfW * ARENA.despawnFactor ||
      Math.abs(y - this.cy) > this.halfH * ARENA.despawnFactor
    );
  }

  /** Convert a fraction-of-unit value from the balance tables into pixels. */
  px(fraction: number): number {
    return fraction * this.unit;
  }

  polarX(angle: number, radius: number): number {
    return this.cx + Math.cos(angle) * radius;
  }

  polarY(angle: number, radius: number): number {
    return this.cy + Math.sin(angle) * radius;
  }

  radiusOf(x: number, y: number): number {
    return Math.hypot(x - this.cx, y - this.cy);
  }

  angleOf(x: number, y: number): number {
    return Math.atan2(y - this.cy, x - this.cx);
  }

  /**
   * Angular half-width subtended by an object of `radius` at distance `dist`.
   * Used so a big threat is caught by the shield edge as soon as it *touches*,
   * not when its centre crosses.
   */
  angularRadius(radius: number, dist: number): number {
    if (dist <= radius) return Math.PI;
    return Math.asin(Math.min(1, radius / dist));
  }
}
