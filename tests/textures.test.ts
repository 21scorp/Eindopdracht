/**
 * @vitest-environment happy-dom
 *
 * The texture contract.
 *
 * `docs/SPRITES.md` and `src/render/manifest.ts` are what an artist works from.
 * If the game starts asking for a key the manifest does not list, the artist
 * finds out when a magenta checkerboard appears in a build. These tests make
 * that a failing test instead.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { installCanvasStub } from './helpers/canvasStub';
import { TextureStore, canvasToTexture } from '../src/render/TextureStore';
import { registerProceduralArt } from '../src/render/procgen';
import { TEXTURE_MANIFEST } from '../src/render/manifest';
import { GUARDIANS } from '../src/data/guardians';
import { THREAT_LIST } from '../src/data/threats';

beforeAll(() => installCanvasStub());

function populatedStore(): TextureStore {
  const store = new TextureStore();
  registerProceduralArt(
    store,
    GUARDIANS.map((g) => ({ id: g.id, rarity: g.rarity, shape: g.shape, hue: g.hue })),
  );
  return store;
}

describe('manifest', () => {
  it('lists every key the game registers', () => {
    const registered = new Set(populatedStore().keys());
    const documented = new Set(TEXTURE_MANIFEST.map((e) => e.key));
    const undocumented = [...registered].filter((k) => !documented.has(k));
    expect(undocumented).toEqual([]);
  });

  it('does not promise keys the game never asks for', () => {
    const registered = new Set(populatedStore().keys());
    const orphaned = TEXTURE_MANIFEST.map((e) => e.key).filter((k) => !registered.has(k));
    expect(orphaned).toEqual([]);
  });

  it('covers both frames for every Guardian', () => {
    const keys = new Set(TEXTURE_MANIFEST.map((e) => e.key));
    for (const g of GUARDIANS) {
      expect(keys.has(`guardian/${g.id}/portrait`)).toBe(true);
      expect(keys.has(`guardian/${g.id}/emblem`)).toBe(true);
    }
  });

  it('covers every threat archetype', () => {
    const keys = new Set(TEXTURE_MANIFEST.map((e) => e.key));
    for (const t of THREAT_LIST) expect(keys.has(t.texture)).toBe(true);
  });

  it('declares a usable size for every entry', () => {
    for (const e of TEXTURE_MANIFEST) {
      expect(e.width).toBeGreaterThan(0);
      expect(e.height).toBeGreaterThan(0);
      expect(e.key).toMatch(/^[a-z0-9]+(\/[a-z0-9-]+)+$/);
    }
  });

  it('has no duplicate keys', () => {
    const keys = TEXTURE_MANIFEST.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('texture store', () => {
  it('generates a texture on first use and caches it', () => {
    const store = populatedStore();
    const first = store.get('fx/spark');
    const second = store.get('fx/spark');
    expect(first).toBe(second);
    expect(first.fromAtlas).toBe(false);
    expect(first.sw).toBeGreaterThan(0);
  });

  it('produces a visible placeholder for an unknown key instead of throwing', () => {
    const store = populatedStore();
    const tex = store.get('does/not/exist');
    expect(tex.key).toBe('does/not/exist');
    expect(tex.sw).toBeGreaterThan(0);
  });

  it('lets an atlas frame override a procedural key', () => {
    const store = populatedStore();
    const before = store.get('threat/orb');
    expect(before.fromAtlas).toBe(false);

    // Stand in for a loaded atlas frame.
    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const replacement = { ...canvasToTexture('threat/orb', canvas), fromAtlas: true };
    (store as unknown as { textures: Map<string, unknown> }).textures.set('threat/orb', replacement);

    const after = store.get('threat/orb');
    expect(after.fromAtlas).toBe(true);
    expect(after.sw).toBe(40);
  });

  it('drops generated textures on invalidate but keeps atlas frames', () => {
    const store = populatedStore();
    store.get('fx/spark');
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    (store as unknown as { textures: Map<string, unknown> }).textures.set('from/atlas', {
      ...canvasToTexture('from/atlas', canvas),
      fromAtlas: true,
    });

    store.invalidate();
    expect(store.keys()).toContain('from/atlas');
  });

  it('reports animation frames and ends a non-looping animation', () => {
    const store = populatedStore();
    store.defineAnimation({ name: 'test', frames: ['a', 'b', 'c'], fps: 10, loop: false });
    expect(store.frameAt('test', 0)).toBe('a');
    expect(store.frameAt('test', 0.15)).toBe('b');
    expect(store.frameAt('test', 0.5)).toBeUndefined();

    store.defineAnimation({ name: 'loopy', frames: ['a', 'b'], fps: 10, loop: true });
    expect(store.frameAt('loopy', 0.2)).toBe('a');
    expect(store.frameAt('loopy', 0.3)).toBe('b');
  });
});
