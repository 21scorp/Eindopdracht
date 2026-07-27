/**
 * Offline check.
 *
 * "Plays fully offline" is a promise the README makes and the manifest implies,
 * and it is the kind of promise that quietly stops being true. This registers
 * the worker the way a real first visit does, cuts the network, reloads, and
 * fails unless the game boots and plays with no server at all.
 *
 * It has already caught two separate reasons it was not true:
 *
 *   - the worker was never registered, because the registration was attached to
 *     a `load` event that had already fired by the time boot finished
 *   - every cache lookup missed, because an entry added by URL was fetched with
 *     a wildcard Accept header and the page asks for text/css — different
 *     entries once `Vary` is respected
 *
 * Usage:  node tools/offline.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2 });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

function log(step) {
  console.log(`\x1b[36m▸\x1b[0m ${step}`);
}

const fail = (message) => {
  console.log(`\n\x1b[31moffline check failed\x1b[0m\n   ${message}`);
  process.exitCode = 1;
};

try {
  log('first visit, online');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const worker = await page.evaluate(async () => {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
    return { registrations: regs.length, active: regs.some((r) => !!r.active), controlled: !!navigator.serviceWorker.controller };
  });
  console.log(`  worker: ${JSON.stringify(worker)}`);
  if (worker.registrations === 0) throw new Error('no service worker was registered on the first visit');
  if (!worker.active) throw new Error('the service worker never activated');

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    let total = 0;
    let scripts = 0;
    for (const n of names) {
      const keys = await (await caches.open(n)).keys();
      total += keys.length;
      scripts += keys.filter((r) => /\.(js|css)$/.test(new URL(r.url).pathname)).length;
    }
    return { entries: total, scripts };
  });
  console.log(`  cached: ${cached.entries} entries, ${cached.scripts} script/style`);
  if (cached.scripts === 0) throw new Error('the build itself was never cached — the shell alone is not playable');

  log('cutting the network');
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const offline = await page.evaluate(() => ({
    booted: !!window.aegis,
    screen: window.aegis?.screens?.currentName,
  }));
  console.log(`  offline boot: ${JSON.stringify(offline)}`);
  if (!offline.booted) throw new Error('the game did not boot with no network');

  log('playing offline');
  await page.evaluate(() => {
    window.aegis.screens.closeAll();
    window.aegis.startRun();
  });
  await page.waitForTimeout(3500);
  const played = await page.evaluate(() => ({
    mode: window.aegis.mode,
    wave: window.aegis.session.director.wave,
    live: window.aegis.session.pool.live.length,
  }));
  console.log(`  offline run: ${JSON.stringify(played)}`);
  if (played.mode !== 'playing' || played.wave < 1) throw new Error('a run would not start with no network');

  await page.screenshot({ path: 'tools/shots/offline.png' });

  const real = errors.filter((e) => !e.includes('Failed to load resource'));
  if (real.length > 0) throw new Error(`console errors offline: ${real.slice(0, 2).join(' | ')}`);
} catch (err) {
  fail(err.message);
} finally {
  await context.setOffline(false);
  await browser.close();
}

if (!process.exitCode) console.log('\n\x1b[32m✓ registers, caches, boots and plays with no network\x1b[0m');
