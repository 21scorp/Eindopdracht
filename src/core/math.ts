/**
 * Small, allocation-free math helpers used across the engine.
 * Everything here is pure so it can be unit tested without a DOM.
 */

export const TAU = Math.PI * 2;
export const HALF_PI = Math.PI / 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function remap(v: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, inverseLerp(inMin, inMax, v));
}

/**
 * Frame-rate independent exponential smoothing.
 * `halfLife` is the time in seconds for the value to travel half the remaining distance.
 */
export function damp(current: number, target: number, halfLife: number, dt: number): number {
  if (halfLife <= 0) return target;
  return lerp(target, current, Math.pow(2, -dt / halfLife));
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

/** Wrap an angle into [0, TAU). */
export function normalizeAngle(a: number): number {
  let x = a % TAU;
  if (x < 0) x += TAU;
  return x;
}

/** Shortest signed delta from `a` to `b`. */
export function angleDelta(a: number, b: number): number {
  return wrapAngle(b - a);
}

/** Absolute shortest distance between two angles, in [0, PI]. */
export function angleDistance(a: number, b: number): number {
  return Math.abs(wrapAngle(b - a));
}

/** Interpolate between angles along the shortest path. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

/** Exponential smoothing for angles, taking the shortest path. */
export function dampAngle(current: number, target: number, halfLife: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.pow(2, -dt / halfLife));
}

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function smootherstep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function length2(x: number, y: number): number {
  return x * x + y * y;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function sign(v: number): number {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + sign(d) * maxDelta;
}

/** Round to a fixed number of decimals — used for display and save-file stability. */
export function roundTo(v: number, decimals = 0): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}
