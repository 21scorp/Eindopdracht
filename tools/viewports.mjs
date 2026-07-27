/**
 * Viewport sweep.
 *
 * The game is designed mobile-portrait first, but it has to be *correct*
 * everywhere. This opens each key screen at several viewport sizes, screenshots
 * them, and fails on the one thing that is always a bug rather than a taste
 * question: content wider than the viewport.
 *
 *   node tools/viewports.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots', 'viewports');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'phone-small', width: 320, height: 568, mobile: true },
  { name: 'phone', width: 412, height: 892, mobile: true },
  { name: 'phone-landscape', width: 892, height: 412, mobile: true },
  { name: 'tablet', width: 820, height: 1180, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
  { name: 'ultrawide', width: 2560, height: 1080, mobile: false },
];

const SCREENS = ['home', 'roster', 'banner', 'shop', 'rates', 'howtoplay'];

const problems = [];
const consoleErrors = [];

const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await context.newPage();
  page.on('pageerror', (err) => consoleErrors.push(`${vp.name}: ${err.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${vp.name}: ${m.text()}`);
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Clear the daily overlay so the screens underneath are measurable.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^CLAIM/.test(b.textContent ?? ''));
    btn?.click();
  });
  await page.waitForTimeout(900);

  for (const screen of SCREENS) {
    await page.evaluate((s) => {
      window.aegis.showMenu('home');
      if (s !== 'home') window.aegis.screens.push(s);
    }, screen);
    await page.waitForTimeout(450);

    const overflow = await page.evaluate(() => {
      const active = document.querySelector('.screen.is-active');
      if (!active) return null;
      const vw = document.documentElement.clientWidth;
      const offenders = [];

      // Content inside a deliberately scrollable container is supposed to
      // extend past the viewport — that is what the scroll is for.
      const inScroller = (el) => {
        for (let n = el.parentElement; n && n !== active; n = n.parentElement) {
          const overflowX = getComputedStyle(n).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll') return true;
        }
        return false;
      };

      for (const el of active.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (inScroller(el)) continue;
        // A few pixels of subpixel bleed is not a bug; a chopped-off column is.
        if (r.right > vw + 2 || r.left < -2) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className || '').toString().split(' ')[0],
            left: Math.round(r.left),
            right: Math.round(r.right),
          });
        }
      }
      return {
        vw,
        docWidth: document.documentElement.scrollWidth,
        offenders: offenders.slice(0, 6),
      };
    });

    if (overflow && (overflow.docWidth > overflow.vw + 2 || overflow.offenders.length > 0)) {
      problems.push({ viewport: vp.name, screen, ...overflow });
    }

    await page.screenshot({ path: join(OUT, `${vp.name}-${screen}.png`) });
  }

  // A run, so the arena and HUD are checked at this size too.
  await page.evaluate(() => window.aegis.startRun());
  await page.waitForTimeout(2600);
  await page.screenshot({ path: join(OUT, `${vp.name}-play.png`) });
  const arena = await page.evaluate(() => {
    const a = window.aegis.session.arena;
    return {
      shieldR: Math.round(a.shieldR),
      nexusR: Math.round(a.nexusR),
      cx: Math.round(a.cx),
      cy: Math.round(a.cy),
      fitsWidth: a.shieldR * 2 < window.innerWidth,
      fitsHeight: a.shieldR * 2 < window.innerHeight,
    };
  });
  if (!arena.fitsWidth || !arena.fitsHeight) {
    problems.push({ viewport: vp.name, screen: 'play', arena });
  }
  console.log(`${vp.name.padEnd(17)} ${String(vp.width).padStart(4)}x${String(vp.height).padEnd(5)} arena r=${arena.shieldR}`);

  await context.close();
}

await browser.close();

console.log('');
if (consoleErrors.length) {
  console.log(`\x1b[31m${consoleErrors.length} console error(s)\x1b[0m`);
  for (const e of consoleErrors.slice(0, 10)) console.log('  ', e);
}
if (problems.length) {
  console.log(`\x1b[31m${problems.length} layout problem(s)\x1b[0m`);
  for (const p of problems) console.log('  ', JSON.stringify(p));
  process.exit(1);
}
console.log(`\x1b[32m✓ ${VIEWPORTS.length} viewports x ${SCREENS.length + 1} screens, no overflow\x1b[0m`);
