/**
 * Set-piece capture.
 *
 * Drives the game into states that are slow to reach by playing — a boss fight,
 * full Overdrive, a crowded arena, a wave still off-screen — and screenshots
 * each one. Reviewing the moments that matter should not require surviving to
 * wave fifteen by hand.
 *
 *   node tools/capture.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const MEDIA = args.includes('--media');
const BASE = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:4173/';
const here = dirname(fileURLToPath(import.meta.url));
// `--media` writes the curated, committed set the README uses: 1x rather than
// 2x, because a repository does not need retina screenshots.
const OUT = MEDIA ? join(here, '..', 'docs', 'media') : join(here, 'shots', 'moments');
mkdirSync(OUT, { recursive: true });

const SCENES = [
  {
    name: '01-edge-warnings',
    settle: 400,
    build: () => {
      // A ring still outside the viewport, so every entry chevron is showing.
      for (let i = 0; i < 12; i++) place('orb', (i / 12) * Math.PI * 2, 'edge', 0.94);
    },
  },
  {
    name: '02-busy-arena',
    settle: 800,
    build: () => {
      const s = window.aegis.session;
      s.score = 41_200;
      s.combo = 18;
      for (let i = 0; i < 20; i++) {
        place(i % 4 === 0 ? 'lancer' : 'orb', (i / 20) * Math.PI * 2 + i * 0.13, 'shield', 1.15 + (i % 5) * 0.26);
      }
    },
  },
  {
    name: '03-overdrive',
    settle: 900,
    build: () => {
      const s = window.aegis.session;
      s.combo = 46;
      s.maxCombo = 46;
      s.score = 184_320;
      s.ultCharge = s.ultCost;
      s.events.emit('overdriveStart', { combo: s.combo });
      s.overdrive = true;
      for (let i = 0; i < 10; i++) place('orb', (i / 10) * Math.PI * 2, 'shield', 1.2 + (i % 3) * 0.34);
    },
  },
  {
    name: '04-warden',
    settle: 1300,
    build: () => {
      const s = window.aegis.session;
      s.score = 96_450;
      s.combo = 21;
      const boss = place('warden', -Math.PI / 2.4, 'shield', 1.8);
      if (boss) {
        boss.hp = 11;
        boss.maxHp = 16;
        s.events.emit('bossSpawn', { threat: boss });
      }
      for (let i = 0; i < 6; i++) place('orb', -Math.PI / 2.4 + (i - 2.5) * 0.24, 'shield', 1.05 + i * 0.13);
    },
  },
  {
    name: '05-last-stand',
    settle: 800,
    build: () => {
      const s = window.aegis.session;
      s.integrity = 1;
      s.score = 58_900;
      s.combo = 12;
      s.events.emit('lastStand', {});
      for (let i = 0; i < 9; i++) place('lancer', (i / 9) * Math.PI * 2 + 0.4, 'shield', 1.08 + (i % 4) * 0.19);
    },
  },
  {
    name: '06-bulwarks-and-seekers',
    settle: 800,
    build: () => {
      const s = window.aegis.session;
      s.score = 132_800;
      s.combo = 27;
      for (let i = 0; i < 5; i++) place('bulwark', (i / 5) * Math.PI * 2, 'shield', 1.3 + i * 0.16);
      for (let i = 0; i < 5; i++) place('seeker', (i / 5) * Math.PI * 2 + 0.6, 'shield', 1.5 + i * 0.2);
      for (let i = 0; i < 3; i++) place('splitter', (i / 3) * Math.PI * 2 + 1.1, 'shield', 2.1 + i * 0.2);
    },
  },
];

/** Injected into the page: places a threat at a polar position. */
function installHelpers() {
  window.place = (kind, angle, from, factor) => {
    const s = window.aegis.session;
    const a = s.arena;
    const def = window.aegisData.THREATS[kind];
    const t = s.pool.spawn(def);
    if (!t) return null;
    const base = from === 'edge' ? a.edgeRadius(angle) : a.shieldR;
    t.angle = angle;
    t.radius = base * factor;
    t.speed = a.unit * 0.05;
    t.size = a.px(def.radius);
    t.x = a.polarX(angle, t.radius);
    t.y = a.polarY(angle, t.radius);
    t.facing = angle + Math.PI;
    t.scale = 1;
    t.hp = def.hp;
    t.maxHp = def.hp;
    return t;
  };
}

const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const context = await browser.newContext({
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: MEDIA ? 1 : 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /^CLAIM/.test(b.textContent ?? ''));
  btn?.click();
  window.aegis.profile.markTipSeen('basics');
});
await page.waitForTimeout(700);

// The README needs a few representative frames, not the whole review set, and
// under names that mean something in a document.
const MEDIA_SCENES = new Map([
  ['02-busy-arena', 'arena'],
  ['03-overdrive', 'overdrive'],
  ['04-warden', 'warden'],
]);
const selected = MEDIA ? SCENES.filter((s) => MEDIA_SCENES.has(s.name)) : SCENES;

for (const scene of selected) {
  await page.evaluate(() => window.aegis.startRun());
  await page.waitForTimeout(400);
  // Park the director so the staged scene is not immediately buried by a wave.
  await page.evaluate(() => {
    window.aegis.session.director.phase = 'complete';
    window.aegis.session.pool.clear();
  });
  await page.evaluate(installHelpers);
  await page.evaluate(scene.build);
  await page.waitForTimeout(scene.settle);
  const fileName = MEDIA ? `${MEDIA_SCENES.get(scene.name)}.png` : `${scene.name}.png`;
  await page.screenshot({ path: join(OUT, fileName) });
  console.log(`\x1b[36m▸\x1b[0m ${fileName}`);
}

await browser.close();

console.log('');
if (errors.length) {
  console.log(`\x1b[31m${errors.length} console error(s)\x1b[0m`);
  for (const e of errors.slice(0, 8)) console.log('  ', e);
  process.exit(1);
}
console.log(`\x1b[32m✓ captured ${selected.length} moments into ${MEDIA ? 'docs/media' : 'tools/shots/moments'}\x1b[0m`);
