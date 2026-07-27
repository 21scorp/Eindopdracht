/**
 * @vitest-environment happy-dom
 *
 * Wallet, roster and persistence.
 *
 * Anything that can silently give away or destroy a player's currency gets a
 * test. Save migration is included because the first time it runs in
 * production is the first time anyone finds out whether it works.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { Profile, DUPLICATE_SHARDS, cumulativeStarCost } from '../src/meta/Profile';
import { Store, mergeDefaults } from '../src/core/Storage';
import { MAX_STARS, STARTER_GUARDIAN_ID, getGuardian, levelUpCost, scaleStats } from '../src/data/guardians';
import { MockProvider, PRODUCTS, StoreService, describeGrant, mergeGrants } from '../src/meta/store';

let counter = 0;
function freshProfile(): Profile {
  return new Profile(`test.profile.${counter++}.${Math.random()}`);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('wallet', () => {
  it('starts with enough prisms for a ten-pull', () => {
    const p = freshProfile();
    expect(p.balance('prisms')).toBeGreaterThanOrEqual(1500);
  });

  it('credits and debits', () => {
    const p = freshProfile();
    const start = p.balance('cores');
    p.credit('cores', 250, 'test');
    expect(p.balance('cores')).toBe(start + 250);
    expect(p.debit('cores', 100, 'test')).toBe(true);
    expect(p.balance('cores')).toBe(start + 150);
  });

  it('refuses a debit it cannot cover and changes nothing', () => {
    const p = freshProfile();
    const start = p.balance('prisms');
    expect(p.debit('prisms', start + 1, 'test')).toBe(false);
    expect(p.balance('prisms')).toBe(start);
  });

  it('never goes negative through fractional or negative inputs', () => {
    const p = freshProfile();
    const start = p.balance('cores');
    p.credit('cores', -500, 'test');
    expect(p.balance('cores')).toBe(start);
    p.debit('cores', -50, 'test');
    expect(p.balance('cores')).toBe(start);
  });

  it('writes a ledger entry for every movement', () => {
    const p = freshProfile();
    const before = p.data.ledger.length;
    p.credit('cores', 10, 'run');
    p.debit('cores', 5, 'exchange');
    expect(p.data.ledger.length).toBe(before + 2);
    const last = p.data.ledger[p.data.ledger.length - 1]!;
    expect(last.delta).toBe(-5);
    expect(last.balance).toBe(p.balance('cores'));
  });
});

describe('roster', () => {
  it('starts with exactly the starter Guardian equipped', () => {
    const p = freshProfile();
    expect(p.ownedIds()).toEqual([STARTER_GUARDIAN_ID]);
    expect(p.equipped).toBe(STARTER_GUARDIAN_ID);
  });

  it('grants a new Guardian without paying shards', () => {
    const p = freshProfile();
    const shardsBefore = p.balance('shards');
    const result = p.grant('kestrel', 'test');
    expect(result.duplicate).toBe(false);
    expect(p.owns('kestrel')).toBe(true);
    expect(p.balance('shards')).toBe(shardsBefore);
  });

  it('converts duplicates into shards at the published rate', () => {
    const p = freshProfile();
    p.grant('kestrel', 'test');
    const before = p.balance('shards');
    const dup = p.grant('kestrel', 'test');
    expect(dup.duplicate).toBe(true);
    expect(dup.shards).toBe(DUPLICATE_SHARDS.rare);
    expect(p.balance('shards')).toBe(before + DUPLICATE_SHARDS.rare);
  });

  it('raises stars on the published duplicate schedule', () => {
    const p = freshProfile();
    p.grant('kestrel', 'test');
    expect(p.owned('kestrel')!.stars).toBe(1);

    // One duplicate is enough for the first star.
    p.grant('kestrel', 'test');
    expect(p.owned('kestrel')!.stars).toBe(2);

    // Then the cost escalates: the next star needs the cumulative total.
    while (p.owned('kestrel')!.copies - 1 < cumulativeStarCost(2)) p.grant('kestrel', 'test');
    expect(p.owned('kestrel')!.stars).toBe(3);
  });

  it('never exceeds the maximum star level', () => {
    const p = freshProfile();
    for (let i = 0; i < 200; i++) p.grant('kestrel', 'test');
    expect(p.owned('kestrel')!.stars).toBe(MAX_STARS);
  });

  it('refuses to equip a Guardian that is not owned', () => {
    const p = freshProfile();
    expect(p.equip('eclipse')).toBe(false);
    expect(p.equipped).toBe(STARTER_GUARDIAN_ID);
  });
});

describe('levelling', () => {
  it('charges the published shard cost', () => {
    const p = freshProfile();
    const id = STARTER_GUARDIAN_ID;
    const expected = levelUpCost(1, getGuardian(id).rarity);
    expect(p.levelUpCostFor(id)).toBe(expected);

    p.credit('shards', expected, 'test');
    const before = p.balance('shards');
    expect(p.levelUp(id)).toBe(true);
    expect(p.owned(id)!.level).toBe(2);
    expect(p.balance('shards')).toBe(before - expected);
  });

  it('fails without enough shards and changes nothing', () => {
    const p = freshProfile();
    const id = STARTER_GUARDIAN_ID;
    expect(p.levelUp(id)).toBe(false);
    expect(p.owned(id)!.level).toBe(1);
  });

  it('makes a Guardian strictly better as it levels and stars', () => {
    const g = getGuardian('kestrel');
    const base = scaleStats(g.stats, 1, 1);
    const maxed = scaleStats(g.stats, 30, 5);
    expect(maxed.integrity).toBeGreaterThan(base.integrity);
    expect(maxed.scoreMult).toBeGreaterThan(base.scoreMult);
    expect(maxed.parryWindow).toBeGreaterThan(base.parryWindow);
    // Lower is better for these two.
    expect(maxed.turn).toBeLessThan(base.turn);
    expect(maxed.pulseCooldown).toBeLessThan(base.pulseCooldown);
  });
});

describe('account xp', () => {
  it('levels up and pays out', () => {
    const p = freshProfile();
    const prisms = p.balance('prisms');
    const result = p.addXp(p.xpToNext);
    expect(result.levelsGained).toBeGreaterThanOrEqual(1);
    expect(p.data.level).toBeGreaterThan(1);
    expect(p.balance('prisms')).toBeGreaterThan(prisms);
  });

  it('carries the remainder into the next level', () => {
    const p = freshProfile();
    const need = p.xpToNext;
    p.addXp(need + 10);
    expect(p.data.xp).toBe(10);
  });
});

describe('gacha rng persistence', () => {
  it('advances and persists the stream so a pull cannot be re-rolled', () => {
    const key = `test.rng.${Math.random()}`;
    const a = new Profile(key);
    const before = a.rng.getState();
    a.rng.next();
    a.commitGacha();
    const after = a.rng.getState();
    expect(after).not.toEqual(before);

    // A fresh Profile reading the same storage resumes from the advanced state.
    const b = new Profile(key);
    expect(b.rng.getState()).toEqual(after);
  });
});

describe('save handling', () => {
  it('round-trips through export and import', () => {
    const a = freshProfile();
    a.credit('cores', 4321, 'test');
    a.grant('onyx', 'test');
    const code = a.exportSave();

    const b = freshProfile();
    expect(b.importSave(code)).toBe(true);
    expect(b.balance('cores')).toBe(a.balance('cores'));
    expect(b.owns('onyx')).toBe(true);
  });

  it('rejects a corrupt save code without wiping progress', () => {
    const p = freshProfile();
    p.credit('cores', 999, 'test');
    const before = p.balance('cores');
    expect(p.importSave('not-a-real-save')).toBe(false);
    expect(p.balance('cores')).toBe(before);
  });

  it('repairs a save whose sub-objects are the wrong shape entirely', () => {
    // `mergeDefaults` takes arrays from the save wholesale, so a record whose
    // `stats` is an array survives the merge intact and every later read of it
    // is undefined — not a crash, which is worse: a save that silently behaves
    // like a different save. Seen in the wild as a half-synced record.
    const key = `test.shape.${Math.random()}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        __v: 1,
        __savedAt: Date.now(),
        data: { stats: [], settings: 7, daily: null, roster: null, ledger: 'nope', seenTips: 3 },
      }),
    );
    const p = new Profile(key);
    expect(typeof p.data.stats.runs).toBe('number');
    expect(typeof p.data.settings.music).toBe('number');
    expect(typeof p.data.daily.date).toBe('string');
    expect(Array.isArray(p.data.ledger)).toBe(true);
    expect(Array.isArray(p.data.seenTips)).toBe(true);
    expect(p.owns(p.equipped)).toBe(true);
  });

  it('keeps the fields a partial save did set', () => {
    const key = `test.partial.${Math.random()}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({ __v: 1, __savedAt: Date.now(), data: { stats: { bestScore: 4242 }, settings: { music: 0.1 } } }),
    );
    const p = new Profile(key);
    expect(p.data.stats.bestScore).toBe(4242);
    expect(p.data.stats.runs).toBe(0);
    expect(p.data.settings.music).toBe(0.1);
    expect(typeof p.data.settings.sfx).toBe('number');
  });

  it('repairs a save that references a Guardian that no longer exists', () => {
    const key = `test.repair.${Math.random()}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        __v: 1,
        __savedAt: Date.now(),
        data: {
          roster: { ghost: { level: 3, stars: 2, copies: 2, obtainedAt: 1, favourite: false } },
          equipped: 'ghost',
          cores: 10,
        },
      }),
    );
    const p = new Profile(key);
    expect(p.owns('ghost')).toBe(false);
    expect(p.ownedIds().length).toBeGreaterThan(0);
    expect(p.owns(p.equipped)).toBe(true);
  });

  it('clamps out-of-range values loaded from disk', () => {
    const key = `test.clamp.${Math.random()}`;
    window.localStorage.setItem(
      key,
      JSON.stringify({
        __v: 1,
        __savedAt: Date.now(),
        data: { cores: -5000, prisms: 12.7, level: 9999, roster: {} },
      }),
    );
    const p = new Profile(key);
    expect(p.balance('cores')).toBe(0);
    expect(p.balance('prisms')).toBe(12);
    expect(p.data.level).toBeLessThanOrEqual(60);
  });
});

describe('storage primitives', () => {
  it('runs migrations in order', () => {
    const key = `test.migrate.${Math.random()}`;
    window.localStorage.setItem(key, JSON.stringify({ __v: 0, __savedAt: 0, data: { n: 1 } }));
    const store = new Store<{ n: number }>({
      key,
      version: 3,
      defaults: () => ({ n: 0 }),
      migrations: {
        0: (d) => ({ n: (d as { n: number }).n + 1 }),
        1: (d) => ({ n: (d as { n: number }).n * 10 }),
        2: (d) => ({ n: (d as { n: number }).n + 5 }),
      },
    });
    expect(store.data.n).toBe(25);
  });

  it('falls back to defaults when a migration is missing', () => {
    const key = `test.nomigrate.${Math.random()}`;
    window.localStorage.setItem(key, JSON.stringify({ __v: 0, __savedAt: 0, data: { n: 7 } }));
    const store = new Store<{ n: number }>({ key, version: 2, defaults: () => ({ n: -1 }) });
    expect(store.data.n).toBe(-1);
  });

  it('does not overwrite a save from a newer build', () => {
    const key = `test.future.${Math.random()}`;
    const payload = JSON.stringify({ __v: 99, __savedAt: 0, data: { n: 7 } });
    window.localStorage.setItem(key, payload);
    const store = new Store<{ n: number }>({ key, version: 1, defaults: () => ({ n: 0 }) });
    expect(store.data.n).toBe(0);
    expect(window.localStorage.getItem(key)).toBe(payload);
  });

  it('backfills fields added after the save was written', () => {
    const merged = mergeDefaults({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } }) as {
      a: number;
      b: { c: number; d: number };
    };
    expect(merged).toEqual({ a: 1, b: { c: 9, d: 3 } });
  });
});

describe('purchases', () => {
  it('grants contents and doubles the first purchase where advertised', async () => {
    const p = freshProfile();
    const store = new StoreService(p, new MockProvider());
    const product = PRODUCTS.find((x) => x.id === 'prisms.small')!;
    const before = p.balance('prisms');

    const receipt = await store.purchase(product.id);
    expect(receipt.status).toBe('completed');
    // First purchase doubles: 300 + 300.
    expect(p.balance('prisms')).toBe(before + 600);

    const second = p.balance('prisms');
    await store.purchase(product.id);
    expect(p.balance('prisms')).toBe(second + 300);
  });

  it('enforces purchase limits', async () => {
    const p = freshProfile();
    const store = new StoreService(p, new MockProvider());
    const limited = PRODUCTS.find((x) => x.limit === 1)!;
    expect((await store.purchase(limited.id)).status).toBe('completed');
    expect((await store.purchase(limited.id)).status).toBe('unavailable');
    expect(p.purchaseCount(limited.id)).toBe(1);
  });

  it('grants nothing when the platform reports a failure', async () => {
    const p = freshProfile();
    const provider = new MockProvider();
    provider.forcedStatus = 'cancelled';
    const store = new StoreService(p, provider);
    const before = p.balance('prisms');
    const receipt = await store.purchase('prisms.medium');
    expect(receipt.status).toBe('cancelled');
    expect(p.balance('prisms')).toBe(before);
  });

  it('records entitlements so a restore can re-grant them', async () => {
    const p = freshProfile();
    const store = new StoreService(p, new MockProvider());
    await store.purchase('permanent.archive');
    expect(p.hasEntitlement('archive')).toBe(true);
  });

  it('describes exactly what a pack contains', () => {
    const merged = mergeGrants({ currency: { prisms: 100 } }, { currency: { prisms: 50, cores: 10 } });
    expect(merged.currency).toEqual({ prisms: 150, cores: 10 });
    expect(describeGrant(merged)).toContain('150 Prisms');
  });

  it('reports itself as simulated so the UI can say so', () => {
    const store = new StoreService(freshProfile(), new MockProvider());
    expect(store.isSimulated).toBe(true);
  });
});
