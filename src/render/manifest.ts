/**
 * The texture contract.
 *
 * Every key the game will ask for, with the frame size and anchor the
 * procedural version uses. This is the spec sprites are drawn against, and
 * `tests/textures.test.ts` asserts it stays in step with what the game actually
 * registers — so the document an artist works from cannot drift from the code.
 *
 * Sizes mirror `procgen.ts`. They are declared as data rather than introspected
 * because introspecting them would require a DOM.
 */

import { GUARDIANS } from '../data/guardians';
import { THREAT_LIST } from '../data/threats';

export interface Entry {
  key: string;
  width: number;
  height: number;
  category: string;
  notes: string;
}

/**
 * Sizes mirror `render/procgen.ts`. They live here as data rather than being
 * introspected, because introspecting them would need a DOM — and because this
 * list doubles as the spec the sprites are drawn against.
 */
export const TEXTURE_MANIFEST: Entry[] = [
  { key: 'nexus/core', width: 256, height: 256, category: 'nexus', notes: 'rotates; visible diameter ~60% of frame' },
  { key: 'nexus/ring', width: 512, height: 512, category: 'nexus', notes: 'thin, mostly transparent, tinted' },

  { key: 'fx/spark', width: 64, height: 64, category: 'fx', notes: 'draw white, tinted at runtime' },
  { key: 'fx/spark-aegis', width: 64, height: 64, category: 'fx', notes: 'cyan variant' },
  { key: 'fx/spark-threat', width: 64, height: 64, category: 'fx', notes: 'red variant' },
  { key: 'fx/spark-parry', width: 64, height: 64, category: 'fx', notes: 'gold variant' },
  { key: 'fx/glow', width: 128, height: 128, category: 'fx', notes: 'soft falloff, no hard edge' },
  { key: 'fx/glow-aegis', width: 128, height: 128, category: 'fx', notes: '' },
  { key: 'fx/glow-parry', width: 128, height: 128, category: 'fx', notes: '' },
  { key: 'fx/glow-threat', width: 128, height: 128, category: 'fx', notes: '' },
  { key: 'fx/glow-ultimate', width: 128, height: 128, category: 'fx', notes: '' },
  { key: 'fx/ring', width: 256, height: 256, category: 'fx', notes: 'annulus; scaled up to 4x' },
  { key: 'fx/ring-aegis', width: 256, height: 256, category: 'fx', notes: '' },
  { key: 'fx/ring-parry', width: 256, height: 256, category: 'fx', notes: '' },
  { key: 'fx/starburst', width: 256, height: 256, category: 'fx', notes: 'four-point flare' },
  { key: 'fx/starburst-parry', width: 256, height: 256, category: 'fx', notes: '' },
  { key: 'fx/starburst-legendary', width: 384, height: 384, category: 'fx', notes: 'summon burst only' },
  { key: 'fx/starburst-mythic', width: 384, height: 384, category: 'fx', notes: 'summon burst only' },
  { key: 'fx/streak', width: 128, height: 32, category: 'fx', notes: 'aimed along +X' },
  { key: 'fx/streak-aegis', width: 128, height: 32, category: 'fx', notes: '' },
  { key: 'fx/smoke', width: 96, height: 96, category: 'fx', notes: 'drawn non-additively, low alpha' },
  { key: 'fx/shard', width: 48, height: 48, category: 'fx', notes: 'debris, spins' },
  { key: 'fx/shard-threat', width: 48, height: 48, category: 'fx', notes: '' },

  { key: 'ui/star', width: 64, height: 64, category: 'ui', notes: 'filled rarity star' },
  { key: 'ui/star-empty', width: 64, height: 64, category: 'ui', notes: 'same shape, desaturated' },
  { key: 'ui/prism', width: 96, height: 96, category: 'ui', notes: 'premium currency' },
  { key: 'ui/core', width: 96, height: 96, category: 'ui', notes: 'soft currency' },
  { key: 'ui/shard', width: 96, height: 96, category: 'ui', notes: 'upgrade material' },

  { key: 'res/arc', width: 96, height: 96, category: 'ui', notes: 'resonance: shield shape' },
  { key: 'res/turn', width: 96, height: 96, category: 'ui', notes: 'resonance: shield tracking' },
  { key: 'res/pulse', width: 96, height: 96, category: 'ui', notes: 'resonance: pulse' },
  { key: 'res/perfect', width: 96, height: 96, category: 'ui', notes: 'resonance: precision' },
  { key: 'res/chain', width: 96, height: 96, category: 'ui', notes: 'resonance: deflection and chains' },
  { key: 'res/nexus', width: 96, height: 96, category: 'ui', notes: 'resonance: survival' },
  { key: 'res/score', width: 96, height: 96, category: 'ui', notes: 'resonance: score and economy' },
  { key: 'res/ult', width: 96, height: 96, category: 'ui', notes: 'resonance: ultimate' },
];

const THREAT_SIZES: Record<string, [number, number]> = {
  orb: [72, 72],
  lancer: [96, 60],
  splitter: [84, 84],
  bulwark: [92, 92],
  seeker: [80, 80],
  herald: [88, 88],
  warden: [320, 320],
};

for (const def of THREAT_LIST) {
  const [w, h] = THREAT_SIZES[def.kind] ?? [72, 72];
  TEXTURE_MANIFEST.push({
    key: def.texture,
    width: w,
    height: h,
    category: 'threat',
    notes: `${def.label} — faces +X${def.armoured ? ', armoured leading edge' : ''}${def.boss ? ', health arc drawn outside' : ''}`,
  });
}

for (const g of GUARDIANS) {
  TEXTURE_MANIFEST.push({
    key: `guardian/${g.id}/portrait`,
    width: 512,
    height: 640,
    category: 'guardian',
    notes: `${g.name} (${g.rarity}) — hue ${g.hue}; compose for a bottom scrim`,
  });
  TEXTURE_MANIFEST.push({
    key: `guardian/${g.id}/emblem`,
    width: 192,
    height: 192,
    category: 'guardian',
    notes: `${g.name} — must read at 44px`,
  });
}

