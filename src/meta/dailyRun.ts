/**
 * The Daily Run.
 *
 * One seed, the same for everyone, changing at local midnight. The wave
 * director is already deterministic from a seed, so this costs almost nothing
 * to build and changes the conversation entirely: a score out of context is a
 * number, and a score on *the waves everyone else played today* is an argument.
 *
 * It is deliberately not a leaderboard. There is no server, no account and no
 * ranking to defend — just a numbered day, your best on it, and share text
 * built so two people can compare in a reply. The whole mechanic is the
 * comparison, and the comparison does not need infrastructure.
 *
 * Replaying is allowed. Locking the day after one attempt punishes the player
 * who wants to improve, which is exactly the player worth keeping; the number
 * that travels is your best of the day, and the attempt count travels with it
 * so nobody is pretending it was one shot.
 */

/** The day the count starts from. Only used to make the number small and human. */
const EPOCH = '2026-01-01';

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * The seed everyone plays today.
 *
 * Derived from the local date, so a player in Auckland and a player in Lisbon
 * are on the same puzzle for most of the day and never on a puzzle that does
 * not exist yet. A UTC date would put half the world a day behind their own
 * calendar, which is worse than the overlap being imperfect.
 */
export function dailyRunSeed(dateKey = todayKey()): string {
  return `aegis-daily-${dateKey}`;
}

/** A small human number for the share text: "AEGIS Daily #208". */
export function dailyRunNumber(dateKey = todayKey()): number {
  const start = Date.parse(`${EPOCH}T00:00:00`);
  const day = Date.parse(`${dateKey}T00:00:00`);
  if (!Number.isFinite(start) || !Number.isFinite(day)) return 1;
  return Math.max(1, Math.round((day - start) / 86_400_000) + 1);
}

export interface DailyRunState {
  /** Local date this record is for. */
  date: string;
  /** Best score posted today. */
  best: number;
  /** Deepest wave reached today. */
  wave: number;
  /** Attempts today. */
  plays: number;
  /** Whether the first-run reward has been paid today. */
  rewarded: boolean;
}

export function makeDailyRunState(dateKey = todayKey()): DailyRunState {
  return { date: dateKey, best: 0, wave: 0, plays: 0, rewarded: false };
}

/** Roll the record over at midnight. Returns the state to store. */
export function rollDailyRun(state: DailyRunState, dateKey = todayKey()): DailyRunState {
  return state.date === dateKey ? state : makeDailyRunState(dateKey);
}

/**
 * Fold a finished attempt in. Returns the new state and whether it improved.
 *
 * Keeping the best rather than the first is the friendlier rule and the one
 * that keeps somebody playing a fourth time.
 */
export function recordDailyRun(
  state: DailyRunState,
  result: { score: number; wave: number },
  dateKey = todayKey(),
): { state: DailyRunState; improved: boolean; firstToday: boolean } {
  const rolled = rollDailyRun(state, dateKey);
  const firstToday = rolled.plays === 0;
  const improved = result.score > rolled.best;
  return {
    state: {
      date: rolled.date,
      best: Math.max(rolled.best, Math.round(result.score)),
      wave: Math.max(rolled.wave, result.wave),
      plays: rolled.plays + 1,
      rewarded: rolled.rewarded,
    },
    improved,
    firstToday,
  };
}

/** Paid once per day, for turning up. Small enough not to be the reason to play. */
export const DAILY_RUN_REWARD = { cores: 400, prisms: 20 } as const;

/**
 * The line that gets pasted into a reply.
 *
 * Wave and score, the day number so it is comparable, and the attempt count so
 * it is honest. No emoji grid: the arena is not a grid, and a fake one would be
 * decoration pretending to be data.
 */
export function dailyRunShareText(opts: {
  dateKey?: string;
  score: number;
  wave: number;
  plays: number;
  url?: string;
}): string {
  const n = dailyRunNumber(opts.dateKey ?? todayKey());
  const tries = opts.plays === 1 ? 'first try' : `${opts.plays} tries`;
  const head = `AEGIS Daily #${n} — wave ${opts.wave}, ${opts.score.toLocaleString('en-US')} (${tries}).`;
  return opts.url ? `${head} Same waves, your turn: ${opts.url}` : `${head} Same waves for everyone today.`;
}
