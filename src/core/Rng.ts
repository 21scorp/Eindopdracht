/**
 * Deterministic pseudo-random number generation.
 *
 * Two independent streams matter in this game:
 *  - the *cosmetic* stream (particles, sparkles) which can be seeded from time,
 *  - the *authoritative* stream (gacha, wave composition) which must be
 *    reproducible so a pull can be audited or a run replayed.
 *
 * We use sfc32 (small fast counter, 32-bit) — fast, tiny state, passes
 * PractRand, and its state serialises to four integers we can put in a save file.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Hash an arbitrary string into four well-mixed 32-bit seeds. */
export function seedFromString(str: string): RngState {
  // xmur3
  let h = 1779033703 ^ str.length;
  const next = (): number => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return { a: next(), b: next(), c: next(), d: next() };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string | RngState = String(Date.now())) {
    const s = typeof seed === 'string' ? seedFromString(seed) : seed;
    this.a = s.a >>> 0;
    this.b = s.b >>> 0;
    this.c = s.c >>> 0;
    this.d = s.d >>> 0;
    // Discard a few outputs so poorly-distributed seeds settle.
    for (let i = 0; i < 12; i++) this.next();
  }

  /** Raw uniform float in [0, 1). */
  next(): number {
    const a = this.a;
    const b = this.b;
    const c = this.c;
    const d = this.d;
    const t = (a + b) | 0;
    this.a = b ^ (b >>> 9);
    this.b = (c + (c << 3)) | 0;
    this.c = (c << 21) | (c >>> 11);
    this.d = (d + 1) | 0;
    const t2 = (t + d) | 0;
    this.c = (this.c + t2) | 0;
    return (t2 >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Random element. Throws on an empty array so bugs surface loudly. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with an empty array');
    return items[this.int(0, items.length - 1)]!;
  }

  /**
   * Weighted pick. `weights` must be the same length as `items` and sum to > 0.
   * Returns the index so callers can use it for logging/auditing.
   */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < weights.length; i++) total += Math.max(0, weights[i]!);
    if (total <= 0) throw new Error('Rng.weightedIndex called with non-positive total weight');
    let roll = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      roll -= Math.max(0, weights[i]!);
      if (roll < 0) return i;
    }
    return weights.length - 1;
  }

  /** Fisher-Yates, in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i);
      const tmp = items[i]!;
      items[i] = items[j]!;
      items[j] = tmp;
    }
    return items;
  }

  /** Approximately normal via the sum of three uniforms; cheap and good enough for VFX. */
  gaussian(mean = 0, stdDev = 1): number {
    const u = (this.next() + this.next() + this.next()) / 3;
    return mean + (u - 0.5) * 3.464 * stdDev;
  }

  /** Random unit angle. */
  angle(): number {
    return this.next() * Math.PI * 2;
  }

  /** Signed value in [-mag, mag]. */
  signedRange(mag: number): number {
    return this.range(-mag, mag);
  }

  getState(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  setState(s: RngState): void {
    this.a = s.a >>> 0;
    this.b = s.b >>> 0;
    this.c = s.c >>> 0;
    this.d = s.d >>> 0;
  }

  clone(): Rng {
    return new Rng(this.getState());
  }
}

/** Shared cosmetic stream. Never use this for anything the player can audit. */
export const fxRng = new Rng(`fx-${Date.now()}-${Math.random()}`);
