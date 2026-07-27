/**
 * Layout integrity sweep.
 *
 * Screenshots only catch what somebody remembers to look at. This walks every
 * screen at three widths and fails on the two ways a layout breaks silently:
 *
 *   - an element that clips its own text. A panel sets `overflow: hidden`, and
 *     `overflow: hidden` sets a flex item's automatic minimum size to zero — so
 *     inside a scrolling column it is the one child flex is willing to squash,
 *     and it squashes by cutting a sentence in half rather than by scrolling.
 *     That is exactly how the rates screen was shipping a headline number with
 *     its bottom half missing.
 *   - content wider than the window, which turns a vertical scroller into a
 *     thing that also slides sideways under your thumb.
 *
 * Deliberate truncation is not a failure: an ellipsis or a line clamp is a
 * design decision, and both are excluded.
 *
 * Usage:  node tools/layout.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SCREENS = ['home', 'roster', 'banner', 'shop', 'rates', 'settings', 'profile', 'howtoplay', 'quests', 'daily'];
const WIDTHS = [
  { name: 'small', width: 320, height: 568 },
  { name: 'phone', width: 412, height: 892 },
  { name: 'tablet', width: 820, height: 1180 },
];

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const problems = [];

for (const vp of WIDTHS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  console.log(`\n\x1b[36m▸\x1b[0m ${vp.name} (${vp.width}x${vp.height})`);

  for (const screen of SCREENS) {
    await page.evaluate((s) => {
      window.aegis.showMenu('home');
      if (s !== 'home') window.aegis.screens.push(s);
    }, screen);
    // The rates screen fills its expectation panel a frame after it paints, so
    // measuring immediately measures the placeholder.
    await page.waitForTimeout(500);

    const found = await page.evaluate(() => {
      const actives = [...document.querySelectorAll('.screen.is-active')];
      const active = actives[actives.length - 1];
      if (!active) return { clipped: [], wide: [] };

      const label = (el) => {
        const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName;
        const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
        return text ? `${cls || el.tagName} "${text}"` : cls || el.tagName;
      };

      const clipped = [];
      const wide = [];

      for (const el of active.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;

        // Anything wider than the window makes the page slide sideways.
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          wide.push(`${label(el)} spans ${Math.round(r.left)}..${Math.round(r.right)}`);
        }

        const clips = (axis) => axis === 'hidden' || axis === 'clip';
        // An intentional scroller is not clipping anything: it is scrolling.
        const scrolls = (axis) => axis === 'auto' || axis === 'scroll';
        if (scrolls(s.overflowY) || scrolls(s.overflowX)) continue;
        // Deliberate truncation, both flavours.
        if (s.textOverflow === 'ellipsis' || s.webkitLineClamp !== 'none') continue;
        // Purely decorative clipping: an image cropped to its frame is the
        // point of the frame.
        if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'SVG') continue;
        if (!(el.textContent ?? '').trim()) continue;

        const overY = clips(s.overflowY) ? el.scrollHeight - el.clientHeight : 0;
        const overX = clips(s.overflowX) ? el.scrollWidth - el.clientWidth : 0;
        // A couple of pixels is sub-pixel rounding and a descender; four is a
        // cut line of text.
        if (overY > 3) clipped.push(`${label(el)} — ${overY}px of content cut off the bottom`);
        else if (overX > 3) clipped.push(`${label(el)} — ${overX}px cut off the right`);
      }

      return {
        clipped,
        wide,
        pageWide: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      };
    });

    const notes = [];
    if (found.clipped.length) notes.push(`${found.clipped.length} clipped`);
    if (found.wide.length) notes.push(`${found.wide.length} overhanging`);
    if (found.pageWide > 1) notes.push(`page ${found.pageWide}px wide`);
    console.log(`  ${screen.padEnd(12)} ${notes.length ? notes.join(', ') : 'clean'}`);
    for (const c of found.clipped.slice(0, 5)) console.log(`      clip: ${c}`);
    for (const w of found.wide.slice(0, 5)) console.log(`      wide: ${w}`);

    if (found.clipped.length) problems.push(`${vp.name}/${screen}: ${found.clipped[0]}`);
    if (found.pageWide > 1) problems.push(`${vp.name}/${screen}: the page scrolls sideways by ${found.pageWide}px`);
  }

  await context.close();
}

await browser.close();

if (problems.length > 0) {
  console.log(`\n\x1b[33m${problems.length} layout problem(s)\x1b[0m`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
console.log('\n\x1b[32m✓ nothing clips its own content, nothing overhangs the window\x1b[0m');
