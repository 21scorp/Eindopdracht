/**
 * Headless balance harness.
 *
 * Plays hundreds of runs with a scripted bot at three skill levels and reports
 * the resulting curve. Tuning a difficulty ramp by feel means re-playing the
 * first two minutes a hundred times and still not knowing what happens at wave
 * twelve; this answers that in a few seconds.
 *
 * The bot is deliberately simple and *worse* than a real player — it reacts on
 * a fixed tick, aims with error, and never plans. If the bot can reach a wave,
 * a human comfortably can.
 *
 *   npm run balance
 *   npm run balance -- --runs 400 --skill expert
 */

import { GameSession } from '../src/game/GameSession';
import { GUARDIANS, getGuardian } from '../src/data/guardians';
import { Rng } from '../src/core/Rng';
import { angleDistance, normalizeAngle } from '../src/core/math';
import type { ViewInfo } from '../src/render/Renderer';
import type { RunStats } from '../src/game/events';
import { REWARDS, XP } from '../src/data/balance';
import { getBanner } from '../src/data/banners';

const STEP = 1 / 120;
const MAX_RUN_SECONDS = 600;

const VIEW: ViewInfo = {
  width: 412,
  height: 892,
  cx: 206,
  cy: 446,
  scale: 1,
  minSide: 412,
  portrait: true,
};

interface Skill {
  name: string;
  /** Seconds between decisions. */
  tick: number;
  /** Radians of aim error, applied as a slow drift. */
  aimError: number;
  /** Threats that must be in the pulse window before the bot pulses. */
  pulseThreshold: number;
  /** Probability of noticing a threat that needs the pulse at all. */
  pulseAwareness: number;
  /** Probability of firing the ultimate on any given decision when ready. */
  ultChance: number;
}

const SKILLS: Record<string, Skill> = {
  novice: { name: 'novice', tick: 0.3, aimError: 0.3, pulseThreshold: 3, pulseAwareness: 0.25, ultChance: 0.05 },
  average: { name: 'average', tick: 0.16, aimError: 0.14, pulseThreshold: 2, pulseAwareness: 0.6, ultChance: 0.2 },
  expert: { name: 'expert', tick: 0.07, aimError: 0.04, pulseThreshold: 2, pulseAwareness: 0.95, ultChance: 0.6 },
};

interface RunRecord extends RunStats {
  skill: string;
}

function playRun(guardianId: string, skill: Skill, seed: string): RunRecord {
  const session = new GameSession(seed);
  session.arena.update(VIEW);
  session.start(getGuardian(guardianId), 1, 1, seed);

  const rng = new Rng(`bot-${seed}`);
  let decisionTimer = 0;
  let aimBias = 0;
  let elapsed = 0;
  let finished: RunStats | null = null;
  session.events.on('runEnd', ({ stats }) => (finished = stats));

  // The bot drafts too. Without this the harness measures a game nobody plays:
  // a real run past wave 2 always has cards on it, and the numbers this tool
  // reports — run length, score curve, core income — all move because of them.
  // It picks at random rather than well, so the report reads as a floor.
  session.events.on('waveClear', ({ wave }) => {
    if (!session.draftDue(wave)) return;
    const offer = session.rollOffer(wave);
    if (offer.length > 0) session.takeResonance(rng.pick(offer));
  });

  while (!finished && elapsed < MAX_RUN_SECONDS) {
    decisionTimer -= STEP;
    if (decisionTimer <= 0) {
      decisionTimer = skill.tick;
      aimBias = rng.signedRange(skill.aimError);
      decide(session, skill, rng, aimBias);
    }
    session.update(STEP);
    elapsed += STEP;
  }

  const stats: RunStats = finished ?? session.buildStats();
  return { ...stats, skill: skill.name };
}

function decide(session: GameSession, skill: Skill, rng: Rng, aimBias: number): void {
  const arena = session.arena;
  let target: { angle: number; radius: number } | null = null;
  let soonest = Infinity;
  let inPulseBand = 0;
  let uncoverable = false;

  for (const t of session.pool.live) {
    if (!t.active || t.state !== 'incoming' || t.delay > 0) continue;
    const timeToShield = (t.radius - arena.shieldR) / Math.max(1, t.speed);
    if (timeToShield < soonest) {
      soonest = timeToShield;
      target = { angle: t.angle, radius: t.radius };
    }
    if (Math.abs(t.radius - arena.shieldR) < arena.shieldR * 0.3) inPulseBand++;
    // Something is nearly on top of us at an angle we cannot swing to in time.
    if (
      timeToShield < 0.25 &&
      angleDistance(t.angle, session.shieldAngle) > session.arcHalf + 0.35
    ) {
      uncoverable = true;
    }
  }

  if (target) session.shieldTarget = normalizeAngle(target.angle + aimBias);

  const shouldPulse =
    (inPulseBand >= skill.pulseThreshold || uncoverable) && rng.chance(skill.pulseAwareness);
  if (shouldPulse) session.pulse();

  if (session.ultimateReady && rng.chance(skill.ultChance)) session.fireUltimate();
}

// ---------------------------------------------------------------------------

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx]!;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function pad(text: string, width: number, right = false): string {
  const s = String(text);
  return right ? s.padStart(width) : s.padEnd(width);
}

function report(title: string, rows: Array<[string, string]>): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
  for (const [k, v] of rows) console.log(`  ${pad(k, 26)} ${v}`);
}

function summarise(records: RunRecord[], label: string): void {
  const waves = records.map((r) => r.wave);
  const scores = records.map((r) => r.score);
  const durations = records.map((r) => r.duration);

  report(label, [
    ['runs', String(records.length)],
    ['wave  p10 / median / p90', `${percentile(waves, 0.1)} / ${percentile(waves, 0.5)} / ${percentile(waves, 0.9)}`],
    ['wave  best', String(Math.max(...waves))],
    ['score median', Math.round(percentile(scores, 0.5)).toLocaleString('en-US')],
    ['score p90', Math.round(percentile(scores, 0.9)).toLocaleString('en-US')],
    ['run length median', `${percentile(durations, 0.5).toFixed(0)}s`],
    ['run length p90', `${percentile(durations, 0.9).toFixed(0)}s`],
    ['hit the harness cap', `${records.filter((r) => r.duration >= MAX_RUN_SECONDS - 1).length} of ${records.length}`],
    ['reached a boss wave', `${Math.round((records.filter((r) => r.wave >= 5).length / records.length) * 100)}%`],
    ['felled a Warden', `${Math.round((records.filter((r) => r.bossKills > 0).length / records.length) * 100)}%`],
    ['mean max combo', mean(records.map((r) => r.maxCombo)).toFixed(1)],
    ['mean parries', mean(records.map((r) => r.parries)).toFixed(1)],
    ['mean chains', mean(records.map((r) => r.chains)).toFixed(1)],
    ['mean precision', `${(mean(records.map((r) => r.accuracy)) * 100).toFixed(0)}%`],
  ]);
}

/**
 * What a run is worth, and therefore how long the free path to a summon is.
 * The economy is only meaningful relative to the scores players actually get,
 * so it is projected from the same simulated runs rather than guessed.
 */
function economy(records: RunRecord[]): void {
  const banner = getBanner('standard');
  const coresPerRun = mean(
    records.map((r) => r.score * REWARDS.coresPerScore + r.wave * REWARDS.coresPerWave),
  );
  const xpPerRun = mean(records.map((r) => r.score * XP.perScore + r.wave * XP.perWave));
  const secondsPerRun = mean(records.map((r) => r.duration));
  // The shop's cheapest conversion, kept in step with ShopScreen.
  const coresPerSummon = 2000;
  const runsPerSummon = coresPerSummon / Math.max(1, coresPerRun);

  report('Economy projection (average skill)', [
    ['cores per run', Math.round(coresPerRun).toLocaleString('en-US')],
    ['xp per run', Math.round(xpPerRun).toLocaleString('en-US')],
    ['runs per single summon', runsPerSummon.toFixed(1)],
    ['minutes per single summon', ((runsPerSummon * secondsPerRun) / 60).toFixed(1)],
    ['runs per ten-pull', ((banner.costTen / 160) * runsPerSummon).toFixed(0)],
    ['hours per ten-pull', (((banner.costTen / 160) * runsPerSummon * secondsPerRun) / 3600).toFixed(1)],
    ['runs to hit the daily cap', (REWARDS.dailyCoreSoftCap / Math.max(1, coresPerRun)).toFixed(1)],
    ['levels from one run at L1', (xpPerRun / XP.curve(1)).toFixed(1)],
  ]);
}

/** Where runs actually end, so the ramp can be read directly. */
function waveHistogram(records: RunRecord[]): void {
  const counts = new Map<number, number>();
  for (const r of records) counts.set(r.wave, (counts.get(r.wave) ?? 0) + 1);
  const maxWave = Math.max(...records.map((r) => r.wave));
  const maxCount = Math.max(...counts.values());
  console.log('\n\x1b[1mRuns ending on each wave\x1b[0m');
  for (let w = 1; w <= maxWave; w++) {
    const n = counts.get(w) ?? 0;
    const bar = '█'.repeat(Math.round((n / maxCount) * 34));
    const boss = w % 5 === 0 ? ' \x1b[35m(boss)\x1b[0m' : '';
    console.log(`  ${pad(`w${w}`, 5)} ${pad(String(n), 4, true)}  ${bar}${boss}`);
  }
}

function parseArgs(): { runs: number; skills: string[]; guardian: string; roster: boolean } {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const skill = get('--skill');
  return {
    runs: Number(get('--runs') ?? 150),
    skills: skill ? [skill] : ['novice', 'average', 'expert'],
    guardian: get('--guardian') ?? 'vane',
    roster: args.includes('--roster'),
  };
}

const { runs, skills, guardian, roster } = parseArgs();

console.log(`\x1b[36mAEGIS balance harness\x1b[0m  —  ${runs} runs per skill, guardian: ${guardian}`);

for (const skillName of skills) {
  const skill = SKILLS[skillName];
  if (!skill) {
    console.error(`Unknown skill "${skillName}". Try: ${Object.keys(SKILLS).join(', ')}`);
    process.exit(1);
  }
  const records: RunRecord[] = [];
  for (let i = 0; i < runs; i++) records.push(playRun(guardian, skill, `bal-${skillName}-${i}`));
  summarise(records, `Skill: ${skillName}`);
  if (skillName === 'average') {
    waveHistogram(records);
    economy(records);
  }
}

// Cross-roster comparison: every Guardian should be worth taking into a run.
if (roster) {
  console.log('\n\x1b[1mRoster comparison (average skill)\x1b[0m');
  console.log(`  ${pad('guardian', 12)}${pad('rarity', 11)}${pad('wave', 6, true)}${pad('score', 10, true)}${pad('combo', 8, true)}`);
  const perRun = Math.max(20, Math.round(runs / 3));
  const rows: Array<{ id: string; rarity: string; wave: number; score: number; combo: number }> = [];
  for (const g of GUARDIANS) {
    const records: RunRecord[] = [];
    for (let i = 0; i < perRun; i++) records.push(playRun(g.id, SKILLS.average!, `roster-${g.id}-${i}`));
    rows.push({
      id: g.name,
      rarity: g.rarity,
      wave: percentile(records.map((r) => r.wave), 0.5),
      score: Math.round(percentile(records.map((r) => r.score), 0.5)),
      combo: Math.round(mean(records.map((r) => r.maxCombo))),
    });
  }
  rows.sort((a, b) => b.score - a.score);
  for (const r of rows) {
    console.log(
      `  ${pad(r.id, 12)}${pad(r.rarity, 11)}${pad(String(r.wave), 6, true)}${pad(r.score.toLocaleString('en-US'), 10, true)}${pad(String(r.combo), 8, true)}`,
    );
  }

  const scores = rows.map((r) => r.score).filter((s) => s > 0);
  const spread = Math.max(...scores) / Math.max(1, Math.min(...scores));
  console.log(`\n  best/worst score ratio: ${spread.toFixed(2)}x`);
  // Rarity is *supposed* to matter, so some spread is the design working. The
  // threshold is set to catch a genuinely broken pick — the first run of this
  // report showed 49x, which was a Guardian whose Ultimate recharged itself.
  if (spread > 6) {
    console.log('  \x1b[33mwarning: spread this wide usually means one kit has an exploit, not that rarity works\x1b[0m');
  }
}

console.log('');
