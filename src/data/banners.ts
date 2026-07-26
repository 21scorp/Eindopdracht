/**
 * Banner definitions.
 *
 * Rates are published in the UI exactly as they are written here — the Rates
 * screen renders from this object, so the numbers a player sees can never drift
 * from the numbers the roll uses. That is both the honest thing to do and a
 * store requirement in most territories.
 */

import type { Rarity } from '../render/palette';

export interface PityConfig {
  /** Pull count at which the mythic rate starts ramping. */
  softPityStart: number;
  /** Rate added per pull once soft pity begins. */
  softPityStep: number;
  /** Guaranteed mythic at this pull count since the last one. */
  hardPity: number;
  /** Guaranteed legendary-or-better at this count since the last one. */
  legendaryPity: number;
  /** Every N pulls guarantees at least an epic. */
  epicFloor: number;
}

export interface Banner {
  id: string;
  name: string;
  subtitle: string;
  /** Guardian ids that get a rate-up within their tier. */
  featured: string[];
  /** Ids excluded from this banner entirely. */
  excluded?: string[];
  /** Base rates. Must sum to 1. */
  rates: Record<Rarity, number>;
  /** Chance a mythic pull is the featured mythic. Losing it guarantees the next. */
  featuredMythicChance: number;
  /** Within a tier, featured entries get this much of the tier's probability. */
  featuredTierShare: number;
  pity: PityConfig;
  /** Prism cost per pull, and for a ten-pull. */
  costSingle: number;
  costTen: number;
  /** Accent colour for the banner UI. */
  accent: string;
  /** Short copy shown on the banner card. */
  blurb: string;
  /** Set for the permanent banner that never rotates. */
  permanent?: boolean;
}

export const STANDARD_PITY: PityConfig = {
  softPityStart: 61,
  softPityStep: 0.06,
  hardPity: 90,
  legendaryPity: 20,
  epicFloor: 10,
};

/**
 * The published rate table. Every banner shares it; only rate-up differs.
 *
 * Ordered so the tier names mean what they say — Common really is the most
 * common outcome. A table where "Rare" is the likeliest result is the kind of
 * detail that quietly erodes trust in every other number on the screen.
 */
export const STANDARD_RATES: Record<Rarity, number> = {
  mythic: 0.007,
  legendary: 0.053,
  epic: 0.2,
  rare: 0.3,
  common: 0.44,
};

export const BANNERS: readonly Banner[] = [
  {
    id: 'eclipse-rising',
    name: 'ECLIPSE RISING',
    subtitle: 'Limited Signal',
    featured: ['eclipse', 'kestrel', 'seraph'],
    rates: STANDARD_RATES,
    featuredMythicChance: 0.5,
    featuredTierShare: 0.5,
    pity: STANDARD_PITY,
    costSingle: 160,
    costTen: 1500,
    accent: '#FF3D6E',
    blurb: 'ECLIPSE holds the tightest arc in the roster and the widest parry window. Rate-up on ECLIPSE, KESTREL and SERAPH.',
  },
  {
    id: 'standard',
    name: 'OPEN CHANNEL',
    subtitle: 'Permanent',
    featured: [],
    rates: STANDARD_RATES,
    featuredMythicChance: 0.5,
    featuredTierShare: 0.5,
    pity: STANDARD_PITY,
    costSingle: 160,
    costTen: 1500,
    accent: '#4DE1FF',
    blurb: 'Every Guardian in the archive, at published rates. Pity carries over between sessions and never resets on its own.',
    permanent: true,
  },
];

export const BANNER_BY_ID: ReadonlyMap<string, Banner> = new Map(BANNERS.map((b) => [b.id, b]));

export function getBanner(id: string): Banner {
  const b = BANNER_BY_ID.get(id);
  if (!b) throw new Error(`Unknown banner "${id}"`);
  return b;
}

export const DEFAULT_BANNER_ID = BANNERS[0]!.id;
