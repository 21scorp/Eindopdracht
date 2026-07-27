/**
 * @vitest-environment happy-dom
 *
 * The in-run draft.
 *
 * Two classes of bug matter here. The first is a card that does nothing —
 * silently, because a multiplier was applied to a stat the simulation does not
 * read. The second is a card that does something twice, which is what happens
 * the moment modifiers are applied incrementally instead of recomputed. Both
 * are invisible in a playtest, so both are asserted directly.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Rng } from '../src/core/Rng';
import { GameSession } from '../src/game/GameSession';
import { getGuardian } from '../src/data/guardians';
import {
  DRAFT_INTERVAL,
  FIRST_DRAFT_WAVE,
  RESONANCE,
  applyResonance,
  draftIndex,
  isDraftWave,
  makeMods,
  rollResonance,
  tierWeight,
} from '../src/data/resonance';

function session(guardianId = 'vane'): GameSession {
  const s = new GameSession();
  s.arena.update({ width: 412, height: 892, cx: 206, cy: 446, scale: 1, minSide: 412, portrait: true });
  s.start(getGuardian(guardianId), 1, 1, 'test-seed');
  return s;
}

describe('the card list', () => {
  it('has unique ids', () => {
    const ids = RESONANCE.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every card a name, a rules sentence and a weight', () => {
    for (const r of RESONANCE) {
      expect(r.name.length).toBeGreaterThan(2);
      expect(r.text.endsWith('.')).toBe(true);
      expect(r.weight).toBeGreaterThan(0);
      expect(r.icon.startsWith('res/')).toBe(true);
    }
  });

  it('has enough cards that a long run never runs dry', () => {
    // Eight drafts is a very deep run; three cards each must still be possible.
    expect(RESONANCE.length).toBeGreaterThanOrEqual(8 + 3);
  });

  it('changes something for every card', () => {
    const base = JSON.stringify(makeMods());
    for (const r of RESONANCE) {
      const m = makeMods();
      r.apply(m);
      expect(JSON.stringify(m), `${r.id} applied nothing`).not.toBe(base);
    }
  });

  it('has at least one card that costs the player something', () => {
    const tradeoffs = RESONANCE.filter((r) => {
      const m = makeMods();
      r.apply(m);
      return m.arc < 1 || m.turn > 1 || m.pulseCooldown > 1 || m.scoreMult < 1;
    });
    expect(tradeoffs.length).toBeGreaterThan(0);
  });
});

describe('folding cards into modifiers', () => {
  it('is a pure function of the list, not of the order it was applied in', () => {
    const a = applyResonance(['wide-guard', 'prism-cut']);
    const b = applyResonance(['prism-cut', 'wide-guard']);
    expect(a).toEqual(b);
  });

  it('does not double-apply when recomputed from the same list', () => {
    const once = applyResonance(['wide-guard']);
    const again = applyResonance(['wide-guard']);
    expect(again.arc).toBe(once.arc);
  });

  it('ignores an id the build no longer has', () => {
    expect(() => applyResonance(['removed-in-a-later-build'])).not.toThrow();
    expect(applyResonance(['removed-in-a-later-build'])).toEqual(makeMods());
  });

  it('stacks multiplicatively across cards that touch the same stat', () => {
    const m = applyResonance(['wide-guard', 'focus']);
    expect(m.arc).toBeCloseTo(1.18 * 0.85, 6);
  });
});

describe('the schedule', () => {
  it('starts at the first draft wave and repeats on the interval', () => {
    expect(isDraftWave(1)).toBe(false);
    expect(isDraftWave(FIRST_DRAFT_WAVE)).toBe(true);
    expect(isDraftWave(FIRST_DRAFT_WAVE + DRAFT_INTERVAL)).toBe(true);
    expect(isDraftWave(FIRST_DRAFT_WAVE + 1)).toBe(false);
  });

  it('numbers the drafts from zero', () => {
    expect(draftIndex(FIRST_DRAFT_WAVE)).toBe(0);
    expect(draftIndex(FIRST_DRAFT_WAVE + DRAFT_INTERVAL)).toBe(1);
    expect(draftIndex(FIRST_DRAFT_WAVE + 1)).toBe(-1);
  });

  it('offers roughly one draft per three waves over a long run', () => {
    let drafts = 0;
    for (let w = 1; w <= 30; w++) if (isDraftWave(w)) drafts++;
    expect(drafts).toBeGreaterThanOrEqual(9);
    expect(drafts).toBeLessThanOrEqual(11);
  });
});

describe('tier weighting', () => {
  it('opens with commons and escalates', () => {
    expect(tierWeight('common', 0)).toBeGreaterThan(tierWeight('rare', 0));
    expect(tierWeight('rare', 0)).toBeGreaterThan(tierWeight('epic', 0));
    expect(tierWeight('epic', 6)).toBeGreaterThan(tierWeight('epic', 0));
    expect(tierWeight('common', 6)).toBeLessThan(tierWeight('common', 0));
  });

  it('never reaches zero, so no tier becomes unreachable', () => {
    for (const tier of ['common', 'rare', 'epic'] as const) {
      for (const i of [0, 1, 3, 5, 20]) expect(tierWeight(tier, i)).toBeGreaterThan(0);
    }
  });
});

describe('rolling an offer', () => {
  it('offers three distinct cards', () => {
    const offer = rollResonance(new Rng('a'), [], 0);
    expect(offer).toHaveLength(3);
    expect(new Set(offer).size).toBe(3);
  });

  it('never offers a card already held', () => {
    const held = ['wide-guard', 'snap-turn', 'pulse-battery'];
    for (let i = 0; i < 60; i++) {
      const offer = rollResonance(new Rng(`s${i}`), held, 2);
      for (const id of offer) expect(held).not.toContain(id);
    }
  });

  it('is deterministic for the same seed', () => {
    expect(rollResonance(new Rng('same'), [], 1)).toEqual(rollResonance(new Rng('same'), [], 1));
  });

  it('copes when the pool is nearly exhausted', () => {
    const held = RESONANCE.slice(2).map((r) => r.id);
    const offer = rollResonance(new Rng('x'), held, 4);
    expect(offer).toHaveLength(2);
  });

  it('returns nothing rather than repeating when everything is held', () => {
    const held = RESONANCE.map((r) => r.id);
    expect(rollResonance(new Rng('x'), held, 4)).toEqual([]);
  });

  it('leans epic in the late game and common in the early game', () => {
    const early = new Set<string>();
    const late = new Set<string>();
    for (let i = 0; i < 200; i++) {
      for (const id of rollResonance(new Rng(`e${i}`), [], 0)) early.add(`${i}:${id}`);
      for (const id of rollResonance(new Rng(`l${i}`), [], 6)) late.add(`${i}:${id}`);
    }
    const epicIds = new Set(RESONANCE.filter((r) => r.tier === 'epic').map((r) => r.id));
    const count = (set: Set<string>) => [...set].filter((s) => epicIds.has(s.split(':')[1]!)).length;
    expect(count(late)).toBeGreaterThan(count(early) * 2);
  });
});

describe('a session taking cards', () => {
  let s: GameSession;
  beforeEach(() => {
    s = session();
  });

  it('starts with nothing and an untouched stat block', () => {
    expect(s.resonance).toEqual([]);
    expect(s.stats).toEqual(s.baseStats);
  });

  it('widens the shield when told to', () => {
    const before = s.stats.arc;
    expect(s.takeResonance('wide-guard')).toBe(true);
    expect(s.stats.arc).toBeCloseTo(before * 1.18, 6);
    // The base stats are untouched, so the fold stays reproducible.
    expect(s.baseStats.arc).toBe(before);
  });

  it('refuses a card it already holds, and does not apply it twice', () => {
    s.takeResonance('wide-guard');
    const after = s.stats.arc;
    expect(s.takeResonance('wide-guard')).toBe(false);
    expect(s.stats.arc).toBe(after);
    expect(s.resonance).toEqual(['wide-guard']);
  });

  it('refuses an unknown card', () => {
    expect(s.takeResonance('not-a-card')).toBe(false);
    expect(s.resonance).toEqual([]);
  });

  it('repairs the nexus as well as raising its ceiling', () => {
    s.integrity = 1;
    const maxBefore = s.maxIntegrity;
    s.takeResonance('reinforced');
    expect(s.maxIntegrity).toBe(maxBefore + 1);
    expect(s.integrity).toBe(2);
  });

  it('never repairs past the new ceiling', () => {
    const full = s.integrity;
    s.takeResonance('reinforced');
    expect(s.integrity).toBe(full + 1);
    expect(s.integrity).toBeLessThanOrEqual(s.maxIntegrity);
  });

  it('lowers the ultimate cost and applies it to the live meter immediately', () => {
    const before = s.ultCost;
    s.takeResonance('overflow');
    expect(s.ultCost).toBeLessThan(before);
    expect(s.ultCost).toBe(s.stats.ultCost);
  });

  it('raises the second shield permanently', () => {
    expect(s.mirror).toBe(false);
    s.takeResonance('twin-guard');
    expect(s.mirror).toBe(true);
  });

  it('keeps the second shield up frame after frame', () => {
    // Regression: the Ultimate teardown ran every frame and cleared the same
    // flag TWIN GUARD raises, so the card silently did nothing from the next
    // frame onward.
    s.takeResonance('twin-guard');
    for (let i = 0; i < 240; i++) s.update(1 / 120);
    expect(s.mirror).toBe(true);
  });

  it('does not leave the second shield up for a run that did not take it', () => {
    for (let i = 0; i < 120; i++) s.update(1 / 120);
    expect(s.mirror).toBe(false);
  });

  it('keeps the shield inside sane bounds however many cards stack', () => {
    for (const id of ['wide-guard', 'focus', 'snap-turn', 'pulse-battery']) s.takeResonance(id);
    expect(s.stats.arc).toBeGreaterThan(0.25);
    expect(s.stats.arc).toBeLessThan(Math.PI * 1.4 + 0.001);
    expect(s.stats.turn).toBeGreaterThan(0);
    expect(s.stats.pulseCooldown).toBeGreaterThan(0);
  });

  it('reports the build and the payout multiplier in the run stats', () => {
    s.takeResonance('core-tithe');
    s.takeResonance('wide-guard');
    const stats = s.buildStats();
    expect(stats.resonance).toEqual(['core-tithe', 'wide-guard']);
    expect(stats.coreMult).toBeCloseTo(1.3, 6);
  });

  it('clears the build when a new run starts', () => {
    s.takeResonance('wide-guard');
    s.takeResonance('twin-guard');
    s.start(getGuardian('vane'), 1, 1, 'another-seed');
    expect(s.resonance).toEqual([]);
    expect(s.mirror).toBe(false);
    expect(s.stats).toEqual(s.baseStats);
  });

  it('only offers a draft on a draft wave', () => {
    expect(s.draftDue(1)).toBe(false);
    expect(s.draftDue(FIRST_DRAFT_WAVE)).toBe(true);
  });

  it('does not offer a draft once the run is over', () => {
    s.end();
    expect(s.draftDue(FIRST_DRAFT_WAVE)).toBe(false);
  });

  it('rolls an offer that excludes what is already held', () => {
    s.takeResonance('wide-guard');
    const offer = s.rollOffer(FIRST_DRAFT_WAVE + DRAFT_INTERVAL);
    expect(offer).toHaveLength(3);
    expect(offer).not.toContain('wide-guard');
  });

  it('rolls the same offer twice for the same run state', () => {
    const a = s.rollOffer(FIRST_DRAFT_WAVE);
    const b = s.rollOffer(FIRST_DRAFT_WAVE);
    expect(a).toEqual(b);
  });
});
