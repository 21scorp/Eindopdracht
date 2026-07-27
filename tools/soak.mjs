/**
 * Long-run soak.
 *
 * The smoke test plays for about thirty seconds, which is long enough to prove
 * the flows work and far too short to prove the game survives an evening. This
 * one plays continuously for several minutes — through wave escalation, boss
 * fights, drafts, deaths and restarts — and watches the numbers that only go
 * wrong slowly: heap size, texture cache, live entity counts, frame time.
 *
 * A leak here is not theoretical. The tint cache grew unbounded until it was
 * holding hundreds of megabytes of canvases, and nothing shorter than this would
 * have shown it.
 *
 * Usage:  node tools/soak.mjs [seconds] [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const SECONDS = Number(process.argv[2] ?? 180);
const BASE = process.argv[3] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch(
  existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {},
);
const context = await browser.newContext({
  viewport: { width: 412, height: 892 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

console.log(`\x1b[36m▸\x1b[0m soaking for ${SECONDS}s at ${BASE}`);
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.aegis.screens.closeAll();
  window.aegis.startRun();
});

const samples = [];
const started = Date.now();
let restarts = 0;
let drafts = 0;

while ((Date.now() - started) / 1000 < SECONDS) {
  // Play: aim at the nearest incoming threat, pulse at a cluster, take drafts,
  // and start a fresh run whenever this one ends. Nothing here is skilful; the
  // point is that the machine keeps running, not that it plays well.
  const step = await page.evaluate(() => {
    const app = window.aegis;
    let tookDraft = false;
    let restarted = false;

    if (app.screens.currentName === 'resonance') {
      const cards = document.querySelectorAll('.rescard');
      cards[Math.floor(Math.random() * cards.length)]?.click();
      tookDraft = true;
    } else if (app.mode !== 'playing') {
      app.screens.closeAll();
      app.startRun();
      restarted = true;
    } else {
      const s = app.session;
      let best = null;
      let bestR = Infinity;
      let band = 0;
      for (const t of s.pool.live) {
        if (!t.active || t.state !== 'incoming' || t.delay > 0) continue;
        if (t.radius < bestR) {
          bestR = t.radius;
          best = t;
        }
        if (Math.abs(t.radius - s.arena.shieldR) < s.arena.shieldR * 0.18) band++;
      }
      if (best) s.shieldTarget = best.angle;
      if (band >= 2) s.pulse();
      if (s.ultimateReady && Math.random() < 0.3) s.fireUltimate();
    }

    return { tookDraft, restarted };
  });

  if (step.tookDraft) drafts++;
  if (step.restarted) restarts++;
  await page.waitForTimeout(90);

  // Sample roughly every ten seconds.
  if (samples.length < Math.floor((Date.now() - started) / 10_000) + 1) {
    const sample = await page.evaluate(() => {
      const app = window.aegis;
      const mem = performance.memory;
      return {
        t: Math.round(performance.now() / 1000),
        wave: app.session.director.wave,
        entities: app.session.pool.live.length,
        particles: app.particles.count,
        textures: window.aegisData?.textures?.stats?.generated,
        tintMp: window.aegisData?.textures?.stats?.tintMegapixels,
        heapMb: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
        fps: Math.round(app.loop.fps),
      };
    });
    samples.push(sample);
    console.log(
      `  t=${String(sample.t).padStart(3)}s  wave ${String(sample.wave).padStart(2)}  ` +
        `entities ${String(sample.entities).padStart(3)}  particles ${String(sample.particles).padStart(4)}  ` +
        `textures ${sample.textures ?? '?'}  tint ${(sample.tintMp ?? 0).toFixed?.(1) ?? '?'}MP  ` +
        `heap ${sample.heapMb ?? '?'}MB  ${sample.fps}fps`,
    );
  }
}

await page.screenshot({ path: 'tools/shots/soak-end.png' });
await browser.close();

// ------------------------------------------------------------------- verdict

const heaps = samples.map((s) => s.heapMb).filter((h) => typeof h === 'number');
const first = heaps.slice(0, Math.max(1, Math.floor(heaps.length / 3)));
const last = heaps.slice(-Math.max(1, Math.floor(heaps.length / 3)));
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const growth = heaps.length >= 4 ? avg(last) / Math.max(1, avg(first)) : 1;

console.log(`\n  runs started      ${restarts + 1}`);
console.log(`  drafts taken      ${drafts}`);
console.log(`  peak entities     ${Math.max(...samples.map((s) => s.entities))}`);
console.log(`  peak particles    ${Math.max(...samples.map((s) => s.particles))}`);
if (heaps.length >= 4) {
  console.log(`  heap first third  ${avg(first).toFixed(0)}MB`);
  console.log(`  heap last third   ${avg(last).toFixed(0)}MB  (${growth.toFixed(2)}x)`);
}

const problems = [];
if (errors.length > 0) problems.push(`${errors.length} console error(s): ${errors.slice(0, 3).join(' | ')}`);
// Only meaningful over a long soak: a competent-enough bot can legitimately
// survive a couple of minutes, but a game where runs *cannot* end is the
// soft-lock this whole family of tools exists to catch.
if (SECONDS >= 150 && restarts === 0) {
  problems.push('no run ended in the whole soak — either the bot is not playing or runs cannot finish');
}
// A game that allocates per frame shows up as steady growth. Some growth is
// normal (the texture cache fills as new art is first drawn); doubling is not.
if (growth > 2) problems.push(`heap grew ${growth.toFixed(2)}x across the soak — likely a leak`);

if (problems.length > 0) {
  console.log(`\n\x1b[31msoak failed\x1b[0m`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}

console.log('\n\x1b[32m✓ soak clean\x1b[0m');
