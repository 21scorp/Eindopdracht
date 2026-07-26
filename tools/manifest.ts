/**
 * Texture manifest CLI.
 *
 * Prints the contract in `src/render/manifest.ts`, emits it as JSON for an art
 * pipeline, or diffs it against a produced atlas so a missing frame is caught
 * before it reaches a player as a magenta checkerboard.
 *
 *   npm run atlas:manifest
 *   npm run atlas:manifest -- --json > manifest.json
 *   npm run atlas:manifest -- --check public/assets/atlas.json
 */

import { readFileSync } from 'node:fs';
import { TEXTURE_MANIFEST as ENTRIES } from '../src/render/manifest';

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const checkIndex = args.indexOf('--check');

if (args.includes('--json')) {
  console.log(JSON.stringify({ anchor: 'centre', entries: ENTRIES }, null, 2));
} else if (checkIndex >= 0) {
  const path = args[checkIndex + 1];
  if (!path) {
    console.error('--check needs a path to an atlas JSON file');
    process.exit(1);
  }
  let frames: Record<string, unknown>;
  try {
    frames = (JSON.parse(readFileSync(path, 'utf8')) as { frames: Record<string, unknown> }).frames ?? {};
  } catch (err) {
    console.error(`Could not read ${path}: ${(err as Error).message}`);
    process.exit(1);
  }
  const present = new Set(
    Object.keys(frames).map((n) => n.replace(/\.(png|webp|jpg|jpeg)$/i, '').replace(/^\/+/, '')),
  );
  const missing = ENTRIES.filter((e) => !present.has(e.key));
  const extra = [...present].filter((k) => !ENTRIES.some((e) => e.key === k));

  console.log(`${present.size} frames in atlas, ${ENTRIES.length} keys required`);
  if (missing.length) {
    console.log(`\n\x1b[33m${missing.length} missing (these fall back to procedural art):\x1b[0m`);
    for (const m of missing) console.log(`  ${m.key}`);
  }
  if (extra.length) {
    console.log(`\n\x1b[36m${extra.length} extra frames the game never asks for:\x1b[0m`);
    for (const k of extra) console.log(`  ${k}`);
  }
  if (!missing.length && !extra.length) console.log('\n\x1b[32m✓ atlas matches the manifest exactly\x1b[0m');
} else {
  const pad = (s: string, n: number): string => s.padEnd(n);
  let category = '';
  console.log(`\x1b[36mAEGIS texture manifest\x1b[0m — ${ENTRIES.length} keys, all anchored centre\n`);
  for (const e of ENTRIES) {
    if (e.category !== category) {
      category = e.category;
      console.log(`\n\x1b[1m${category.toUpperCase()}\x1b[0m`);
    }
    console.log(`  ${pad(e.key, 34)}${pad(`${e.width}x${e.height}`, 11)}${e.notes}`);
  }
  console.log('\nSee docs/SPRITES.md for the full contract.\n');
}
