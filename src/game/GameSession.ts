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
import {
  applyResonance,
  draftIndex,
  getResonance,
  isDraftWave,
  makeMods,
  rollResonance,
  type RunMods,
} from '../data/resonance';
import { TAU, angleDistance, clamp, clamp01, dampAngle, normalizeAngle } from '../core/math';
import { BOSS, DIFFICULTY, FEEL, PULSE, SCORING, SHIELD } from '../data/balance';
import { THREATS, type ThreatDef } from '../data/threats';
import {
  BASE_STATS,
  perfectTolerance as perfectToleranceFor,
  scaleStats,
  type Guardian,
  type GuardianStats,
  type UltimateId,
} from '../data/guardians';
import { Arena } from './Arena';
import { ThreatPool, type Threat } from './Threat';
import { WaveDirector } from './WaveDirector';
import type { GameEvents, HitQuality, RunStats } from './events';

export type SessionPhase = 'idle' | 'intro' | 'playing' | 'dying' | 'over';

/**
 * Seconds an armoured target is immune after being hit. Long enough that
 * breaking armour takes real time, short enough that it never feels unresponsive.
 */
/**
 * How long an instant Ultimate keeps the meter locked.
 *
 * NOVA, FRACTURE and SIPHON resolve in a single frame, so without this they
 * charge *while their own explosion is still on screen*: the board they just
 * cleared is the easiest board in the game to build combo on. A second of
 * lockout costs nothing to feel and closes the loop.
 */
const INSTANT_ULT_LOCKOUT = 1;

/**
 * How many links a single chain reaction may run before it stops minting new
 * projectiles. Four is still a spectacle; unbounded is a game that cannot end.
 */
const CHAIN_CASCADE_LIMIT = 3;

/** SIPHON's guard rails. See the case in `applyUltimate`. */
const SIPHON = {
  /** Threats it must actually drain for the heal to trigger. */
  minDrain: 5,
  /** Integrity it can restore across a whole run. */
  healBudget: 3,
} as const;

const ARMOUR_HIT_COOLDOWN = 0.22;

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
  /** The Guardian's own scaled stats, before anything the run added. */
  baseStats: GuardianStats = { ...BASE_STATS };
  /** What the simulation actually reads: base stats with run modifiers folded in. */
  stats: GuardianStats = { ...BASE_STATS };

  // --- resonance (the in-run draft) ---
  /** Ids taken this run, in the order they were taken. */
  resonance: string[] = [];
  mods: RunMods = makeMods();
  /** The three ids currently on offer, or empty when no draft is pending. */
  offer: string[] = [];
  private secondWindUsed = false;

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
  private bossEnraged = false;
  private siphonHealsLeft = SIPHON.healBudget;
  private lastStandFired = false;

  constructor(seed = String(Date.now())) {
    this.seed = seed;
    this.rng = new Rng(`session-${seed}`);
    this.pool = new ThreatPool(DIFFICULTY.maxLiveThreats + 40, THREATS.orb);
    this.director = new WaveDirector(
      {
        spawn: (req) => this.spawnThreat(req.def, req.angle, req.speedMult, req.swirlBias),
        incomingCount: () => this.pool.countIncoming(),
        bossPresent: () => this.pool.findBoss() !== null,
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
    this.baseStats = scaleStats(guardian.stats, level, stars);
    this.resonance = [];
    this.offer = [];
    this.mods = makeMods();
    this.secondWindUsed = false;
    this.applyMods();

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
    this.bossEnraged = false;
    this.siphonHealsLeft = SIPHON.healBudget;
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
      resonance: [...this.resonance],
      coreMult: this.mods.cores,
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
    // Ultimates are triggered from input, which happens between simulation
    // steps, so the cached live view can be a frame stale.
    this.pool.refresh();
    const id = this.guardian.ultimate;
    this.events.emit('ultimateFired', { id });
    this.applyUltimate(id);
    return true;
  }

  /**
   * Keep a run consistent when the arena changes size underneath it.
   *
   * Everything in flight is stored in pixels — a radius, a velocity, a size —
   * and the arena is sized from the shortest side of the viewport. Resize the
   * window and those pixel values suddenly mean something else: growing it by
   * a factor of two leaves every live threat *inside* the shield, past the band
   * that can block them and on an uninterruptible course for the nexus. A
   * desktop window drag or a tablet entering split view was enough.
   *
   * Rescaling by the change in shield radius — about the old centre, because
   * the arena moves as well as resizes — keeps every threat exactly where it
   * was relative to the arena, which is the only frame of reference the player
   * has.
   */
  rescale(previous: { shieldR: number; cx: number; cy: number }): void {
    const k = this.arena.shieldR / previous.shieldR;
    if (!Number.isFinite(k) || k <= 0 || Math.abs(k - 1) < 0.001) return;

    // A resize can land between the spawn and the next update, and the live
    // list is only rebuilt at the top of an update — so a threat spawned this
    // frame would be missed and left in the old arena's coordinates.
    this.pool.refresh();
    for (const t of this.pool.live) {
      if (!t.active) continue;
      t.size = this.arena.px(t.def.radius);
      t.speed *= k;
      if (t.state === 'deflected') {
        // Cartesian is authoritative for a shot in flight, and it has to be
        // re-based on the *old* centre: the arena moves as well as resizes.
        t.x = this.arena.cx + (t.x - previous.cx) * k;
        t.y = this.arena.cy + (t.y - previous.cy) * k;
        t.vx *= k;
        t.vy *= k;
        t.radius = this.arena.radiusOf(t.x, t.y);
      } else {
        t.radius *= k;
        t.x = this.arena.polarX(t.angle, t.radius);
        t.y = this.arena.polarY(t.angle, t.radius);
      }
    }
    this.pulseRadius *= k;
  }

  // ------------------------------------------------------------- resonance

  /**
   * Recompute the stats the simulation reads.
   *
   * Every card the run has taken is folded in from scratch rather than applied
   * incrementally, so the stat block is always a pure function of the Guardian
   * and the list of cards. That matters more than it looks: it means a card can
   * never be applied twice by a stray call, and a run's whole state is
   * reproducible from `resonance` alone.
   */
  private applyMods(): void {
    const b = this.baseStats;
    const m = this.mods;
    this.stats = {
      arc: clamp(b.arc * m.arc, 0.25, Math.PI * 1.4),
      turn: Math.max(0.012, b.turn * m.turn),
      pulseCooldown: Math.max(0.35, b.pulseCooldown * m.pulseCooldown),
      pulseWindow: b.pulseWindow * m.pulseWindow,
      parryWindow: b.parryWindow * m.parryWindow,
      deflectSpeed: b.deflectSpeed * m.deflectSpeed,
      integrity: b.integrity + m.integrityBonus,
      ultCost: Math.max(4, Math.round(b.ultCost * m.ultCost)),
      scoreMult: b.scoreMult * m.scoreMult,
    };
    this.ultCost = this.stats.ultCost;
    this.arcHalf = this.fullCircle ? Math.PI : this.stats.arc / 2;
    if (this.mods.mirror) this.mirror = true;
  }

  /** Is a draft owed after clearing this wave? */
  draftDue(wave: number): boolean {
    return isDraftWave(wave) && this.phase === 'playing';
  }

  /**
   * Roll the cards for the draft owed at this wave.
   *
   * Seeded from the run seed and the draft number, so a challenge link offers
   * the same cards at the same points — as long as the challenger takes the
   * same ones. Diverging picks diverge the pool, which is the honest behaviour:
   * the alternative is offering a card the player already holds.
   */
  rollOffer(wave: number): string[] {
    const index = Math.max(0, draftIndex(wave));
    const rng = new Rng(`resonance-${this.seed}-${index}-${this.resonance.join('.')}`);
    this.offer = rollResonance(rng, this.resonance, index);
    return this.offer;
  }

  /** Take a card. Returns false for an unknown id or one already held. */
  takeResonance(id: string): boolean {
    const def = getResonance(id);
    if (!def || this.resonance.includes(id)) return false;

    const beforeIntegrity = this.mods.integrityBonus;
    this.resonance.push(id);
    this.mods = applyResonance(this.resonance);
    this.applyMods();

    // Integrity is the one stat that has a *current* value as well as a maximum,
    // so raising the maximum has to hand over the repair too — a card that says
    // "repair the nexus" and does not is the kind of thing players screenshot.
    const gained = this.mods.integrityBonus - beforeIntegrity;
    if (gained > 0) {
      this.maxIntegrity = this.stats.integrity;
      this.integrity = Math.min(this.maxIntegrity, this.integrity + gained);
    }

    this.offer = [];
    this.events.emit('resonanceTaken', { id, name: def.name, tier: def.tier });
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
    this.pulseRadius = this.arena.nexusR + (this.arena.shieldR - this.arena.nexusR) * eased * PULSE.maxExtension;

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
      if (t.hitCooldown > 0) t.hitCooldown = Math.max(0, t.hitCooldown - dt);
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
        if (target.hitCooldown > 0) continue;
        const dx = target.x - p.x;
        const dy = target.y - p.y;
        // Deflected shots hit with a generous radius: they are energised, and a
        // near miss on a chain reads as a bug rather than as skill.
        const rr = target.size + p.size * 1.6;
        if (dx * dx + dy * dy > rr * rr) continue;
        this.resolveContact(target, 'chain', target.angle, DAMAGE.chain, { chainDepth: p.chainDepth + 1 });
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
      if (!t.active || t.state !== 'incoming' || t.delay > 0 || t.hitCooldown > 0) continue;

      const angRadius = arena.angularRadius(t.size, Math.max(t.radius, 1));
      const contactR = arena.shieldR + t.size + arena.shieldHalfThickness;
      // The shield is a *band*, not a disc. Without the inner bound it would
      // also catch anything that already slipped past at another angle and
      // then drifted into the covered arc, which quietly removes the whole
      // consequence of missing a block.
      const innerR = arena.shieldR - t.size - arena.shieldHalfThickness;

      if (t.radius <= contactR && t.radius >= innerR) {
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
        if (!t.active || t.state !== 'incoming' || t.delay > 0 || t.hitCooldown > 0) continue;
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

  /**
   * The share of the arc that counts as dead centre, for this run.
   *
   * Derived from the Guardian's parry window and whatever the draft has done to
   * it. This is the only reader of that stat: before it existed the number was
   * printed on every Guardian card and multiplied by a Resonance card, and
   * changed nothing at all.
   */
  private get perfectTolerance(): number {
    return perfectToleranceFor(this.stats);
  }

  /** Does the shield (or its mirror) cover this angle? */
  private isCovered(angle: number, angRadius: number): { hit: boolean; perfect: boolean } {
    if (this.fullCircle) {
      // BULWARK covers every angle, but a PERFECT still has to be earned by
      // pointing at the thing. Granting free perfects for standing still made
      // the two Guardians that have this Ultimate outscore the rest of the
      // roster fifty to one.
      const perfect = angleDistance(angle, this.shieldAngle) <= (this.stats.arc / 2) * this.perfectTolerance;
      return { hit: true, perfect };
    }

    const check = (centre: number): { hit: boolean; perfect: boolean } => {
      const d = angleDistance(angle, centre);
      const hit = d <= this.arcHalf + SHIELD.forgiveness + angRadius;
      const perfect = d <= this.arcHalf * this.perfectTolerance;
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

  /**
   * Where a siege threat parks.
   *
   * Interpolated between the outer edge of the shield band and the outer edge
   * of the pulse ring at full extension, so it is out of one reach and inside
   * the other by construction rather than by a constant that happened to work
   * on the screen it was tuned on.
   */
  siegeHoldRadius(t: Threat): number {
    const contact = this.arena.shieldR + t.size + this.arena.shieldHalfThickness;
    const reach = this.arena.shieldR * (PULSE.maxExtension + PULSE.bandHalfWidth);
    return contact + (reach - contact) * (t.def.siege?.holdBias ?? 0.5);
  }

  /** True while a siege threat is parked at its firing radius. */
  private siegeHolding(t: Threat): boolean {
    const siege = t.def.siege;
    if (!siege) return false;
    return t.siegeShots < siege.shots && t.radius <= this.siegeHoldRadius(t);
  }

  /**
   * The Herald's whole fight.
   *
   * It walks in, stops at a radius the shield physically cannot reach, and
   * shells the nexus on a timer. The player has exactly one answer — the pulse
   * ring, whose maximum reach is set just past the hold radius — which is the
   * point of the archetype: it turns the pulse from a panic button into a way
   * of touching something out there. Once it has fired its shots it commits and
   * dives in fast, so ignoring it is a cost, never a stalemate.
   */
  private updateSiege(t: Threat, dt: number): void {
    const siege = t.def.siege;
    if (!siege) return;
    t.angle += t.swirl * dt * 0.35;

    if (!this.siegeHolding(t)) {
      // Committing: everything it had left goes into the charge.
      if (t.siegeShots >= siege.shots) t.speed = this.approachSpeed(t.def, t.angle, 1.9);
      return;
    }

    t.siegeTimer -= dt;
    if (t.siegeTimer > 0) return;
    t.siegeTimer = siege.interval;
    t.siegeShots++;

    const dart = THREATS[siege.dart];
    const spawned = this.spawnAt(dart, t.angle, t.radius - t.size * 0.6, siege.dartSpeed, 1);
    if (spawned) {
      spawned.scale = 1;
      // Darts score as the Herald's, not as a free Lancer: a Herald that fires
      // three of them should not also be a score piñata.
      spawned.scoreMult = dart.scoreMult * 0.5;
      this.events.emit('heraldShot', { x: t.x, y: t.y, angle: t.angle });
    }
  }

  private moveIncoming(t: Threat, dt: number): void {
    const arena = this.arena;
    const push = t.bounce > 0 ? t.bounce * arena.px(0.4) : 0;
    // A Herald holding its firing position must not drift inward, so the
    // approach is skipped for as long as it is still shelling.
    if (!this.siegeHolding(t)) t.radius -= (t.speed - push) * dt;

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
      case 'siege':
        this.updateSiege(t, dt);
        break;
      case 'straight':
        break;
    }

    t.x = arena.polarX(t.angle, t.radius);
    t.y = arena.polarY(t.angle, t.radius);
    t.facing = t.angle + Math.PI;
    if (t.def.motion === 'spiral' || t.def.motion === 'drift') t.facing += t.spin * t.age;
  }

  /**
   * Deflected shots steer gently toward the nearest incoming threat ahead of
   * them.
   *
   * Without this, chains essentially never happen: a shot leaves along the
   * radius it was blocked on and everything else is approaching along a
   * *different* radius, so the two only meet by coincidence. A small amount of
   * homing is what turns "I blocked it" into "I blocked it into three others",
   * which is the whole reason blocks return fire instead of just vanishing.
   */
  private steerDeflected(t: Threat, dt: number): void {
    let bestX = 0;
    let bestY = 0;
    let bestScore = Infinity;
    const speed = Math.hypot(t.vx, t.vy);
    if (speed < 1) return;
    const dirX = t.vx / speed;
    const dirY = t.vy / speed;

    for (const other of this.pool.live) {
      if (!other.active || other.state !== 'incoming' || other.delay > 0) continue;
      const dx = other.x - t.x;
      const dy = other.y - t.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1 || dist > this.arena.unit * 0.55 * this.mods.homing) continue;
      // Only consider targets roughly ahead, so shots never turn back inward.
      const forward = (dx * dirX + dy * dirY) / dist;
      if (forward < 0.35) continue;
      const score = dist * (2 - forward);
      if (score < bestScore) {
        bestScore = score;
        bestX = dx / dist;
        bestY = dy / dist;
      }
    }
    if (bestScore === Infinity) return;

    const turn = Math.min(1, 5.5 * this.mods.homing * dt);
    const nx = dirX + (bestX - dirX) * turn;
    const ny = dirY + (bestY - dirY) * turn;
    const len = Math.hypot(nx, ny) || 1;
    t.vx = (nx / len) * speed;
    t.vy = (ny / len) * speed;
  }

  private moveDeflected(t: Threat, dt: number): void {
    this.steerDeflected(t, dt);
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.facing += t.spin * dt;
    t.radius = this.arena.radiusOf(t.x, t.y);
    if (this.arena.isOffscreen(t.x, t.y)) this.pool.release(t);
  }

  // ------------------------------------------------------------- resolution

  /**
   * Resolve any contact against a threat, respecting armour.
   *
   * Every path that can hurt something goes through here. Chain hits used to
   * call `registerHit` directly, which skipped the armour branch entirely — so
   * a single stray deflected shot killed a Bulwark through its plate, and
   * killed a sixteen-hit Warden outright.
   */
  private resolveContact(
    t: Threat,
    quality: HitQuality,
    angle: number,
    damage: number,
    opts: { knockback?: number; forceMult?: number; chainDepth?: number } = {},
  ): void {
    if (t.def.armoured) {
      t.hp -= damage;
      t.flash = 1;
      t.bounce = opts.knockback ?? 1;
      t.hitCooldown = ARMOUR_HIT_COOLDOWN;
      t.radius += this.arena.px(0.02) * (opts.knockback ?? 1);
      if (t.boss) {
        this.events.emit('bossDamaged', { threat: t, hp: Math.max(0, t.hp), maxHp: t.maxHp });
      }
      if (t.hp <= 0) {
        this.registerHit(t, quality, angle, opts.forceMult ?? 1, opts.chainDepth ?? 0);
      } else {
        // A landed-but-not-lethal hit still pays a little and keeps the combo alive.
        this.awardHit(t, quality, false);
      }
      return;
    }
    this.registerHit(t, quality, angle, opts.forceMult ?? 1, opts.chainDepth ?? 0);
  }

  private handleShieldContact(t: Threat, perfect: boolean): void {
    if (this.ult.id === 'overcharge' && this.ult.timer > 0) perfect = true;
    const quality = perfect ? 'perfect' : 'block';
    const damage = perfect ? DAMAGE.perfect * this.mods.perfectDamage : DAMAGE.block;
    this.resolveContact(t, quality, t.angle, damage);
  }

  private handlePulseCatch(t: Threat): void {
    this.pulseCaught++;
    const perfect = t.radius >= this.arena.shieldR * PULSE.perfectInner;
    this.resolveContact(t, 'parry', t.angle, DAMAGE.parry, {
      knockback: 1.4,
      forceMult: PULSE.knockback,
    });
    if (perfect) this.slow(FEEL.parrySlowScale, FEEL.parrySlowDuration);
  }

  /**
   * Convert a threat into a deflected projectile (or kill it outright) and pay
   * out score, combo and Ultimate charge.
   */
  private registerHit(t: Threat, quality: HitQuality, angle: number, forceMult = 1, chainDepth = 0): void {
    const killed = true;
    this.awardHit(t, quality, killed);

    if (t.boss) {
      this.killThreat(t, false);
      return;
    }

    // Past the cascade limit the threat is destroyed rather than turned into
    // more ammunition. Without this a single parry walks through a whole wave —
    // every chain kill mints a fresh projectile that mints another — and a
    // player who can land parries never has to face a wave at all. The harness
    // found it as one Guardian sitting at the ten-minute cap, alive at wave 62.
    if (chainDepth > CHAIN_CASCADE_LIMIT + this.mods.chainDepth) {
      this.counters.kills++;
      this.events.emit('threatKilled', { threat: t, x: t.x, y: t.y, byUltimate: false });
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
    t.chainDepth = chainDepth;
    // Parried shots pierce one extra target; CHAIN REACTION adds another.
    t.hp = (quality === 'parry' ? 2 : 1) + this.mods.chainDepth;
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
      (quality === 'block'
        ? SCORING.comboBlock
        : quality === 'perfect'
          ? SCORING.comboPerfect
          : quality === 'parry'
            ? SCORING.comboParry
            : SCORING.comboChain) + this.mods.comboBonus;

    const focus = quality === 'perfect' ? this.mods.perfectScore : 1;
    const gained = base * t.scoreMult * this.multiplier * this.stats.scoreMult * focus;
    this.score += gained;
    this.combo += comboGain;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;

    // An Ultimate cannot charge while one is running. Without this rule the
    // defensive Ultimates pay for themselves: a full-circle shield blocks
    // everything, everything blocked feeds the meter, and the meter refills
    // before the effect ends. That loop never breaks.
    if (this.ult.timer <= 0 && this.ult.gatherTimer <= 0) {
      this.ultCharge = Math.min(this.ultCost, this.ultCharge + comboGain);
    }

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
    if (t.boss) {
      // A Warden that reaches the nexus slams it and is thrown back out. It
      // must not be removed: the boss wave only ends when the boss dies, so
      // deleting it here would leave the director waiting forever — a
      // soft-lock the balance harness found before any player could.
      t.radius = this.arena.shieldR * 1.7;
      t.x = this.arena.polarX(t.angle, t.radius);
      t.y = this.arena.polarY(t.angle, t.radius);
      t.bounce = 1.6;
      t.flash = 1;
      t.hitCooldown = ARMOUR_HIT_COOLDOWN;
    } else {
      this.pool.release(t);
    }
    if (this.invuln > 0) return;

    const amount = t.def.damage;
    if (this.integrity - amount <= 0 && this.mods.secondWind && !this.secondWindUsed) {
      // SECOND WIND. The combo still breaks — this is a reprieve, not a freebie
      // — but the run continues, with a long enough window to reset the shield.
      this.secondWindUsed = true;
      this.integrity = 1;
      this.invuln = 2.6;
      this.events.emit('secondWind', {});
    } else {
      this.integrity -= amount;
      this.invuln = 1.1;
    }

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
        this.ult.timer = INSTANT_ULT_LOCKOUT;
        this.ult.duration = INSTANT_ULT_LOCKOUT;
        this.clearAll(1);
        break;
      }
      case 'bulwark': {
        const d = this.guardian.rarity === 'legendary' ? 7 : 5;
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
        // The gather is a one-second commit the player cannot act during, and
        // dragging a wave *inward* puts it closer to the nexus than it started.
        // Being killed by your own Ultimate's wind-up is not a skill test, and
        // it is why both Guardians carrying MAGNETIZE sat at the bottom of the
        // roster comparison.
        this.invuln = Math.max(this.invuln, 1.15);
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
        this.ult.timer = INSTANT_ULT_LOCKOUT;
        this.ult.duration = INSTANT_ULT_LOCKOUT;
        // The heal is earned and it is finite.
        //
        // Unbounded, SIPHON is not an Ultimate, it is immortality: clear the
        // screen, take a life back, let the combo refill the meter on the
        // emptiest board in the game, repeat. The harness caught it as one
        // Guardian's *median* run sitting at the ten-minute cap, alive at wave
        // 62, while the next best in the roster reached 26. Two rules fix it
        // without making the Ultimate weak — it has to actually drain a crowd,
        // and a run only gets so many.
        const drained = this.clearAll(1.2);
        if (drained >= SIPHON.minDrain && this.siphonHealsLeft > 0 && this.integrity < this.maxIntegrity) {
          this.siphonHealsLeft--;
          this.integrity += 1;
          this.events.emit('siphonHeal', { left: this.siphonHealsLeft });
        }
        break;
      }
      case 'fracture': {
        this.ult.timer = INSTANT_ULT_LOCKOUT;
        this.ult.duration = INSTANT_ULT_LOCKOUT;
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

  /**
   * Put the shield back to whatever the *run* says it should be.
   *
   * MIRROR the Ultimate and TWIN GUARD the Resonance card raise the same flag,
   * so an Ultimate ending must not switch off a card the player is holding —
   * which is exactly what it did: taking TWIN GUARD appeared to do nothing,
   * because this ran on the very next frame and cleared it.
   */
  private restoreShieldState(): void {
    this.fullCircle = false;
    this.mirror = this.mods.mirror;
  }

  private updateUltimate(dt: number): void {
    if (this.ult.timer <= 0) {
      this.restoreShieldState();
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
      this.restoreShieldState();
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
      this.resolveContact(t, 'parry', t.angle, DAMAGE.lance, { forceMult: 1.8 });
    }
  }

  /** Destroy everything on screen, paying `scoreScale` per kill. */
  private clearAll(scoreScale: number): number {
    let drained = 0;
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
      drained++;
      this.killThreat(t, true);
    }
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.updateMultiplier();
    return drained;
  }

  // -------------------------------------------------------------------- misc

  private updateBossBehaviour(dt: number): void {
    const boss = this.pool.findBoss();
    if (!boss || boss.delay > 0) {
      this.bossAttackTimer = 1.4;
      return;
    }
    // Enrage. A boss whose behaviour never changes is a health bar with a
    // sprite on it: the fight has the same shape at 5% as it did at 100%, so
    // the last third is the least interesting part of the longest fight in the
    // game. Below a third of its health the Warden fires nearly twice as often,
    // in a wider fan, and drifts faster — the same fight, turned up.
    const enraged = boss.hp <= boss.maxHp * BOSS.enrageAt;
    if (enraged && !this.bossEnraged) {
      this.bossEnraged = true;
      boss.swirl *= BOSS.enrageSwirl;
      this.events.emit('bossEnraged', { threat: boss });
    }

    this.bossAttackTimer -= dt;
    if (this.bossAttackTimer > 0) return;
    const cadence = clamp(2.6 - this.director.wave * 0.05, 1.1, 2.6);
    this.bossAttackTimer = enraged ? cadence * BOSS.enrageCadence : cadence;

    // The Warden fires a short arc of orbs from its own position.
    const count = enraged ? 5 : 3;
    const spread = enraged ? 1.15 : 0.5;
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

  // Read-only counters. The HUD, the coach and the quest system all need to
  // know what has happened this run without being able to change it.
  get blocksLanded(): number {
    return this.counters.blocks;
  }
  get perfectsLanded(): number {
    return this.counters.perfects;
  }
  get parriesLanded(): number {
    return this.counters.parries;
  }
  get chainsLanded(): number {
    return this.counters.chains;
  }
  get killCount(): number {
    return this.counters.kills;
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
