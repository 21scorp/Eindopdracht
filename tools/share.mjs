/**
 * Share card check.
 *
 * The card is the artifact the whole distribution model rests on, it is drawn
 * on a canvas where no DOM sweep can see it, and one of its lines is a name a
 * player typed. `fillText` neither wraps nor clips: a string that does not fit
 * simply runs off the edge, silently, on the one image that gets posted
 * somewhere public.
 *
 * This renders the card at the values a card actually has to survive — a
 * ten-digit score, a five-digit combo, a full hand of Resonance, and a name far
 * longer than the rename field allows, because an imported save code is under
 * no obligation to respect it — and then reads the pixels back. Nothing may
 * paint outside the inner frame.
 *
 * Screenshots go to `tools/shots/share-*.png` so the composition can be judged
 * as well as measured.
 *
 * Usage:  node tools/share.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync, writeFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const CASES = [
  { file: 'share-fresh', name: 'GUARDIAN', score: 8_420, wave: 6, combo: 14, cards: [] },
  { file: 'share-max', name: 'MAXIMUMOVERDRV', score: 987_654_321, wave: 137, combo: 4321, cards: ['wide-guard', 'core-tithe', 'twin-guard', 'siphon'] },
  {
    file: 'share-hostile',
    name: 'CONSTANTINOPLE OVERDRIVE COMMANDER OF THE ETERNAL WATCH',
    score: 1_234_567_890,
    wave: 999,
    combo: 99_999,
    cards: ['wide-guard', 'core-tithe', 'twin-guard', 'siphon'],
  },
];

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 1 });
const page = await context.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

const problems = [];

for (const t of CASES) {
  const result = await page.evaluate(async (t) => {
    const app = window.aegis;
    app.profile.data.playerName = t.name;
    app.screens.closeAll();
    app.startRun();
    await new Promise((r) => setTimeout(r, 600));
    const s = app.session;
    for (const id of t.cards) {
      try {
        s.takeResonance(id);
      } catch {
        /* a card that no longer exists is not what this probe is about */
      }
    }
    s.score = t.score;
    s.combo = t.combo;
    s.maxCombo = t.combo;
    s.director.wave = t.wave;
    s.invuln = 0;
    s.end();
    await new Promise((r) => setTimeout(r, 1200));

    const canvas = window.aegisData.renderShareCard({
      stats: app.lastRun.stats,
      playerName: app.profile.data.playerName,
      bestScore: app.profile.data.stats.bestScore,
      dailyNumber: app.lastDaily?.number,
    });

    // The frame is drawn at 28px and its inner rule at 40px. Anything painting
    // outside that is text that did not fit. Look for *bright* pixels only: the
    // background gradient and the vignette reach the edge by design, and the
    // frame stroke itself is a dim grey.
    const ctx = canvas.getContext('2d');
    const { width: W, height: H } = canvas;
    const MARGIN = 26;
    const bright = (px, i) => px[i] > 150 && px[i + 1] > 150 && px[i + 2] > 150 && px[i + 3] > 128;

    const overflow = [];
    const bands = [
      ['left', 0, 0, MARGIN, H],
      ['right', W - MARGIN, 0, MARGIN, H],
      ['top', 0, 0, W, MARGIN],
      ['bottom', 0, H - MARGIN, W, MARGIN],
    ];
    for (const [side, x, y, w, h] of bands) {
      const data = ctx.getImageData(x, y, w, h).data;
      let hits = 0;
      for (let i = 0; i < data.length; i += 4) if (bright(data, i)) hits++;
      if (hits > 0) overflow.push(`${side} margin has ${hits} lit pixels`);
    }

    return { url: canvas.toDataURL('image/png'), overflow, w: W, h: H };
  }, t);

  if (result.url?.startsWith('data:image')) {
    writeFileSync(`tools/shots/${t.file}.png`, Buffer.from(result.url.split(',')[1], 'base64'));
  }

  const ok = result.overflow.length === 0;
  console.log(`  ${t.file.padEnd(16)} ${result.w}x${result.h}  ${ok ? 'inside the frame' : result.overflow.join(', ')}`);
  for (const o of result.overflow) problems.push(`${t.file}: ${o}`);
}

await browser.close();

if (problems.length > 0) {
  console.log(`\n\x1b[33m${problems.length} share card problem(s)\x1b[0m`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
console.log('\n\x1b[32m✓ every card stays inside its own frame\x1b[0m');
