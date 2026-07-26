/**
 * The wave director.
 *
 * Difficulty is not a single rising number. Each wave gets a *budget* of threat
 * points, and the director spends it on authored spawn patterns — a volley from
 * one side, a pincer, a full ring. That produces waves that feel composed while
 * still being different every run.
 *
 * The director also owns the rest beats. Two seconds of quiet between waves is
 * what makes the next thirty seconds feel intense; without it everything reads
 * as uniform noise.
 */

import { Rng } from '../core/Rng';
import { clamp, TAU } from '../core/math';
import { DIFFICULTY } from '../data/balance';
import {
  THREATS,
  availablePatterns,
  availableThreats,
  type PatternDef,
  type ThreatDef,
} from '../data/threats';

export type WavePhase = 'calm' | 'spawning' | 'clearing' | 'boss' | 'complete';

export interface SpawnRequest {
  def: ThreatDef;
  /** Angle around the arena the threat enters from. */
  angle: number;
  /** Speed multiplier from wave scaling. */
  speedMult: number;
  /** Extra angular drift, used to make patterns curve as a set. */
  swirlBias: number;
}

export interface DirectorHooks {
  spawn(req: SpawnRequest): void;
  /** Live count of threats that still threaten the nexus. */
  incomingCount(): number;
  onWaveStart(wave: number, isBoss: boolean): void;
  onWaveClear(wave: number): void;
}

interface PendingSpawn extends SpawnRequest {
  at: number;
}

export class WaveDirector {
  wave = 0;
  phase: WavePhase = 'calm';
  /** Seconds remaining in the current phase timer. */
  phaseTimer: number = DIFFICULTY.openingCalm;

  private budget = 0;
  private spawnTimer = 0;
  private pending: PendingSpawn[] = [];
  private clock = 0;
  private rng: Rng;

  /** Set true by the session when the boss dies, so the boss phase can end. */
  bossDefeated = false;

  constructor(
    private readonly hooks: DirectorHooks,
    seed: string,
  ) {
    this.rng = new Rng(`waves-${seed}`);
  }

  reset(seed: string): void {
    this.wave = 0;
    this.phase = 'calm';
    this.phaseTimer = DIFFICULTY.openingCalm;
    this.budget = 0;
    this.spawnTimer = 0;
    this.pending.length = 0;
    this.clock = 0;
    this.bossDefeated = false;
    this.rng = new Rng(`waves-${seed}`);
  }

  /** Global speed multiplier applied to threats spawned right now. */
  get speedMultiplier(): number {
    return Math.min(DIFFICULTY.speedCap, 1 + Math.max(0, this.wave - 1) * DIFFICULTY.speedGrowth);
  }

  /** 0..1 progress through the current wave's spawn budget, for the HUD. */
  get waveProgress(): number {
    if (this.phase === 'calm') return 0;
    if (this.phase === 'clearing' || this.phase === 'complete') return 1;
    const total = this.budgetFor(this.wave);
    return total <= 0 ? 1 : clamp(1 - this.budget / total, 0, 1);
  }

  get isBossWave(): boolean {
    return this.wave > 0 && this.wave % DIFFICULTY.bossEvery === 0;
  }

  update(dt: number): void {
    this.clock += dt;

    // Staggered spawns fire regardless of phase, so a pattern that started
    // before a wave ended still completes.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]!;
      if (this.clock >= p.at) {
        this.hooks.spawn(p);
        this.pending.splice(i, 1);
      }
    }

    switch (this.phase) {
      case 'calm':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.startWave();
        break;

      case 'spawning':
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.emitPattern();
          this.spawnTimer = this.spawnInterval();
        }
        if (this.budget <= 0 && this.pending.length === 0) {
          this.phase = 'clearing';
        }
        break;

      case 'boss':
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          // Bosses are accompanied by a light trickle so the player cannot
          // simply park the shield on the boss and wait.
          this.emitPattern(0.55);
          this.spawnTimer = this.spawnInterval() * 1.7;
        }
        if (this.bossDefeated) {
          this.phase = 'clearing';
        }
        break;

      case 'clearing':
        if (this.hooks.incomingCount() === 0 && this.pending.length === 0) {
          this.hooks.onWaveClear(this.wave);
          this.phase = 'calm';
          this.phaseTimer = DIFFICULTY.waveBreak;
        }
        break;

      case 'complete':
        break;
    }
  }

  private startWave(): void {
    this.wave++;
    this.bossDefeated = false;
    this.budget = this.budgetFor(this.wave);
    this.spawnTimer = 0.25;
    const boss = this.isBossWave;
    if (boss) {
      this.phase = 'boss';
      this.hooks.onWaveStart(this.wave, true);
      this.pending.push({
        def: this.bossDef(),
        angle: this.rng.angle(),
        speedMult: 1 + (this.wave / DIFFICULTY.bossEvery - 1) * 0.09,
        swirlBias: this.rng.chance(0.5) ? 1 : -1,
        at: this.clock + 1.1,
      });
    } else {
      this.phase = 'spawning';
      this.hooks.onWaveStart(this.wave, false);
    }
  }

  private budgetFor(wave: number): number {
    return DIFFICULTY.budgetBase + Math.pow(wave, DIFFICULTY.budgetExponent) * DIFFICULTY.budgetGrowth;
  }

  private spawnInterval(): number {
    const raw = DIFFICULTY.spawnIntervalBase * Math.pow(DIFFICULTY.spawnIntervalDecay, this.wave);
    return Math.max(DIFFICULTY.spawnIntervalFloor, raw);
  }

  private bossDef(): ThreatDef {
    const tier = Math.max(1, Math.floor(this.wave / DIFFICULTY.bossEvery));
    // Bosses scale by HP rather than by speed, so the fight gets longer and more
    // demanding without becoming unreadable.
    return {
      ...THREATS.warden,
      hp: Math.round(THREATS.warden.hp * (1 + (tier - 1) * 0.55)),
      radius: THREATS.warden.radius * (1 + (tier - 1) * 0.05),
      scoreMult: THREATS.warden.scoreMult * (1 + (tier - 1) * 0.3),
    };
  }

  /**
   * Choose a pattern we can afford, fill it, and queue the spawns.
   * `budgetScale` lets the boss phase emit smaller patterns.
   */
  private emitPattern(budgetScale = 1): void {
    if (this.hooks.incomingCount() >= DIFFICULTY.maxLiveThreats) return;
    if (this.phase === 'spawning' && this.budget <= 0) return;

    const patterns = availablePatterns(this.wave);
    const pattern = this.pickPattern(patterns);
    const kinds = availableThreats(this.wave);
    if (kinds.length === 0) return;

    const baseAngle = this.rng.angle();
    const swirlBias = this.rng.chance(0.5) ? 1 : -1;
    const speedMult = this.speedMultiplier * this.rng.range(0.95, 1.06);

    const homogeneousDef = pattern.homogeneous ? this.pickThreat(kinds) : null;

    for (let i = 0; i < pattern.count; i++) {
      const def = homogeneousDef ?? this.pickThreat(kinds);
      const cost = def.cost * pattern.costMult * budgetScale;
      if (this.phase === 'spawning' && this.budget - cost < -0.75) break;
      this.budget -= cost;

      const t = pattern.count === 1 ? 0 : i / (pattern.count - 1) - 0.5;
      const angle =
        pattern.spread >= TAU - 0.001
          ? baseAngle + (i / pattern.count) * TAU
          : baseAngle + t * pattern.spread;

      this.pending.push({
        def,
        angle,
        speedMult,
        swirlBias: pattern.id === 'spiral' ? swirlBias * 1.6 : swirlBias,
        at: this.clock + i * pattern.stagger,
      });

      if (this.phase === 'spawning' && this.budget <= 0) break;
    }
  }

  private pickPattern(patterns: PatternDef[]): PatternDef {
    const weights = patterns.map((p) => p.weight);
    return patterns[this.rng.weightedIndex(weights)]!;
  }

  private pickThreat(kinds: ThreatDef[]): ThreatDef {
    // Bias slightly toward newly unlocked archetypes so a new wave feels new.
    const weights = kinds.map((k) => {
      const freshness = this.wave - k.unlockWave;
      const bonus = freshness >= 0 && freshness <= 2 ? 1.6 : 1;
      return k.weight * bonus;
    });
    return kinds[this.rng.weightedIndex(weights)]!;
  }
}
