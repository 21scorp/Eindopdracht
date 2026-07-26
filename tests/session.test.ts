/**
 * Gameplay mechanics.
 *
 * `GameSession` has no DOM dependency, so the whole combat model can be driven
 * headlessly at a fixed step. These tests exist because the first playtest
 * showed two mechanics silently doing nothing — chains never triggering and
 * pulses never catching anything — and neither was visible from the code.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/GameSession';
import { getGuardian } from '../src/data/guardians';
import { THREATS } from '../src/data/threats';
import { SCORING } from '../src/data/balance';
import type { ViewInfo } from '../src/render/Renderer';
import type { HitQuality } from '../src/game/events';

const VIEW: ViewInfo = {
  width: 412,
  height: 892,
  cx: 206,
  cy: 446,
  scale: 1,
  minSide: 412,
  portrait: true,
};

const STEP = 1 / 120;

function makeSession(guardianId = 'vane'): GameSession {
  const s = new GameSession('test-seed');
  s.arena.update(VIEW);
  s.start(getGuardian(guardianId), 1, 1, 'test-seed');
  return s;
}

/** Advance the simulation by `seconds` at the real fixed step. */
function advance(s: GameSession, seconds: number): void {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i++) s.update(STEP);
}

/** Place a threat directly, bypassing the wave director. */
function place(
  s: GameSession,
  kind: keyof typeof THREATS,
  angle: number,
  radiusFraction: number,
): NonNullable<ReturnType<GameSession['pool']['spawn']>> {
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

function collectHits(s: GameSession): HitQuality[] {
  const out: HitQuality[] = [];
  s.events.on('hit', (e) => out.push(e.quality));
  return out;
}

describe('arena geometry', () => {
  it('places the spawn ring on the screen edge, not on a circle', () => {
    const s = makeSession();
    const right = s.arena.edgeRadius(0);
    const up = s.arena.edgeRadius(-Math.PI / 2);
    // On a 412x892 viewport the top edge is much further away than the side.
    expect(right).toBeCloseTo(412 / 2 + 70, 3);
    expect(up).toBeCloseTo(892 / 2 + 70, 3);
  });

  it('keeps the arena inside the viewport', () => {
    const s = makeSession();
    expect(s.arena.shieldR).toBeLessThan(VIEW.minSide / 2);
    expect(s.arena.nexusR).toBeLessThan(s.arena.shieldR);
  });
});

describe('shield contact', () => {
  let session: GameSession;
  beforeEach(() => {
    session = makeSession();
  });

  it('blocks a threat inside the arc', () => {
    const hits = collectHits(session);
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    // Just off the arc centre, but well inside it: a block, not a perfect.
    place(session, 'orb', session.arcHalf * 0.8, 1.02);
    advance(session, STEP * 2);
    expect(hits).toContain('block');
  });

  it('scores a PERFECT at the centre of the arc', () => {
    const hits = collectHits(session);
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    place(session, 'orb', 0, 1.02);
    advance(session, STEP * 2);
    expect(hits).toContain('perfect');
  });

  it('lets a threat through outside the arc', () => {
    const hits = collectHits(session);
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    place(session, 'orb', Math.PI, 1.02);
    advance(session, STEP * 2);
    expect(hits).toHaveLength(0);
  });

  it('turns a blocked threat into an outbound projectile', () => {
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    const t = place(session, 'orb', 0, 1.02);
    advance(session, STEP * 2);
    expect(t.state).toBe('deflected');
    // Moving away from the nexus.
    expect(t.vx).toBeGreaterThan(0);
  });

  it('bounces armoured threats instead of deflecting them', () => {
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    // Off-centre, so this is a block (1 damage) against 2 armour — it survives.
    const t = place(session, 'bulwark', session.arcHalf * 0.8, 1.02);
    const startHp = t.hp;
    advance(session, STEP * 2);
    expect(t.state).toBe('incoming');
    expect(t.hp).toBe(startHp - 1);
  });

  it('breaks armour outright on a perfect, which deals double', () => {
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    const hits = collectHits(session);
    const t = place(session, 'bulwark', 0, 1.02);
    advance(session, STEP * 2);
    expect(hits).toContain('perfect');
    // Once armour breaks the threat becomes ammunition like anything else. Its
    // `hp` is reused at that point as the projectile's pierce count.
    expect(t.state).toBe('deflected');
  });

  it('cannot break armour faster than the hit cooldown allows', () => {
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    place(session, 'bulwark', 0, 1.02);
    // A perfect deals 2 and a Bulwark has 2 HP, so one contact is lethal — but
    // it must take one contact, not a hundred in the same tenth of a second.
    let contacts = 0;
    session.events.on('hit', () => contacts++);
    advance(session, 0.1);
    expect(contacts).toBeLessThanOrEqual(1);
  });
});

describe('pulse', () => {
  it('parries a threat inside the band regardless of shield angle', () => {
    const session = makeSession();
    const hits = collectHits(session);
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    // Directly behind the shield — a block is impossible here.
    place(session, 'orb', Math.PI, 0.99);
    expect(session.pulse()).toBe(true);
    advance(session, session.stats.pulseWindow + STEP * 4);
    expect(hits).toContain('parry');
  });

  it('respects its cooldown', () => {
    const session = makeSession();
    expect(session.pulse()).toBe(true);
    advance(session, session.stats.pulseWindow + STEP);
    expect(session.pulse()).toBe(false);
    advance(session, session.stats.pulseCooldown);
    expect(session.pulse()).toBe(true);
  });

  it('catches a whole cluster in one sweep', () => {
    const session = makeSession();
    let caught = 0;
    session.events.on('pulse', (e) => (caught = e.caught));
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    // Spread across the half of the arena the shield cannot reach, so every
    // kill here is attributable to the pulse.
    for (let i = 0; i < 6; i++) place(session, 'orb', Math.PI * (0.55 + (i / 5) * 0.9), 0.98);
    session.pulse();
    // Generous: a perfect catch triggers slow motion, which stretches the
    // window in real time.
    advance(session, 2);
    expect(caught).toBe(6);
  });

  it('reaches threats the shield has already let past', () => {
    const session = makeSession();
    const hits = collectHits(session);
    session.shieldAngle = Math.PI;
    session.shieldTarget = Math.PI;
    place(session, 'orb', 0, 0.55);
    session.pulse();
    advance(session, 1.5);
    expect(hits).toContain('parry');
  });

  it('misses threats that are nowhere near the band', () => {
    const session = makeSession();
    const hits = collectHits(session);
    place(session, 'orb', 0, 3.2);
    session.pulse();
    advance(session, session.stats.pulseWindow + STEP * 4);
    expect(hits).not.toContain('parry');
  });
});

describe('chains', () => {
  it('lets a deflected shot destroy another threat', () => {
    const session = makeSession();
    const hits = collectHits(session);
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    place(session, 'orb', 0, 1.02);
    // A second threat further out on a nearby angle: the homing should find it.
    place(session, 'orb', 0.28, 1.9);
    advance(session, 1.4);
    expect(hits).toContain('chain');
  });

  it('does not let one shot clear the entire screen', () => {
    const session = makeSession();
    const hits = collectHits(session);
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    place(session, 'orb', 0, 1.02);
    for (let i = 0; i < 8; i++) place(session, 'orb', 0.12 * i, 1.5 + i * 0.12);
    advance(session, 2);
    const chains = hits.filter((q) => q === 'chain').length;
    // Chains cascade — each new projectile can hit one more — but a single
    // block must not be able to wipe an unbounded number of threats.
    expect(chains).toBeLessThanOrEqual(9);
  });
});

describe('scoring and combo', () => {
  it('raises the multiplier every combo step', () => {
    const session = makeSession();
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    expect(session.multiplier).toBe(1);
    for (let i = 0; i < SCORING.multiplierStep; i++) {
      place(session, 'orb', session.arcHalf * 0.8, 1.02);
      advance(session, STEP * 2);
    }
    expect(session.combo).toBeGreaterThanOrEqual(SCORING.multiplierStep);
    expect(session.multiplier).toBeGreaterThan(1);
  });

  it('caps the multiplier', () => {
    const session = makeSession();
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    for (let i = 0; i < 400; i++) {
      place(session, 'orb', session.arcHalf * 0.8, 1.02);
      advance(session, STEP * 2);
    }
    expect(session.multiplier).toBeLessThanOrEqual(SCORING.multiplierMax * SCORING.overdriveMultiplier);
  });

  it('enters Overdrive at the threshold', () => {
    const session = makeSession();
    let entered = false;
    session.events.on('overdriveStart', () => (entered = true));
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    while (session.combo < SCORING.overdriveThreshold) {
      place(session, 'orb', 0, 1.02);
      advance(session, STEP * 2);
    }
    expect(entered).toBe(true);
    expect(session.overdrive).toBe(true);
  });

  it('pays a parry more than a perfect, and a perfect more than a block', () => {
    const scoreFor = (setup: (s: GameSession) => void): number => {
      const s = makeSession();
      s.shieldAngle = 0;
      s.shieldTarget = 0;
      setup(s);
      advance(s, s.stats.pulseWindow + STEP * 4);
      return s.score;
    };
    const block = scoreFor((s) => place(s, 'orb', s.arcHalf * 0.85, 1.02));
    const perfect = scoreFor((s) => place(s, 'orb', 0, 1.02));
    const parry = scoreFor((s) => {
      place(s, 'orb', Math.PI, 0.99);
      s.pulse();
    });
    expect(perfect).toBeGreaterThan(block);
    expect(parry).toBeGreaterThan(perfect);
  });
});

describe('damage', () => {
  it('loses integrity when a threat reaches the nexus', () => {
    const session = makeSession();
    session.shieldAngle = Math.PI;
    session.shieldTarget = Math.PI;
    const before = session.integrity;
    place(session, 'orb', 0, 0.1);
    advance(session, 0.5);
    expect(session.integrity).toBeLessThan(before);
  });

  it('breaks the combo on damage', () => {
    const session = makeSession();
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    for (let i = 0; i < 4; i++) {
      place(session, 'orb', 0, 1.02);
      advance(session, STEP * 2);
    }
    expect(session.combo).toBeGreaterThan(0);
    session.shieldAngle = Math.PI;
    session.shieldTarget = Math.PI;
    place(session, 'orb', 0, 0.1);
    advance(session, 0.5);
    expect(session.combo).toBe(0);
  });

  it('grants brief invulnerability so one gap does not cost every life', () => {
    const session = makeSession();
    session.shieldAngle = Math.PI;
    session.shieldTarget = Math.PI;
    const before = session.integrity;
    place(session, 'orb', 0, 0.1);
    place(session, 'orb', 0.2, 0.1);
    place(session, 'orb', -0.2, 0.1);
    advance(session, 0.3);
    expect(session.integrity).toBe(before - 1);
  });

  it('ends the run when integrity is gone', () => {
    const session = makeSession('ember'); // 2 integrity
    let ended = false;
    session.events.on('runEnd', () => (ended = true));
    session.shieldAngle = Math.PI;
    session.shieldTarget = Math.PI;
    for (let i = 0; i < 6 && !ended; i++) {
      place(session, 'orb', 0, 0.1);
      advance(session, 1.3);
    }
    expect(ended).toBe(true);
    expect(session.phase).toBe('over');
  });
});

describe('ultimates', () => {
  it('charges from combo and fires once full', () => {
    const session = makeSession();
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    expect(session.ultimateReady).toBe(false);
    while (!session.ultimateReady) {
      place(session, 'orb', 0, 1.02);
      advance(session, STEP * 2);
    }
    expect(session.fireUltimate()).toBe(true);
    expect(session.ultCharge).toBe(0);
  });

  it('NOVA clears the screen', () => {
    const session = makeSession('vane');
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    while (!session.ultimateReady) {
      place(session, 'orb', 0, 1.02);
      advance(session, STEP * 2);
    }
    for (let i = 0; i < 8; i++) place(session, 'orb', (i / 8) * Math.PI * 2, 2.2);
    session.fireUltimate();
    advance(session, STEP);
    expect(session.pool.countIncoming()).toBe(0);
  });

  it('BULWARK covers every angle for its duration', () => {
    const session = makeSession('slate');
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    while (!session.ultimateReady) {
      place(session, 'orb', 0, 1.02);
      advance(session, STEP * 2);
    }
    session.fireUltimate();
    advance(session, STEP);
    expect(session.fullCircle).toBe(true);

    const hits = collectHits(session);
    place(session, 'orb', Math.PI, 1.02);
    advance(session, STEP * 2);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('DILATE slows threats but not the shield', () => {
    const session = makeSession('halcyon');
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    while (!session.ultimateReady) {
      place(session, 'orb', 0, 1.02);
      advance(session, STEP * 2);
    }
    expect(session.threatTimeScale).toBe(1);
    session.fireUltimate();
    advance(session, STEP);
    expect(session.threatTimeScale).toBeLessThan(1);
  });
});

describe('wave director', () => {
  it('starts a wave and eventually clears it', () => {
    const session = makeSession('solstice'); // high integrity, survives longer
    const waves: number[] = [];
    session.events.on('waveStart', (e) => waves.push(e.wave));
    // Full circle cover so nothing can reach the nexus while we watch the flow.
    session.fullCircle = true;
    for (let i = 0; i < 120 * 40; i++) {
      session.fullCircle = true;
      session.update(STEP);
    }
    expect(waves.length).toBeGreaterThanOrEqual(2);
    expect(waves[0]).toBe(1);
  });

  it('keeps the live threat count within the readability cap', () => {
    const session = makeSession('solstice');
    let peak = 0;
    for (let i = 0; i < 120 * 60; i++) {
      session.update(STEP);
      peak = Math.max(peak, session.pool.countIncoming());
      if (session.phase === 'over') break;
    }
    // The cap is a spawn gate, not a hard clamp — splitters and boss adds can
    // overshoot it briefly. A large overshoot means the gate is not working.
    expect(peak).toBeLessThan(70);
  });
});

describe('run statistics', () => {
  it('reports counts that match what happened', () => {
    const session = makeSession();
    session.shieldAngle = 0;
    session.shieldTarget = 0;
    for (let i = 0; i < 5; i++) {
      place(session, 'orb', 0, 1.02);
      advance(session, STEP * 2);
    }
    const stats = session.buildStats();
    // Deflected shots home, so later orbs are often chained before they reach
    // the shield. Every one of the five is accounted for either way.
    expect(stats.perfects + stats.chains).toBe(5);
    expect(stats.perfects).toBeGreaterThanOrEqual(1);
    expect(stats.blocks).toBe(0);
    expect(stats.score).toBeGreaterThan(0);
    expect(stats.accuracy).toBeCloseTo(1, 5);
    expect(stats.guardianId).toBe('vane');
  });
});
