/**
 * Quest tracking.
 *
 * Pure functions plus a thin tracker over the profile. The daily set is derived
 * from `playerId + date`, so it is identical on every reload without anything
 * being stored, and different tomorrow without anything being scheduled.
 *
 * Progress only ever moves forward within a day and is applied once per run,
 * from the run's own stats — there is no live subscription that could
 * double-count if a system re-emits an event.
 */

import { Rng } from '../core/Rng';
import { DAILY_QUEST_COUNT, QUEST_BY_ID, QUEST_POOL, questLabel, type QuestDef } from '../data/quests';
import type { RunStats } from '../game/events';
import type { Profile } from './Profile';

export interface QuestState {
  id: string;
  progress: number;
  claimed: boolean;
}

export interface QuestView {
  def: QuestDef;
  label: string;
  progress: number;
  target: number;
  complete: boolean;
  claimed: boolean;
}

/**
 * Choose today's quests. Deterministic in (account, date), and guaranteed to be
 * three different quests with no two reading the same metric — three variations
 * on "kill things" is not three objectives.
 */
export function rollDailyQuests(playerId: string, dateKey: string): string[] {
  const rng = new Rng(`quests-${playerId}-${dateKey}`);
  const pool = [...QUEST_POOL];
  const chosen: QuestDef[] = [];
  const usedMetrics = new Set<string>();

  while (chosen.length < DAILY_QUEST_COUNT && pool.length > 0) {
    const eligible = pool.filter((q) => !usedMetrics.has(q.metric));
    const candidates = eligible.length > 0 ? eligible : pool;
    const pick = candidates[rng.weightedIndex(candidates.map((q) => q.weight))]!;
    chosen.push(pick);
    usedMetrics.add(pick.metric);
    pool.splice(pool.indexOf(pick), 1);
  }
  return chosen.map((q) => q.id);
}

/** Pull the value a quest cares about out of a finished run. */
export function metricValue(stats: RunStats, def: QuestDef): number {
  switch (def.metric) {
    case 'runs':
      return 1;
    case 'score':
      return stats.score;
    case 'wave':
      return stats.wave;
    case 'maxCombo':
      return stats.maxCombo;
    case 'perfects':
      return stats.perfects;
    case 'parries':
      return stats.parries;
    case 'chains':
      return stats.chains;
    case 'kills':
      return stats.kills;
    case 'bossKills':
      return stats.bossKills;
    case 'ultimates':
      return stats.ultimatesUsed;
  }
}

/** Apply a run to one quest's progress. Returns the new value. */
export function advance(current: number, stats: RunStats, def: QuestDef): number {
  const value = metricValue(stats, def);
  return def.mode === 'sum' ? current + value : Math.max(current, value);
}

export class QuestTracker {
  constructor(private readonly profile: Profile) {}

  /** Today's quests, rolling a new set if the date has turned over. */
  private ensureToday(): QuestState[] {
    this.profile.rollDailyIfNeeded();
    const data = this.profile.data;
    const today = data.daily.date;

    if (data.questDate !== today || !Array.isArray(data.quests) || data.quests.length === 0) {
      data.questDate = today;
      data.quests = rollDailyQuests(data.playerId, today).map((id) => ({ id, progress: 0, claimed: false }));
      this.profile.events.emit('change', {});
    }
    // Drop anything whose definition was removed in a later build.
    data.quests = data.quests.filter((q) => QUEST_BY_ID.has(q.id));
    return data.quests;
  }

  list(): QuestView[] {
    return this.ensureToday().map((state) => {
      const def = QUEST_BY_ID.get(state.id)!;
      return {
        def,
        label: questLabel(def),
        progress: Math.min(state.progress, def.target),
        target: def.target,
        complete: state.progress >= def.target,
        claimed: state.claimed,
      };
    });
  }

  /** Number of finished-but-unclaimed quests, for the home screen badge. */
  get claimable(): number {
    return this.list().filter((q) => q.complete && !q.claimed).length;
  }

  /** Fold a finished run into today's progress. */
  recordRun(stats: RunStats): QuestView[] {
    const states = this.ensureToday();
    const newlyComplete: QuestView[] = [];

    for (const state of states) {
      const def = QUEST_BY_ID.get(state.id)!;
      if (state.progress >= def.target) continue;
      state.progress = advance(state.progress, stats, def);
      if (state.progress >= def.target) {
        newlyComplete.push({
          def,
          label: questLabel(def),
          progress: def.target,
          target: def.target,
          complete: true,
          claimed: false,
        });
      }
    }
    this.profile.events.emit('change', {});
    this.profile.save();
    return newlyComplete;
  }

  /** Claim one finished quest. Returns false if it was not claimable. */
  claim(id: string): boolean {
    const states = this.ensureToday();
    const state = states.find((q) => q.id === id);
    const def = state ? QUEST_BY_ID.get(state.id) : undefined;
    if (!state || !def || state.claimed || state.progress < def.target) return false;

    state.claimed = true;
    this.profile.credit(def.reward.currency, def.reward.amount, `quest:${def.id}`);
    this.profile.save();
    return true;
  }

  /** Claim everything finished. Returns how many paid out. */
  claimAll(): number {
    let n = 0;
    for (const q of this.list()) {
      if (q.complete && !q.claimed && this.claim(q.def.id)) n++;
    }
    return n;
  }
}
