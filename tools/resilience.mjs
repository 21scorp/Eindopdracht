/**
 * Hostile-environment check.
 *
 * The smoke test drives the happy path in a healthy browser. This one boots the
 * same build in browsers that are broken in the specific ways real players'
 * browsers are broken, and asserts the game still starts and still plays:
 *
 *   1. localStorage throws on every call        (Safari private mode, blocked cookies)
 *   2. the save is corrupt                      (a half-written record, an extension, a bad sync)
 *   3. the save claims a version from the future (a player who rolled back)
 *   4. AudioContext does not exist              (locked-down or ancient browsers)
 *   5. MediaRecorder does not exist             (no clip capture available)
 *
 * None of these may produce a console error, a blank canvas, or a run that
 * cannot be started. Losing a feature is fine; losing the game is not.
 *
 * Usage:  node tools/resilience.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});

function log(step) {
  console.log(`\x1b[36m▸\x1b[0m ${step}`);
}

const failures = [];

/**
 * Boot the game under a scenario and report what survived.
 *
 * `init` runs before any page script, so it can break the environment the way
 * the real one is broken rather than patching over it afterwards.
 */
async function scenario(name, init, { allowWarnings = [] } = {}) {
  log(name);
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

  if (init) await page.addInitScript(init);

  try {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1800);

    const booted = await page.evaluate(() => ({
      hasApp: !!window.aegis,
      screen: window.aegis?.screens?.currentName,
      guardian: window.aegis?.profile?.equipped,
      prisms: window.aegis?.profile?.balance('prisms'),
    }));
    if (!booted.hasApp) throw new Error('window.aegis was never set — the app did not boot');
    if (!booted.guardian) throw new Error('no Guardian equipped — the profile did not load');

    // And it must actually play, not merely render a menu.
    await page.evaluate(() => {
      window.aegis.screens.closeAll();
      window.aegis.startRun();
    });
    await page.waitForTimeout(2500);
    const playing = await page.evaluate(() => ({
      mode: window.aegis.mode,
      wave: window.aegis.session.director.wave,
      fps: Math.round(window.aegis.loop.fps),
      drew: window.aegis.renderer.display.width > 0,
    }));
    if (playing.mode !== 'playing') throw new Error(`mode is "${playing.mode}" after starting a run`);
    if (playing.wave < 1) throw new Error('no wave started');
    if (!playing.drew) throw new Error('the canvas has no size');

    const unexpected = errors.filter((e) => !allowWarnings.some((w) => e.includes(w)));
    if (unexpected.length > 0) throw new Error(`console errors: ${unexpected.slice(0, 3).join(' | ')}`);

    console.log(`  ok — booted on ${booted.screen}, reached wave ${playing.wave} at ${playing.fps}fps`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`  \x1b[31mFAILED\x1b[0m — ${err.message}`);
  } finally {
    await context.close();
  }
}

await scenario('localStorage throws on every call', () => {
  const boom = () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }),
  });
});

await scenario('the save is corrupt', () => {
  window.localStorage.setItem('aegis.profile.v1', '{"__v":1,"data":{"cores":"not a number"');
});

await scenario('the save is from a newer build', () => {
  window.localStorage.setItem(
    'aegis.profile.v1',
    JSON.stringify({ __v: 99, __savedAt: Date.now(), data: { cores: 12345, playerName: 'FUTURE' } }),
  );
});

await scenario('the save is a valid record of the wrong shape', () => {
  window.localStorage.setItem(
    'aegis.profile.v1',
    JSON.stringify({ __v: 1, __savedAt: Date.now(), data: { roster: null, settings: 7, stats: [] } }),
  );
});

await scenario('AudioContext does not exist', () => {
  delete window.AudioContext;
  delete window.webkitAudioContext;
});

await scenario('MediaRecorder does not exist', () => {
  delete window.MediaRecorder;
});

await scenario('captureStream is missing from canvas', () => {
  delete HTMLCanvasElement.prototype.captureStream;
});

await browser.close();

if (failures.length > 0) {
  console.log(`\n\x1b[31m${failures.length} scenario(s) failed\x1b[0m`);
  for (const f of failures) console.log(`   ${f}`);
  process.exit(1);
}

console.log('\n\x1b[32m✓ survives every hostile environment\x1b[0m');
