/**
 * Camera feel.
 *
 * Three effects, all driven by a single "trauma" style model so they decay
 * naturally and never stack into nausea:
 *
 *  - shake      : trauma^2 amplitude, noise-driven, decays fast
 *  - punch      : a zoom impulse that springs back
 *  - hitstop    : freezes simulation time for a few frames on heavy impacts
 *
 * Everything is capped. A game that shakes constantly reads as cheap; shake
 * should be rare and mean something.
 */

import { clamp, clamp01, damp } from '../core/math';
import { fxRng } from '../core/Rng';
import type { Renderer } from './Renderer';

export class Camera {
  /** 0..1. Shake amplitude is trauma squared, so small hits stay subtle. */
  private trauma = 0;
  private traumaDecay = 1.7;

  private shakeTime = 0;
  private shakeSeedX = fxRng.range(0, 1000);
  private shakeSeedY = fxRng.range(0, 1000);

  private zoomTarget = 1;
  private zoomCurrent = 1;
  private zoomVelocity = 0;

  private rotTarget = 0;
  private rotCurrent = 0;

  private aberrationLevel = 0;
  private vignetteLevel = 0;

  /** Remaining hitstop in unscaled seconds. */
  private hitstop = 0;

  /** Scales all camera motion; 0 disables it for players who need that. */
  intensity = 1;

  /** Maximum shake offset in CSS pixels at full trauma. */
  maxOffset = 26;

  addTrauma(amount: number): void {
    this.trauma = clamp01(this.trauma + amount * this.intensity);
  }

  /** A zoom impulse. Positive pushes in, negative pulls out. */
  punch(amount: number): void {
    this.zoomVelocity += amount * this.intensity;
  }

  /** Freeze gameplay for `seconds` of real time. Impacts feel heavier for it. */
  freeze(seconds: number): void {
    this.hitstop = Math.max(this.hitstop, seconds * clamp(this.intensity, 0.25, 1));
  }

  /** Chromatic split, 0..1. Decays on its own. */
  addAberration(amount: number): void {
    this.aberrationLevel = clamp01(this.aberrationLevel + amount * this.intensity);
  }

  /** Extra vignette darkening, e.g. when the nexus is critical. */
  setVignette(level: number): void {
    this.vignetteLevel = clamp01(level);
  }

  /** A sustained zoom, e.g. pushing in during a boss intro. */
  setZoom(target: number): void {
    this.zoomTarget = target;
  }

  setRotation(target: number): void {
    this.rotTarget = target;
  }

  get isFrozen(): boolean {
    return this.hitstop > 0;
  }

  /**
   * Advance camera state. Takes *unscaled* real time — hitstop must tick down
   * in real seconds even while simulation time is stopped.
   */
  update(dt: number): void {
    if (this.hitstop > 0) this.hitstop = Math.max(0, this.hitstop - dt);

    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    this.shakeTime += dt;

    // Spring the zoom impulse back to the sustained target.
    const stiffness = 120;
    const damping = 14;
    const displacement = this.zoomCurrent - this.zoomTarget;
    this.zoomVelocity += (-stiffness * displacement - damping * this.zoomVelocity) * dt;
    this.zoomCurrent += this.zoomVelocity * dt;
    this.zoomCurrent = clamp(this.zoomCurrent, 0.82, 1.35);

    this.rotCurrent = damp(this.rotCurrent, this.rotTarget, 0.12, dt);
    this.aberrationLevel = Math.max(0, this.aberrationLevel - dt * 2.6);
  }

  /** Push the resulting values into the renderer's post-process state. */
  apply(renderer: Renderer): void {
    const shake = this.trauma * this.trauma;
    const amp = shake * this.maxOffset * this.intensity;
    renderer.shakeX = amp * (noise(this.shakeSeedX + this.shakeTime * 34) * 2 - 1);
    renderer.shakeY = amp * (noise(this.shakeSeedY + this.shakeTime * 34) * 2 - 1);
    renderer.zoom = this.zoomCurrent;
    renderer.rotation = this.rotCurrent;
    renderer.aberration = Math.max(this.aberrationLevel, shake * 0.45);
    renderer.vignetteBoost = this.vignetteLevel * 0.3;
  }

  reset(): void {
    this.trauma = 0;
    this.zoomCurrent = 1;
    this.zoomTarget = 1;
    this.zoomVelocity = 0;
    this.rotCurrent = 0;
    this.rotTarget = 0;
    this.aberrationLevel = 0;
    this.vignetteLevel = 0;
    this.hitstop = 0;
  }
}

/** Cheap smooth value noise in 1D — plenty for shake. */
function noise(t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i);
  const b = hash(i + 1);
  return a + (b - a) * u;
}

function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}
