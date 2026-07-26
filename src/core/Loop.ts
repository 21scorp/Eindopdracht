/**
 * The game loop.
 *
 * Simulation runs at a fixed 120 Hz step so parry windows are measured in
 * deterministic ticks rather than whatever the display happens to do. Rendering
 * happens once per animation frame using the latest simulated state; at 60 Hz
 * that is two sim steps per frame, which is close enough that interpolation
 * would cost more than it buys.
 *
 * `timeScale` is how hitstop and slow-motion are expressed: gameplay slows,
 * but the loop itself keeps running at full rate so UI stays responsive.
 */

export const FIXED_STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 8; // Beyond this we drop time rather than spiral.
const MAX_FRAME_TIME = 0.25; // Never simulate more than a quarter second of catch-up.

export interface LoopCallbacks {
  /** Fixed-step simulation. `dt` is always FIXED_STEP scaled by timeScale. */
  update(dt: number): void;
  /** Called once per animation frame. `dt` is real elapsed time, unscaled. */
  render(dt: number): void;
}

export class Loop {
  private rafId = 0;
  private running = false;
  private accumulator = 0;
  private lastTime = 0;

  /** Scales simulation time only. 0 = frozen, 1 = normal, 0.25 = slow motion. */
  timeScale = 1;

  /** Total simulated seconds since the loop started, after time scaling. */
  elapsed = 0;

  /** Smoothed frames per second, for the debug overlay. */
  fps = 60;

  private fpsAccumulator = 0;
  private fpsFrames = 0;

  constructor(private readonly callbacks: LoopCallbacks) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * Discard accumulated time. Call after a long blocking operation (asset
   * decode, tab regaining focus) so the game does not fast-forward.
   */
  resetClock(): void {
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    let frameTime = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!Number.isFinite(frameTime) || frameTime < 0) frameTime = 0;
    if (frameTime > MAX_FRAME_TIME) frameTime = MAX_FRAME_TIME;

    this.fpsAccumulator += frameTime;
    this.fpsFrames++;
    if (this.fpsAccumulator >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAccumulator;
      this.fpsAccumulator = 0;
      this.fpsFrames = 0;
    }

    this.accumulator += frameTime;

    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      const dt = FIXED_STEP * this.timeScale;
      this.elapsed += dt;
      this.callbacks.update(dt);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) {
      // We fell far behind (background tab, GC pause). Drop the backlog.
      this.accumulator = 0;
    }

    this.callbacks.render(frameTime);
  };
}
