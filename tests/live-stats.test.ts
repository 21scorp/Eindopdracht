/**
 * @vitest-environment happy-dom
 *
 * Nothing declared may be decorative.
 *
 * `parryWindow` was printed on every Guardian card, scaled by level and stars,
 * multiplied by a Resonance card — and read by no code at all. It was a number
 * the game told the player mattered, for months, and it did nothing. Grepping
 * for a symbol would have found it; nobody grepped, because nobody suspected.
 *
 * So this file does not grep. For every stat a Guardian declares and every
 * modifier the draft can apply, it builds two sessions that differ only in that
 * one value, drives an identical scenario, and asserts that something the player
 * could actually see comes out different. A stat with no probe fails the suite,
 * so the next one added has to be wired up before it can ship.
 */

import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/GameSession';
import {
  BASE_STATS,
  GUARDIANS,
  ULTIMATE_IDS,
  getGuardian,
  type GuardianStats,
  type UltimateId,
} from '../src/data/guardians';
import { PATTERNS, THREATS, THREAT_LIST, availablePatterns, availableThreats } from '../src/data/threats';
import { RESONANCE, makeMods, type RunMods } from '../src/data/resonance';
import type { ViewInfo } from '../src/render/Renderer';

const VIEW: ViewInfo = { width: 412, height: 892, cx: 206, cy: 446, scale: 1, minSide: 412, portrait: true };
const STEP = 1 / 120;

function makeSession(overrides: Partial<GuardianStats> = {}, cards: string[] = []): GameSession {
  const s = new GameSession('probe');
  s.arena.update(VIEW);
  const g = getGuardian('vane');
  s.start({ ...g, stats: { ...BASE_STATS, ...overrides } }, 1, 1, 'probe');
  for (const id of cards) s.takeResonance(id);
  return s;
}

/** A session whose Guardian carries a specific Ultimate, already charged. */
function withUltimate(id: UltimateId): GameSession {
  const s = new GameSession('probe');
  s.arena.update(VIEW);
  const g = getGuardian('vane');
  s.start({ ...g, ultimate: id }, 1, 1, 'probe');
  s.ultCharge = s.ultCost;
  return s;
}

/** Fill the arena with something for an Ultimate to act on. */
function crowd(s: GameSession, count = 6): void {
  for (let i = 0; i < count; i++) {
    const t = place(s, 'orb', (i / count) * Math.PI * 2, 1.5);
    t.speed = 0;
  }
  // The pool's live list is rebuilt at the top of an update, so a freshly
  // spawned threat is not visible to anything until one step has passed.
  advance(s, STEP);
}

const liveThreats = (s: GameSession): number =>
  s.pool.live.filter((t) => t.active && t.state === 'incoming').length;

function advance(s: GameSession, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) s.update(STEP);
}

function place(s: GameSession, kind: keyof typeof THREATS, angle: number, radiusFraction: number) {
  const def = THREATS[kind];
  const t = s.pool.spawn(def)!;
  const radius = s.arena.shieldR * radiusFraction;
  t.angle = angle;
  t.radius = radius;
  t.speed = s.arena.unit * 0.1;
  t.size = s.arena.px(def.radius);
  t.x = s.arena.polarX(angle, radius);
  t.y = s.arena.polarY(angle, radius);
  t.scale = 1;
  t.facing = angle + Math.PI;
  return t;
}

/** Land one contact at a chosen offset from the arc centre and report it. */
function contact(s: GameSession, offsetFraction = 0, kind: keyof typeof THREATS = 'orb'): string[] {
  const seen: string[] = [];
  s.events.on('hit', (e) => seen.push(e.quality));
  s.shieldAngle = 0;
  s.shieldTarget = 0;
  place(s, kind, s.arcHalf * offsetFraction, 1.02);
  advance(s, STEP * 3);
  return seen;
}

// --------------------------------------------------------------- guardian stats

/**
 * One probe per declared stat: a value to perturb, and something observable that
 * has to move when it does. `expect` is deliberately about *behaviour* — reading
 * the stat back out of the session would pass even if nothing consumed it.
 */
const STAT_PROBES: Record<keyof GuardianStats, () => void> = {
  arc: () => {
    // A contact that a narrow arc misses and a wide arc catches.
    const offset = BASE_STATS.arc / 2 + 0.12;
    const narrow = makeSession({ arc: BASE_STATS.arc });
    const wide = makeSession({ arc: BASE_STATS.arc + 0.6 });
    const seenNarrow: string[] = [];
    const seenWide: string[] = [];
    narrow.events.on('hit', (e) => seenNarrow.push(e.quality));
    wide.events.on('hit', (e) => seenWide.push(e.quality));
    for (const s of [narrow, wide]) {
      s.shieldAngle = 0;
      s.shieldTarget = 0;
      place(s, 'orb', offset, 1.02);
      advance(s, STEP * 3);
    }
    expect(seenNarrow).toHaveLength(0);
    expect(seenWide.length).toBeGreaterThan(0);
  },

  turn: () => {
    const slow = makeSession({ turn: 0.2 });
    const fast = makeSession({ turn: 0.01 });
    for (const s of [slow, fast]) {
      s.shieldAngle = 0;
      s.shieldTarget = 1.2;
      advance(s, 0.1);
    }
    expect(fast.shieldAngle).toBeGreaterThan(slow.shieldAngle);
  },

  pulseCooldown: () => {
    const long = makeSession({ pulseCooldown: 4 });
    const short = makeSession({ pulseCooldown: 0.5 });
    for (const s of [long, short]) {
      s.pulse();
      advance(s, 1.2);
    }
    expect(short.pulse()).toBe(true);
    expect(long.pulse()).toBe(false);
  },

  pulseWindow: () => {
    const brief = makeSession({ pulseWindow: 0.2 });
    const wide = makeSession({ pulseWindow: 0.8 });
    for (const s of [brief, wide]) {
      s.pulse();
      advance(s, 0.3);
    }
    expect(brief.pulseActive).toBe(false);
    expect(wide.pulseActive).toBe(true);
  },

  parryWindow: () => {
    // The bug this file exists for: same contact, different verdict.
    const tight = makeSession({ parryWindow: BASE_STATS.parryWindow });
    const generous = makeSession({ parryWindow: BASE_STATS.parryWindow * 2.5 });
    expect(contact(tight, 0.6)).toContain('block');
    expect(contact(generous, 0.6)).toContain('perfect');
  },

  deflectSpeed: () => {
    const slow = makeSession({ deflectSpeed: 0.8 });
    const fast = makeSession({ deflectSpeed: 3 });
    const speeds = [slow, fast].map((s) => {
      s.shieldAngle = 0;
      s.shieldTarget = 0;
      const t = place(s, 'orb', 0, 1.02);
      advance(s, STEP * 3);
      return Math.hypot(t.vx, t.vy);
    });
    expect(speeds[1]!).toBeGreaterThan(speeds[0]! * 2);
  },

  integrity: () => {
    expect(makeSession({ integrity: 6 }).integrity).toBe(6);
    expect(makeSession({ integrity: 2 }).integrity).toBe(2);
  },

  ultCost: () => {
    // `scaleStats` floors the meter at 18, so "cheap" means the floor and the
    // probe has to actually fill it rather than assume one parry does.
    const cheap = makeSession({ ultCost: 1 });
    const dear = makeSession({ ultCost: 400 });
    for (const s of [cheap, dear]) for (let i = 0; i < 20; i++) contact(s, 0);
    expect(cheap.ultimateReady).toBe(true);
    expect(dear.ultimateReady).toBe(false);
  },

  scoreMult: () => {
    const plain = makeSession({ scoreMult: 1 });
    const rich = makeSession({ scoreMult: 3 });
    for (const s of [plain, rich]) contact(s, 0);
    expect(rich.score).toBeGreaterThan(plain.score * 2);
  },
};

describe('every Guardian stat changes the game', () => {
  it('has a probe for every declared stat', () => {
    // A new stat with no probe fails here rather than shipping decorative.
    expect(Object.keys(STAT_PROBES).sort()).toEqual(Object.keys(BASE_STATS).sort());
  });

  for (const [name, probe] of Object.entries(STAT_PROBES)) {
    it(`${name} is read by the simulation`, probe);
  }
});

// ------------------------------------------------------------------- run mods

/** The card that carries each modifier, so the probe drives the real path. */
const MOD_CARD: Record<keyof RunMods, string> = {
  arc: 'wide-guard',
  turn: 'snap-turn',
  pulseCooldown: 'pulse-battery',
  pulseWindow: 'long-pulse',
  parryWindow: 'steady-hands',
  deflectSpeed: 'kinetic-return',
  ultCost: 'overflow',
  scoreMult: 'prism-cut',
  integrityBonus: 'reinforced',
  perfectScore: 'focus',
  perfectDamage: 'executioner',
  chainDepth: 'chain-reaction',
  comboBonus: 'overclock',
  homing: 'magnet-field',
  cores: 'core-tithe',
  mirror: 'twin-guard',
  secondWind: 'second-wind',
};

const MOD_PROBES: Record<keyof RunMods, () => void> = {
  // The stat-shaped modifiers only have to reach the stat block; the stat
  // probes above already prove the simulation reads it from there.
  arc: () => expect(makeSession({}, ['wide-guard']).stats.arc).toBeGreaterThan(makeSession().stats.arc),
  turn: () => expect(makeSession({}, ['snap-turn']).stats.turn).toBeLessThan(makeSession().stats.turn),
  pulseCooldown: () =>
    expect(makeSession({}, ['pulse-battery']).stats.pulseCooldown).toBeLessThan(makeSession().stats.pulseCooldown),
  pulseWindow: () =>
    expect(makeSession({}, ['long-pulse']).stats.pulseWindow).toBeGreaterThan(makeSession().stats.pulseWindow),
  parryWindow: () =>
    expect(makeSession({}, ['steady-hands']).stats.parryWindow).toBeGreaterThan(makeSession().stats.parryWindow),
  deflectSpeed: () =>
    expect(makeSession({}, ['kinetic-return']).stats.deflectSpeed).toBeGreaterThan(makeSession().stats.deflectSpeed),
  ultCost: () => expect(makeSession({}, ['overflow']).ultCost).toBeLessThan(makeSession().ultCost),
  scoreMult: () => {
    const plain = makeSession();
    const rich = makeSession({}, ['prism-cut']);
    for (const s of [plain, rich]) contact(s, 0);
    expect(rich.score).toBeGreaterThan(plain.score);
  },

  integrityBonus: () => {
    const s = makeSession();
    const before = s.maxIntegrity;
    s.takeResonance('reinforced');
    expect(s.maxIntegrity).toBe(before + 1);
  },

  perfectScore: () => {
    const plain = makeSession();
    const focused = makeSession({}, ['focus']);
    for (const s of [plain, focused]) contact(s, 0);
    // FOCUS also narrows the arc, so the contact has to be dead centre — which
    // it is — and the score difference is the multiplier doing its job.
    expect(focused.score).toBeGreaterThan(plain.score);
  },

  perfectDamage: () => {
    // A Warden, because a two-health Bulwark dies to any perfect — armour is
    // *meant* to fall to a clean parry — and a threat that dies is immediately
    // re-purposed as a projectile with its health reset.
    const remaining = [makeSession(), makeSession({}, ['executioner'])].map((s) => {
      s.shieldAngle = 0;
      s.shieldTarget = 0;
      const t = place(s, 'warden', 0, 1.02);
      advance(s, STEP * 3);
      return t.hp;
    });
    expect(remaining[1]!).toBeLessThan(remaining[0]!);
  },

  chainDepth: () => {
    const pierce = [makeSession(), makeSession({}, ['chain-reaction'])].map((s) => {
      s.shieldAngle = 0;
      s.shieldTarget = 0;
      const t = place(s, 'orb', 0, 1.02);
      advance(s, STEP * 3);
      return t.hp;
    });
    expect(pierce[1]!).toBeGreaterThan(pierce[0]!);
  },

  comboBonus: () => {
    const plain = makeSession();
    const clocked = makeSession({}, ['overclock']);
    for (const s of [plain, clocked]) contact(s, 0);
    expect(clocked.combo).toBeGreaterThan(plain.combo);
  },

  homing: () => {
    // A deflected shot with a target ahead and slightly off its flight path.
    // Sampled over a few frames only: given long enough both settle onto the
    // same bearing, and what the modifier changes is how fast they get there.
    const bend = [makeSession(), makeSession({}, ['magnet-field'])].map((s) => {
      s.shieldAngle = 0;
      s.shieldTarget = 0;
      const shot = place(s, 'orb', 0, 1.02);
      advance(s, STEP * 3);
      const target = place(s, 'orb', 0.18, 1.6);
      target.speed = 0;
      const before = Math.atan2(shot.vy, shot.vx);
      advance(s, STEP * 4);
      return Math.abs(Math.atan2(shot.vy, shot.vx) - before);
    });
    expect(bend[0]!).toBeGreaterThan(0);
    expect(bend[1]!).toBeGreaterThan(bend[0]!);
  },

  cores: () => {
    const s = makeSession({}, ['core-tithe']);
    expect(s.buildStats().coreMult).toBeGreaterThan(makeSession().buildStats().coreMult);
  },

  mirror: () => {
    const s = makeSession({}, ['twin-guard']);
    advance(s, 1);
    expect(s.mirror).toBe(true);
    expect(makeSession().mirror).toBe(false);
  },

  secondWind: () => {
    const survive = (cards: string[]): number => {
      const s = makeSession({ integrity: 1 }, cards);
      s.shieldAngle = Math.PI;
      s.shieldTarget = Math.PI;
      // Straight into the nexus from the uncovered side.
      const t = place(s, 'orb', 0, 0.2);
      t.speed = s.arena.unit * 0.6;
      advance(s, 0.6);
      return s.integrity;
    };
    expect(survive([])).toBe(0);
    expect(survive(['second-wind'])).toBe(1);
  },
};

describe('every draft modifier changes the game', () => {
  it('has a probe and a card for every modifier', () => {
    const keys = Object.keys(makeMods()).sort();
    expect(Object.keys(MOD_PROBES).sort()).toEqual(keys);
    expect(Object.keys(MOD_CARD).sort()).toEqual(keys);
  });

  it('names a card that actually exists for every modifier', () => {
    const ids = new Set(RESONANCE.map((r) => r.id));
    for (const [mod, card] of Object.entries(MOD_CARD)) {
      expect(ids.has(card), `${mod} points at a card that does not exist: ${card}`).toBe(true);
    }
  });

  for (const [name, probe] of Object.entries(MOD_PROBES)) {
    it(`${name} reaches the simulation`, probe);
  }
});

// ------------------------------------------------------------------ ultimates

/**
 * Every Ultimate must do something, and it must do it *now*.
 *
 * The Ultimate is the payoff for a whole run's combo and the reason a rare
 * Guardian feels different from a common one. One that quietly fizzles is worse
 * than one that is weak: the player spent a meter on it.
 */
const ULT_PROBES: Record<UltimateId, () => void> = {
  nova: () => {
    const s = withUltimate('nova');
    crowd(s);
    expect(liveThreats(s)).toBeGreaterThan(0);
    expect(s.fireUltimate()).toBe(true);
    expect(liveThreats(s)).toBe(0);
  },

  fracture: () => {
    const s = withUltimate('fracture');
    crowd(s);
    const before = s.score;
    expect(s.fireUltimate()).toBe(true);
    expect(liveThreats(s)).toBe(0);
    expect(s.score).toBeGreaterThan(before);
  },

  siphon: () => {
    const s = withUltimate('siphon');
    s.integrity = 1;
    crowd(s, 8);
    expect(s.fireUltimate()).toBe(true);
    expect(liveThreats(s)).toBe(0);
    expect(s.integrity).toBe(2);
  },

  bulwark: () => {
    const s = withUltimate('bulwark');
    expect(s.fireUltimate()).toBe(true);
    expect(s.fullCircle).toBe(true);
    // Covered from behind, which is the entire point of it.
    s.shieldAngle = 0;
    s.shieldTarget = 0;
    const seen: string[] = [];
    s.events.on('hit', (e) => seen.push(e.quality));
    place(s, 'orb', Math.PI, 1.02);
    advance(s, STEP * 3);
    expect(seen.length).toBeGreaterThan(0);
  },

  mirror: () => {
    const s = withUltimate('mirror');
    expect(s.fireUltimate()).toBe(true);
    expect(s.mirror).toBe(true);
    s.shieldAngle = 0;
    s.shieldTarget = 0;
    const seen: string[] = [];
    s.events.on('hit', (e) => seen.push(e.quality));
    place(s, 'orb', Math.PI, 1.02);
    advance(s, STEP * 3);
    expect(seen.length).toBeGreaterThan(0);
  },

  dilate: () => {
    const s = withUltimate('dilate');
    expect(s.threatTimeScale).toBe(1);
    expect(s.fireUltimate()).toBe(true);
    expect(s.threatTimeScale).toBeLessThan(1);
  },

  overcharge: () => {
    const s = withUltimate('overcharge');
    expect(s.fireUltimate()).toBe(true);
    // A contact well off centre still reads as a perfect while it is up.
    expect(contact(s, 0.9)).toContain('perfect');
  },

  lance: () => {
    const s = withUltimate('lance');
    s.shieldAngle = 0;
    s.shieldTarget = 0;
    // Directly along the aim, and something well off it that must survive.
    const onBeam = place(s, 'orb', 0, 2);
    onBeam.speed = 0;
    const offBeam = place(s, 'orb', Math.PI, 2);
    offBeam.speed = 0;
    expect(s.fireUltimate()).toBe(true);
    advance(s, STEP * 2);
    expect(onBeam.state).not.toBe('incoming');
    expect(offBeam.state).toBe('incoming');
  },

  magnetize: () => {
    const s = withUltimate('magnetize');
    s.shieldAngle = 0;
    s.shieldTarget = 0;
    crowd(s, 6);
    expect(s.fireUltimate()).toBe(true);
    // It gathers first and detonates after — both halves have to happen.
    advance(s, 0.4);
    expect(liveThreats(s)).toBeGreaterThan(0);
    advance(s, 1);
    expect(liveThreats(s)).toBe(0);
  },

  sentinel: () => {
    const s = withUltimate('sentinel');
    expect(s.getSentinels()).toHaveLength(0);
    expect(s.fireUltimate()).toBe(true);
    expect(s.getSentinels().length).toBeGreaterThan(0);

    // And they have to actually deflect, not just orbit prettily.
    const drone = s.getSentinels()[0]!;
    const t = place(s, 'orb', drone.angle, drone.radius / s.arena.shieldR);
    t.speed = 0;
    advance(s, STEP * 4);
    expect(t.state).not.toBe('incoming');
  },
};

describe('every Ultimate does something', () => {
  it('has a probe for every Ultimate in the game', () => {
    expect(Object.keys(ULT_PROBES).sort()).toEqual([...ULTIMATE_IDS].sort());
  });

  it('has at least one Guardian carrying each one', () => {
    const carried = new Set(GUARDIANS.map((g) => g.ultimate));
    for (const id of ULTIMATE_IDS) {
      expect(carried.has(id), `no Guardian carries ${id}`).toBe(true);
    }
  });

  for (const [name, probe] of Object.entries(ULT_PROBES)) {
    it(`${name} resolves`, probe);
  }
});

// -------------------------------------------------------------------- threats

/**
 * The same audit for the threat table: a field nobody reads is a threat that
 * looks different and plays identically, which is worse than having one fewer.
 */
describe('every threat property changes the game', () => {
  it('gives every archetype its own texture and label', () => {
    const textures = new Set(THREAT_LIST.map((t) => t.texture));
    const labels = new Set(THREAT_LIST.map((t) => t.label));
    expect(textures.size).toBe(THREAT_LIST.length);
    expect(labels.size).toBe(THREAT_LIST.length);
  });

  it('makes every non-boss archetype reachable', () => {
    const reachable = new Set(availableThreats(40).map((t) => t.kind));
    for (const t of THREAT_LIST) {
      if (t.boss) continue;
      expect(reachable.has(t.kind), `${t.kind} never unlocks`).toBe(true);
    }
  });

  it('makes every spawn pattern reachable', () => {
    const reachable = new Set(availablePatterns(40).map((p) => p.id));
    for (const p of PATTERNS) expect(reachable.has(p.id), `${p.id} never unlocks`).toBe(true);
  });

  it('lets armour survive a plain block and not a perfect', () => {
    const blocked = makeSession();
    blocked.shieldAngle = 0;
    blocked.shieldTarget = 0;
    const armoured = place(blocked, 'bulwark', blocked.arcHalf * 0.85, 1.02);
    advance(blocked, STEP * 3);
    expect(armoured.state).toBe('incoming');

    const perfected = makeSession();
    perfected.shieldAngle = 0;
    perfected.shieldTarget = 0;
    const soft = place(perfected, 'bulwark', 0, 1.02);
    advance(perfected, STEP * 3);
    expect(soft.state).toBe('deflected');
  });

  it('breaks a splitter into children', () => {
    const s = makeSession();
    s.shieldAngle = 0;
    s.shieldTarget = 0;
    place(s, 'splitter', 0, 1.02);
    advance(s, STEP * 4);
    const children = s.pool.live.filter((t) => t.kind === THREATS.splitter.splitInto!.kind && t.generation > 0);
    expect(children.length).toBe(THREATS.splitter.splitInto!.count);
  });

  it('removes exactly the integrity a threat declares', () => {
    const s = makeSession();
    // Facing away, so nothing is blocked and the threat walks into the nexus.
    s.shieldAngle = Math.PI;
    s.shieldTarget = Math.PI;
    const before = s.integrity;
    const t = place(s, 'orb', 0, 0.2);
    t.speed = s.arena.unit * 0.6;
    advance(s, 0.6);
    expect(s.integrity).toBe(before - THREATS.orb.damage);
  });

  it('moves a spiral and a tracker off their entry bearing, and a straight one not at all', () => {
    const drift = (kind: keyof typeof THREATS): number => {
      const s = makeSession();
      s.shieldAngle = 0;
      s.shieldTarget = 0;
      const t = place(s, kind, 1.2, 2.4);
      t.speed = 0;
      const start = t.angle;
      advance(s, 0.6);
      return Math.abs(t.angle - start);
    };
    expect(drift('orb')).toBe(0);
    expect(drift('splitter')).toBeGreaterThan(0);
    expect(drift('seeker')).toBeGreaterThan(0);
  });

  it('makes a shorter travel time actually arrive sooner', () => {
    const arrival = (kind: keyof typeof THREATS): number => {
      const s = makeSession();
      s.shieldAngle = Math.PI;
      s.shieldTarget = Math.PI;
      const t = s.pool.spawn(THREATS[kind])!;
      t.angle = 0;
      t.radius = s.arena.edgeRadius(0);
      t.speed = (s.arena.edgeRadius(0) - s.arena.shieldR) / THREATS[kind].travelTime;
      t.size = s.arena.px(THREATS[kind].radius);
      t.scale = 1;
      let elapsed = 0;
      while (elapsed < 12 && t.radius > s.arena.shieldR) {
        s.update(STEP);
        elapsed += STEP;
      }
      return elapsed;
    };
    expect(arrival('lancer')).toBeLessThan(arrival('orb'));
  });
});
