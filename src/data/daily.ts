/**
 * The daily reward track.
 *
 * A seven-day cycle that *advances* rather than resets. Missing a day costs you
 * that day's reward and nothing else — punishing an absence by wiping progress
 * is the mechanic that turns a game into an obligation, and people quit
 * obligations.
 *
 * The streak counter still exists and still pays a bonus, so showing up daily
 * is rewarded; it is just not the only way to make progress.
 */

import type { CurrencyId } from '../meta/Profile';

export interface DailyReward {
  /** 1-7. */
  day: number;
  currency: CurrencyId;
  amount: number;
  /** Marks the day worth waiting for. */
  highlight?: boolean;
  label: string;
}

export const DAILY_TRACK: readonly DailyReward[] = [
  { day: 1, currency: 'cores', amount: 250, label: '250 Cores' },
  { day: 2, currency: 'shards', amount: 40, label: '40 Shards' },
  { day: 3, currency: 'cores', amount: 400, label: '400 Cores' },
  { day: 4, currency: 'prisms', amount: 60, label: '60 Prisms' },
  { day: 5, currency: 'shards', amount: 90, label: '90 Shards' },
  { day: 6, currency: 'cores', amount: 700, label: '700 Cores' },
  { day: 7, currency: 'prisms', amount: 160, label: '160 Prisms', highlight: true },
];

/** Extra paid on top once a streak reaches these lengths. */
export const STREAK_BONUSES: ReadonlyArray<{ days: number; currency: CurrencyId; amount: number }> = [
  { days: 3, currency: 'cores', amount: 300 },
  { days: 7, currency: 'prisms', amount: 100 },
  { days: 14, currency: 'prisms', amount: 200 },
  { days: 30, currency: 'prisms', amount: 500 },
];

export function rewardForDay(day: number): DailyReward {
  const index = ((day - 1) % DAILY_TRACK.length + DAILY_TRACK.length) % DAILY_TRACK.length;
  return DAILY_TRACK[index]!;
}

/** The bonus payable at exactly this streak length, if any. */
export function streakBonusFor(streak: number): (typeof STREAK_BONUSES)[number] | null {
  return STREAK_BONUSES.find((b) => b.days === streak) ?? null;
}
