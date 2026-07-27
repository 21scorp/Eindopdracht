/**
 * In-run HUD check.
 *
 * The HUD is drawn on the canvas, so the DOM layout sweep cannot see it — and
 * it is the one surface that is on screen for the entire time anybody actually
 * plays. It is also laid out against the state a run *starts* in: a zero score,
 * no combo, no cards. The state it spends its life in is the opposite.
 *
 * This puts a run into the widest state it can reach — a nine-figure score, a
 * four-digit combo, wave 137, a full hand of Resonance — on the two shapes with
 * the least room, and checks:
 *
 *   - the thumb targets stay fully on screen. An Ultimate button half off the
 *     bottom edge is unpressable on the shape where it matters most.
 *   - the targets do not overlap each other, or a tap does two things.
 *   - the targets stay clear of the arena, or defending the ring means
 *     accidentally pausing.
 *
 * It writes screenshots to `tools/shots/hud-*.png` so the drawn layout can be
 * looked at as well as measured.
 *
 * Usage:  node tools/hud.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SHAPES = [
  { name: 'small', width: 320, height: 568 },
  { name: 'phone', width: 412, height: 892 },
  { name: 'landscape', width: 892, height: 412 },
];

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const problems = [];

for (const shape of SHAPES) {
  const context = await browser.newContext({
    viewport: { width: shape.width, height: shape.height },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  console.log(`\n\x1b[36m▸\x1b[0m ${shape.name} (${shape.width}x${shape.height})`);

  await page.evaluate(() => {
    const app = window.aegis;
    app.profile.markTipSeen('basics');
    app.screens.closeAll();
    app.startRun();
  });
  await page.waitForTimeout(700);

  // The widest every field gets, all at once.
  await page.evaluate(() => {
    const s = window.aegis.session;
    for (const id of ['wide-guard', 'core-tithe', 'twin-guard', 'siphon', 'overcharge', 'chain-reaction']) {
      try {
        s.takeResonance(id);
      } catch {
        /* a card that no longer exists is not what this probe is about */
      }
    }
    s.score = 987_654_321;
    s.combo = 4321;
    s.maxCombo = 4321;
    s.director.wave = 137;
    s.ultCharge = s.ultCost;
    s.invuln = 999;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `tools/shots/hud-${shape.name}.png` });

  const geometry = await page.evaluate(() => {
    const app = window.aegis;
    const hit = app.hud.hit;
    const a = app.session.arena;
    const dpr = window.devicePixelRatio || 1;
    // Hit areas are in the same space the input reports in, which is CSS
    // pixels — the same space `arena` uses.
    return {
      view: { w: window.innerWidth, h: window.innerHeight, dpr },
      arena: { cx: a.cx, cy: a.cy, r: a.shieldR },
      areas: Object.entries(hit).map(([name, v]) => ({ name, x: v.x, y: v.y, r: v.r })),
    };
  });

  console.log(`  view ${geometry.view.w}x${geometry.view.h} @${geometry.view.dpr}x, shield r=${Math.round(geometry.arena.r)}`);

  for (const a of geometry.areas) {
    const off =
      a.x - a.r < 0 || a.y - a.r < 0 || a.x + a.r > geometry.view.w || a.y + a.r > geometry.view.h;
    const line = `${a.name.padEnd(9)} centre ${Math.round(a.x)},${Math.round(a.y)} r=${Math.round(a.r)}`;
    console.log(`  ${line}${off ? '  \x1b[31m← off screen\x1b[0m' : ''}`);
    if (a.r <= 0) {
      problems.push(`${shape.name}: the ${a.name} button has no hit area at all`);
      continue;
    }
    if (off) problems.push(`${shape.name}: the ${a.name} button is partly off screen`);
    // 44px of *diameter* is the guidance for a thumb target.
    if (a.r * 2 < 44) problems.push(`${shape.name}: the ${a.name} button is only ${Math.round(a.r * 2)}px across`);

    // Overlapping the playfield means defending the ring can pause the game.
    const toArena = Math.hypot(a.x - geometry.arena.cx, a.y - geometry.arena.cy);
    if (toArena < geometry.arena.r + a.r) {
      problems.push(`${shape.name}: the ${a.name} button overlaps the shield ring`);
    }
  }

  for (let i = 0; i < geometry.areas.length; i++) {
    for (let j = i + 1; j < geometry.areas.length; j++) {
      const p = geometry.areas[i];
      const q = geometry.areas[j];
      if (Math.hypot(p.x - q.x, p.y - q.y) < p.r + q.r) {
        problems.push(`${shape.name}: the ${p.name} and ${q.name} buttons overlap`);
      }
    }
  }

  await context.close();
}

await browser.close();

if (problems.length > 0) {
  console.log(`\n\x1b[33m${problems.length} HUD problem(s)\x1b[0m`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
console.log('\n\x1b[32m✓ every thumb target is on screen, reachable and unambiguous\x1b[0m');
