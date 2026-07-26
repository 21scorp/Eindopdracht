/**
 * The simulation.
 *
 * One run of AEGIS. Owns the shield, the threats, the wave director, scoring
 * and the Ultimate. Draws nothing and knows nothing about the DOM — rendering
 * reads this state, and everything reactive (audio, VFX, quests) subscribes to
 * the event bus.
 *
 * The two verbs:
 *
 *   AIM    Drag anywhere. The shield arc follows your finger's angle around the
 *          nexus. Contact anywhere in the arc blocks; contact near the arc's
 *          centre is a PERFECT.
 *
 *   PULSE  Tap. A ring travels out from the nexus and back. Anything it touches
 *          is PARRIED regardless of angle — so it is a *timing* tool, where the
 *          shield is a *positioning* tool. Catching a cluster at the shield
 *          radius is the highest-value play in the game.
 *
 * Blocked threats do not vanish: they become deflected projectiles that fly
 * outward and kill whatever they hit. Chains are where big scores come from.
 */

import { EventBus } from '../core/EventBus';
import { Rng } from '../core/Rng';
import { TAU, angleDistance, clamp, clamp01, dampAngle, normalizeAngle } from '../core/math';
import { DIFFICULTY, FEEL, PULSE, SCORING, SHIELD } from '../data/balance';
import { THREATS, type ThreatDef } from '../data/threats';
import { BASE_STATS, scaleStats, type Guardian, type GuardianStats, type UltimateId } from '../data/guardians';
import { Arena } from './Arena';
import { ThreatPool, type Threat } from './Threat';
import { WaveDirector } from './WaveDirector';
import type { GameEvents, HitQuality, RunStats } from './events';

export type SessionPhase = 'idle' | 'intro' | 'playing' | 'dying' | 'over';

/** Damage dealt to armoured targets by each kind of contact. */
const DAMAGE = {
  block: 1,
  perfect: 2,
  parry: 3,
  chain: 2,
  lance: 4,
  ultimate: 6,
} as const;

interface UltimateState {
  id: UltimateId | null;
  /** Seconds remaining of a sustained effect. */
  timer: number;
  /** Total duration, for the HUD ring. */
  duration: number;
  /** Magnetize gathers before it detonates. */
  gatherTimer: number;
  gatherX: number;
  gatherY: number;
  /** Sentinel drone angles. */
  drones: number[];
  droneSpin: number;
}

export interface Sentinel {
  angle: number;
  radius: number;
}

export class GameSession {
  readonly events = new EventBus<GameEvents>();
  readonly arena = new Arena();
  readonly pool: ThreatPool;
  readonly director: WaveDirector;

  phase: SessionPhase = 'idle';

  // --- guardian ---
  guardian!: Guardian;
  stats: GuardianStats = { ...BASE_STATS };

  // --- shield ---
  shieldAngle = -Math.PI / 2;
  shieldTarget = -Math.PI / 2;
  /** Half the arc width in radians, after Ultimates. */
  arcHalf = BASE_STATS.arc / 2;
  /** Set while BULWARK is up. */
  fullCircle = false;
  /** Set while MIRROR is up. */
  mirror = false;

  // --- pulse ---
  pulseCooldown = 0;
  pulseTimer = 0;
  pulseActive = false;
  /** Current radius of the pulse ring in px. */
  pulseRadius = 0;
  private pulseCaught = 0;

  // --- scoring ---
  score = 0;
  combo = 0;
  maxCombo = 0;
  multiplier = 1;
  overdrive = false;

  // --- survival ---
  integrity = 3;
  maxIntegrity = 3;
  /** Seconds of invulnerability after taking a hit. */
  invuln = 0;

  // --- ultimate ---
  ultCharge = 0;
  ultCost = BASE_STATS.ultCost;
  ult: UltimateState = {
    id: null,
    timer: 0,
    duration: 0,
    gatherTimer: 0,
    gatherX: 0,
    gatherY: 0,
    drones: [],
    droneSpin: 0,
  };

  /** Gameplay time scale, driven by slow-motion. The App multiplies dt by this. */
  timeScale = 1;
  private slowTimer = 0;
  private slowScale = 1;

  // --- run stats ---
  elapsed = 0;
  private counters = { blocks: 0, perfects: 0, parries: 0, chains: 0, kills: 0, bossKills: 0, ults: 0 };
  seed = '';

  private rng: Rng;
  private bossAttackTimer = 0;
  private lastStandFired = false;

  constructor(seed = String(Date.now())) {
    this.seed = seed;
    this.rng = new Rng(`session-${seed}`);
    this.pool = new ThreatPool(DIFFICULTY.maxLiveThreats + 40, THREATS.orb);
    this.director = new WaveDirector(
      {
        spawn: (req) => this.spawnThreat(req.def, req.angle, req.speedMult, req.swirlBias),
        incomingCount: () => this.pool.countIncoming(),
        onWaveStart: (wave, boss) => this.events.emit('waveStart', { wave, boss }),
        onWaveClear: (wave) => this.completeWave(wave),
      },
      seed,
    );
  }

  // -------------------------------------------------------------- lifecycle

  start(guardian: Guardian, level: number, stars: number, seed = String(Date.now())): void {
    this.seed = seed;
    this.rng = new Rng(`session-${seed}`);
    this.guardian = guardian;
    this.stats = scaleStats(guardian.stats, level, stars);

    this.phase = 'playing';
    this.shieldAngle = -Math.PI / 2;
    this.shieldTarget = -Math.PI / 2;
    this.arcHalf = this.stats.arc / 2;
    this.fullCircle = false;
    this.mirror = false;

    this.pulseCooldown = 0;
    this.pulseTimer = 0;
    this.pulseActive = false;
    this.pulseRadius = 0;

    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.multiplier = 1;
    this.overdrive = false;

    this.integrity = this.stats.integrity;
    this.maxIntegrity = this.stats.integrity;
    this.invuln = 0;

    this.ultCharge = 0;
    this.ultCost = this.stats.ultCost;
    this.ult = {
      id: null,
      timer: 0,
      duration: 0,
      gatherTimer: 0,
      gatherX: 0,
      gatherY: 0,
      drones: [],
      droneSpin: 0,
    };

    this.timeScale = 1;
    this.slowTimer = 0;
    this.slowScale = 1;
    this.elapsed = 0;
    this.counters = { blocks: 0, perfects: 0, parries: 0, chains: 0, kills: 0, bossKills: 0, ults: 0 };
    this.bossAttackTimer = 0;
    this.lastStandFired = false;

    this.pool.clear();
    this.director.reset(seed);
    this.events.emit('runStart', { guardianId: guardian.id, seed });
  }

  end(): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.events.emit('runEnd', { stats: this.buildStats() });
  }

  buildStats(): RunStats {
    const contacts = this.counters.blocks + this.counters.perfects + this.counters.parries;
    return {
      score: Math.round(this.score),
      wave: Math.max(1, this.director.wave),
      maxCombo: this.maxCombo,
      blocks: this.counters.blocks,
      perfects: this.counters.perfects,
      parries: this.counters.parries,
      chains: this.counters.chains,
      kills: this.counters.kills,
      bossKills: this.counters.bossKills,
      ultimatesUsed: this.counters.ults,
      duration: this.elapsed,
      integrityLeft: Math.max(0, this.integrity),
      accuracy: contacts === 0 ? 0 : (this.counters.perfects + this.counters.parries) / contacts,
      guardianId: this.guardian?.id ?? 'vane',
      seed: this.seed,
    };
  }

  // ------------------------------------------------------------------ input

  /** Point the shield at a world position. */
  aimAt(x: number, y: number): void {
    this.shieldTarget = Math.atan2(y - this.arena.cy, x - this.arena.cx);
  }

  /** Nudge the shield with a keyboard axis. */
  aimAxis(axis: number, dt: number): void {
    this.shieldTarget = normalizeAngle(this.shieldTarget + axis * 4.2 * dt);
  }

  /** Fire the pulse. Returns false if it was on cooldown. */
  pulse(): boolean {
    if (this.phase !== 'playing') return false;
    if (this.pulseCooldown > 0 || this.pulseActive) {
      this.events.emit('pulse', { success: false, caught: 0 });
      return false;
    }
    this.pulseActive = true;
    this.pulseTimer = 0;
    this.pulseCaught = 0;
    this.pulseRadius = this.arena.nexusR;
    this.pulseCooldown = this.stats.pulseCooldown;
    return true;
  }

  get ultimateReady(): boolean {
    return this.ultCharge >= this.ultCost && this.ult.timer <= 0 && this.ult.gatherTimer <= 0;
  }

  fireUltimate(): boolean {
    if (this.phase !== 'playing' || !this.ultimateReady) return false;
    this.ultCharge = 0;
    this.counters.ults++;
    const id = this.guardian.ultimate;
    this.events.emit('ultimateFired', { id });
    this.applyUltimate(id);
    return true;
  }

  // ----------------------------------------------------------------- update

  /**
   * Advance one step.
   *
   * `dt` is *unscaled* real simulation time. The session applies its own slow
   * motion internally, because the effect is deliberately asymmetric: threats
   * and the wave clock slow down, but shield rotation and cooldowns do not.
   * That asymmetry is what makes a slow-motion moment read as power rather than
   * as sluggishness.
   */
  update(dt: number): void {
    if (this.phase !== 'playing' && this.phase !== 'dying') return;
    this.elapsed += dt;

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowScale = 1;
    }
    this.timeScale = this.slowScale;
    const simDt = dt * this.slowScale;

    this.updateShield(dt);
    this.updatePulse(simDt);
    this.updateUltimate(simDt);

    this.pool.refresh();
    this.updateThreats(simDt);
    this.updateBossBehaviour(simDt);

    this.director.update(simDt);

    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);
    if (this.pulseCooldown > 0) {
      const before = this.pulseCooldown;
      this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
      if (before > 0 && this.pulseCooldown === 0) this.events.emit('pulseReady', {});
    }

    this.updateMultiplier();

    if (this.integrity <= 0 && this.phase === 'playing') {
      this.phase = 'dying';
      this.slow(0.25, 0.9);
    } else if (this.phase === 'dying') {
      // Let the death beat breathe before the results screen.
      if (this.slowTimer <= 0) this.end();
    }
  }

  private updateShield(dt: number): void {
    this.arcHalf = this.fullCircle ? Math.PI : this.stats.arc / 2;
    this.shieldAngle = dampAngle(this.shieldAngle, this.shieldTarget, this.stats.turn, dt);
  }

  private updatePulse(dt: number): void {
    if (!this.pulseActive) return;
    this.pulseTimer += dt;
    const window = this.stats.pulseWindow;
    const travel = window * PULSE.travelFraction;
    const t = clamp01(this.pulseTimer / travel);
    // Ease-out so the ring is slowest — and therefore most forgiving — right at
    // the shield radius where the interesting timing lives.
    const eased = 1 - Math.pow(1 - t, 2.1);
    this.pulseRadius = this.arena.nexusR + (this.arena.shieldR - this.arena.nexusR) * eased * 1.06;

    if (this.pulseTimer >= window) {
      this.pulseActive = false;
      this.events.emit('pulse', { success: this.pulseCaught > 0, caught: this.pulseCaught });
    }
  }

  private updateMultiplier(): void {
    const steps = Math.floor(this.combo / SCORING.multiplierStep);
    let m = Math.min(SCORING.multiplierMax, 1 + steps * SCORING.multiplierGain);
    if (this.overdrive) m *= SCORING.overdriveMultiplier;
    this.multiplier = m;

    const shouldOverdrive = this.combo >= SCORING.overdriveThreshold;
    if (shouldOverdrive && !this.overdrive) {
      this.overdrive = true;
      this.events.emit('overdriveStart', { combo: this.combo });
    } else if (!shouldOverdrive && this.overdrive) {
      this.overdrive = false;
      this.events.emit('overdriveEnd', {});
    }
  }

  // ---------------------------------------------------------------- threats

  /**
   * Approach speed in px/s such that `def.travelTime` seconds elapse between
   * the screen edge at this angle and the shield.
   */
  private approachSpeed(def: ThreatDef, angle: number, speedMult: number): number {
    const distance = Math.max(this.arena.unit * 0.2, this.arena.edgeRadius(angle) - this.arena.shieldR);
    return (distance / Math.max(0.2, def.travelTime)) * speedMult;
  }

  private spawnThreat(def: ThreatDef, angle: number, speedMult: number, swirlBias: number): Threat | null {
    const t = this.pool.spawn(def);
    if (!t) return null;
    t.angle = angle;
    t.radius = this.arena.edgeRadius(angle);
    t.speed = this.approachSpeed(def, angle, speedMult);
    t.swirl = def.swirl * swirlBias;
    t.size = this.arena.px(def.radius);
    t.x = this.arena.polarX(angle, t.radius);
    t.y = this.arena.polarY(angle, t.radius);
    t.facing = angle + Math.PI;
    t.spin = def.motion === 'spiral' ? this.rng.signedRange(2.2) : this.rng.signedRange(0.6);
    t.scale = 0;
    if (def.boss) this.events.emit('bossSpawn', { threat: t });
    return t;
  }

  /** Spawn a threat already inside the arena — used by splitters and bosses. */
  private spawnAt(def: ThreatDef, angle: number, radius: number, speedMult: number, generation: number): Threat | null {
    const t = this.pool.spawn(def);
    if (!t) return null;
    t.angle = angle;
    t.radius = radius;
    t.speed = this.approachSpeed(def, angle, speedMult);
    t.swirl = def.swirl * (this.rng.chance(0.5) ? 1 : -1);
    t.size = this.arena.px(def.radius);
    t.x = this.arena.polarX(angle, radius);
    t.y = this.arena.polarY(angle, radius);
    t.facing = angle + Math.PI;
    t.spin = this.rng.signedRange(1.4);
    t.scale = 0.4;
    t.generation = generation;
    return t;
  }

  private updateThreats(dt: number): void {
    const arena = this.arena;
    const live = this.pool.live;
    // DILATE slows incoming threats only. Deflected shots keep full speed, so
    // the Ultimate turns a crowded screen into a shooting gallery.
    const incomingDt = dt * this.threatTimeScale;

    for (const t of live) {
      if (t.delay > 0) {
        t.delay -= dt;
        continue;
      }
      t.age += dt;
      t.scale = Math.min(1, t.scale + dt * 5.5);
      if (t.flash > 0) t.flash = Math.max(0, t.flash - dt * 6);
      if (t.bounce > 0) t.bounce = Math.max(0, t.bounce - dt * 3.5);
      t.trailTimer += dt;

      switch (t.state) {
        case 'incoming':
          this.moveIncoming(t, incomingDt);
          break;
        case 'deflected':
          this.moveDeflected(t, dt);
          break;
        case 'dying':
          t.deathTimer -= dt;
          t.scale = Math.max(0, t.scale - dt * 4.5);
          if (t.deathTimer <= 0) this.pool.release(t);
          continue;
      }
    }

    // Chain damage: deflected projectiles kill incoming threats they pass through.
    for (const p of live) {
      if (!p.active || p.state !== 'deflected') continue;
      for (const target of live) {
        if (!target.active || target.state !== 'incoming' || target === p) continue;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        const rr = target.size + p.size;
        if (dx * dx + dy * dy > rr * rr) continue;
        this.registerHit(target, 'chain', target.angle);
        // A projectile survives its first chain kill, giving multi-kills room to
        // happen, then expires so it cannot mow down a whole wave alone.
        p.hp -= 1;
        if (p.hp <= 0) {
          this.killThreat(p, false);
          break;
        }
      }
    }

    // Shield and nexus interaction.
    for (const t of live) {
      if (!t.active || t.state !== 'incoming' || t.delay > 0) continue;

      const angRadius = arena.angularRadius(t.size, Math.max(t.radius, 1));
      const contactR = arena.shieldR + t.size + arena.shieldHalfThickness;

      if (t.radius <= contactR) {
        const covered = this.isCovered(t.angle, angRadius);
        if (covered.hit) {
          this.handleShieldContact(t, covered.perfect);
          continue;
        }
      }

      // Reached the nexus.
      if (t.radius <= arena.nexusR + t.size * 0.7) {
        this.damageNexus(t);
      }
    }

    // Pulse sweep.
    if (this.pulseActive) {
      const band = arena.shieldR * PULSE.bandHalfWidth;
      for (const t of live) {
        if (!t.active || t.state !== 'incoming' || t.delay > 0) continue;
        if (Math.abs(t.radius - this.pulseRadius) > band + t.size) continue;
        this.handlePulseCatch(t);
      }
    }

    // Sentinel drones auto-deflect.
    if (this.ult.id === 'sentinel' && this.ult.timer > 0) {
      const droneR = arena.shieldR * 0.82;
      for (const angle of this.ult.drones) {
        for (const t of live) {
          if (!t.active || t.state !== 'incoming' || t.delay > 0) continue;
          const dx = t.x - arena.polarX(angle, droneR);
          const dy = t.y - arena.polarY(angle, droneR);
          const rr = t.size + arena.px(0.028);
          if (dx * dx + dy * dy <= rr * rr) {
            this.registerHit(t, 'block', t.angle);
          }
        }
      }
    }
  }

  /** Does the shield (or its mirror) cover this angle? */
  private isCovered(angle: number, angRadius: number): { hit: boolean; perfect: boolean } {
    if (this.fullCircle) return { hit: true, perfect: true };

    const check = (centre: number): { hit: boolean; perfect: boolean } => {
      const d = angleDistance(angle, centre);
      const hit = d <= this.arcHalf + SHIELD.forgiveness + angRadius;
      const perfect = d <= this.arcHalf * SHIELD.perfectTolerance;
      return { hit, perfect };
    };

    const primary = check(this.shieldAngle);
    if (primary.hit) return primary;
    if (this.mirror) {
      const secondary = check(this.shieldAngle + Math.PI);
      if (secondary.hit) return secondary;
    }
    return { hit: false, perfect: false };
  }

  private moveIncoming(t: Threat, dt: number): void {
    const arena = this.arena;
    const push = t.bounce > 0 ? t.bounce * arena.px(0.4) : 0;
    t.radius -= (t.speed - push) * dt;

    switch (t.def.motion) {
      case 'spiral':
        t.angle += t.swirl * dt * (1 + (arena.shieldR / Math.max(t.radius, arena.shieldR * 0.4) - 1) * 0.5);
        break;
      case 'track': {
        // Seekers steer toward whichever side the shield is *not* covering.
        const blind = this.shieldAngle + Math.PI;
        const delta = normalizeAngle(blind - t.angle + Math.PI) - Math.PI;
        const rate = t.def.swirl * dt;
        t.angle += clamp(delta, -rate, rate);
        break;
      }
      case 'drift':
        t.angle += t.swirl * dt * 0.5;
        break;
      case 'straight':
        break;
    }

    t.x = arena.polarX(t.angle, t.radius);
    t.y = arena.polarY(t.angle, t.radius);
    t.facing = t.angle + Math.PI;
    if (t.def.motion === 'spiral' || t.def.motion === 'drift') t.facing += t.spin * t.age;
  }

  private moveDeflected(t: Threat, dt: number): void {
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.facing += t.spin * dt;
    t.radius = this.arena.radiusOf(t.x, t.y);
    if (this.arena.isOffscreen(t.x, t.y)) this.pool.release(t);
  }

  // ------------------------------------------------------------- resolution

  private handleShieldContact(t: Threat, perfect: boolean): void {
    if (this.ult.id === 'overcharge' && this.ult.timer > 0) perfect = true;

    if (t.def.armoured) {
      // Armour cannot be deflected by the shield, only worn down. It recoils so
      // the player gets clear feedback that the hit landed.
      t.hp -= perfect ? DAMAGE.perfect : DAMAGE.block;
      t.flash = 1;
      t.bounce = 1;
      t.radius += this.arena.px(0.02);
      if (t.boss) {
        this.events.emit('bossDamaged', { threat: t, hp: Math.max(0, t.hp), maxHp: t.maxHp });
      }
      if (t.hp <= 0) {
        this.registerHit(t, perfect ? 'perfect' : 'block', t.angle);
      } else {
        // A landed-but-not-lethal hit still pays a little and keeps the combo alive.
        this.awardHit(t, perfect ? 'perfect' : 'block', false);
      }
      return;
    }

    this.registerHit(t, perfect ? 'perfect' : 'block', t.angle);
  }

  private handlePulseCatch(t: Threat): void {
    this.pulseCaught++;
    const inner = this.arena.shieldR * PULSE.perfectInner;
    const perfect = t.radius >= inner;

    if (t.def.armoured) {
      t.hp -= DAMAGE.parry;
      t.flash = 1;
      t.bounce = 1.4;
      t.radius += this.arena.px(0.035);
      if (t.boss) this.events.emit('bossDamaged', { threat: t, hp: Math.max(0, t.hp), maxHp: t.maxHp });
      if (t.hp <= 0) this.registerHit(t, 'parry', t.angle);
      else this.awardHit(t, 'parry', false);
      if (perfect) this.slow(FEEL.parrySlowScale, FEEL.parrySlowDuration);
      return;
    }

    this.registerHit(t, 'parry', t.angle, PULSE.knockback);
    if (perfect) this.slow(FEEL.parrySlowScale, FEEL.parrySlowDuration);
  }

  /**
   * Convert a threat into a deflected projectile (or kill it outright) and pay
   * out score, combo and Ultimate charge.
   */
  private registerHit(t: Threat, quality: HitQuality, angle: number, forceMult = 1): void {
    const killed = true;
    this.awardHit(t, quality, killed);

    if (t.boss) {
      this.killThreat(t, false);
      return;
    }

    // The threat becomes ammunition. Deflection speed is derived from the arena
    // rather than from the threat's own approach speed, so a shot returned
    // sideways on a tall phone travels as fast as one returned upward.
    const speed = this.arena.px(0.42) * this.stats.deflectSpeed * forceMult;
    const spreadAngle = angle + this.rng.signedRange(quality === 'block' ? 0.16 : 0.05);
    t.state = 'deflected';
    t.vx = Math.cos(spreadAngle) * speed;
    t.vy = Math.sin(spreadAngle) * speed;
    t.spin = this.rng.signedRange(9);
    t.flash = 1;
    t.hp = quality === 'parry' ? 2 : 1; // parried shots pierce one extra target
    this.counters.kills++;
    this.events.emit('threatKilled', { threat: t, x: t.x, y: t.y, byUltimate: false });

    if (t.def.splitInto && t.generation < 1) {
      const child = THREATS[t.def.splitInto.kind];
      const n = t.def.splitInto.count;
      for (let i = 0; i < n; i++) {
        const a = t.angle + ((i - (n - 1) / 2) / Math.max(1, n)) * 1.05;
        this.spawnAt(child, a, Math.max(t.radius, this.arena.shieldR * 1.12), t.def.splitInto.speedMult, 1);
      }
    }
  }

  private awardHit(t: Threat, quality: HitQuality, killed: boolean): void {
    const base =
      quality === 'block'
        ? SCORING.block
        : quality === 'perfect'
          ? SCORING.perfect
          : quality === 'parry'
            ? SCORING.parry
            : SCORING.chain;

    const comboGain =
      quality === 'block'
        ? SCORING.comboBlock
        : quality === 'perfect'
          ? SCORING.comboPerfect
          : quality === 'parry'
            ? SCORING.comboParry
            : SCORING.comboChain;

    const gained = base * t.scoreMult * this.multiplier * this.stats.scoreMult;
    this.score += gained;
    this.combo += comboGain;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.ultCharge = Math.min(this.ultCost, this.ultCharge + comboGain);

    switch (quality) {
      case 'block':
        this.counters.blocks++;
        break;
      case 'perfect':
        this.counters.perfects++;
        break;
      case 'parry':
        this.counters.parries++;
        break;
      case 'chain':
        this.counters.chains++;
        break;
    }

    const before = this.multiplier;
    this.updateMultiplier();
    if (this.multiplier > before) {
      this.events.emit('comboMilestone', { combo: this.combo, multiplier: this.multiplier });
    }
    if (this.ultCharge >= this.ultCost && this.ultCharge - comboGain < this.ultCost) {
      this.events.emit('ultimateReady', {});
    }

    this.events.emit('hit', {
      quality,
      x: t.x,
      y: t.y,
      angle: t.angle,
      threat: t,
      score: gained,
      combo: this.combo,
      multiplier: this.multiplier,
      killed,
    });
  }

  private killThreat(t: Threat, byUltimate: boolean): void {
    if (t.state === 'dying') return;
    t.state = 'dying';
    t.deathTimer = t.boss ? 0.9 : 0.22;
    this.counters.kills++;
    if (t.boss) {
      this.counters.bossKills++;
      this.director.bossDefeated = true;
      this.events.emit('bossKilled', { threat: t, x: t.x, y: t.y });
      // The Warden sheds its ring on death — a free scoring opportunity that
      // also gives the player something to do with the adrenaline.
      for (let i = 0; i < 10; i++) {
        this.spawnAt(THREATS.orb, (i / 10) * TAU, this.arena.shieldR * 1.5, 0.85, 1);
      }
    } else {
      this.events.emit('threatKilled', { threat: t, x: t.x, y: t.y, byUltimate });
    }
  }

  private damageNexus(t: Threat): void {
    this.pool.release(t);
    if (this.invuln > 0) return;

    const amount = t.def.damage;
    this.integrity -= amount;
    this.invuln = 1.1;

    const brokenCombo = this.combo;
    if (this.overdrive) {
      // Overdrive softens the fall instead of wiping it — losing a 40 combo to
      // one mistake feels punitive enough to make people stop playing.
      this.combo = Math.floor(this.combo * SCORING.overdriveGrace);
    } else {
      this.combo = 0;
    }
    this.updateMultiplier();
    this.events.emit('comboBreak', { combo: brokenCombo });
    this.events.emit('damage', {
      integrity: Math.max(0, this.integrity),
      x: t.x,
      y: t.y,
      fatal: this.integrity <= 0,
    });

    if (this.integrity === 1 && !this.lastStandFired) {
      this.lastStandFired = true;
      this.events.emit('lastStand', {});
    }
  }

  private completeWave(wave: number): void {
    const bonus = SCORING.waveClear * (1 + wave * 0.12) * this.stats.scoreMult;
    this.score += bonus;
    this.events.emit('waveClear', { wave, bonus });
  }

  // ------------------------------------------------------------- ultimates

  private applyUltimate(id: UltimateId): void {
    this.ult.id = id;
    this.ult.drones = [];
    this.ult.gatherTimer = 0;

    switch (id) {
      case 'nova': {
        this.ult.timer = 0;
        this.ult.duration = 0;
        this.clearAll(1);
        break;
      }
      case 'bulwark': {
        const d = this.guardian.rarity === 'legendary' ? 9 : 5;
        this.ult.duration = d;
        this.ult.timer = d;
        this.fullCircle = true;
        break;
      }
      case 'dilate': {
        const d = this.guardian.rarity === 'legendary' ? 7 : 5;
        this.ult.duration = d;
        this.ult.timer = d;
        break;
      }
      case 'magnetize': {
        this.ult.gatherTimer = 0.95;
        this.ult.duration = 0.95;
        this.ult.timer = 0.95;
        this.ult.gatherX = this.arena.polarX(this.shieldAngle, this.arena.shieldR * 0.78);
        this.ult.gatherY = this.arena.polarY(this.shieldAngle, this.arena.shieldR * 0.78);
        break;
      }
      case 'lance': {
        this.ult.timer = 0.45;
        this.ult.duration = 0.45;
        this.fireLance();
        break;
      }
      case 'mirror': {
        this.ult.duration = 8;
        this.ult.timer = 8;
        this.mirror = true;
        break;
      }
      case 'overcharge': {
        const d = this.guardian.rarity === 'legendary' ? 8 : 6;
        this.ult.duration = d;
        this.ult.timer = d;
        break;
      }
      case 'siphon': {
        this.ult.timer = 0;
        this.ult.duration = 0;
        const healed = Math.min(2, this.maxIntegrity - this.integrity);
        this.integrity += healed;
        this.clearAll(1.2);
        break;
      }
      case 'fracture': {
        this.ult.timer = 0;
        this.ult.duration = 0;
        this.clearAll(1.5);
        break;
      }
      case 'sentinel': {
        const count = this.guardian.rarity === 'mythic' ? 5 : 3;
        const d = this.guardian.rarity === 'mythic' ? 10 : 8;
        this.ult.duration = d;
        this.ult.timer = d;
        this.ult.drones = Array.from({ length: count }, (_, i) => (i / count) * TAU);
        break;
      }
    }
  }

  private updateUltimate(dt: number): void {
    if (this.ult.timer <= 0) {
      if (this.fullCircle) this.fullCircle = false;
      if (this.mirror) this.mirror = false;
      if (this.ult.id && this.ult.gatherTimer <= 0) this.ult.id = null;
      return;
    }

    this.ult.timer -= dt;

    if (this.ult.id === 'magnetize') {
      this.ult.gatherTimer -= dt;
      const strength = this.arena.px(2.6);
      for (const t of this.pool.live) {
        if (!t.active || t.state !== 'incoming') continue;
        const dx = this.ult.gatherX - t.x;
        const dy = this.ult.gatherY - t.y;
        const d = Math.hypot(dx, dy) || 1;
        const step = Math.min(d, strength * dt);
        t.x += (dx / d) * step;
        t.y += (dy / d) * step;
        t.radius = this.arena.radiusOf(t.x, t.y);
        t.angle = this.arena.angleOf(t.x, t.y);
      }
      if (this.ult.gatherTimer <= 0) {
        this.clearAll(this.guardian.rarity === 'mythic' ? 2 : 1.4);
        this.ult.gatherTimer = 0;
      }
    }

    if (this.ult.id === 'sentinel') {
      this.ult.droneSpin += dt * 1.5;
      for (let i = 0; i < this.ult.drones.length; i++) {
        this.ult.drones[i] = (i / this.ult.drones.length) * TAU + this.ult.droneSpin;
      }
    }

    if (this.ult.timer <= 0) {
      if (this.fullCircle) this.fullCircle = false;
      if (this.mirror) this.mirror = false;
      this.ult.id = null;
    }
  }

  /** Threat speed multiplier from DILATE. Rendering and movement both use it. */
  get threatTimeScale(): number {
    if (this.ult.id !== 'dilate' || this.ult.timer <= 0) return 1;
    return this.guardian.rarity === 'legendary' ? 0.25 : 0.3;
  }

  private fireLance(): void {
    const width = this.arena.px(0.05);
    for (const t of this.pool.live) {
      if (!t.active || t.state !== 'incoming') continue;
      const rel = angleDistance(t.angle, this.shieldAngle);
      const perpendicular = Math.sin(rel) * t.radius;
      if (Math.abs(perpendicular) > width + t.size) continue;
      if (Math.cos(rel) < 0) continue; // behind the beam origin
      if (t.def.armoured) {
        t.hp -= DAMAGE.lance;
        t.flash = 1;
        if (t.boss) this.events.emit('bossDamaged', { threat: t, hp: Math.max(0, t.hp), maxHp: t.maxHp });
        if (t.hp <= 0) this.registerHit(t, 'parry', t.angle);
      } else {
        this.registerHit(t, 'parry', t.angle, 1.8);
      }
    }
  }

  /** Destroy everything on screen, paying `scoreScale` per kill. */
  private clearAll(scoreScale: number): void {
    for (const t of this.pool.live) {
      if (!t.active || t.state === 'dying') continue;
      if (t.boss) {
        t.hp -= DAMAGE.ultimate;
        t.flash = 1;
        this.events.emit('bossDamaged', { threat: t, hp: Math.max(0, t.hp), maxHp: t.maxHp });
        if (t.hp <= 0) this.killThreat(t, true);
        continue;
      }
      if (t.state === 'deflected') continue;

      const gained = SCORING.ultimateKill * t.scoreMult * this.multiplier * this.stats.scoreMult * scoreScale;
      this.score += gained;
      this.combo += 1;
      this.killThreat(t, true);
    }
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.updateMultiplier();
  }

  // -------------------------------------------------------------------- misc

  private updateBossBehaviour(dt: number): void {
    const boss = this.pool.findBoss();
    if (!boss || boss.delay > 0) {
      this.bossAttackTimer = 1.4;
      return;
    }
    this.bossAttackTimer -= dt;
    if (this.bossAttackTimer > 0) return;
    this.bossAttackTimer = clamp(2.6 - this.director.wave * 0.05, 1.1, 2.6);

    // The Warden fires a short arc of orbs from its own position.
    const count = 3;
    const spread = 0.5;
    for (let i = 0; i < count; i++) {
      const a = boss.angle + (i - (count - 1) / 2) * (spread / count);
      this.spawnAt(THREATS.orb, a, Math.max(boss.radius - boss.size, this.arena.shieldR * 1.3), 1.15, 1);
    }
  }

  /** Apply slow motion. Later calls win if they are slower. */
  slow(scale: number, duration: number): void {
    if (scale < this.slowScale || this.slowTimer <= 0) {
      this.slowScale = scale;
    }
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  /** 0..1 charge on the Ultimate, for the HUD. */
  get ultProgress(): number {
    return clamp01(this.ultCost <= 0 ? 1 : this.ultCharge / this.ultCost);
  }

  /** 0..1 pulse cooldown remaining, for the HUD. */
  get pulseProgress(): number {
    return this.stats.pulseCooldown <= 0 ? 1 : 1 - clamp01(this.pulseCooldown / this.stats.pulseCooldown);
  }

  /** Sentinel drone positions, for rendering. */
  getSentinels(): Sentinel[] {
    if (this.ult.id !== 'sentinel' || this.ult.timer <= 0) return [];
    const r = this.arena.shieldR * 0.82;
    return this.ult.drones.map((angle) => ({ angle, radius: r }));
  }
}
