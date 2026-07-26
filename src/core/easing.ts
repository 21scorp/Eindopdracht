/**
 * Easing curves. All take and return a normalised t in [0, 1].
 * These drive nearly every piece of "juice" in the game, so they live in one
 * place and are named after the classic Penner set.
 */

import { clamp01 } from './math';

export type Easing = (t: number) => number;

export const linear: Easing = (t) => t;

export const quadIn: Easing = (t) => t * t;
export const quadOut: Easing = (t) => t * (2 - t);
export const quadInOut: Easing = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);

export const cubicIn: Easing = (t) => t * t * t;
export const cubicOut: Easing = (t) => 1 + --t * t * t;
export const cubicInOut: Easing = (t) => (t < 0.5 ? 4 * t * t * t : 1 + (t - 1) * (2 * t - 2) * (2 * t - 2));

export const quartOut: Easing = (t) => 1 - Math.pow(1 - t, 4);
export const quintOut: Easing = (t) => 1 - Math.pow(1 - t, 5);

export const expoIn: Easing = (t) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10));
export const expoOut: Easing = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
export const expoInOut: Easing = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;

export const sineIn: Easing = (t) => 1 - Math.cos((t * Math.PI) / 2);
export const sineOut: Easing = (t) => Math.sin((t * Math.PI) / 2);
export const sineInOut: Easing = (t) => -(Math.cos(Math.PI * t) - 1) / 2;

export const circOut: Easing = (t) => Math.sqrt(1 - Math.pow(t - 1, 2));

const C4 = (2 * Math.PI) / 3;
export const elasticOut: Easing = (t) =>
  t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1;

const BACK_C1 = 1.70158;
const BACK_C3 = BACK_C1 + 1;
export const backOut: Easing = (t) => 1 + BACK_C3 * Math.pow(t - 1, 3) + BACK_C1 * Math.pow(t - 1, 2);
export const backIn: Easing = (t) => BACK_C3 * t * t * t - BACK_C1 * t * t;

export const bounceOut: Easing = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
};

/** A quick "pop" curve: overshoot then settle. Great for reveal cards. */
export const pop: Easing = (t) => {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3) * Math.cos(x * Math.PI * 1.5);
};

/** Rises to 1 at the midpoint then falls back to 0. Useful for flashes. */
export const spike: Easing = (t) => {
  const x = clamp01(t);
  return x < 0.5 ? quadOut(x * 2) : quadOut((1 - x) * 2);
};
