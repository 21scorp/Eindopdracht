/**
 * Threat entities and their pool.
 *
 * Threats are pooled structs, like particles: the wave director can spawn a
 * ring of eight at once without allocating, and a boss death that spawns
 * fifteen orbs costs nothing but field writes.
 *
 * A threat lives in one of three states:
 *   incoming   — approaching the nexus, dangerous, blockable
 *   deflected  — flying outward, harmless to you, lethal to incoming threats
 *   dying      — playing its death animation, no longer simulated
 */

export type ThreatState = 'incoming' | 'deflected' | 'dying';

import type { ThreatDef, ThreatKind } from '../data/threats';

export interface Threat {
  active: boolean;
  id: number;
  def: ThreatDef;
  kind: ThreatKind;
  state: ThreatState;

  x: number;
  y: number;
  vx: number;
  vy: number;

  /** Polar approach state, authoritative while `incoming`. */
  angle: number;
  radius: number;
  /** Approach speed in px/s. */
  speed: number;
  /** Angular drift in rad/s. */
  swirl: number;

  /** Visual facing. */
  facing: number;
  spin: number;

  hp: number;
  maxHp: number;
  /** Collision radius in px. */
  size: number;

  age: number;
  /** Counts down before the threat becomes visible and active. */
  delay: number;
  /** 0..1 spawn-in scale, also used for the death shrink. */
  scale: number;
  /** Seconds of white hit-flash remaining. */
  flash: number;
  /** Seconds remaining in the dying animation. */
  deathTimer: number;

  /** Set when an armoured threat bounces, so it recoils visibly. */
  bounce: number;
  /**
   * Seconds before this threat can be hit again.
   *
   * Without it an armoured threat sitting against the shield is struck once per
   * simulation step — 120 times a second — and a two-hit Bulwark dies in 17
   * milliseconds. The cooldown is what makes armour mean "hit it repeatedly"
   * instead of "touch it once".
   */
  hitCooldown: number;
  /** Score multiplier carried from the spawn context (e.g. boss children). */
  scoreMult: number;
  /** Marks children of a splitter so they cannot split again. */
  generation: number;
  boss: boolean;

  /** Trail emission accumulator, so trails are frame-rate independent. */
  trailTimer: number;

  /** Siege archetypes: seconds until the next shot, and shots already fired. */
  siegeTimer: number;
  siegeShots: number;
}

let nextId = 1;

function makeThreat(def: ThreatDef): Threat {
  return {
    active: false,
    id: 0,
    def,
    kind: def.kind,
    state: 'incoming',
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    radius: 0,
    speed: 0,
    swirl: 0,
    facing: 0,
    spin: 0,
    hp: 1,
    maxHp: 1,
    size: 10,
    age: 0,
    delay: 0,
    scale: 0,
    flash: 0,
    deathTimer: 0,
    bounce: 0,
    hitCooldown: 0,
    scoreMult: 1,
    generation: 0,
    boss: false,
    trailTimer: 0,
    siegeTimer: 0,
    siegeShots: 0,
  };
}

export class ThreatPool {
  private pool: Threat[] = [];
  /** Live threats, rebuilt each update so callers can iterate without checks. */
  readonly live: Threat[] = [];

  constructor(
    capacity: number,
    private readonly fallbackDef: ThreatDef,
  ) {
    for (let i = 0; i < capacity; i++) this.pool.push(makeThreat(fallbackDef));
  }

  get capacity(): number {
    return this.pool.length;
  }

  spawn(def: ThreatDef): Threat | null {
    for (const t of this.pool) {
      if (t.active) continue;
      t.active = true;
      t.id = nextId++;
      t.def = def;
      t.kind = def.kind;
      t.state = 'incoming';
      t.x = 0;
      t.y = 0;
      t.vx = 0;
      t.vy = 0;
      t.angle = 0;
      t.radius = 0;
      t.speed = 0;
      t.swirl = def.swirl;
      t.facing = 0;
      t.spin = 0;
      t.hp = def.hp;
      t.maxHp = def.hp;
      t.size = 10;
      t.age = 0;
      t.delay = 0;
      t.scale = 0;
      t.flash = 0;
      t.deathTimer = 0;
      t.bounce = 0;
      t.hitCooldown = 0;
      t.scoreMult = def.scoreMult;
      t.generation = 0;
      t.siegeTimer = 0;
      t.siegeShots = 0;
      t.boss = def.boss ?? false;
      t.trailTimer = 0;
      return t;
    }
    return null; // Pool exhausted; the director treats this as backpressure.
  }

  release(t: Threat): void {
    t.active = false;
    t.def = this.fallbackDef;
  }

  clear(): void {
    for (const t of this.pool) t.active = false;
    this.live.length = 0;
  }

  /** Rebuild the `live` view. Call once at the top of each update. */
  refresh(): void {
    this.live.length = 0;
    for (const t of this.pool) if (t.active) this.live.push(t);
  }

  /** Count of live threats that still threaten the nexus. */
  countIncoming(): number {
    let n = 0;
    for (const t of this.pool) if (t.active && t.state === 'incoming') n++;
    return n;
  }

  findBoss(): Threat | null {
    for (const t of this.pool) if (t.active && t.boss && t.state !== 'dying') return t;
    return null;
  }
}
