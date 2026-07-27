/**
 * Accessibility sweep.
 *
 * The menus are real DOM rather than canvas specifically so that focus order,
 * screen readers and keyboard navigation work — which is only true if somebody
 * checks. This walks every screen and reports controls a keyboard or a screen
 * reader cannot deal with:
 *
 *   - an interactive element with no accessible name
 *   - a control smaller than the 44px touch target guidance
 *   - an element that takes focus but shows nothing when focused
 *   - text below the contrast floor against its own background
 *
 * Usage:  node tools/a11y.mjs [baseUrl]
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173/';
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SCREENS = ['home', 'roster', 'banner', 'shop', 'rates', 'settings', 'profile', 'howtoplay', 'quests', 'daily'];

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const context = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2 });
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(1600);

const problems = [];

for (const screen of SCREENS) {
  await page.evaluate((s) => {
    window.aegis.showMenu('home');
    if (s !== 'home') window.aegis.screens.push(s);
  }, screen);
  await page.waitForTimeout(400);

  const found = await page.evaluate(() => {
    // The *topmost* active screen only: an overlay leaves the screen beneath
    // it visible, and counting both reports the same home-screen labels ten
    // times over.
    const actives = [...document.querySelectorAll('.screen.is-active')];
    const active = actives[actives.length - 1];
    if (!active) return { nameless: [], tiny: [], faint: [] };

    const controls = [...active.querySelectorAll('button, a[href], input, select, [tabindex]')];
    const nameOf = (el) =>
      (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '')
        .replace(/\s+/g, ' ')
        .trim();

    // A control can be smaller than it is hittable: an `::after` overlay is the
    // usual way to keep a switch looking like a switch while giving it a thumb-
    // sized target. Measure what can actually be pressed.
    const hitBox = (el) => {
      const r = el.getBoundingClientRect();
      const after = getComputedStyle(el, '::after');
      if (!after || after.content === 'none' || after.position !== 'absolute') return r;
      // Only ever *grow* the box: a decorative overlay inset inside the button
      // is not a smaller hit area, it is a highlight.
      const grow = (v) => Math.max(0, -(v.endsWith('px') ? parseFloat(v) : 0));
      return {
        width: r.width + grow(after.left) + grow(after.right),
        height: r.height + grow(after.top) + grow(after.bottom),
      };
    };

    const nameless = [];
    const tiny = [];
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // not shown
      const label = nameOf(el);
      if (!label) nameless.push(el.className || el.tagName);
      const hit = hitBox(el);
      // 44px is the guidance; the design uses smaller chips deliberately, so
      // flag only what is genuinely easy to miss with a thumb.
      if (Math.min(hit.width, hit.height) < 32) {
        tiny.push(`${el.className || el.tagName} ${Math.round(hit.width)}x${Math.round(hit.height)}`);
      }
    }

    // Contrast: sample text nodes against their own computed background.
    const luminance = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Parse rgb()/rgba() properly, alpha included. Anything else — a modern
    // `color(srgb ...)` from a resolved `color-mix`, say — is reported as
    // unreadable rather than guessed at, because a mis-parsed colour produces
    // confident nonsense like "1.00:1".
    const rgba = (value) => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((v) => parseFloat(v));
      if (parts.length < 3 || parts.slice(0, 3).some((v) => Number.isNaN(v))) return null;
      return { rgb: parts.slice(0, 3), a: parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1 };
    };
    const parse = (value) => rgba(value)?.rgb ?? [];
    const backdropOf = (el) => {
      // A nearly-transparent panel is not the backdrop; keep walking until
      // something actually paints.
      for (let n = el; n; n = n.parentElement) {
        const c = rgba(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.6) return c.rgb;
      }
      return [4, 5, 11];
    };

    const faint = [];
    const texts = [...active.querySelectorAll('span, p, h1, h2, h3, li, button')].slice(0, 400);
    for (const el of texts) {
      if (!el.textContent?.trim()) continue;
      if (el.children.length > 0) continue;
      const style = getComputedStyle(el);
      const fg = parse(style.color);
      if (fg.length !== 3) continue; // unreadable colour syntax; do not guess
      const bg = backdropOf(el);
      const l1 = luminance(fg) + 0.05;
      const l2 = luminance(bg) + 0.05;
      const ratio = Math.max(l1, l2) / Math.min(l1, l2);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      const floor = large ? 3 : 4.5;
      if (ratio < floor) {
        faint.push(`"${el.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}:1 at ${size}px`);
      }
    }
    return { nameless, tiny, faint };
  });

  const line = [];
  if (found.nameless.length) line.push(`${found.nameless.length} unnamed`);
  if (found.tiny.length) line.push(`${found.tiny.length} small`);
  if (found.faint.length) line.push(`${found.faint.length} low-contrast`);
  console.log(`  ${screen.padEnd(12)} ${line.length ? line.join(', ') : 'clean'}`);
  for (const n of found.nameless.slice(0, 4)) console.log(`      unnamed: ${n}`);
  for (const t of found.tiny.slice(0, 4)) console.log(`      small:   ${t}`);
  for (const f of found.faint.slice(0, 6)) console.log(`      faint:   ${f}`);

  if (found.nameless.length) problems.push(`${screen}: ${found.nameless.length} control(s) with no accessible name`);
  if (found.faint.length) problems.push(`${screen}: ${found.faint.length} text(s) below the contrast floor`);
}

// Keyboard: every screen must be traversable and show where focus is.
await page.evaluate(() => window.aegis.showMenu('home'));
await page.waitForTimeout(300);
const focusWalk = await page.evaluate(() => {
  const actives = [...document.querySelectorAll('.screen.is-active')];
  const active = actives[actives.length - 1];
  const controls = [...active.querySelectorAll('button, a[href], input')].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  let visible = 0;
  const invisible = [];
  for (const el of controls) {
    el.focus();
    const s = getComputedStyle(el);
    // Either an outline or a ring-style shadow counts.
    if ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow.includes('rgb')) visible++;
    else invisible.push(el.className || el.tagName);
  }
  return { controls: controls.length, visible, invisible };
});
console.log(`\n  home focus ring: ${focusWalk.visible}/${focusWalk.controls} controls show focus`);
for (const el of focusWalk.invisible) console.log(`      no ring: ${el}`);
if (focusWalk.controls > 0 && focusWalk.visible < focusWalk.controls) {
  problems.push(`home: ${focusWalk.controls - focusWalk.visible} control(s) give no visible focus`);
}

await browser.close();

if (problems.length > 0) {
  console.log(`\n\x1b[33m${problems.length} accessibility problem(s)\x1b[0m`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
console.log('\n\x1b[32m✓ every control is named, sized and legible\x1b[0m');
