/**
 * App icon generator.
 *
 * Renders the AEGIS mark — a shield arc around a nexus — at every size the web
 * manifest asks for, plus the favicon. Generated rather than committed as
 * binaries so the mark stays in step with the palette, and so there is no
 * "which file was the source" question later.
 *
 *   node tools/icons.mjs
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: 'icon-192.png', size: 192, safe: 1 },
  { name: 'icon-512.png', size: 512, safe: 1 },
  // Maskable icons are cropped to a circle by some launchers, so the mark is
  // drawn at 72% and the background bleeds to the edges.
  { name: 'icon-maskable-512.png', size: 512, safe: 0.72 },
  { name: 'apple-touch-icon.png', size: 180, safe: 0.86 },
  { name: 'favicon-32.png', size: 32, safe: 1 },
];

/**
 * Draws the mark into a canvas of `size`, with the art inset to `safe`.
 * Runs inside the page, so it takes a single serialisable argument.
 */
function drawIcon([size, safe]) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const TAU = Math.PI * 2;

  // Background — the same near-black the game uses, with a cool bloom.
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, '#0B1020');
  bg.addColorStop(1, '#04050B');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const R = (size / 2) * safe;

  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, 'rgba(77,225,255,0.35)');
  glow.addColorStop(1, 'rgba(77,225,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // Shield arc — the brand shape.
  ctx.lineCap = 'round';
  const arcR = R * 0.64;
  const half = 1.05;
  ctx.strokeStyle = 'rgba(77,225,255,0.22)';
  ctx.lineWidth = R * 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, -Math.PI / 2 - half, -Math.PI / 2 + half);
  ctx.stroke();

  const arcGrad = ctx.createLinearGradient(cx - arcR, cy - arcR, cx + arcR, cy);
  arcGrad.addColorStop(0, '#4DE1FF');
  arcGrad.addColorStop(0.5, '#EAFEFF');
  arcGrad.addColorStop(1, '#4DE1FF');
  ctx.strokeStyle = arcGrad;
  ctx.lineWidth = R * 0.12;
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, -Math.PI / 2 - half, -Math.PI / 2 + half);
  ctx.stroke();

  // Nexus — a hexagonal core.
  const coreR = R * 0.27;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i / 6) * TAU;
    const x = cx + Math.cos(a) * coreR;
    const y = cy + Math.sin(a) * coreR;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const core = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.4, 0, cx, cy, coreR);
  core.addColorStop(0, '#FFFFFF');
  core.addColorStop(0.5, '#B9E9FF');
  core.addColorStop(1, '#12496B');
  ctx.fillStyle = core;
  ctx.fill();
  ctx.strokeStyle = 'rgba(234,254,255,0.9)';
  ctx.lineWidth = R * 0.035;
  ctx.stroke();

  return c.toDataURL('image/png');
}

const PRESET_CHROMIUM = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch(existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {});
const page = await browser.newPage();
await page.setContent('<!doctype html><body></body>');

for (const { name, size, safe } of SIZES) {
  const dataUrl = await page.evaluate(drawIcon, [size, safe]);
  const base64 = String(dataUrl).split(',')[1];
  writeFileSync(join(OUT, name), Buffer.from(base64, 'base64'));
  console.log(`wrote icons/${name} (${size}x${size})`);
}

await browser.close();
