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
 * Then it does it again under load. The menus are laid out against a fresh
 * account: a three-digit score, a short name, an empty roster. The screens that
 * actually break are the ones a good run produces — nine-figure scores,
 * four-digit combos, a hand of six Resonance cards, a ten-pull of Mythics — and
 * those screens are only reachable by playing, which is exactly why nobody
 * looks at them at 320px.
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

/**
 * Runs in the page. Reports anything in the topmost active screen that cuts off
 * its own content or hangs outside the window.
 */
function scan() {
  const actives = [...document.querySelectorAll('.screen.is-active')];
  const active = actives[actives.length - 1];
  if (!active) return { clipped: [], wide: [], spills: [], pageWide: 0 };

  const label = (el) => {
    const cls = typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName;
    const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 32);
    return text ? `${cls || el.tagName} "${text}"` : cls || el.tagName;
  };

  const clipped = [];
  const wide = [];
  const spills = [];

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
    // Purely decorative clipping: an image cropped to its frame is the point of
    // the frame. A card mid-flip is measured against a transform, not a layout.
    if (el.tagName === 'IMG' || el.tagName === 'CANVAS' || el.tagName === 'SVG' || el.tagName === 'VIDEO') continue;
    if (s.transform !== 'none' && s.transform.includes('matrix3d')) continue;
    if (!(el.textContent ?? '').trim()) continue;

    const overY = clips(s.overflowY) ? el.scrollHeight - el.clientHeight : 0;
    const overX = clips(s.overflowX) ? el.scrollWidth - el.clientWidth : 0;
    // A couple of pixels is sub-pixel rounding and a descender; four is a cut
    // line of text.
    if (overY > 3) clipped.push(`${label(el)} — ${overY}px of content cut off the bottom`);
    else if (overX > 3) clipped.push(`${label(el)} — ${overX}px cut off the right`);

    // The other way a layout fails without clipping anything: a flex child that
    // has been squeezed below its own contents, so those contents spill past it
    // and paint on top of whatever comes next. Nothing is cut off — two legible
    // things are stacked into one illegible one, which is worse. The home hero
    // card was doing precisely this to the stats row on a 568px-tall phone.
    const parent = el.parentElement;
    if (!parent || parent === active) continue;
    if (s.position !== 'static' && s.position !== 'relative') continue;
    const ps = getComputedStyle(parent);
    if (!ps.display.includes('flex') || ps.flexDirection !== 'column') continue;
    if (clips(ps.overflowY) || scrolls(ps.overflowY)) continue;
    const spill = Math.round(r.bottom - parent.getBoundingClientRect().bottom);
    if (spill > 4) spills.push(`${label(el)} hangs ${spill}px below its ${ps.display} parent`);
  }

  return {
    clipped,
    wide,
    spills,
    pageWide: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
  };
}

const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const problems = [];

/** Measure whatever is on screen right now and print a line for it. */
async function check(page, where, name) {
  const found = await page.evaluate(scan);
  const notes = [];
  if (found.clipped.length) notes.push(`${found.clipped.length} clipped`);
  if (found.spills.length) notes.push(`${found.spills.length} spilling`);
  if (found.wide.length) notes.push(`${found.wide.length} overhanging`);
  if (found.pageWide > 1) notes.push(`page ${found.pageWide}px wide`);
  console.log(`  ${name.padEnd(14)} ${notes.length ? notes.join(', ') : 'clean'}`);
  for (const c of found.clipped.slice(0, 5)) console.log(`      clip:  ${c}`);
  for (const o of found.spills.slice(0, 5)) console.log(`      spill: ${o}`);
  for (const w of found.wide.slice(0, 5)) console.log(`      wide:  ${w}`);

  if (found.clipped.length) problems.push(`${where}/${name}: ${found.clipped[0]}`);
  if (found.spills.length) problems.push(`${where}/${name}: ${found.spills[0]}`);
  if (found.pageWide > 1) problems.push(`${where}/${name}: the page scrolls sideways by ${found.pageWide}px`);
}

// --------------------------------------------------------------- menus, empty

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
    await check(page, vp.name, screen);
  }

  await context.close();
}

// ---------------------------------------------------- run outcomes, under load

const LOADED = [
  { name: 'small', width: 320, height: 568 },
  { name: 'phone', width: 412, height: 892 },
  // Held sideways: the shape with the least height, and the one a results
  // screen full of nine-figure numbers has the least room to live in.
  { name: 'landscape', width: 892, height: 412 },
];

for (const vp of LOADED) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1600);

  console.log(`\n\x1b[36m▸\x1b[0m ${vp.name} under load`);

  // A name nobody would pick and everybody eventually types, and enough
  // currency that every figure on every screen is at its widest.
  await page.evaluate(() => {
    const p = window.aegis.profile;
    p.data.playerName = 'CONSTANTINOPLE OVERDRIVE';
    p.data.stats.bestScore = 987_654_321;
    p.credit('cores', 9_999_999, 'layout-probe');
    p.credit('prisms', 999_999, 'layout-probe');
    p.credit('shards', 99_999, 'layout-probe');
    p.save();
    window.aegis.showMenu('home');
  });
  await page.waitForTimeout(500);
  await check(page, `${vp.name} loaded`, 'home');
  await page.evaluate(() => window.aegis.screens.push('shop'));
  await page.waitForTimeout(400);
  await check(page, `${vp.name} loaded`, 'shop');
  await page.evaluate(() => window.aegis.screens.push('profile'));
  await page.waitForTimeout(400);
  await check(page, `${vp.name} loaded`, 'profile');

  // The draft, mid-run.
  await page.evaluate(() => {
    window.aegis.screens.closeAll();
    window.aegis.startRun();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.aegis.session.events.emit('waveClear', { wave: 2, bonus: 0 }));
  await page.waitForTimeout(500);
  await check(page, `${vp.name} loaded`, 'resonance');
  await page.evaluate(() => document.querySelector('.rescard')?.click());
  await page.waitForTimeout(400);

  // Pause, mid-run.
  await page.evaluate(() => window.aegis.screens.push('pause'));
  await page.waitForTimeout(400);
  await check(page, `${vp.name} loaded`, 'pause');
  await page.evaluate(() => window.aegis.screens.closeAll());
  await page.waitForTimeout(300);

  // The results screen a genuinely good run produces: nine figures, a
  // four-digit combo, and a full hand of Resonance to list.
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
    s.invuln = 0;
    s.end();
  });
  await page.waitForTimeout(1400);
  await check(page, `${vp.name} loaded`, 'results');

  // Ten Mythics: the widest the reveal grid ever gets.
  await page.evaluate(() => {
    const app = window.aegis;
    const guardians = window.aegisData.GUARDIANS;
    const pick = [...guardians].sort((a, b) => b.name.length - a.name.length).slice(0, 10);
    const granted = pick.map((g) => ({
      result: { guardian: g, rarity: g.rarity, featured: true, pity: 0 },
      outcome: { duplicate: true, shards: 400, starUp: true, copies: 6 },
    }));
    app.screens.closeAll();
    app.screens.push('pullresult', { granted, bannerId: 'standard' });
  });
  // The reveal is animated; measure once every card has landed.
  await page.waitForTimeout(4000);
  await check(page, `${vp.name} loaded`, 'pullresult');

  await context.close();
}

await browser.close();

if (problems.length > 0) {
  console.log(`\n\x1b[33m${problems.length} layout problem(s)\x1b[0m`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}
console.log('\n\x1b[32m✓ nothing clips its own content, nothing overhangs the window\x1b[0m');
