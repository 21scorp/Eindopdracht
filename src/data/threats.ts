/**
 * Threat archetypes.
 *
 * Five silhouettes plus a boss. Each one asks a different question of the
 * player, and each is readable at a glance from colour + shape alone — which is
 * what lets the arena stay legible at forty simultaneous entities.
 *
 *   ORB       "cover this angle"          — the baseline
 *   LANCER    "cover it *now*"            — speed
 *   SPLITTER  "handle the aftermath"      — spawns children on death
 *   BULWARK   "you cannot block this"     — must be pulsed or chained
 *   SEEKER    "your gap is where I go"    — tracks the shield's blind side
 *   HERALD    "you cannot reach me"       — holds outside the shield and shells
 *                                            the nexus; only the pulse gets there
 *   WARDEN    boss                        — armoured, sheds a ring of orbs
 *
 * `cost` is the wave-budget price. `weight` biases random selection once the
 * archetype has unlocked.
 */

export type ThreatKind = 'orb' | 'lancer' | 'splitter' | 'bulwark' | 'seeker' | 'herald' | 'warden';

export type ThreatMotion = 'straight' | 'spiral' | 'track' | 'drift' | 'siege';

export interface ThreatDef {
  kind: ThreatKind;
  texture: string;
  /** Collision radius as a fraction of the shortest viewport side. */
  radius: number;
  /**
   * Seconds to travel from the screen edge to the shield at wave 1.
   * Expressed as time rather than speed so pacing is identical on a phone and
   * a widescreen monitor — the distance differs, the experience does not.
   */
  travelTime: number;
  /** Hits required. Anything above 1 survives a plain block. */
  hp: number;
  /** Wave-budget cost. */
  cost: number;
  /** Selection weight once unlocked. */
  weight: number;
  /** First wave this archetype can appear on. */
  unlockWave: number;
  motion: ThreatMotion;
  /** Radians per second of orbital drift for spiral/drift movers. */
  swirl: number;
  /** Score multiplier on top of the base event score. */
  scoreMult: number;
  /** Integrity removed if it reaches the nexus. */
  damage: number;
  /** A plain shield block bounces off instead of deflecting. */
  armoured?: boolean;
  /** Children spawned when destroyed. */
  splitInto?: { kind: ThreatKind; count: number; speedMult: number };
  /**
   * Siege behaviour: hold at a radius the shield cannot reach and shell the
   * nexus, then commit. `holdRadius` is a multiple of the shield radius and is
   * deliberately inside the pulse ring's maximum reach — the whole point of the
   * archetype is that the pulse is the answer.
   */
  siege?: { holdRadius: number; shots: number; interval: number; dart: ThreatKind; dartSpeed: number };
  /** Boss flag: bigger, has a health bar, changes the music. */
  boss?: boolean;
  /** Display name for the kill feed and tutorial. */
  label: string;
}

export const THREATS: Record<ThreatKind, ThreatDef> = {
  orb: {
    kind: 'orb',
    texture: 'threat/orb',
    radius: 0.021,
    travelTime: 3.1,
    hp: 1,
    cost: 1,
    weight: 100,
    unlockWave: 1,
    motion: 'straight',
    swirl: 0,
    scoreMult: 1,
    damage: 1,
    label: 'Orb',
  },
  lancer: {
    kind: 'lancer',
    texture: 'threat/lancer',
    radius: 0.019,
    travelTime: 1.45,
    hp: 1,
    cost: 1.6,
    weight: 68,
    unlockWave: 2,
    motion: 'straight',
    swirl: 0,
    scoreMult: 1.5,
    damage: 1,
    label: 'Lancer',
  },
  splitter: {
    kind: 'splitter',
    texture: 'threat/splitter',
    radius: 0.026,
    travelTime: 3.9,
    hp: 1,
    cost: 2.2,
    weight: 52,
    unlockWave: 4,
    motion: 'spiral',
    swirl: 0.42,
    scoreMult: 1.3,
    damage: 1,
    splitInto: { kind: 'orb', count: 3, speedMult: 1.35 },
    label: 'Splitter',
  },
  bulwark: {
    kind: 'bulwark',
    texture: 'threat/bulwark',
    radius: 0.028,
    travelTime: 4.7,
    hp: 2,
    cost: 3,
    weight: 40,
    unlockWave: 6,
    motion: 'straight',
    swirl: 0,
    scoreMult: 2,
    damage: 1,
    armoured: true,
    label: 'Bulwark',
  },
  seeker: {
    kind: 'seeker',
    texture: 'threat/seeker',
    radius: 0.022,
    travelTime: 2.8,
    hp: 1,
    cost: 2.6,
    weight: 46,
    unlockWave: 8,
    motion: 'track',
    swirl: 1.15,
    scoreMult: 1.8,
    damage: 1,
    label: 'Seeker',
  },
  herald: {
    kind: 'herald',
    texture: 'threat/herald',
    radius: 0.024,
    travelTime: 5.2,
    hp: 1,
    cost: 3.4,
    weight: 34,
    unlockWave: 10,
    motion: 'siege',
    swirl: 0.16,
    scoreMult: 2.4,
    damage: 1,
    siege: { holdRadius: 1.16, shots: 3, interval: 1.5, dart: 'lancer', dartSpeed: 1.15 },
    label: 'Herald',
  },
  warden: {
    kind: 'warden',
    texture: 'threat/warden',
    radius: 0.082,
    travelTime: 11,
    hp: 16,
    cost: 0,
    weight: 0,
    unlockWave: 5,
    motion: 'drift',
    swirl: 0.2,
    scoreMult: 6,
    damage: 2,
    armoured: true,
    boss: true,
    label: 'Warden',
  },
};

export const THREAT_LIST: readonly ThreatDef[] = Object.values(THREATS);

/** Archetypes eligible on a given wave, excluding bosses. */
export function availableThreats(wave: number): ThreatDef[] {
  return THREAT_LIST.filter((t) => !t.boss && wave >= t.unlockWave);
}

/**
 * Spawn patterns. The director picks one, then fills it with archetypes it can
 * afford. Patterns are what make waves feel authored rather than random.
 */
export type PatternId =
  | 'single'
  | 'volley'
  | 'ring'
  | 'spiral'
  | 'pincer'
  | 'cluster'
  | 'sweep'
  | 'column'
  | 'lattice';

export interface PatternDef {
  id: PatternId;
  /** How many spawn slots the pattern places. */
  count: number;
  /** Total angular spread in radians across those slots. */
  spread: number;
  /** Delay between consecutive slots, in seconds. */
  stagger: number;
  /** Multiplier applied to each spawned threat's budget cost. */
  costMult: number;
  /** First wave this pattern can be chosen on. */
  unlockWave: number;
  weight: number;
  /** All slots use the same archetype rather than mixing. */
  homogeneous?: boolean;
}

export const PATTERNS: readonly PatternDef[] = [
  { id: 'single', count: 1, spread: 0, stagger: 0, costMult: 1, unlockWave: 1, weight: 70 },
  { id: 'volley', count: 3, spread: 0.75, stagger: 0.1, costMult: 0.95, unlockWave: 2, weight: 80, homogeneous: true },
  { id: 'cluster', count: 4, spread: 0.45, stagger: 0.06, costMult: 0.9, unlockWave: 3, weight: 60 },
  { id: 'pincer', count: 2, spread: Math.PI, stagger: 0, costMult: 1, unlockWave: 3, weight: 55, homogeneous: true },
  { id: 'sweep', count: 5, spread: 1.6, stagger: 0.14, costMult: 0.88, unlockWave: 6, weight: 50, homogeneous: true },
  { id: 'spiral', count: 6, spread: Math.PI * 2, stagger: 0.11, costMult: 0.82, unlockWave: 8, weight: 45 },
  { id: 'ring', count: 8, spread: Math.PI * 2, stagger: 0, costMult: 0.78, unlockWave: 11, weight: 34, homogeneous: true },
  // A long single-file line from one bearing: the answer is to hold still,
  // which is the opposite of what every other pattern rewards.
  { id: 'column', count: 5, spread: 0.12, stagger: 0.34, costMult: 0.92, unlockWave: 7, weight: 44, homogeneous: true },
  // Two opposed volleys, offset in time — you have to leave one side to be hit
  // by the pulse while the shield answers the other.
  { id: 'lattice', count: 6, spread: Math.PI, stagger: 0.22, costMult: 0.85, unlockWave: 13, weight: 30 },
];

export function availablePatterns(wave: number): PatternDef[] {
  return PATTERNS.filter((p) => wave >= p.unlockWave);
}
