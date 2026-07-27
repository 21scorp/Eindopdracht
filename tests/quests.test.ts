/**
 * @vitest-environment happy-dom
 *
 * Daily objectives.
 *
 * The two things that must hold: a quest can never pay out twice, and the set
 * a player sees must be stable across reloads. Both are the kind of bug that is
 * invisible in a playtest and obvious in a ledger.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Profile } from '../src/meta/Profile';
import { QuestTracker, advance, metricValue, rollDailyQuests } from '../src/meta/quests';
import { DAILY_QUEST_COUNT, QUEST_BY_ID, QUEST_POOL, questLabel } from '../src/data/quests';
import type { RunStats } from '../src/game/events';

let counter = 0;
function freshProfile(): Profile {
  return new Profile(`test.quests.${counter++}.${Math.random()}`);
}

function run(overrides: Partial<RunStats> = {}): RunStats {
  return {
    score: 50_000,
    wave: 8,
    maxCombo: 22,
    blocks: 40,
    perfects: 18,
    parries: 9,
    chains: 21,
    kills: 90,
    bossKills: 1,
    ultimatesUsed: 2,
    duration: 84,
    integrityLeft: 1,
    accuracy: 0.6,
    guardianId: 'vane',
    seed: 'test',
    ...overrides,
  };
}

/**
 * Pin an exact quest set. The daily roll depends on the account id *and* the
 * date, so a test that relies on it is a test that behaves differently
 * tomorrow — and one that quietly picks the "play 3 runs" quest fails when the
 * fixture only plays one.
 */
function withQuests(ids: string[]): { profile: Profile; tracker: QuestTracker } {
  const profile = freshProfile();
  profile.data.questDate = profile.data.daily.date;
  profile.data.quests = ids.map((id) => ({ id, progress: 0, claimed: false }));
  return { profile, tracker: new QuestTracker(profile) };
}

/** A run large enough to finish any single-run objective in the pool. */
const HUGE = run({
  score: 500_000,
  wave: 30,
  maxCombo: 200,
  perfects: 200,
  parries: 200,
  chains: 200,
  kills: 500,
  bossKills: 5,
  ultimatesUsed: 20,
});

const SINGLE_RUN_QUESTS = ['perfects40', 'parries25', 'combo35'];

beforeEach(() => window.localStorage.clear());

describe('the pool', () => {
  it('has unique ids and reachable targets', () => {
    const ids = QUEST_POOL.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUEST_POOL) {
      expect(q.target).toBeGreaterThan(0);
      expect(q.reward.amount).toBeGreaterThan(0);
      expect(q.weight).toBeGreaterThan(0);
    }
  });

  it('has enough entries to fill a day without repeating', () => {
    expect(QUEST_POOL.length).toBeGreaterThanOrEqual(DAILY_QUEST_COUNT * 2);
  });

  it('substitutes the target into every label that asks for one', () => {
    for (const q of QUEST_POOL) {
      expect(questLabel(q)).not.toContain('{n}');
    }
  });
});

describe('rolling a day', () => {
  it('is stable for the same account and date', () => {
    const a = rollDailyQuests('player-1', '2026-07-27');
    const b = rollDailyQuests('player-1', '2026-07-27');
    expect(a).toEqual(b);
  });

  it('differs by day and by account', () => {
    const day1 = rollDailyQuests('player-1', '2026-07-27');
    const day2 = rollDailyQuests('player-1', '2026-07-28');
    const other = rollDailyQuests('player-2', '2026-07-27');
    expect(day1).not.toEqual(day2);
    expect(day1).not.toEqual(other);
  });

  it('never repeats a quest or a metric within a day', () => {
    for (let i = 0; i < 60; i++) {
      const ids = rollDailyQuests(`p${i}`, '2026-07-27');
      expect(ids).toHaveLength(DAILY_QUEST_COUNT);
      expect(new Set(ids).size).toBe(DAILY_QUEST_COUNT);
      const metrics = ids.map((id) => QUEST_BY_ID.get(id)!.metric);
      expect(new Set(metrics).size).toBe(DAILY_QUEST_COUNT);
    }
  });
});

describe('progress', () => {
  it('accumulates sum metrics and keeps the best of best metrics', () => {
    const sum = QUEST_POOL.find((q) => q.mode === 'sum' && q.metric === 'kills')!;
    const best = QUEST_POOL.find((q) => q.mode === 'best' && q.metric === 'wave')!;

    expect(advance(0, run({ kills: 30 }), sum)).toBe(30);
    expect(advance(30, run({ kills: 30 }), sum)).toBe(60);

    expect(advance(0, run({ wave: 9 }), best)).toBe(9);
    expect(advance(9, run({ wave: 4 }), best)).toBe(9);
    expect(advance(9, run({ wave: 14 }), best)).toBe(14);
  });

  it('counts a run as one for the runs metric', () => {
    const runs = QUEST_POOL.find((q) => q.metric === 'runs')!;
    expect(metricValue(run(), runs)).toBe(1);
  });

  it('reads every metric it declares', () => {
    for (const q of QUEST_POOL) {
      expect(Number.isFinite(metricValue(run(), q))).toBe(true);
    }
  });
});

describe('the tracker', () => {
  it('gives a new account a full set', () => {
    const tracker = new QuestTracker(freshProfile());
    const list = tracker.list();
    expect(list).toHaveLength(DAILY_QUEST_COUNT);
    for (const q of list) {
      expect(q.progress).toBe(0);
      expect(q.claimed).toBe(false);
    }
  });

  it('advances on a run and reports what just completed', () => {
    const { tracker } = withQuests(SINGLE_RUN_QUESTS);
    const completed = tracker.recordRun(HUGE);
    expect(completed).toHaveLength(SINGLE_RUN_QUESTS.length);
    expect(tracker.list().every((q) => q.complete)).toBe(true);
    expect(tracker.claimable).toBe(SINGLE_RUN_QUESTS.length);
  });

  it('only reports a completion once', () => {
    const { tracker } = withQuests(SINGLE_RUN_QUESTS);
    expect(tracker.recordRun(HUGE).length).toBeGreaterThan(0);
    expect(tracker.recordRun(HUGE)).toEqual([]);
  });

  it('needs several runs for a multi-run objective', () => {
    const { tracker } = withQuests(['runs3']);
    expect(tracker.recordRun(HUGE)).toEqual([]);
    expect(tracker.recordRun(HUGE)).toEqual([]);
    expect(tracker.recordRun(HUGE)).toHaveLength(1);
    expect(tracker.list()[0]!.progress).toBe(3);
  });

  it('pays a claim exactly once', () => {
    const { profile, tracker } = withQuests(SINGLE_RUN_QUESTS);
    tracker.recordRun(HUGE);

    const target = tracker.list()[0]!;
    const before = profile.balance(target.def.reward.currency);
    expect(tracker.claim(target.def.id)).toBe(true);
    expect(profile.balance(target.def.reward.currency)).toBe(before + target.def.reward.amount);

    // Second attempt changes nothing.
    expect(tracker.claim(target.def.id)).toBe(false);
    expect(profile.balance(target.def.reward.currency)).toBe(before + target.def.reward.amount);
  });

  it('refuses to claim an unfinished quest', () => {
    const { profile, tracker } = withQuests(SINGLE_RUN_QUESTS);
    const target = tracker.list()[0]!;
    const before = profile.balance(target.def.reward.currency);
    expect(tracker.claim(target.def.id)).toBe(false);
    expect(profile.balance(target.def.reward.currency)).toBe(before);
  });

  it('claims everything finished in one call and then has nothing left', () => {
    const { tracker } = withQuests(SINGLE_RUN_QUESTS);
    tracker.recordRun(HUGE);
    expect(tracker.claimAll()).toBe(SINGLE_RUN_QUESTS.length);
    expect(tracker.claimAll()).toBe(0);
    expect(tracker.claimable).toBe(0);
  });

  it('survives a save that references a quest the build no longer has', () => {
    const profile = freshProfile();
    profile.data.questDate = profile.data.daily.date;
    profile.data.quests = [{ id: 'removed-in-a-later-build', progress: 5, claimed: false }];
    const tracker = new QuestTracker(profile);
    expect(() => tracker.list()).not.toThrow();
    expect(tracker.list().every((q) => QUEST_BY_ID.has(q.def.id))).toBe(true);
  });

  it('rolls a fresh set when the date turns over', () => {
    const profile = freshProfile();
    const tracker = new QuestTracker(profile);
    tracker.recordRun(run());
    const before = tracker.list().map((q) => q.def.id);

    profile.data.daily.date = '1999-01-01';
    profile.data.questDate = '1999-01-01';
    profile.data.quests = [];
    // `rollDailyIfNeeded` resets the stale date to today, which re-rolls.
    const after = tracker.list();
    expect(after).toHaveLength(DAILY_QUEST_COUNT);
    expect(after.every((q) => q.progress === 0)).toBe(true);
    void before;
  });
});
