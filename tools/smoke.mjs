/**
 * Browser smoke test.
 *
 * Loads the built game in a phone-sized Chromium, walks the main flows, and
 * fails on any console error or page exception. Screenshots land in
 * `tools/shots/` so the visual result can be reviewed alongside the log.
 *
 * Usage:  node tools/smoke.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots');
mkdirSync(OUT, { recursive: true });

const errors = [];
const warnings = [];

function log(step) {
  console.log(`\x1b[36m▸\x1b[0m ${step}`);
}

// Prefer a pre-provisioned browser when one is present (as in this dev
// container); otherwise let Playwright resolve its own download, which is what
// CI has after `playwright install`.
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

page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error') errors.push(text);
  else if (msg.type() === 'warning') warnings.push(text);
});
page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}\n${err.stack}`));

const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log(`captured ${name}.png`);
};

try {
  log(`loading ${BASE}`);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  // A fresh context means a fresh profile, so the daily reward opens itself.
  await shot('00-daily');
  const dailyClaimed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^CLAIM/.test(b.textContent ?? ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  console.log('  daily reward claimed:', dailyClaimed);
  if (!dailyClaimed) throw new Error('daily reward did not open for a new profile');
  await page.waitForTimeout(1400);
  await shot('01-home');

  // --- diagnostics from inside the app -------------------------------------
  const boot = await page.evaluate(() => {
    const app = window.aegis;
    return {
      hasApp: !!app,
      mode: app?.mode,
      fps: app?.loop?.fps,
      quality: app?.renderer?.quality,
      equipped: app?.profile?.equipped,
      prisms: app?.profile?.balance('prisms'),
      screen: app?.screens?.currentName,
    };
  });
  console.log('  boot state:', JSON.stringify(boot));
  if (!boot.hasApp) throw new Error('window.aegis was never set — boot failed');

  // --- gameplay -------------------------------------------------------------
  log('starting a run');
  await page.getByRole('button', { name: /HOLD THE LINE/i }).click();
  await page.waitForTimeout(2200);
  await shot('02-play-early');

  // Play for real: an "autopilot" that aims at the nearest incoming threat and
  // pulses when a cluster is at the shield radius. It is not a good player, but
  // it exercises every collision path.
  const box = { x: 206, y: 446 };
  await page.mouse.move(box.x, box.y - 150);
  await page.mouse.down();
  for (let i = 0; i < 150; i++) {
    const aim = await page.evaluate(() => {
      const s = window.aegis.session;
      const a = s.arena;
      let best = null;
      let bestR = Infinity;
      for (const t of s.pool.live) {
        if (!t.active || t.state !== 'incoming' || t.delay > 0) continue;
        if (t.radius < bestR) {
          bestR = t.radius;
          best = t;
        }
      }
      const nearPulse = s.pool.live.filter(
        (t) => t.active && t.state === 'incoming' && Math.abs(t.radius - a.shieldR) < a.shieldR * 0.18,
      ).length;
      return best
        ? { angle: best.angle, cx: a.cx, cy: a.cy, r: a.shieldR, pulse: nearPulse >= 2 }
        : { angle: null, cx: a.cx, cy: a.cy, r: a.shieldR, pulse: false };
    });
    if (aim.angle !== null) {
      await page.mouse.move(
        aim.cx + Math.cos(aim.angle) * aim.r * 1.1,
        aim.cy + Math.sin(aim.angle) * aim.r * 1.1,
      );
    }
    if (aim.pulse && i % 3 === 0) {
      await page.keyboard.press('Space');
    }
    await page.waitForTimeout(55);
  }
  await page.mouse.up();
  await shot('03-play-mid');

  const mid = await page.evaluate(() => {
    const s = window.aegis.session;
    return {
      phase: s.phase,
      wave: s.director.wave,
      score: Math.round(s.score),
      combo: s.combo,
      integrity: s.integrity,
      liveThreats: s.pool.live.length,
      fps: Math.round(window.aegis.loop.fps),
      particles: window.aegis.particles.count,
    };
  });
  console.log('  gameplay state:', JSON.stringify(mid));
  if (mid.wave < 1) throw new Error('no wave started');
  if (mid.score <= 0 && mid.integrity === 3) {
    throw new Error('nothing happened in 8s of play — threats never reached the shield');
  }

  // --- force a run end so results render ------------------------------------
  log('ending the run');
  await page.evaluate(() => window.aegis.session.end());
  await page.waitForTimeout(1200);
  await shot('04-results');

  // --- summon ---------------------------------------------------------------
  log('opening summon');
  await page.evaluate(() => window.aegis.showMenu('home'));
  await page.waitForTimeout(600);
  await page.evaluate(() => window.aegis.screens.push('banner'));
  await page.waitForTimeout(700);
  await shot('05-banner');

  log('performing a ten-pull');
  await page.getByRole('button', { name: /SUMMON x10/i }).click();
  await page.waitForTimeout(1300);
  await shot('06-summon-cinematic');
  await page.waitForTimeout(4200);
  await shot('07-pull-results');
  // Force the tail of the reveal so the hero card is captured settled.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'REVEAL ALL');
    btn?.click();
  });
  await page.waitForTimeout(1100);
  await shot('07b-pull-settled');

  const afterPull = await page.evaluate(() => ({
    screen: window.aegis.screens.currentName,
    owned: window.aegis.profile.ownedIds().length,
    pulls: window.aegis.profile.data.stats.pulls,
    prisms: window.aegis.profile.balance('prisms'),
    mode: window.aegis.mode,
  }));
  console.log('  after pull:', JSON.stringify(afterPull));
  if (afterPull.pulls < 10) throw new Error('ten-pull did not register 10 pulls');
  if (afterPull.mode === 'cinema') throw new Error('cinematic never handed back control');

  // --- other screens --------------------------------------------------------
  for (const [name, screen] of [
    ['08-roster', 'roster'],
    ['09-shop', 'shop'],
    ['10-rates', 'rates'],
    ['11-settings', 'settings'],
    ['12-profile', 'profile'],
    ['12b-howto', 'howtoplay'],
  ]) {
    log(`opening ${screen}`);
    await page.evaluate((s) => {
      window.aegis.showMenu('home');
      window.aegis.screens.push(s);
    }, screen);
    await page.waitForTimeout(650);
    await shot(name);
  }

  // --- share card -----------------------------------------------------------
  // Rendered through the results screen's own button so the lazy chunk, the
  // canvas render and the delivery fallbacks are all exercised for real.
  log('rendering the share card');
  await page.evaluate(() => {
    const stats = window.aegis.lastRun?.stats;
    if (stats) window.aegis.screens.replace('results', { stats, rewards: window.aegis.lastRun.rewards });
  });
  await page.waitForTimeout(500);
  const shareResult = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'SHARE');
    if (!btn) return 'no-button';
    btn.click();
    await new Promise((r) => setTimeout(r, 1200));
    return 'clicked';
  });
  console.log('  share path:', shareResult);
  if (shareResult === 'no-button') throw new Error('results screen has no share button');
  await shot('13-share');

  const finalStats = await page.evaluate(() => window.aegis.lastRun?.stats ?? null);
  console.log('  run stats:', JSON.stringify(finalStats));

  // --- challenge link -------------------------------------------------------
  // The viral loop: a link reproduces the challenger's exact wave sequence.
  log('following a challenge link');
  const token = await page.evaluate(() => {
    const stats = window.aegis.lastRun?.stats;
    if (!stats) return null;
    // Reach the encoder the way the share path does, through the app.
    return { seed: stats.seed, score: stats.score, wave: stats.wave, guardianId: stats.guardianId };
  });
  if (!token) throw new Error('no run to build a challenge from');

  const encoded = Buffer.from(
    ['1', token.seed, String(token.score + 1000), String(token.wave), token.guardianId, 'RIVAL'].join('|'),
    'utf8',
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await page.goto(`${BASE}?c=${encoded}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await shot('14-challenge');

  const onChallenge = await page.evaluate(() => ({
    screen: window.aegis.screens.currentName,
    pending: !!window.aegis.pendingChallenge,
    urlHasParam: location.search.includes('c='),
  }));
  console.log('  challenge landing:', JSON.stringify(onChallenge));
  if (onChallenge.screen !== 'challenge') throw new Error('a challenge link did not open the challenge screen');
  if (onChallenge.urlHasParam) throw new Error('the challenge parameter was not cleared from the URL');

  await page.getByRole('button', { name: /^ACCEPT$/i }).click();
  await page.waitForTimeout(1800);
  await shot('15-challenge-run');
  const inChallenge = await page.evaluate(() => ({
    mode: window.aegis.mode,
    seed: window.aegis.session.seed,
    target: window.aegis.hud.challengeTarget,
  }));
  console.log('  challenge run:', JSON.stringify(inChallenge));
  if (inChallenge.seed !== token.seed) throw new Error('the challenge run used a different seed');
  if (inChallenge.target <= 0) throw new Error('the HUD is not showing the challenge target');

  await page.evaluate(() => window.aegis.session.end());
  await page.waitForTimeout(1400);
  await shot('16-challenge-result');
} catch (err) {
  errors.push(`test failure: ${err.message}`);
  await page.screenshot({ path: join(OUT, 'zz-failure.png') }).catch(() => {});
} finally {
  await browser.close();
}

console.log('');
if (warnings.length) {
  console.log(`\x1b[33m${warnings.length} warning(s)\x1b[0m`);
  for (const w of warnings.slice(0, 12)) console.log('  ', w);
}
if (errors.length) {
  console.log(`\x1b[31m${errors.length} error(s)\x1b[0m`);
  for (const e of errors) console.log('  ', e);
  process.exit(1);
}
console.log('\x1b[32m✓ smoke test passed\x1b[0m');
