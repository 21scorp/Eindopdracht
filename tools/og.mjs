/**
 * Social preview image.
 *
 * The game's whole distribution model is a link in a reply, and a link with no
 * image is a link nobody clicks. This renders the arena at the moment it looks
 * most like itself — a wide shield arc mid-Overdrive, threats converging — at
 * the 1200x630 that every scraper wants, and writes it to `public/og.png`.
 *
 * Rendered from the real game rather than drawn by hand, so it can never depict
 * a version of the game that does not exist.
 *
 * Usage:  node tools/og.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

await page.evaluate(() => {
  const app = window.aegis;
  // No coaching card in a promo frame: it is a first-run affordance, and this
  // image is not a first run.
  app.profile.markTipSeen('basics');
  app.screens.closeAll();
  app.startRun();
});
await page.waitForTimeout(500);

await page.evaluate(() => {
  const app = window.aegis;
  const s = app.session;
  const a = s.arena;
  const T = window.aegisData.THREATS;

  // Park the director so the staged frame is not immediately buried.
  s.director.phase = 'complete';
  s.pool.clear();

  s.director.wave = 14;
  s.score = 486_200;
  s.combo = 52;
  s.maxCombo = 52;
  s.overdrive = true;
  s.events.emit('overdriveStart', { combo: s.combo });
  // Deliberately *not* full: a ready Ultimate throws a banner across the
  // middle of the frame, and this image has one job.
  s.ultCharge = s.ultCost * 0.78;
  s.invuln = 999;
  // A wide arc, held to the side, so the shield reads as an arc rather than as
  // a ring — the silhouette is the thing somebody has to recognise later.
  s.takeResonance('wide-guard');
  s.shieldAngle = -0.5;
  s.shieldTarget = -0.5;

  const place = (kind, angle, factor) => {
    const def = T[kind];
    const t = s.pool.spawn(def);
    if (!t) return;
    t.angle = angle;
    t.radius = a.shieldR * factor;
    t.speed = a.unit * 0.05;
    t.size = a.px(def.radius);
    t.x = a.polarX(angle, t.radius);
    t.y = a.polarY(angle, t.radius);
    t.facing = angle + Math.PI;
    t.scale = 1;
    t.hp = def.hp;
    t.maxHp = def.hp;
  };

  // Far enough out that nothing reaches the shield while the frame settles —
  // a contact throws floating score text across the composition and recharges
  // the Ultimate into a banner.
  for (let i = 0; i < 16; i++) place(i % 5 === 0 ? 'lancer' : 'orb', (i / 16) * Math.PI * 2 + 0.28, 2.1 + (i % 4) * 0.42);
  for (let i = 0; i < 3; i++) place('seeker', (i / 3) * Math.PI * 2 + 1.1, 2.6 + i * 0.3);
  place('splitter', 2.4, 2.4);
  place('bulwark', -1.9, 2.2);
});

// Long enough for the run-start banner to clear and the trails to form, short
// enough that nothing has arrived.
await page.waitForTimeout(2200);
await page.screenshot({ path: join(OUT, 'og.png') });
await browser.close();

console.log(`\x1b[32m✓ wrote public/og.png (1200x630)\x1b[0m`);
