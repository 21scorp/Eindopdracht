/**
 * @vitest-environment happy-dom
 *
 * Engine primitives.
 *
 * Angle maths and the RNG underpin everything else, so they get direct
 * coverage rather than being tested implicitly through gameplay.
 */

import { describe, expect, it } from 'vitest';
import {
  TAU,
  angleDelta,
  angleDistance,
  clamp,
  clamp01,
  damp,
  dampAngle,
  inverseLerp,
  lerp,
  lerpAngle,
  moveToward,
  normalizeAngle,
  remap,
  roundTo,
  smoothstep,
  wrapAngle,
} from '../src/core/math';
import { Rng, seedFromString } from '../src/core/Rng';
import { EventBus } from '../src/core/EventBus';
import { alpha, hexToRgb, mix, rgbToHex, hsl, RARITY_STYLE, RARITIES } from '../src/render/palette';
import { getGuardian } from '../src/data/guardians';
import {
  decodeChallenge,
  encodeChallenge,
  evaluateChallenge,
  readChallengeFromUrl,
} from '../src/meta/challenge';

describe('scalar maths', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp01(0.5)).toBe(0.5);
  });

  it('interpolates and inverts', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(inverseLerp(0, 10, 2.5)).toBe(0.25);
    expect(inverseLerp(4, 4, 4)).toBe(0);
    expect(remap(5, 0, 10, 100, 200)).toBe(150);
  });

  it('smoothsteps within bounds', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 6);
    expect(smoothstep(-3)).toBe(0);
  });

  it('moves toward a target without overshooting', () => {
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(0, 2, 3)).toBe(2);
    expect(moveToward(0, -2, 3)).toBe(-2);
  });

  it('rounds to a fixed precision', () => {
    expect(roundTo(1.2345, 2)).toBe(1.23);
    expect(roundTo(1.9)).toBe(2);
  });
});

describe('damping', () => {
  it('reaches half the distance in one half-life', () => {
    expect(damp(0, 100, 0.5, 0.5)).toBeCloseTo(50, 6);
  });

  it('is frame-rate independent', () => {
    const oneStep = damp(0, 100, 0.4, 0.5);
    let many = 0;
    for (let i = 0; i < 50; i++) many = damp(many, 100, 0.4, 0.01);
    expect(many).toBeCloseTo(oneStep, 6);
  });

  it('snaps to the target for a zero half-life', () => {
    expect(damp(0, 100, 0, 0.016)).toBe(100);
  });
});

describe('angles', () => {
  it('wraps into (-PI, PI]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 10);
    expect(wrapAngle(TAU)).toBeCloseTo(0, 10);
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI / 2, 10);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 10);
  });

  it('normalises into [0, TAU)', () => {
    expect(normalizeAngle(-0.5)).toBeCloseTo(TAU - 0.5, 10);
    expect(normalizeAngle(TAU + 0.5)).toBeCloseTo(0.5, 10);
    for (const a of [-10, -1, 0, 1, 10, 100]) {
      const n = normalizeAngle(a);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(TAU);
    }
  });

  it('takes the short way around', () => {
    expect(angleDelta(0.1, TAU - 0.1)).toBeCloseTo(-0.2, 10);
    expect(angleDistance(0.1, TAU - 0.1)).toBeCloseTo(0.2, 10);
    expect(angleDistance(0, Math.PI)).toBeCloseTo(Math.PI, 10);
  });

  it('never reports a distance above PI', () => {
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * TAU * 3 - TAU;
      const b = ((i * 7) / 200) * TAU - TAU;
      expect(angleDistance(a, b)).toBeLessThanOrEqual(Math.PI + 1e-9);
    }
  });

  it('interpolates across the seam', () => {
    const mid = lerpAngle(0.1, TAU - 0.1, 0.5);
    expect(Math.abs(wrapAngle(mid))).toBeLessThan(0.01);
  });

  it('damps across the seam without spinning the long way', () => {
    // Target is just below zero. Damping must cross the seam directly rather
    // than travelling almost all the way around.
    let a = 0.1;
    let travelled = 0;
    for (let i = 0; i < 60; i++) {
      const before = a;
      a = dampAngle(a, TAU - 0.1, 0.05, 0.016);
      travelled += angleDistance(before, a);
    }
    expect(angleDistance(a, TAU - 0.1)).toBeLessThan(0.02);
    expect(travelled).toBeLessThan(0.5);
  });
});

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = new Rng('abc');
    const b = new Rng('abc');
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('diverges for different seeds', () => {
    const a = new Rng('abc');
    const b = new Rng('abd');
    let same = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) same++;
    expect(same).toBeLessThan(3);
  });

  it('stays inside [0, 1)', () => {
    const r = new Rng('range');
    for (let i = 0; i < 20_000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is roughly uniform', () => {
    const r = new Rng('uniform');
    const buckets = new Array(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]!++;
    for (const count of buckets) {
      expect(Math.abs(count - n / 10) / (n / 10)).toBeLessThan(0.05);
    }
  });

  it('produces integers across the full inclusive range', () => {
    const r = new Rng('int');
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.int(3, 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect(seen.size).toBe(5);
  });

  it('honours weights', () => {
    const r = new Rng('weights');
    const counts = [0, 0, 0];
    for (let i = 0; i < 30_000; i++) counts[r.weightedIndex([1, 3, 6])]!++;
    expect(counts[0]! / 30_000).toBeCloseTo(0.1, 1);
    expect(counts[1]! / 30_000).toBeCloseTo(0.3, 1);
    expect(counts[2]! / 30_000).toBeCloseTo(0.6, 1);
  });

  it('ignores zero-weight entries', () => {
    const r = new Rng('zero');
    for (let i = 0; i < 500; i++) expect(r.weightedIndex([0, 1, 0])).toBe(1);
  });

  it('throws on impossible inputs rather than returning nonsense', () => {
    const r = new Rng('throws');
    expect(() => r.pick([])).toThrow();
    expect(() => r.weightedIndex([0, 0])).toThrow();
  });

  it('round-trips its state', () => {
    const r = new Rng('state');
    for (let i = 0; i < 17; i++) r.next();
    const snapshot = r.getState();
    const expected = Array.from({ length: 10 }, () => r.next());

    const restored = new Rng(snapshot);
    expect(Array.from({ length: 10 }, () => restored.next())).toEqual(expected);
  });

  it('survives a JSON round-trip of its state', () => {
    const r = new Rng('json');
    r.next();
    const revived = new Rng(JSON.parse(JSON.stringify(r.getState())));
    expect(revived.next()).toBe(r.clone().next());
  });

  it('shuffles without losing or duplicating elements', () => {
    const r = new Rng('shuffle');
    const input = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = r.shuffle([...input]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(input);
    expect(shuffled).not.toEqual(input);
  });

  it('hashes different strings to different seeds', () => {
    expect(seedFromString('a')).not.toEqual(seedFromString('b'));
    expect(seedFromString('same')).toEqual(seedFromString('same'));
  });
});

describe('event bus', () => {
  it('delivers to every listener and supports unsubscribe', () => {
    const bus = new EventBus<{ ping: number }>();
    const seen: number[] = [];
    const off = bus.on('ping', (v) => seen.push(v));
    bus.on('ping', (v) => seen.push(v * 10));
    bus.emit('ping', 1);
    off();
    bus.emit('ping', 2);
    expect(seen).toEqual([1, 10, 20]);
  });

  it('fires a once listener exactly once', () => {
    const bus = new EventBus<{ ping: void }>();
    let n = 0;
    bus.once('ping', () => n++);
    bus.emit('ping', undefined);
    bus.emit('ping', undefined);
    expect(n).toBe(1);
  });

  it('survives a listener that throws', () => {
    const bus = new EventBus<{ ping: void }>();
    let reached = false;
    bus.on('ping', () => {
      throw new Error('boom');
    });
    bus.on('ping', () => (reached = true));
    expect(() => bus.emit('ping', undefined)).not.toThrow();
    expect(reached).toBe(true);
  });

  it('tolerates a listener unsubscribing during dispatch', () => {
    const bus = new EventBus<{ ping: void }>();
    const seen: string[] = [];
    const off = bus.on('ping', () => {
      seen.push('a');
      off();
    });
    bus.on('ping', () => seen.push('b'));
    bus.emit('ping', undefined);
    bus.emit('ping', undefined);
    expect(seen).toEqual(['a', 'b', 'b']);
  });
});

describe('palette', () => {
  it('round-trips hex and rgb', () => {
    expect(rgbToHex(hexToRgb('#4DE1FF'))).toBe('#4de1ff');
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('produces valid rgba strings', () => {
    expect(alpha('#000000', 0.5)).toBe('rgba(0,0,0,0.5)');
    expect(alpha('#000000', 5)).toBe('rgba(0,0,0,1)');
    expect(alpha('#000000', -1)).toBe('rgba(0,0,0,0)');
  });

  it('mixes toward the endpoints', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('produces a valid colour for any hue', () => {
    for (let h = -720; h <= 720; h += 37) {
      expect(hsl(h, 0.8, 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('defines a style for every rarity, escalating in drama', () => {
    let previous = -1;
    for (const r of RARITIES) {
      const style = RARITY_STYLE[r];
      expect(style).toBeDefined();
      expect(style.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(style.drama).toBeGreaterThan(previous);
      previous = style.drama;
    }
    expect(RARITY_STYLE.mythic.prismatic).toBe(true);
  });
});

describe('challenge links', () => {
  const sample = { seed: 'p_abc123-1700000000000', score: 412_345, wave: 14, name: 'QUINCY', guardianId: 'eclipse' };

  it('round-trips a challenge', () => {
    const decoded = decodeChallenge(encodeChallenge(sample));
    expect(decoded).toEqual(sample);
  });

  it('produces a token that survives a URL', () => {
    const token = encodeChallenge(sample);
    expect(token).not.toMatch(/[+/=]/);
    const url = new URL(`https://example.com/?c=${token}`);
    expect(decodeChallenge(url.searchParams.get('c')!)).toEqual(sample);
  });

  it('rejects junk rather than starting a broken run', () => {
    expect(decodeChallenge('')).toBeNull();
    expect(decodeChallenge('not-base64!!')).toBeNull();
    expect(decodeChallenge(btoa('999|seed|1|1|vane|X'))).toBeNull();
    expect(decodeChallenge(btoa('1|seed'))).toBeNull();
  });

  it('never hands on a Guardian that does not exist', () => {
    // This one crashed the app during boot and left a blank screen, which is
    // the worst possible outcome for the one feature whose whole job is being
    // opened by somebody who has never played.
    const decoded = decodeChallenge(encodeChallenge({ ...sample, guardianId: 'not-a-guardian' }));
    expect(decoded).not.toBeNull();
    expect(() => getGuardian(decoded!.guardianId)).not.toThrow();
  });

  it('clamps an absurd seed rather than carrying it around', () => {
    const decoded = decodeChallenge(encodeChallenge({ ...sample, seed: 'x'.repeat(5000) }));
    expect(decoded!.seed.length).toBeLessThanOrEqual(96);
    expect(decoded!.seed.length).toBeGreaterThan(0);
  });

  it('clamps a hostile payload instead of trusting it', () => {
    const decoded = decodeChallenge(encodeChallenge({ ...sample, score: -50, wave: -3, name: 'X'.repeat(80) }));
    expect(decoded!.score).toBe(0);
    expect(decoded!.wave).toBe(1);
    expect(decoded!.name.length).toBeLessThanOrEqual(14);
  });

  it('reads and clears the parameter from a query string', () => {
    const token = encodeChallenge(sample);
    expect(readChallengeFromUrl(`?c=${token}`)).toEqual(sample);
    expect(readChallengeFromUrl('?other=1')).toBeNull();
  });

  it('scores an attempt against the target', () => {
    expect(evaluateChallenge(sample, 500_000)).toEqual({ outcome: 'beaten', margin: 87_655 });
    expect(evaluateChallenge(sample, 400_000)).toEqual({ outcome: 'missed', margin: 12_345 });
    expect(evaluateChallenge(sample, sample.score)).toEqual({ outcome: 'beaten', margin: 0 });
  });
});
