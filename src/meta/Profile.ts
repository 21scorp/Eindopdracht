/**
 * The player's account.
 *
 * Everything persistent lives here behind a single versioned store: wallet,
 * roster, pity counters, settings, stats, purchases. Systems read it, mutate it
 * through named methods, and the profile emits change events so the UI can stay
 * in sync without polling.
 *
 * Two design rules:
 *  - Currency only moves through `credit`/`debit`, which write a ledger entry.
 *    When a player asks where 1,600 prisms went, there is an answer.
 *  - The gacha RNG state is *persisted and advanced*. A player cannot reload to
 *    re-roll a pull, and a pull can be reproduced from its recorded state.
 */

import { EventBus } from '../core/EventBus';
import { Rng, seedFromString, type RngState } from '../core/Rng';
import { Store } from '../core/Storage';
import { clamp } from '../core/math';
import { XP } from '../data/balance';
import { BANNERS } from '../data/banners';
import { MAX_LEVEL, MAX_STARS, STARTER_GUARDIAN_ID, getGuardian, levelUpCost, starUpCost } from '../data/guardians';
import type { Quality } from '../render/Renderer';
import { createPityState, type PityState } from './gacha';

export type CurrencyId = 'cores' | 'prisms' | 'shards';

export interface OwnedGuardian {
  level: number;
  stars: number;
  /** Total copies pulled, including the first. */
  copies: number;
  obtainedAt: number;
  favourite: boolean;
}

export interface LedgerEntry {
  at: number;
  currency: CurrencyId;
  delta: number;
  balance: number;
  reason: string;
}

export interface DailyState {
  /** Local date key, YYYY-MM-DD. */
  date: string;
  coresEarned: number;
  runs: number;
  /** Consecutive days with at least one run. */
  streak: number;
  lastPlayedDate: string;
  /** Day index (1-7) of the login reward last claimed. */
  loginClaimed: number;
  loginClaimedDate: string;
}

export interface ProfileStats {
  runs: number;
  bestScore: number;
  bestWave: number;
  bestCombo: number;
  totalScore: number;
  totalKills: number;
  totalParries: number;
  totalPerfects: number;
  totalBossKills: number;
  totalPlaySeconds: number;
  pulls: number;
  mythicsPulled: number;
  legendariesPulled: number;
}

export interface Settings {
  music: number;
  sfx: number;
  haptics: boolean;
  quality: Quality | 'auto';
  screenShake: number;
  reducedFlash: boolean;
  /** Mirrors the HUD action buttons for left-handed play. */
  leftHanded: boolean;
  showFps: boolean;
}

export interface ProfileData {
  version: number;
  createdAt: number;
  lastSeen: number;
  playerId: string;
  playerName: string;

  level: number;
  xp: number;

  cores: number;
  prisms: number;
  shards: number;

  roster: Record<string, OwnedGuardian>;
  equipped: string;

  pity: Record<string, PityState>;
  gachaRng: RngState;

  stats: ProfileStats;
  daily: DailyState;
  settings: Settings;

  /** productId -> times purchased. */
  purchases: Record<string, number>;
  /** Permanent unlocks granted by purchases. */
  entitlements: Record<string, boolean>;

  ledger: LedgerEntry[];
  /** Ids of one-time tips the player has already dismissed. */
  seenTips: string[];
}

export type ProfileEvents = {
  change: Record<string, never>;
  currency: { currency: CurrencyId; delta: number; balance: number; reason: string };
  guardianObtained: { id: string; duplicate: boolean; copies: number };
  guardianUpgraded: { id: string; level: number; stars: number };
  levelUp: { level: number; rewards: { prisms: number; cores: number } };
  equipped: { id: string };
  settings: { settings: Settings };
  streak: { streak: number };
};

const LEDGER_LIMIT = 300;
const SAVE_VERSION = 1;

function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysBetween(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00`);
  const pb = Date.parse(`${b}T00:00:00`);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return 99;
  return Math.round((pb - pa) / 86_400_000);
}

function makeDefaults(): ProfileData {
  const now = Date.now();
  const playerId = `p_${Math.random().toString(36).slice(2, 10)}${now.toString(36)}`;
  const pity: Record<string, PityState> = {};
  for (const b of BANNERS) pity[b.id] = createPityState();

  return {
    version: SAVE_VERSION,
    createdAt: now,
    lastSeen: now,
    playerId,
    playerName: 'GUARDIAN',
    level: 1,
    xp: 0,
    // A deliberate starting gift: enough for a ten-pull, so the first session
    // includes the moment the game is actually about.
    cores: 500,
    prisms: 1600,
    shards: 0,
    roster: {
      [STARTER_GUARDIAN_ID]: { level: 1, stars: 1, copies: 1, obtainedAt: now, favourite: false },
    },
    equipped: STARTER_GUARDIAN_ID,
    pity,
    gachaRng: seedFromString(`${playerId}-gacha`),
    stats: {
      runs: 0,
      bestScore: 0,
      bestWave: 0,
      bestCombo: 0,
      totalScore: 0,
      totalKills: 0,
      totalParries: 0,
      totalPerfects: 0,
      totalBossKills: 0,
      totalPlaySeconds: 0,
      pulls: 0,
      mythicsPulled: 0,
      legendariesPulled: 0,
    },
    daily: {
      date: todayKey(),
      coresEarned: 0,
      runs: 0,
      streak: 0,
      lastPlayedDate: '',
      loginClaimed: 0,
      loginClaimedDate: '',
    },
    settings: {
      music: 0.55,
      sfx: 0.8,
      haptics: true,
      quality: 'auto',
      screenShake: 1,
      reducedFlash: false,
      leftHanded: false,
      showFps: false,
    },
    purchases: {},
    entitlements: {},
    ledger: [],
    seenTips: [],
  };
}

export class Profile {
  readonly events = new EventBus<ProfileEvents>();
  private store: Store<ProfileData>;
  private gachaRng: Rng;

  constructor(storageKey = 'aegis.profile.v1') {
    this.store = new Store<ProfileData>({
      key: storageKey,
      version: SAVE_VERSION,
      defaults: makeDefaults,
      validate: (d) => this.repair(d),
    });
    this.gachaRng = new Rng(this.data.gachaRng);
    this.rollDailyIfNeeded();
  }

  get data(): ProfileData {
    return this.store.data;
  }

  /** Clamp and backfill anything a partial save or a bad edit could break. */
  private repair(d: ProfileData): ProfileData {
    d.cores = Math.max(0, Math.floor(d.cores || 0));
    d.prisms = Math.max(0, Math.floor(d.prisms || 0));
    d.shards = Math.max(0, Math.floor(d.shards || 0));
    d.level = clamp(Math.floor(d.level || 1), 1, XP.maxLevel);
    d.xp = Math.max(0, Math.floor(d.xp || 0));

    if (!d.roster || Object.keys(d.roster).length === 0) {
      d.roster = { [STARTER_GUARDIAN_ID]: { level: 1, stars: 1, copies: 1, obtainedAt: Date.now(), favourite: false } };
    }
    for (const [id, owned] of Object.entries(d.roster)) {
      try {
        getGuardian(id);
      } catch {
        // A Guardian removed in a later build: drop it rather than crash.
        delete d.roster[id];
        continue;
      }
      owned.level = clamp(Math.floor(owned.level || 1), 1, MAX_LEVEL);
      owned.stars = clamp(Math.floor(owned.stars || 1), 1, MAX_STARS);
      owned.copies = Math.max(1, Math.floor(owned.copies || 1));
    }
    if (!d.roster[d.equipped]) d.equipped = Object.keys(d.roster)[0] ?? STARTER_GUARDIAN_ID;

    d.pity ??= {};
    for (const b of BANNERS) d.pity[b.id] ??= createPityState();

    if (!d.gachaRng || typeof d.gachaRng.a !== 'number') d.gachaRng = seedFromString(`${d.playerId}-gacha`);
    if (Array.isArray(d.ledger) && d.ledger.length > LEDGER_LIMIT) {
      d.ledger = d.ledger.slice(-LEDGER_LIMIT);
    }
    return d;
  }

  save(): void {
    this.data.lastSeen = Date.now();
    this.store.flush();
  }

  private touch(): void {
    this.store.markDirty();
    this.events.emit('change', {});
  }

  // -------------------------------------------------------------- currency

  balance(currency: CurrencyId): number {
    return this.data[currency];
  }

  canAfford(currency: CurrencyId, amount: number): boolean {
    return this.data[currency] >= amount;
  }

  credit(currency: CurrencyId, amount: number, reason: string): number {
    const delta = Math.max(0, Math.floor(amount));
    if (delta === 0) return this.data[currency];
    this.data[currency] += delta;
    this.record(currency, delta, reason);
    return this.data[currency];
  }

  /** Returns false and changes nothing if the player cannot afford it. */
  debit(currency: CurrencyId, amount: number, reason: string): boolean {
    const delta = Math.max(0, Math.floor(amount));
    if (this.data[currency] < delta) return false;
    this.data[currency] -= delta;
    this.record(currency, -delta, reason);
    return true;
  }

  private record(currency: CurrencyId, delta: number, reason: string): void {
    const entry: LedgerEntry = {
      at: Date.now(),
      currency,
      delta,
      balance: this.data[currency],
      reason,
    };
    this.data.ledger.push(entry);
    if (this.data.ledger.length > LEDGER_LIMIT) this.data.ledger.shift();
    this.events.emit('currency', { currency, delta, balance: this.data[currency], reason });
    this.touch();
  }

  // ---------------------------------------------------------------- roster

  owns(id: string): boolean {
    return !!this.data.roster[id];
  }

  owned(id: string): OwnedGuardian | undefined {
    return this.data.roster[id];
  }

  ownedIds(): string[] {
    return Object.keys(this.data.roster);
  }

  ownedSet(): Set<string> {
    return new Set(Object.keys(this.data.roster));
  }

  get equipped(): string {
    return this.data.equipped;
  }

  equip(id: string): boolean {
    if (!this.owns(id)) return false;
    this.data.equipped = id;
    this.events.emit('equipped', { id });
    this.touch();
    return true;
  }

  toggleFavourite(id: string): void {
    const o = this.data.roster[id];
    if (!o) return;
    o.favourite = !o.favourite;
    this.touch();
  }

  /**
   * Grant a Guardian. Duplicates convert into shards and star progress rather
   * than being dead value — an entirely wasted pull is the fastest way to lose
   * a player.
   */
  grant(id: string, source: string): { duplicate: boolean; shards: number; starUp: boolean; copies: number } {
    const guardian = getGuardian(id);
    const existing = this.data.roster[id];

    if (!existing) {
      this.data.roster[id] = { level: 1, stars: 1, copies: 1, obtainedAt: Date.now(), favourite: false };
      this.events.emit('guardianObtained', { id, duplicate: false, copies: 1 });
      this.touch();
      return { duplicate: false, shards: 0, starUp: false, copies: 1 };
    }

    existing.copies++;
    let starUp = false;
    const needed = starUpCost(existing.stars);
    // Copies beyond the first are spent on stars, then converted to shards.
    const spent = existing.copies - 1;
    if (existing.stars < MAX_STARS && spent >= cumulativeStarCost(existing.stars)) {
      existing.stars++;
      starUp = true;
    }
    void needed;

    const shards = DUPLICATE_SHARDS[guardian.rarity] ?? 0;
    if (shards > 0) this.credit('shards', shards, `duplicate:${id}:${source}`);

    this.events.emit('guardianObtained', { id, duplicate: true, copies: existing.copies });
    this.touch();
    return { duplicate: true, shards, starUp, copies: existing.copies };
  }

  levelUpCostFor(id: string): number | null {
    const owned = this.data.roster[id];
    if (!owned || owned.level >= MAX_LEVEL) return null;
    return levelUpCost(owned.level, getGuardian(id).rarity);
  }

  levelUp(id: string): boolean {
    const cost = this.levelUpCostFor(id);
    if (cost === null) return false;
    if (!this.debit('shards', cost, `levelup:${id}`)) return false;
    const owned = this.data.roster[id]!;
    owned.level++;
    this.events.emit('guardianUpgraded', { id, level: owned.level, stars: owned.stars });
    this.touch();
    return true;
  }

  // ------------------------------------------------------------------- xp

  get xpToNext(): number {
    return XP.curve(this.data.level);
  }

  addXp(amount: number): { levelsGained: number; rewards: { prisms: number; cores: number } } {
    let levels = 0;
    const rewards = { prisms: 0, cores: 0 };
    this.data.xp += Math.max(0, Math.round(amount));

    while (this.data.level < XP.maxLevel && this.data.xp >= this.xpToNext) {
      this.data.xp -= this.xpToNext;
      this.data.level++;
      levels++;
      // Account levels pay premium currency. It is the main free path to pulls.
      const prisms = this.data.level % 5 === 0 ? 160 : 60;
      const cores = 200 + this.data.level * 25;
      rewards.prisms += prisms;
      rewards.cores += cores;
      this.credit('prisms', prisms, `levelup:${this.data.level}`);
      this.credit('cores', cores, `levelup:${this.data.level}`);
      this.events.emit('levelUp', { level: this.data.level, rewards: { prisms, cores } });
    }
    if (this.data.level >= XP.maxLevel) this.data.xp = 0;
    this.touch();
    return { levelsGained: levels, rewards };
  }

  // --------------------------------------------------------------- gacha

  pityFor(bannerId: string): PityState {
    this.data.pity[bannerId] ??= createPityState();
    return this.data.pity[bannerId]!;
  }

  /**
   * Hand out the persisted gacha RNG. The caller rolls with it; `commitGacha`
   * then writes the advanced state back, so results cannot be re-rolled by
   * reloading the page mid-pull.
   */
  get rng(): Rng {
    return this.gachaRng;
  }

  commitGacha(): void {
    this.data.gachaRng = this.gachaRng.getState();
    this.touch();
    this.store.flush();
  }

  // --------------------------------------------------------------- stats

  recordRun(input: {
    score: number;
    wave: number;
    combo: number;
    kills: number;
    parries: number;
    perfects: number;
    bossKills: number;
    seconds: number;
  }): { personalBest: boolean } {
    const s = this.data.stats;
    s.runs++;
    s.totalScore += input.score;
    s.totalKills += input.kills;
    s.totalParries += input.parries;
    s.totalPerfects += input.perfects;
    s.totalBossKills += input.bossKills;
    s.totalPlaySeconds += input.seconds;
    const personalBest = input.score > s.bestScore;
    if (personalBest) s.bestScore = input.score;
    if (input.wave > s.bestWave) s.bestWave = input.wave;
    if (input.combo > s.bestCombo) s.bestCombo = input.combo;

    this.rollDailyIfNeeded();
    this.data.daily.runs++;
    this.updateStreak();
    this.touch();
    return { personalBest };
  }

  recordPull(rarity: string): void {
    this.data.stats.pulls++;
    if (rarity === 'mythic') this.data.stats.mythicsPulled++;
    if (rarity === 'legendary') this.data.stats.legendariesPulled++;
    this.touch();
  }

  // --------------------------------------------------------------- daily

  rollDailyIfNeeded(): void {
    const today = todayKey();
    if (this.data.daily.date === today) return;
    this.data.daily.date = today;
    this.data.daily.coresEarned = 0;
    this.data.daily.runs = 0;
    this.touch();
  }

  private updateStreak(): void {
    const today = todayKey();
    const last = this.data.daily.lastPlayedDate;
    if (last === today) return;
    const gap = last ? daysBetween(last, today) : 99;
    this.data.daily.streak = gap === 1 ? this.data.daily.streak + 1 : 1;
    this.data.daily.lastPlayedDate = today;
    this.events.emit('streak', { streak: this.data.daily.streak });
  }

  /** Track soft-capped core income so the economy cannot be farmed flat. */
  noteCoresEarned(amount: number): void {
    this.rollDailyIfNeeded();
    this.data.daily.coresEarned += amount;
    this.touch();
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: Partial<Settings>): void {
    Object.assign(this.data.settings, patch);
    this.events.emit('settings', { settings: this.data.settings });
    this.touch();
  }

  get settings(): Settings {
    return this.data.settings;
  }

  hasSeenTip(id: string): boolean {
    return this.data.seenTips.includes(id);
  }

  markTipSeen(id: string): void {
    if (!this.hasSeenTip(id)) {
      this.data.seenTips.push(id);
      this.touch();
    }
  }

  // ----------------------------------------------------------- purchases

  recordPurchase(productId: string, entitlements: string[] = []): void {
    this.data.purchases[productId] = (this.data.purchases[productId] ?? 0) + 1;
    for (const e of entitlements) this.data.entitlements[e] = true;
    this.touch();
    this.store.flush();
  }

  purchaseCount(productId: string): number {
    return this.data.purchases[productId] ?? 0;
  }

  hasEntitlement(id: string): boolean {
    return !!this.data.entitlements[id];
  }

  // ----------------------------------------------------------- transfer

  exportSave(): string {
    this.save();
    return this.store.export();
  }

  importSave(encoded: string): boolean {
    const ok = this.store.import(encoded);
    if (ok) {
      this.gachaRng = new Rng(this.data.gachaRng);
      this.events.emit('change', {});
    }
    return ok;
  }

  resetAll(): void {
    this.store.reset();
    this.gachaRng = new Rng(this.data.gachaRng);
    this.events.emit('change', {});
  }
}

/** Shards paid out when a duplicate is pulled. */
export const DUPLICATE_SHARDS: Record<string, number> = {
  common: 12,
  rare: 30,
  epic: 90,
  legendary: 240,
  mythic: 600,
};

/** Total duplicate copies needed to reach a given star level. */
export function cumulativeStarCost(currentStars: number): number {
  let total = 0;
  for (let s = 1; s <= currentStars; s++) total += starUpCost(s);
  return total;
}

export { todayKey };
