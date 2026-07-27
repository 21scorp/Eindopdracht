/**
 * Resonance — the in-run draft.
 *
 * Every few waves the run stops and offers three upgrades. Take one, keep it
 * until you die, lose it when you do. It is the oldest trick in the roguelite
 * book and it is in this game for a specific reason: a Guardian you pulled last
 * week plays the same way every run, and "the same way every run" is what makes
 * people stop after five. A draft means the *build* is different even when the
 * Guardian is not, and a run that went somewhere unexpected is a run worth
 * telling someone about.
 *
 * Design rules the list follows:
 *
 *  - **Every entry must be felt inside ten seconds.** "+4% score" is not a
 *    choice, it is a rounding error with a card around it. Numbers here are
 *    large enough to change how the next wave plays.
 *  - **No card is dead weight for any Guardian.** A narrow-arc Guardian and a
 *    wide-arc one both want Wide Guard, for different reasons.
 *  - **Some choices cost something.** Focus narrows your shield. Trading safety
 *    for score is the most interesting decision on the screen, and a draft
 *    where every option is a straight gain is a draft nobody thinks about.
 *
 * Everything here is pure data and pure functions: the roll is deterministic
 * from a seeded RNG, so a challenge link that reproduces a wave sequence also
 * reproduces the offers, and the whole file is testable without a canvas.
 */

import type { Rng } from '../core/Rng';

export type ResonanceTier = 'common' | 'rare' | 'epic';

/**
 * Multipliers and flags a run accumulates. The session reads this and nothing
 * else, so adding a card never means touching the simulation.
 */
export interface RunMods {
  /** Multipliers on the Guardian's scaled stats. */
  arc: number;
  turn: number;
  pulseCooldown: number;
  pulseWindow: number;
  parryWindow: number;
  deflectSpeed: number;
  ultCost: number;
  scoreMult: number;

  /** Flat extra nexus integrity, granted the moment it is taken. */
  integrityBonus: number;
  /** Extra score multiplier applied only to perfect parries. */
  perfectScore: number;
  /** Damage multiplier applied only to perfect parries. */
  perfectDamage: number;
  /** Extra targets a deflected shot can chain through before it expires. */
  chainDepth: number;
  /** Extra combo points per contact. */
  comboBonus: number;
  /** Multiplier on how hard deflected shots steer toward a target. */
  homing: number;
  /** Multiplier on the cores this run pays out. */
  cores: number;

  /** A second shield permanently holds the opposite arc. */
  mirror: boolean;
  /** The first otherwise-fatal hit leaves you at one integrity instead. */
  secondWind: boolean;
}

export function makeMods(): RunMods {
  return {
    arc: 1,
    turn: 1,
    pulseCooldown: 1,
    pulseWindow: 1,
    parryWindow: 1,
    deflectSpeed: 1,
    ultCost: 1,
    scoreMult: 1,
    integrityBonus: 0,
    perfectScore: 1,
    perfectDamage: 1,
    chainDepth: 0,
    comboBonus: 0,
    homing: 1,
    cores: 1,
    mirror: false,
    secondWind: false,
  };
}

export interface ResonanceDef {
  id: string;
  name: string;
  /** One player-facing sentence. Rules language, not flavour. */
  text: string;
  tier: ResonanceTier;
  /** Texture key for the card sigil. */
  icon: string;
  /** Relative weight inside its tier. */
  weight: number;
  apply(m: RunMods): void;
}

export const RESONANCE: ResonanceDef[] = [
  // --- common: reliable, immediately legible -------------------------------
  {
    id: 'wide-guard',
    name: 'WIDE GUARD',
    text: 'Your shield covers 18% more of the ring.',
    tier: 'common',
    icon: 'res/arc',
    weight: 100,
    apply: (m) => {
      m.arc *= 1.18;
    },
  },
  {
    id: 'snap-turn',
    name: 'SNAP TURN',
    text: 'The shield tracks your thumb 22% faster.',
    tier: 'common',
    icon: 'res/turn',
    weight: 100,
    apply: (m) => {
      m.turn *= 0.78;
    },
  },
  {
    id: 'pulse-battery',
    name: 'PULSE BATTERY',
    text: 'Pulse recharges 25% sooner.',
    tier: 'common',
    icon: 'res/pulse',
    weight: 100,
    apply: (m) => {
      m.pulseCooldown *= 0.75;
    },
  },
  {
    id: 'long-pulse',
    name: 'WIDE PULSE',
    text: 'The pulse ring stays lethal 35% longer.',
    tier: 'common',
    icon: 'res/pulse',
    weight: 90,
    apply: (m) => {
      m.pulseWindow *= 1.35;
    },
  },
  {
    id: 'steady-hands',
    name: 'STEADY HANDS',
    text: 'The perfect-parry window is 40% wider.',
    tier: 'common',
    icon: 'res/perfect',
    weight: 100,
    apply: (m) => {
      m.parryWindow *= 1.4;
    },
  },
  {
    id: 'kinetic-return',
    name: 'KINETIC RETURN',
    text: 'Deflected shots fly out 40% faster.',
    tier: 'common',
    icon: 'res/chain',
    weight: 95,
    apply: (m) => {
      m.deflectSpeed *= 1.4;
    },
  },
  {
    id: 'reinforced',
    name: 'REINFORCED NEXUS',
    text: 'Repair the nexus and raise its integrity by 1.',
    tier: 'common',
    icon: 'res/nexus',
    weight: 85,
    apply: (m) => {
      m.integrityBonus += 1;
    },
  },
  {
    id: 'prism-cut',
    name: 'PRISM CUT',
    text: 'Everything scores 12% more.',
    tier: 'common',
    icon: 'res/score',
    weight: 80,
    apply: (m) => {
      m.scoreMult *= 1.12;
    },
  },

  // --- rare: shapes the run -------------------------------------------------
  {
    id: 'overflow',
    name: 'OVERFLOW',
    text: 'Your Ultimate charges on 28% less combo.',
    tier: 'rare',
    icon: 'res/ult',
    weight: 100,
    apply: (m) => {
      m.ultCost *= 0.72;
    },
  },
  {
    id: 'focus',
    name: 'FOCUS',
    text: 'Perfect parries score 70% more. Your shield is 15% narrower.',
    tier: 'rare',
    icon: 'res/perfect',
    weight: 90,
    apply: (m) => {
      m.perfectScore *= 1.7;
      m.arc *= 0.85;
    },
  },
  {
    id: 'chain-reaction',
    name: 'CHAIN REACTION',
    text: 'Deflected shots punch through one more threat.',
    tier: 'rare',
    icon: 'res/chain',
    weight: 95,
    apply: (m) => {
      m.chainDepth += 1;
    },
  },
  {
    id: 'magnet-field',
    name: 'MAGNET FIELD',
    text: 'Deflected shots hunt the nearest threat much harder.',
    tier: 'rare',
    icon: 'res/chain',
    weight: 85,
    apply: (m) => {
      m.homing *= 2.2;
    },
  },
  {
    id: 'second-wind',
    name: 'SECOND WIND',
    text: 'Once this run, a killing hit leaves you at 1 integrity instead.',
    tier: 'rare',
    icon: 'res/nexus',
    weight: 80,
    apply: (m) => {
      m.secondWind = true;
    },
  },
  {
    id: 'core-tithe',
    name: 'CORE TITHE',
    text: 'This run pays 30% more Cores.',
    tier: 'rare',
    icon: 'res/score',
    weight: 70,
    apply: (m) => {
      m.cores *= 1.3;
    },
  },

  // --- epic: run-defining ---------------------------------------------------
  {
    id: 'twin-guard',
    name: 'TWIN GUARD',
    text: 'A second shield permanently holds the opposite arc.',
    tier: 'epic',
    icon: 'res/arc',
    weight: 100,
    apply: (m) => {
      m.mirror = true;
    },
  },
  {
    id: 'executioner',
    name: 'EXECUTIONER',
    text: 'Perfect parries hit for two and a half times the damage.',
    tier: 'epic',
    icon: 'res/perfect',
    weight: 95,
    apply: (m) => {
      m.perfectDamage *= 2.5;
    },
  },
  {
    id: 'overclock',
    name: 'OVERCLOCK',
    text: 'Every contact adds an extra combo point.',
    tier: 'epic',
    icon: 'res/ult',
    weight: 90,
    apply: (m) => {
      m.comboBonus += 1;
    },
  },
];

export const RESONANCE_BY_ID = new Map(RESONANCE.map((r) => [r.id, r]));

export function getResonance(id: string): ResonanceDef | undefined {
  return RESONANCE_BY_ID.get(id);
}

/** Fold a list of taken ids into a fresh modifier set. */
export function applyResonance(ids: readonly string[]): RunMods {
  const mods = makeMods();
  for (const id of ids) getResonance(id)?.apply(mods);
  return mods;
}

// ------------------------------------------------------------------ schedule

/** First draft after wave 2, then one every three waves. */
export const FIRST_DRAFT_WAVE = 2;
export const DRAFT_INTERVAL = 3;

export function isDraftWave(wave: number): boolean {
  if (wave < FIRST_DRAFT_WAVE) return false;
  return (wave - FIRST_DRAFT_WAVE) % DRAFT_INTERVAL === 0;
}

/** How many drafts have happened by the time this wave is cleared. */
export function draftIndex(wave: number): number {
  if (!isDraftWave(wave)) return -1;
  return (wave - FIRST_DRAFT_WAVE) / DRAFT_INTERVAL;
}

// ---------------------------------------------------------------------- roll

/**
 * Tier weight, drifting upward as the run goes on.
 *
 * The first draft should almost always be three commons: a wave-2 player has
 * not earned a run-defining card and would not know what to do with one. By the
 * fifth, epics should be showing up regularly, because that is the run that is
 * going somewhere and the one worth escalating.
 */
export function tierWeight(tier: ResonanceTier, index: number): number {
  const t = Math.min(1, Math.max(0, index) / 5);
  switch (tier) {
    case 'common':
      return 100 - 45 * t;
    case 'rare':
      return 22 + 38 * t;
    case 'epic':
      return 2 + 26 * t;
  }
}

/**
 * Offer `count` distinct cards, never repeating one already taken.
 *
 * Weighted without replacement: draw, remove, redraw. With seventeen cards and
 * three slots the pool never runs dry in a real run, but the loop copes if it
 * ever does rather than looping forever.
 */
export function rollResonance(
  rng: Rng,
  taken: readonly string[],
  index: number,
  count = 3,
  pool: readonly ResonanceDef[] = RESONANCE,
): string[] {
  const held = new Set(taken);
  const candidates = pool.filter((r) => !held.has(r.id));
  const picked: string[] = [];

  while (picked.length < count && candidates.length > 0) {
    const weights = candidates.map((c) => c.weight * tierWeight(c.tier, index));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = rng.next() * total;
    let chosen = candidates.length - 1;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i]!;
      if (roll <= 0) {
        chosen = i;
        break;
      }
    }
    picked.push(candidates[chosen]!.id);
    candidates.splice(chosen, 1);
  }

  return picked;
}
