/**
 * The pull.
 *
 * Pure functions over an explicit state object — no storage, no DOM, no
 * randomness beyond the `Rng` you hand it. That makes the whole system unit
 * testable, and it means a pull can be replayed from its recorded RNG state if
 * a player ever disputes a result.
 *
 * The model is the one players already understand from the genre, implemented
 * honestly:
 *
 *   base rates       published in `banners.ts`, used verbatim
 *   soft pity        mythic rate ramps from pull 61
 *   hard pity        guaranteed mythic at pull 90
 *   legendary pity   guaranteed legendary+ every 20
 *   epic floor       guaranteed epic+ every 10
 *   50/50            a mythic is the featured one half the time; losing
 *                    guarantees the next mythic is featured
 *
 * No hidden rate manipulation based on spend, session length or account age.
 * If a number matters, it is in the banner config and shown in the UI.
 */

import type { Rng } from '../core/Rng';
import { RARITIES, type Rarity } from '../render/palette';
import { GUARDIANS, type Guardian } from '../data/guardians';
import type { Banner } from '../data/banners';

export interface PityState {
  /** Pulls since the last mythic. */
  sinceMythic: number;
  /** Pulls since the last legendary or better. */
  sinceLegendary: number;
  /** Pulls since the last epic or better. */
  sinceEpic: number;
  /** True when the next mythic is guaranteed to be the featured one. */
  guaranteedFeatured: boolean;
  /** Lifetime pulls on this banner, for the history panel. */
  total: number;
}

export function createPityState(): PityState {
  return { sinceMythic: 0, sinceLegendary: 0, sinceEpic: 0, guaranteedFeatured: false, total: 0 };
}

export interface PullResult {
  guardian: Guardian;
  rarity: Rarity;
  /** True if this was the banner's featured Guardian. */
  featured: boolean;
  /** True if the player already owned it — the caller converts it to shards. */
  duplicate: boolean;
  /** Which guarantee produced this pull, if any. Surfaced in the pull log. */
  reason: 'natural' | 'soft-pity' | 'hard-pity' | 'legendary-pity' | 'epic-floor';
  /** Effective mythic rate at the moment of the roll, for the audit log. */
  mythicRate: number;
  /** Pull index within the account's history on this banner. */
  index: number;
}

/** The mythic rate in effect for the *next* pull, given current pity. */
export function effectiveMythicRate(banner: Banner, pity: PityState): number {
  const next = pity.sinceMythic + 1;
  if (next >= banner.pity.hardPity) return 1;
  if (next < banner.pity.softPityStart) return banner.rates.mythic;
  const steps = next - banner.pity.softPityStart + 1;
  return Math.min(1, banner.rates.mythic + steps * banner.pity.softPityStep);
}

/** Guardians eligible on a banner, grouped by rarity. */
export function eligibleByRarity(banner: Banner): Record<Rarity, Guardian[]> {
  const excluded = new Set(banner.excluded ?? []);
  const out = {} as Record<Rarity, Guardian[]>;
  for (const r of RARITIES) out[r] = [];
  for (const g of GUARDIANS) {
    if (excluded.has(g.id)) continue;
    out[g.rarity].push(g);
  }
  return out;
}

/**
 * Roll a single pull and advance `pity` in place.
 *
 * `owned` is only used to mark duplicates; it never affects the odds.
 */
export function pullOnce(banner: Banner, pity: PityState, rng: Rng, owned: ReadonlySet<string>): PullResult {
  const pools = eligibleByRarity(banner);
  const mythicRate = effectiveMythicRate(banner, pity);

  pity.total++;
  pity.sinceMythic++;
  pity.sinceLegendary++;
  pity.sinceEpic++;
  const index = pity.total;

  let rarity: Rarity;
  let reason: PullResult['reason'] = 'natural';

  if (pity.sinceMythic >= banner.pity.hardPity) {
    rarity = 'mythic';
    reason = 'hard-pity';
  } else if (rng.chance(mythicRate)) {
    rarity = 'mythic';
    reason = mythicRate > banner.rates.mythic ? 'soft-pity' : 'natural';
  } else if (pity.sinceLegendary >= banner.pity.legendaryPity) {
    rarity = 'legendary';
    reason = 'legendary-pity';
  } else if (pity.sinceEpic >= banner.pity.epicFloor) {
    // The epic floor guarantees epic-or-better, so legendary can still land here.
    rarity = rng.chance(rateWithin(banner, 'legendary', ['legendary', 'epic'])) ? 'legendary' : 'epic';
    reason = 'epic-floor';
  } else {
    rarity = rollRarityBelowMythic(banner, rng);
  }

  // Reset the relevant counters.
  if (rarity === 'mythic') {
    pity.sinceMythic = 0;
    pity.sinceLegendary = 0;
    pity.sinceEpic = 0;
  } else if (rarity === 'legendary') {
    pity.sinceLegendary = 0;
    pity.sinceEpic = 0;
  } else if (rarity === 'epic') {
    pity.sinceEpic = 0;
  }

  const { guardian, featured } = pickGuardian(banner, rarity, pools, pity, rng);

  return {
    guardian,
    rarity,
    featured,
    duplicate: owned.has(guardian.id),
    reason,
    mythicRate,
    index,
  };
}

/**
 * A ten-pull. Applies the same per-pull logic, then enforces the "at least one
 * rare or better in every ten" floor that the genre expects. Since the base
 * rare rate is 44%, that floor almost never triggers — but it must exist,
 * because the one time it does is the run a player would otherwise quit over.
 */
export function pullMany(
  banner: Banner,
  pity: PityState,
  rng: Rng,
  owned: ReadonlySet<string>,
  count: number,
): PullResult[] {
  const results: PullResult[] = [];
  const seen = new Set(owned);

  for (let i = 0; i < count; i++) {
    const r = pullOnce(banner, pity, rng, seen);
    seen.add(r.guardian.id);
    results.push(r);
  }

  if (count >= 10) {
    const best = results.reduce((a, b) => (rarityRank(b.rarity) > rarityRank(a.rarity) ? b : a));
    if (rarityRank(best.rarity) < rarityRank('rare')) {
      // Upgrade the last common into a rare rather than adding an extra pull.
      const pools = eligibleByRarity(banner);
      const last = results[results.length - 1]!;
      const upgraded = pickGuardian(banner, 'rare', pools, pity, rng);
      last.guardian = upgraded.guardian;
      last.rarity = 'rare';
      last.featured = upgraded.featured;
      last.duplicate = owned.has(upgraded.guardian.id);
    }
  }

  return results;
}

function rollRarityBelowMythic(banner: Banner, rng: Rng): Rarity {
  const tiers: Rarity[] = ['legendary', 'epic', 'rare', 'common'];
  const weights = tiers.map((t) => banner.rates[t]);
  return tiers[rng.weightedIndex(weights)]!;
}

/** Relative chance of `target` among `among`, using the banner's base rates. */
function rateWithin(banner: Banner, target: Rarity, among: Rarity[]): number {
  const total = among.reduce((s, r) => s + banner.rates[r], 0);
  return total <= 0 ? 0 : banner.rates[target] / total;
}

function pickGuardian(
  banner: Banner,
  rarity: Rarity,
  pools: Record<Rarity, Guardian[]>,
  pity: PityState,
  rng: Rng,
): { guardian: Guardian; featured: boolean } {
  const pool = pools[rarity];
  if (pool.length === 0) {
    // Should be impossible with the shipped roster, but a banner config typo
    // must not crash a pull. Fall back to the nearest populated tier.
    for (const r of [...RARITIES].reverse()) {
      if (pools[r].length > 0) return { guardian: rng.pick(pools[r]), featured: false };
    }
    throw new Error('No guardians available for any rarity');
  }

  const featuredHere = pool.filter((g) => banner.featured.includes(g.id));
  const others = pool.filter((g) => !banner.featured.includes(g.id));

  if (featuredHere.length === 0) return { guardian: rng.pick(pool), featured: false };

  if (rarity === 'mythic') {
    // The 50/50, with a guarantee after a loss.
    const wins = pity.guaranteedFeatured || rng.chance(banner.featuredMythicChance);
    pity.guaranteedFeatured = !wins;
    if (wins) return { guardian: rng.pick(featuredHere), featured: true };
    return { guardian: others.length > 0 ? rng.pick(others) : rng.pick(featuredHere), featured: others.length === 0 };
  }

  // Lower tiers just get a share of their own tier's probability.
  if (others.length === 0 || rng.chance(banner.featuredTierShare)) {
    return { guardian: rng.pick(featuredHere), featured: true };
  }
  return { guardian: rng.pick(others), featured: false };
}

export function rarityRank(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/** Pulls remaining until the mythic hard pity fires. */
export function pullsToHardPity(banner: Banner, pity: PityState): number {
  return Math.max(0, banner.pity.hardPity - pity.sinceMythic);
}

/**
 * Expected prisms per mythic under this banner's rates and pity, by simulation.
 * The Rates screen shows this so players can see the real cost, not just the
 * headline 0.7%.
 */
export function simulateAverageMythicCost(banner: Banner, rng: Rng, trials = 4000): number {
  let totalPulls = 0;
  for (let i = 0; i < trials; i++) {
    const pity = createPityState();
    const owned = new Set<string>();
    let pulls = 0;
    // Bounded so a config error cannot hang the UI thread.
    while (pulls < banner.pity.hardPity + 1) {
      const r = pullOnce(banner, pity, rng, owned);
      pulls++;
      if (r.rarity === 'mythic') break;
    }
    totalPulls += pulls;
  }
  return (totalPulls / trials) * banner.costSingle;
}
