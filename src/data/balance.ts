/**
 * Every tuning number in one file.
 *
 * Balance lives apart from logic so it can be iterated without reading code,
 * diffed cleanly, and eventually driven from a remote config without a client
 * update. Nothing here should require knowing how the game is implemented.
 */

export const ARENA = {
  /** Nexus radius as a fraction of the shortest viewport side. */
  nexusRadius: 0.07,
  /** Shield radius as a fraction of the shortest viewport side. */
  shieldRadius: 0.325,
  /** Shield band thickness as a fraction of the shortest viewport side. */
  shieldThickness: 0.026,
  /** Threats enter this far beyond the screen edge, in CSS pixels. */
  spawnMargin: 70,
  /** Deflected threats are cleaned up past this multiple of the screen edge. */
  despawnFactor: 1.4,
} as const;

export const SCORING = {
  block: 10,
  perfect: 25,
  parry: 45,
  chain: 30,
  /** Awarded per threat when an Ultimate clears them. */
  ultimateKill: 20,
  waveClear: 150,
  /** Bonus per remaining integrity point at the end of a run. */
  integrityBonus: 250,

  /** Combo points granted by each event. */
  comboBlock: 1,
  comboPerfect: 2,
  comboParry: 3,
  comboChain: 1,

  /** Multiplier is 1 + floor(combo / step) * gain, clamped to max. */
  multiplierStep: 5,
  multiplierGain: 0.5,
  multiplierMax: 12,

  /** Combo required to enter Overdrive, and the extra multiplier it applies. */
  overdriveThreshold: 30,
  overdriveMultiplier: 2,
  /** Combo drops to this fraction on damage instead of straight to zero in Overdrive. */
  overdriveGrace: 0.4,
} as const;

export const FEEL = {
  /** Hitstop in real seconds per event type. */
  hitstopBlock: 0.012,
  hitstopPerfect: 0.045,
  hitstopParry: 0.085,
  hitstopDamage: 0.14,
  hitstopBossKill: 0.32,

  /** Camera trauma per event, 0..1. */
  traumaBlock: 0.055,
  traumaPerfect: 0.12,
  traumaParry: 0.22,
  traumaDamage: 0.5,
  traumaUltimate: 0.55,
  traumaBossKill: 0.8,

  /** Zoom punch impulse per event. */
  punchPerfect: 0.35,
  punchParry: 0.9,
  punchDamage: -1.4,
  punchUltimate: 1.6,

  /** Slow-motion applied on a perfect pulse, and how long it lasts. */
  parrySlowScale: 0.22,
  parrySlowDuration: 0.18,
  /** Slow-motion when the nexus is about to be hit at 1 integrity. */
  lastStandScale: 0.55,
} as const;

export const PULSE = {
  /** Ring travel: starts at the nexus edge, reaches the shield in this fraction of the window. */
  travelFraction: 0.72,
  /** Half-thickness of the lethal annulus, as a fraction of the shield radius. */
  bandHalfWidth: 0.13,
  /** A parry inside this fraction of the shield radius counts as PERFECT. */
  perfectInner: 0.86,
  /** Force multiplier applied to threats caught by the pulse. */
  knockback: 2.4,
} as const;

export const SHIELD = {
  /** Angular tolerance (as a fraction of the arc half-width) for a PERFECT block. */
  perfectTolerance: 0.34,
  /** Extra angular forgiveness in radians, so a hair-thin miss still blocks. */
  forgiveness: 0.045,
} as const;

export const DIFFICULTY = {
  /** Seconds of build-up before the first threat, so the player can orient. */
  openingCalm: 1.6,
  /** Seconds between waves. */
  waveBreak: 1.5,
  /** Threat budget for wave n: base + n * growth, with a soft exponential lift. */
  budgetBase: 3.2,
  budgetGrowth: 1.35,
  budgetExponent: 1.14,
  /** Global speed multiplier for wave n: 1 + (n-1) * speedGrowth, capped. */
  speedGrowth: 0.033,
  speedCap: 2.0,
  /** Spawn cadence shortens with wave number, floored so it stays readable. */
  spawnIntervalBase: 0.85,
  spawnIntervalDecay: 0.965,
  spawnIntervalFloor: 0.2,
  /** A boss appears on every Nth wave. */
  bossEvery: 5,
  /** Maximum simultaneous live threats — a readability guard, not a difficulty knob. */
  maxLiveThreats: 46,
} as const;

/** Rewards paid out at the end of a run. */
export const REWARDS = {
  /** Cores earned per point of score. */
  coresPerScore: 0.02,
  /** Flat cores for finishing a wave. */
  coresPerWave: 12,
  /** Bonus cores for a new personal best. */
  coresPersonalBest: 150,
  /** Chance of a bonus prism drop per wave cleared. */
  prismChancePerWave: 0.06,
  prismPerDrop: 1,
  /** Daily cap on cores earned from runs, to keep the economy sane. */
  dailyCoreSoftCap: 4000,
  /** Earn rate beyond the soft cap. */
  softCapRate: 0.35,
} as const;

export const XP = {
  /** Account XP per point of score. */
  perScore: 0.05,
  perWave: 25,
  /** XP required to reach level n from n-1. */
  curve: (level: number): number => Math.round(120 + Math.pow(level, 1.6) * 45),
  maxLevel: 60,
} as const;
