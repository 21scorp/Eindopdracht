/**
 * The Guardian roster.
 *
 * A Guardian is the thing you pull for, so each one has to change how the game
 * *feels*, not just add a number. Rarity buys you a more dramatic Ultimate and
 * a sharper stat profile — but every tier is viable, and the highest-skill
 * option in the game (a tight arc that parries wide) sits at Rare on purpose.
 * A collection game where the free character is unplayable loses its players.
 *
 * Art contract for the sprite pass: each entry declares `shape` and `hue`,
 * which drive the procedural placeholder. Real sprites override the texture
 * keys `guardian/<id>/portrait` (512x640) and `guardian/<id>/emblem` (192x192).
 */

import type { Rarity } from '../render/palette';
import type { SigilShape } from '../render/procgen';

export type UltimateId =
  | 'nova'
  | 'bulwark'
  | 'dilate'
  | 'magnetize'
  | 'lance'
  | 'mirror'
  | 'overcharge'
  | 'siphon'
  | 'fracture'
  | 'sentinel';

export interface GuardianStats {
  /** Shield arc width in radians. Wider is more forgiving, narrower scores more. */
  arc: number;
  /** Angular smoothing half-life in seconds. Lower is snappier. */
  turn: number;
  /** Seconds between pulses. */
  pulseCooldown: number;
  /** Seconds the pulse ring stays lethal. */
  pulseWindow: number;
  /** Perfect-parry window on a normal shield contact, in seconds. */
  parryWindow: number;
  /** Multiplier on the speed of deflected threats. */
  deflectSpeed: number;
  /** Starting nexus integrity. */
  integrity: number;
  /** Combo points required to charge the Ultimate. */
  ultCost: number;
  /** Flat score multiplier applied to everything this Guardian earns. */
  scoreMult: number;
}

export interface Guardian {
  id: string;
  name: string;
  title: string;
  rarity: Rarity;
  shape: SigilShape;
  hue: string;
  stats: GuardianStats;
  ultimate: UltimateId;
  /** One line the player reads on the card. Keep it punchy. */
  tagline: string;
  /** Longer flavour for the detail screen. */
  lore: string;
  /** Shown under the ultimate name. Written as a player-facing rules sentence. */
  ultimateText: string;
  /** True for the Guardian every account starts with. */
  starter?: boolean;
}

/** Baseline every Guardian is defined as a delta from. */
export const BASE_STATS: GuardianStats = {
  arc: 1.05,
  turn: 0.045,
  pulseCooldown: 2.6,
  pulseWindow: 0.16,
  parryWindow: 0.12,
  deflectSpeed: 1.5,
  integrity: 3,
  ultCost: 40,
  scoreMult: 1,
};

function stats(overrides: Partial<GuardianStats>): GuardianStats {
  return { ...BASE_STATS, ...overrides };
}

export const GUARDIANS: readonly Guardian[] = [
  // ---------------------------------------------------------------- COMMON --
  {
    id: 'vane',
    name: 'VANE',
    title: 'First Watch',
    rarity: 'common',
    shape: 'crest',
    hue: '#4DE1FF',
    starter: true,
    tagline: 'Broad shield. Forgiving timing. Learns you the rhythm.',
    lore: 'The training construct they never decommissioned. It has held the line longer than anything still standing, and it has never once been interesting about it.',
    ultimate: 'nova',
    ultimateText: 'NOVA — detonate the nexus outward, destroying every threat on screen.',
    stats: stats({ arc: 1.25, parryWindow: 0.14, ultCost: 38 }),
  },
  {
    id: 'slate',
    name: 'SLATE',
    title: 'Immovable',
    rarity: 'common',
    shape: 'anchor',
    hue: '#8A94A6',
    tagline: 'Extra integrity, slower turn. Survives what it cannot dodge.',
    lore: 'Built from the hull of the last evacuation barge. It does not turn quickly because it has never needed to be anywhere else.',
    ultimate: 'bulwark',
    ultimateText: 'BULWARK — the shield wraps a full circle for 5 seconds.',
    stats: stats({ arc: 1.15, turn: 0.075, integrity: 5, deflectSpeed: 1.3, scoreMult: 0.92 }),
  },
  {
    id: 'ember',
    name: 'EMBER',
    title: 'Short Fuse',
    rarity: 'common',
    shape: 'fang',
    hue: '#FF7A4D',
    tagline: 'Fast pulse cycle. Punishes crowds.',
    lore: 'A salvage drone that learned aggression by watching. It pulses more than it needs to, and it is not sorry.',
    ultimate: 'fracture',
    ultimateText: 'FRACTURE — shatter every threat into score shards that fly to the nexus.',
    stats: stats({ arc: 0.95, pulseCooldown: 1.9, pulseWindow: 0.14, integrity: 2, scoreMult: 1.06 }),
  },

  // ------------------------------------------------------------------ RARE --
  {
    id: 'kestrel',
    name: 'KESTREL',
    title: 'Edge Reader',
    rarity: 'rare',
    shape: 'blade',
    hue: '#3FA9FF',
    tagline: 'Narrow arc, huge parry window. The skill pick.',
    lore: 'Flies the line between contact and catastrophe, and files a report about it afterward.',
    ultimate: 'overcharge',
    ultimateText: 'OVERCHARGE — every contact counts as a perfect parry for 6 seconds.',
    stats: stats({ arc: 0.72, turn: 0.032, parryWindow: 0.2, deflectSpeed: 1.7, scoreMult: 1.22 }),
  },
  {
    id: 'halcyon',
    name: 'HALCYON',
    title: 'Slow Water',
    rarity: 'rare',
    shape: 'orbit',
    hue: '#5CFFAE',
    tagline: 'Bends time around the nexus when it matters.',
    lore: 'Keeps a private clock. Insists everyone else is the one running fast.',
    ultimate: 'dilate',
    ultimateText: 'DILATE — threats crawl at 30% speed for 5 seconds. Your shield does not.',
    stats: stats({ arc: 1.0, turn: 0.04, pulseCooldown: 2.4, ultCost: 34 }),
  },
  {
    id: 'onyx',
    name: 'ONYX',
    title: 'Return to Sender',
    rarity: 'rare',
    shape: 'prism',
    hue: '#A45CFF',
    tagline: 'Deflections hit harder and travel faster.',
    lore: 'Does not destroy incoming ordnance. Redirects it, with interest, toward whatever sent it.',
    ultimate: 'lance',
    ultimateText: 'LANCE — fire a piercing beam along your aim that shreds everything in its path.',
    stats: stats({ arc: 0.92, deflectSpeed: 2.1, pulseCooldown: 2.8, scoreMult: 1.14 }),
  },
  {
    id: 'vesper',
    name: 'VESPER',
    title: 'Last Light',
    rarity: 'rare',
    shape: 'bloom',
    hue: '#FFC24D',
    tagline: 'Trades integrity for a faster Ultimate cycle.',
    lore: 'Burns brightest at the end of the shift. Has never described this as a problem.',
    ultimate: 'siphon',
    ultimateText: 'SIPHON — drain every threat on screen into integrity and score.',
    stats: stats({ arc: 0.98, integrity: 2, ultCost: 28, scoreMult: 1.12 }),
  },

  // ------------------------------------------------------------------ EPIC --
  {
    id: 'seraph',
    name: 'SERAPH',
    title: 'Two Faces',
    rarity: 'epic',
    shape: 'eye',
    hue: '#4DE1FF',
    tagline: 'Mirrors your shield to the opposite side.',
    lore: 'Watches both approaches at once and finds the arrangement obvious.',
    ultimate: 'mirror',
    ultimateText: 'MIRROR — a second shield holds the opposite arc for 8 seconds.',
    stats: stats({ arc: 0.88, turn: 0.036, parryWindow: 0.15, deflectSpeed: 1.7, scoreMult: 1.26 }),
  },
  {
    id: 'noct',
    name: 'NOCT',
    title: 'Gravity Well',
    rarity: 'epic',
    shape: 'orbit',
    hue: '#C86BFF',
    tagline: 'Drags threats together so one parry clears many.',
    lore: 'Small, dense, and entirely uninterested in where anything else intended to go.',
    ultimate: 'magnetize',
    ultimateText: 'MAGNETIZE — pull every threat into one point, then detonate it.',
    stats: stats({ arc: 0.94, pulseCooldown: 2.3, pulseWindow: 0.18, ultCost: 42, scoreMult: 1.2 }),
  },
  {
    id: 'zephyr',
    name: 'ZEPHYR',
    title: 'No Wasted Motion',
    rarity: 'epic',
    shape: 'blade',
    hue: '#5CFFAE',
    tagline: 'The snappiest shield in the roster.',
    lore: 'Arrives before the decision to arrive has finished forming.',
    ultimate: 'sentinel',
    ultimateText: 'SENTINEL — three drones orbit and auto-deflect for 8 seconds.',
    stats: stats({ arc: 0.8, turn: 0.022, parryWindow: 0.16, pulseCooldown: 2.2, scoreMult: 1.3 }),
  },
  {
    id: 'cinder',
    name: 'CINDER',
    title: 'Chain Reaction',
    rarity: 'epic',
    shape: 'fang',
    hue: '#FF4D6D',
    tagline: 'Every kill feeds the next. Built for long combos.',
    lore: 'Does not aim for the target. Aims for the sequence the target starts.',
    ultimate: 'nova',
    ultimateText: 'NOVA — detonate the nexus outward, destroying every threat on screen.',
    stats: stats({ arc: 0.86, deflectSpeed: 1.95, parryWindow: 0.14, integrity: 2, scoreMult: 1.34 }),
  },

  // ------------------------------------------------------------- LEGENDARY --
  {
    id: 'oracle',
    name: 'ORACLE',
    title: 'Reads the Wave',
    rarity: 'legendary',
    shape: 'eye',
    hue: '#FFB020',
    tagline: 'Sees threats early and turns knowledge into tempo.',
    lore: 'Has already watched this wave. Is being polite about the parts you get wrong.',
    ultimate: 'dilate',
    ultimateText: 'DILATE — threats crawl at 25% speed for 7 seconds. Your shield does not.',
    stats: stats({
      arc: 0.9,
      turn: 0.026,
      parryWindow: 0.19,
      pulseCooldown: 2.0,
      pulseWindow: 0.2,
      deflectSpeed: 1.9,
      ultCost: 32,
      scoreMult: 1.42,
    }),
  },
  {
    id: 'tempest',
    name: 'TEMPEST',
    title: 'Weather Front',
    rarity: 'legendary',
    shape: 'bloom',
    hue: '#4DE1FF',
    tagline: 'Pulses constantly. Turns the arena into a hazard.',
    lore: 'Does not defend a position so much as make the surrounding space unreasonable.',
    ultimate: 'overcharge',
    ultimateText: 'OVERCHARGE — every contact counts as a perfect parry for 8 seconds.',
    stats: stats({
      arc: 1.05,
      turn: 0.03,
      pulseCooldown: 1.5,
      pulseWindow: 0.22,
      parryWindow: 0.15,
      deflectSpeed: 1.85,
      scoreMult: 1.38,
    }),
  },
  {
    id: 'solstice',
    name: 'SOLSTICE',
    title: 'Held Breath',
    rarity: 'legendary',
    shape: 'prism',
    hue: '#FFE66D',
    tagline: 'Enormous integrity and a full-circle Ultimate.',
    lore: 'The longest night on record ended when this thing decided it had.',
    ultimate: 'bulwark',
    ultimateText: 'BULWARK — the shield wraps a full circle for 9 seconds.',
    stats: stats({
      arc: 1.12,
      turn: 0.034,
      parryWindow: 0.17,
      integrity: 6,
      deflectSpeed: 1.8,
      ultCost: 36,
      scoreMult: 1.3,
    }),
  },

  // ---------------------------------------------------------------- MYTHIC --
  {
    id: 'eclipse',
    name: 'ECLIPSE',
    title: 'The Quiet Between',
    rarity: 'mythic',
    shape: 'eye',
    hue: '#FF3D6E',
    tagline: 'Razor arc, near-perfect timing, ruinous returns.',
    lore: 'Nothing that has reached the nexus since its activation has reached it twice.',
    ultimate: 'magnetize',
    ultimateText: 'MAGNETIZE — pull every threat into one point, then detonate it for double score.',
    stats: stats({
      arc: 0.68,
      turn: 0.02,
      parryWindow: 0.24,
      pulseCooldown: 1.7,
      pulseWindow: 0.24,
      deflectSpeed: 2.35,
      integrity: 4,
      ultCost: 34,
      scoreMult: 1.62,
    }),
  },
  {
    id: 'zenith',
    name: 'ZENITH',
    title: 'Everything At Once',
    rarity: 'mythic',
    shape: 'crest',
    hue: '#C86BFF',
    tagline: 'No weak axis. The complete Guardian.',
    lore: 'Assembled from the surviving cores of every Guardian that fell. It remembers all of them, and it does not intend to repeat any of it.',
    ultimate: 'sentinel',
    ultimateText: 'SENTINEL — five drones orbit and auto-deflect for 10 seconds.',
    stats: stats({
      arc: 0.95,
      turn: 0.022,
      parryWindow: 0.21,
      pulseCooldown: 1.8,
      pulseWindow: 0.22,
      deflectSpeed: 2.15,
      integrity: 5,
      ultCost: 32,
      scoreMult: 1.55,
    }),
  },
];

export const GUARDIAN_BY_ID: ReadonlyMap<string, Guardian> = new Map(GUARDIANS.map((g) => [g.id, g]));

export function getGuardian(id: string): Guardian {
  const g = GUARDIAN_BY_ID.get(id);
  if (!g) throw new Error(`Unknown guardian "${id}"`);
  return g;
}

export const STARTER_GUARDIAN_ID = GUARDIANS.find((g) => g.starter)?.id ?? GUARDIANS[0]!.id;

export function guardiansByRarity(rarity: Rarity): Guardian[] {
  return GUARDIANS.filter((g) => g.rarity === rarity);
}

/**
 * Level scaling.
 *
 * Levels are earned with shards and give a gentle, predictable lift — about
 * +35% integrity and +20% score at max. Stars (from duplicates) widen the
 * parry window, which is the stat players actually feel.
 */
export const MAX_LEVEL = 30;
export const MAX_STARS = 5;

export function scaleStats(base: GuardianStats, level: number, stars: number): GuardianStats {
  const l = Math.max(0, Math.min(MAX_LEVEL, level) - 1) / (MAX_LEVEL - 1);
  const s = Math.max(0, Math.min(MAX_STARS, stars) - 1) / (MAX_STARS - 1);
  return {
    arc: base.arc * (1 + s * 0.1),
    turn: base.turn * (1 - s * 0.12),
    pulseCooldown: base.pulseCooldown * (1 - l * 0.12 - s * 0.06),
    pulseWindow: base.pulseWindow * (1 + s * 0.2),
    parryWindow: base.parryWindow * (1 + s * 0.3),
    deflectSpeed: base.deflectSpeed * (1 + l * 0.14),
    integrity: Math.round(base.integrity + Math.floor(l * 1.99) + Math.floor(s * 1.99)),
    ultCost: Math.max(18, Math.round(base.ultCost * (1 - l * 0.15))),
    scoreMult: base.scoreMult * (1 + l * 0.2 + s * 0.15),
  };
}

/** Shards needed to go from `level` to `level + 1`. */
export function levelUpCost(level: number, rarity: Rarity): number {
  const rarityMult: Record<Rarity, number> = {
    common: 1,
    rare: 1.4,
    epic: 2,
    legendary: 2.8,
    mythic: 3.6,
  };
  return Math.round((12 + level * level * 1.6) * rarityMult[rarity]);
}

/** Duplicates needed to go from `stars` to `stars + 1`. */
export function starUpCost(stars: number): number {
  return [1, 2, 4, 8][Math.max(0, Math.min(3, stars - 1))]!;
}
