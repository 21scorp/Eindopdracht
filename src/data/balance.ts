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
  /** How elongated the spawn rectangle may get before it is clamped. */
  maxSpawnAspect: 1.9,
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
  travelFraction: 0.66,
  /** How far past the shield radius the ring reaches at full extension. */
  maxExtension: 1.06,
  /** Half-thickness of the lethal annulus, as a fraction of the shield radius. */
  bandHalfWidth: 0.18,
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

/**
 * The difficulty ramp.
 *
 * Tuned against `npm run balance`, which plays hundreds of headless runs with a
 * scripted bot. The target shape: an average player's run ends somewhere around
 * wave 8-12 in two to four minutes, they meet a Warden most sessions, and an
 * expert can push past wave 20 without the game ever becoming unreadable.
 *
 * The first pass at these numbers produced ten-minute runs that never ended,
 * which is fatal for a game whose loop is run -> results -> summon -> run.
 */
export const DIFFICULTY = {
  /** Seconds of build-up before the first threat, so the player can orient. */
  openingCalm: 1.8,
  /** Seconds between waves. */
  waveBreak: 1.25,
  /** Threat budget for wave n: base + n^exponent * growth. */
  budgetBase: 2.4,
  budgetGrowth: 2.0,
  budgetExponent: 1.3,
  /**
   * Global speed multiplier for wave n.
   *
   * Two slopes. The first is the difficulty curve people actually play: 7.5%
   * per wave up to a soft knee. Past the knee it keeps climbing, more slowly
   * and without a ceiling, because a hard cap means difficulty *saturates* —
   * and a game whose difficulty saturates has no ending. The balance harness
   * found exactly that: one Guardian's median run sat at the 600-second cap,
   * still alive at wave 62, because nothing past wave 28 was any harder than
   * wave 28.
   */
  speedGrowth: 0.075,
  /** Wave at which the curve bends rather than stops. */
  speedKnee: 28,
  /** Per-wave growth past the knee. Small, but it never stops. */
  speedGrowthLate: 0.055,
  /** Spawn cadence shortens with wave number, floored so it stays readable. */
  spawnIntervalBase: 0.9,
  spawnIntervalDecay: 0.93,
  spawnIntervalFloor: 0.13,
  /** A boss appears on every Nth wave. */
  bossEvery: 5,
  /** Maximum simultaneous live threats — a readability guard, not a difficulty knob. */
  maxLiveThreats: 52,
} as const;

/**
 * Rewards paid out at the end of a run.
 *
 * Calibrated against the score distribution the balance harness reports: an
 * average run lands around 220k, so `coresPerScore` is set to make that worth
 * roughly 500 Cores. At 2,000 Cores per single summon that is about four runs
 * per pull, or thirty for a ten-pull — a few days of casual play, before daily
 * rewards and account levels are counted.
 */
export const BOSS = {
  /** Fraction of maximum health below which the Warden enrages. */
  enrageAt: 0.34,
  /** Multiplier on the time between volleys once enraged (lower is faster). */
  enrageCadence: 0.55,
  /** Multiplier on its orbital drift once enraged. */
  enrageSwirl: 1.9,
} as const;

export const REWARDS = {
  /**
   * Cores earned per point of score.
   *
   * Halved when the Resonance draft landed. The draft roughly doubled the score
   * an average run puts up — that is the point of it — and leaving this alone
   * would have quietly halved the price of every summon.
   */
  coresPerScore: 0.0008,
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
  /** Account XP per point of score. Halved alongside the core rate. */
  perScore: 0.002,
  perWave: 25,
  /** XP required to reach level n from n-1. */
  curve: (level: number): number => Math.round(120 + Math.pow(level, 1.6) * 45),
  maxLevel: 60,
} as const;
