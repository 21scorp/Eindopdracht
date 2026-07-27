/**
 * Daily objectives.
 *
 * Three a day, rolled from the account id and the date so they are stable
 * across reloads and different on different days without needing a server.
 *
 * Two rules shape the pool:
 *
 * **Every quest is completable in a normal run.** Nothing asks for a grind, and
 * nothing asks for something a player cannot influence. If a quest can only be
 * finished by playing badly or by playing for an hour, it is not an objective,
 * it is a chore.
 *
 * **Quests point at skills, not at time.** "Land 30 perfects" teaches aiming;
 * "play 20 runs" teaches nothing and just occupies an evening.
 */

import type { CurrencyId } from '../meta/Profile';

/** How a quest reads its progress from a run. */
export type QuestMetric =
  | 'runs'
  | 'score'
  | 'wave'
  | 'maxCombo'
  | 'perfects'
  | 'parries'
  | 'chains'
  | 'kills'
  | 'bossKills'
  | 'ultimates';

/**
 * `sum`  accumulates across every run today.
 * `best` records the highest single run today — those are the ones that reward
 *        a good run rather than many runs.
 */
export type QuestMode = 'sum' | 'best';

export interface QuestDef {
  id: string;
  metric: QuestMetric;
  mode: QuestMode;
  target: number;
  /** `{n}` is replaced with the target. */
  label: string;
  reward: { currency: CurrencyId; amount: number };
  /** Relative likelihood of being rolled. */
  weight: number;
}

export const QUEST_POOL: readonly QuestDef[] = [
  // --- warm-up: any run finishes these -------------------------------------
  { id: 'runs3', metric: 'runs', mode: 'sum', target: 3, label: 'Hold the line {n} times', reward: { currency: 'cores', amount: 300 }, weight: 60 },
  { id: 'kills120', metric: 'kills', mode: 'sum', target: 120, label: 'Destroy {n} threats', reward: { currency: 'cores', amount: 350 }, weight: 80 },
  { id: 'wave8', metric: 'wave', mode: 'best', target: 8, label: 'Reach wave {n}', reward: { currency: 'cores', amount: 400 }, weight: 80 },

  // --- skill: these teach the mechanics ------------------------------------
  { id: 'perfects40', metric: 'perfects', mode: 'sum', target: 40, label: 'Land {n} perfect blocks', reward: { currency: 'shards', amount: 60 }, weight: 90 },
  { id: 'parries25', metric: 'parries', mode: 'sum', target: 25, label: 'Parry {n} threats with the pulse', reward: { currency: 'shards', amount: 70 }, weight: 90 },
  { id: 'chains50', metric: 'chains', mode: 'sum', target: 50, label: 'Kill {n} threats with deflected shots', reward: { currency: 'shards', amount: 65 }, weight: 80 },
  { id: 'combo35', metric: 'maxCombo', mode: 'best', target: 35, label: 'Reach a {n} combo in one run', reward: { currency: 'shards', amount: 80 }, weight: 85 },
  { id: 'ults5', metric: 'ultimates', mode: 'sum', target: 5, label: 'Fire {n} Ultimates', reward: { currency: 'cores', amount: 380 }, weight: 65 },

  // --- reach: a good run, not a long session -------------------------------
  { id: 'wave12', metric: 'wave', mode: 'best', target: 12, label: 'Reach wave {n}', reward: { currency: 'prisms', amount: 40 }, weight: 55 },
  { id: 'score150k', metric: 'score', mode: 'best', target: 150_000, label: 'Score {n} in one run', reward: { currency: 'prisms', amount: 45 }, weight: 55 },
  { id: 'warden', metric: 'bossKills', mode: 'sum', target: 1, label: 'Fell a Warden', reward: { currency: 'prisms', amount: 50 }, weight: 70 },
  { id: 'warden3', metric: 'bossKills', mode: 'sum', target: 3, label: 'Fell {n} Wardens', reward: { currency: 'prisms', amount: 70 }, weight: 35 },
];

export const QUEST_BY_ID: ReadonlyMap<string, QuestDef> = new Map(QUEST_POOL.map((q) => [q.id, q]));

/** How many are active at once. */
export const DAILY_QUEST_COUNT = 3;

export function questLabel(def: QuestDef): string {
  return def.label.replace('{n}', def.target.toLocaleString('en-US'));
}
