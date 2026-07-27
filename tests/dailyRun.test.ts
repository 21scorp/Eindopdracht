/**
 * @vitest-environment happy-dom
 *
 * The Daily Run.
 *
 * The whole mechanic is that two people can compare, so the parts that must be
 * exactly right are the ones a comparison depends on: everyone on the same
 * calendar day gets the same seed, the day number is stable, the record rolls
 * over at midnight instead of accumulating, and the reward is paid once.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Profile } from '../src/meta/Profile';
import {
  DAILY_RUN_REWARD,
  dailyRunNumber,
  dailyRunSeed,
  dailyRunShareText,
  makeDailyRunState,
  recordDailyRun,
  rollDailyRun,
} from '../src/meta/dailyRun';

let counter = 0;
const freshProfile = (): Profile => new Profile(`test.daily.${counter++}.${Math.random()}`);

beforeEach(() => window.localStorage.clear());

describe('the seed', () => {
  it('is the same for everyone on the same day', () => {
    expect(dailyRunSeed('2026-07-27')).toBe(dailyRunSeed('2026-07-27'));
  });

  it('changes with the day', () => {
    expect(dailyRunSeed('2026-07-27')).not.toBe(dailyRunSeed('2026-07-28'));
  });

  it('carries the date, so a shared run can be identified', () => {
    expect(dailyRunSeed('2026-07-27')).toContain('2026-07-27');
  });
});

describe('the day number', () => {
  it('counts up by one a day', () => {
    expect(dailyRunNumber('2026-07-28') - dailyRunNumber('2026-07-27')).toBe(1);
  });

  it('is stable and human-sized', () => {
    const n = dailyRunNumber('2026-07-27');
    expect(n).toBe(dailyRunNumber('2026-07-27'));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(10_000);
  });

  it('survives a date it cannot parse rather than reporting NaN', () => {
    expect(dailyRunNumber('not-a-date')).toBe(1);
  });
});

describe('the daily record', () => {
  it('starts empty', () => {
    const s = makeDailyRunState('2026-07-27');
    expect(s.best).toBe(0);
    expect(s.plays).toBe(0);
    expect(s.rewarded).toBe(false);
  });

  it('keeps the best score, not the last', () => {
    let s = makeDailyRunState('2026-07-27');
    s = recordDailyRun(s, { score: 5000, wave: 8 }, '2026-07-27').state;
    s = recordDailyRun(s, { score: 1200, wave: 4 }, '2026-07-27').state;
    expect(s.best).toBe(5000);
    expect(s.wave).toBe(8);
    expect(s.plays).toBe(2);
  });

  it('reports an improvement only when there is one', () => {
    let s = makeDailyRunState('2026-07-27');
    const first = recordDailyRun(s, { score: 5000, wave: 8 }, '2026-07-27');
    expect(first.improved).toBe(true);
    s = first.state;
    expect(recordDailyRun(s, { score: 4999, wave: 8 }, '2026-07-27').improved).toBe(false);
  });

  it('knows which attempt was the first of the day', () => {
    let s = makeDailyRunState('2026-07-27');
    expect(recordDailyRun(s, { score: 10, wave: 1 }, '2026-07-27').firstToday).toBe(true);
    s = recordDailyRun(s, { score: 10, wave: 1 }, '2026-07-27').state;
    expect(recordDailyRun(s, { score: 10, wave: 1 }, '2026-07-27').firstToday).toBe(false);
  });

  it('starts over at midnight rather than accumulating', () => {
    let s = makeDailyRunState('2026-07-27');
    s = recordDailyRun(s, { score: 90_000, wave: 20 }, '2026-07-27').state;
    const next = rollDailyRun(s, '2026-07-28');
    expect(next.date).toBe('2026-07-28');
    expect(next.best).toBe(0);
    expect(next.plays).toBe(0);
    expect(next.rewarded).toBe(false);
  });

  it('rolls over inside record, so a run at 00:01 does not land on yesterday', () => {
    let s = makeDailyRunState('2026-07-27');
    s = recordDailyRun(s, { score: 90_000, wave: 20 }, '2026-07-27').state;
    const after = recordDailyRun(s, { score: 100, wave: 2 }, '2026-07-28');
    expect(after.state.date).toBe('2026-07-28');
    expect(after.state.best).toBe(100);
    expect(after.state.plays).toBe(1);
    expect(after.firstToday).toBe(true);
  });
});

describe('the profile', () => {
  it('pays the daily reward once and only once', () => {
    const p = freshProfile();
    const cores = p.balance('cores');
    const prisms = p.balance('prisms');

    const first = p.recordDailyRun({ score: 1000, wave: 5 });
    expect(first.rewarded).toBe(true);
    expect(p.balance('cores')).toBe(cores + DAILY_RUN_REWARD.cores);
    expect(p.balance('prisms')).toBe(prisms + DAILY_RUN_REWARD.prisms);

    const second = p.recordDailyRun({ score: 9000, wave: 12 });
    expect(second.rewarded).toBe(false);
    expect(second.improved).toBe(true);
    expect(p.balance('cores')).toBe(cores + DAILY_RUN_REWARD.cores);
  });

  it('keeps the record across a reload', () => {
    const key = `test.daily.persist.${Math.random()}`;
    const a = new Profile(key);
    a.recordDailyRun({ score: 4321, wave: 9 });
    a.save();

    const b = new Profile(key);
    expect(b.dailyRun.best).toBe(4321);
    expect(b.dailyRun.wave).toBe(9);
    expect(b.dailyRun.plays).toBe(1);
  });

  it('gives a save that predates the feature an empty record rather than crashing', () => {
    const key = `test.daily.old.${Math.random()}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({ __v: 1, __savedAt: Date.now(), data: { cores: 10 } }),
    );
    const p = new Profile(key);
    expect(p.dailyRun.plays).toBe(0);
    expect(typeof p.dailyRun.date).toBe('string');
  });
});

describe('the share line', () => {
  it('carries the day number, the result and how many tries it took', () => {
    const text = dailyRunShareText({ dateKey: '2026-07-27', score: 84_233, wave: 14, plays: 3 });
    expect(text).toContain(`#${dailyRunNumber('2026-07-27')}`);
    expect(text).toContain('84,233');
    expect(text).toContain('wave 14');
    expect(text).toContain('3 tries');
  });

  it('says "first try" rather than "1 tries"', () => {
    expect(dailyRunShareText({ score: 1, wave: 1, plays: 1 })).toContain('first try');
  });

  it('appends a challenge link when there is one', () => {
    const text = dailyRunShareText({ score: 1, wave: 1, plays: 1, url: 'https://example.test/?c=abc' });
    expect(text).toContain('https://example.test/?c=abc');
  });
});
