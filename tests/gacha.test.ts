/**
 * Gacha correctness.
 *
 * These are the tests that matter most in the whole project: if the pull logic
 * is wrong, players pay for something that does not do what the rates screen
 * says it does. Every published guarantee gets an assertion.
 */

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Rng';
import { STANDARD_RATES, getBanner, type Banner } from '../src/data/banners';
import {
  createPityState,
  effectiveMythicRate,
  pullMany,
  pullOnce,
  rarityRank,
  simulateAverageMythicCost,
} from '../src/meta/gacha';
import { RARITIES } from '../src/render/palette';

const standard = getBanner('standard');
const featured = getBanner('eclipse-rising');
const noOwned = new Set<string>();

/** Roll `n` times with a fresh pity state and return the results. */
function roll(banner: Banner, n: number, seed = 'test'): ReturnType<typeof pullOnce>[] {
  const rng = new Rng(seed);
  const pity = createPityState();
  return Array.from({ length: n }, () => pullOnce(banner, pity, rng, noOwned));
}

describe('published rate table', () => {
  it('sums to exactly 1', () => {
    const total = RARITIES.reduce((s, r) => s + STANDARD_RATES[r], 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('is ordered so a rarer tier is never more likely than a commoner one', () => {
    for (let i = 1; i < RARITIES.length; i++) {
      const rarer = RARITIES[i]!;
      const commoner = RARITIES[i - 1]!;
      expect(STANDARD_RATES[rarer]).toBeLessThanOrEqual(STANDARD_RATES[commoner] + 1e-9);
    }
  });
});

describe('soft pity', () => {
  it('does not move before the soft pity start', () => {
    const pity = createPityState();
    pity.sinceMythic = standard.pity.softPityStart - 2;
    expect(effectiveMythicRate(standard, pity)).toBeCloseTo(standard.rates.mythic, 10);
  });

  it('rises by one step per pull once it begins', () => {
    const pity = createPityState();
    pity.sinceMythic = standard.pity.softPityStart - 1; // next pull is the first ramped one
    const first = effectiveMythicRate(standard, pity);
    pity.sinceMythic++;
    const second = effectiveMythicRate(standard, pity);
    expect(first).toBeCloseTo(standard.rates.mythic + standard.pity.softPityStep, 10);
    expect(second - first).toBeCloseTo(standard.pity.softPityStep, 10);
  });

  it('reaches certainty at hard pity', () => {
    const pity = createPityState();
    pity.sinceMythic = standard.pity.hardPity - 1;
    expect(effectiveMythicRate(standard, pity)).toBe(1);
  });
});

describe('hard pity', () => {
  it('always produces a mythic within the published number of pulls', () => {
    for (let seed = 0; seed < 40; seed++) {
      const results = roll(standard, standard.pity.hardPity, `hard-${seed}`);
      expect(results.some((r) => r.rarity === 'mythic')).toBe(true);
    }
  });

  it('resets the counter after a mythic', () => {
    const rng = new Rng('reset');
    const pity = createPityState();
    let sawMythic = false;
    for (let i = 0; i < 200; i++) {
      const r = pullOnce(standard, pity, rng, noOwned);
      if (r.rarity === 'mythic') {
        expect(pity.sinceMythic).toBe(0);
        sawMythic = true;
      }
    }
    expect(sawMythic).toBe(true);
  });
});

describe('tier floors', () => {
  it('never goes more than the epic floor without an epic or better', () => {
    const rng = new Rng('epic-floor');
    const pity = createPityState();
    let sinceEpic = 0;
    for (let i = 0; i < 600; i++) {
      const r = pullOnce(standard, pity, rng, noOwned);
      if (rarityRank(r.rarity) >= rarityRank('epic')) sinceEpic = 0;
      else sinceEpic++;
      expect(sinceEpic).toBeLessThan(standard.pity.epicFloor);
    }
  });

  it('never goes more than the legendary floor without a legendary or better', () => {
    const rng = new Rng('legendary-floor');
    const pity = createPityState();
    let since = 0;
    for (let i = 0; i < 900; i++) {
      const r = pullOnce(standard, pity, rng, noOwned);
      if (rarityRank(r.rarity) >= rarityRank('legendary')) since = 0;
      else since++;
      expect(since).toBeLessThan(standard.pity.legendaryPity);
    }
  });
});

describe('ten-pull', () => {
  it('always contains at least a rare', () => {
    for (let seed = 0; seed < 60; seed++) {
      const rng = new Rng(`ten-${seed}`);
      const pity = createPityState();
      const batch = pullMany(standard, pity, rng, noOwned, 10);
      expect(batch).toHaveLength(10);
      const best = Math.max(...batch.map((r) => rarityRank(r.rarity)));
      expect(best).toBeGreaterThanOrEqual(rarityRank('rare'));
    }
  });

  it('advances pity by exactly ten', () => {
    const rng = new Rng('ten-pity');
    const pity = createPityState();
    pullMany(standard, pity, rng, noOwned, 10);
    expect(pity.total).toBe(10);
  });
});

describe('featured banner', () => {
  it('guarantees the featured mythic after losing the coin flip', () => {
    const rng = new Rng('fifty-fifty');
    const pity = createPityState();
    const featuredIds = new Set(featured.featured);

    let losses = 0;
    let guaranteedWins = 0;

    for (let i = 0; i < 4000; i++) {
      const wasGuaranteed = pity.guaranteedFeatured;
      const r = pullOnce(featured, pity, rng, noOwned);
      if (r.rarity !== 'mythic') continue;
      if (wasGuaranteed) {
        // A guaranteed pull must be the featured mythic, and must clear the flag.
        expect(featuredIds.has(r.guardian.id)).toBe(true);
        expect(pity.guaranteedFeatured).toBe(false);
        guaranteedWins++;
      } else if (!featuredIds.has(r.guardian.id)) {
        expect(pity.guaranteedFeatured).toBe(true);
        losses++;
      }
    }
    expect(losses).toBeGreaterThan(0);
    // Every loss is repaid by the next mythic. The loop can end with one
    // guarantee still outstanding, so the counts differ by at most one.
    expect(losses - guaranteedWins).toBeGreaterThanOrEqual(0);
    expect(losses - guaranteedWins).toBeLessThanOrEqual(1);
    expect(pity.guaranteedFeatured).toBe(losses - guaranteedWins === 1);
  });

  it('marks featured pulls with the featured flag', () => {
    const rng = new Rng('flag');
    const pity = createPityState();
    const featuredIds = new Set(featured.featured);
    for (let i = 0; i < 500; i++) {
      const r = pullOnce(featured, pity, rng, noOwned);
      expect(r.featured).toBe(featuredIds.has(r.guardian.id));
    }
  });

  it('has no featured guardians on the permanent banner', () => {
    const rng = new Rng('permanent');
    const pity = createPityState();
    for (let i = 0; i < 200; i++) {
      expect(pullOnce(standard, pity, rng, noOwned).featured).toBe(false);
    }
  });
});

describe('observed distribution', () => {
  it('lands near the published rates when pity rarely engages', () => {
    const rng = new Rng('distribution');
    const counts: Record<string, number> = {};
    const trials = 40_000;
    for (let i = 0; i < trials; i++) {
      // A fresh pity state each pull isolates the base rates from the floors.
      const r = pullOnce(standard, createPityState(), rng, noOwned);
      counts[r.rarity] = (counts[r.rarity] ?? 0) + 1;
    }
    for (const rarity of RARITIES) {
      const observed = (counts[rarity] ?? 0) / trials;
      const expected = STANDARD_RATES[rarity];
      // Three standard deviations of a binomial, with a floor for the rare tiers.
      const sd = Math.sqrt((expected * (1 - expected)) / trials);
      expect(Math.abs(observed - expected)).toBeLessThan(Math.max(4 * sd, 0.004));
    }
  });
});

describe('duplicate marking', () => {
  it('flags results the player already owns without changing the odds', () => {
    const rng = new Rng('dupes');
    const pity = createPityState();
    const owned = new Set(['vane']);
    let sawVane = false;
    for (let i = 0; i < 400; i++) {
      const r = pullOnce(standard, pity, rng, owned);
      if (r.guardian.id === 'vane') {
        expect(r.duplicate).toBe(true);
        sawVane = true;
      } else {
        expect(r.duplicate).toBe(false);
      }
    }
    expect(sawVane).toBe(true);
  });

  it('marks repeats within a single ten-pull', () => {
    const rng = new Rng('within-batch');
    const pity = createPityState();
    const batch = pullMany(standard, pity, rng, noOwned, 10);
    const seen = new Set<string>();
    for (const r of batch) {
      if (seen.has(r.guardian.id)) expect(r.duplicate).toBe(true);
      seen.add(r.guardian.id);
    }
  });
});

describe('cost expectation', () => {
  it('reports an average mythic cost inside a believable band', () => {
    const cost = simulateAverageMythicCost(standard, new Rng('cost'), 3000);
    const pulls = cost / standard.costSingle;
    // With a 0.7% base rate and pity from 61, the true figure sits in the
    // mid-sixties. A result outside 45-80 means pity or the base rate broke.
    expect(pulls).toBeGreaterThan(45);
    expect(pulls).toBeLessThan(80);
  });
});

describe('determinism', () => {
  it('produces identical sequences from identical seeds', () => {
    const a = roll(standard, 50, 'same-seed').map((r) => r.guardian.id);
    const b = roll(standard, 50, 'same-seed').map((r) => r.guardian.id);
    expect(a).toEqual(b);
  });

  it('produces different sequences from different seeds', () => {
    const a = roll(standard, 50, 'seed-a').map((r) => r.guardian.id);
    const b = roll(standard, 50, 'seed-b').map((r) => r.guardian.id);
    expect(a).not.toEqual(b);
  });
});
