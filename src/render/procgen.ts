/**
 * Procedural art.
 *
 * Every texture key the game uses is generated here as a canvas. This is real
 * shipping art, not grey boxes — soft radial falloff for anything emissive,
 * crisp geometric linework for anything solid, and a consistent light direction
 * so the whole set reads as one piece.
 *
 * When real sprites arrive they override these keys via `TextureStore.loadAtlas`
 * and this file simply stops being consulted. Keep the silhouettes here as the
 * reference the sprite artist matches: same anchor (centre), same natural size,
 * same facing (threats point along +X, i.e. to the right, before rotation).
 */

import { TAU } from '../core/math';
import { COLORS, alpha, lighten, RARITY_STYLE, type Rarity } from './palette';
import { canvasToTexture, type Texture, type TextureStore } from './TextureStore';

function canvas(size: number, height?: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height ?? size;
  const ctx = c.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  return { c, ctx };
}

/** Soft additive blob — the base ingredient of every glow in the game. */
function radialGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  innerAlpha = 1,
  falloff = 2.2,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    g.addColorStop(t, alpha(color, innerAlpha * Math.pow(1 - t, falloff)));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, TAU);
  ctx.fill();
}

/** Regular polygon path, pointing along +X when `rotation` is 0. */
function polygonPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotation = 0,
): void {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * TAU;
    const px = cx + Math.cos(a) * radius;
    const py = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
  rotation = -Math.PI / 2,
): void {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i / (points * 2)) * TAU;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Fill a shape with a top-lit vertical gradient so flat polys gain volume. */
function volumeFill(
  ctx: CanvasRenderingContext2D,
  color: string,
  top: number,
  bottom: number,
  lift = 0.42,
  shade = 0.35,
): void {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, lighten(color, lift));
  g.addColorStop(0.5, color);
  g.addColorStop(1, shadeColor(color, shade));
  ctx.fillStyle = g;
  ctx.fill();
}

function shadeColor(hex: string, amount: number): string {
  // Darken toward the scene's blue-black rather than pure black; keeps shadows cool.
  const from = hex.replace('#', '');
  const n = parseInt(from, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const t = Math.max(0, Math.min(1, amount));
  const tr = Math.round(r * (1 - t) + 8 * t);
  const tg = Math.round(g * (1 - t) + 12 * t);
  const tb = Math.round(b * (1 - t) + 26 * t);
  return `rgb(${tr},${tg},${tb})`;
}

// ---------------------------------------------------------------------------
// FX primitives
// ---------------------------------------------------------------------------

function fxSpark(color: string, size = 64): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  radialGlow(ctx, size / 2, size / 2, size / 2, color, 1, 2.6);
  radialGlow(ctx, size / 2, size / 2, size / 5, '#FFFFFF', 0.9, 1.6);
  return c;
}

function fxSoftGlow(color: string, size = 128): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  radialGlow(ctx, size / 2, size / 2, size / 2, color, 0.85, 2.9);
  return c;
}

/** A thin bright ring, used for shockwaves and pulse fronts. */
function fxRing(color: string, size = 192, thickness = 0.06): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  const w = size * thickness;
  const g = ctx.createRadialGradient(r, r, r - w * 2.4, r, r, r);
  g.addColorStop(0, alpha(color, 0));
  g.addColorStop(0.55, alpha(color, 0.28));
  g.addColorStop(0.86, alpha(lighten(color, 0.5), 1));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, TAU);
  ctx.fill();
  return c;
}

/** Four-point lens flare star — the "something great happened" mark. */
function fxStarburst(color: string, size = 256): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, r, r, r * 0.42, color, 0.85, 2.4);

  const drawSpike = (angle: number, length: number, width: number, col: string): void => {
    ctx.save();
    ctx.translate(r, r);
    ctx.rotate(angle);
    const g = ctx.createLinearGradient(0, 0, length, 0);
    g.addColorStop(0, alpha(lighten(col, 0.7), 0.95));
    g.addColorStop(0.35, alpha(col, 0.4));
    g.addColorStop(1, alpha(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -width);
    ctx.lineTo(length, 0);
    ctx.lineTo(0, width);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU;
    drawSpike(a, r * 0.98, r * 0.055, color);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4;
    drawSpike(a, r * 0.5, r * 0.03, color);
  }
  return c;
}

/** A short motion-blurred streak, aimed along +X. */
function fxStreak(color: string, w = 128, h = 32): HTMLCanvasElement {
  const { c, ctx } = canvas(w, h);
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, alpha(color, 0));
  g.addColorStop(0.55, alpha(color, 0.5));
  g.addColorStop(0.92, alpha(lighten(color, 0.65), 0.95));
  g.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.quadraticCurveTo(w * 0.5, 0, w, h / 2);
  ctx.quadraticCurveTo(w * 0.5, h, 0, h / 2);
  ctx.closePath();
  ctx.fill();
  return c;
}

/** Soft square-ish smoke puff with internal structure. */
function fxSmoke(color: string, size = 96): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  radialGlow(ctx, r, r, r, color, 0.42, 2.2);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.6;
    const d = r * 0.32;
    radialGlow(ctx, r + Math.cos(a) * d, r + Math.sin(a) * d, r * 0.5, color, 0.24, 2.4);
  }
  return c;
}

/** Hexagonal shard debris. */
function fxShard(color: string, size = 48): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  ctx.beginPath();
  ctx.moveTo(r * 0.85, 0);
  ctx.lineTo(0, r * 0.42);
  ctx.lineTo(-r * 0.7, 0);
  ctx.lineTo(0, -r * 0.42);
  ctx.closePath();
  const g = ctx.createLinearGradient(-r, -r, r, r);
  g.addColorStop(0, lighten(color, 0.55));
  g.addColorStop(1, shadeColor(color, 0.45));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha(lighten(color, 0.7), 0.85);
  ctx.lineWidth = size * 0.03;
  ctx.stroke();
  return c;
}

// ---------------------------------------------------------------------------
// Nexus (the thing you defend)
// ---------------------------------------------------------------------------

function nexusCore(size = 256): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;

  // Outer atmosphere.
  radialGlow(ctx, r, r, r * 0.96, COLORS.aegis, 0.32, 2.6);

  // Faceted shell.
  ctx.save();
  ctx.translate(r, r);
  const shell = ctx.createRadialGradient(-r * 0.22, -r * 0.28, r * 0.05, 0, 0, r * 0.62);
  shell.addColorStop(0, '#F2FEFF');
  shell.addColorStop(0.35, COLORS.nexus);
  shell.addColorStop(0.75, '#2C7FA8');
  shell.addColorStop(1, '#0A2740');
  polygonPath(ctx, 0, 0, r * 0.6, 6, Math.PI / 6);
  ctx.fillStyle = shell;
  ctx.fill();

  // Facet seams.
  ctx.strokeStyle = alpha('#DFFBFF', 0.5);
  ctx.lineWidth = size * 0.008;
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i / 6) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6);
    ctx.stroke();
  }

  // Inner hot core.
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, 0, 0, r * 0.3, '#FFFFFF', 0.95, 2);
  polygonPath(ctx, 0, 0, r * 0.2, 6, Math.PI / 6);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  // Rim light.
  polygonPath(ctx, 0, 0, r * 0.6, 6, Math.PI / 6);
  ctx.strokeStyle = alpha('#EAFEFF', 0.9);
  ctx.lineWidth = size * 0.012;
  ctx.stroke();
  ctx.restore();
  return c;
}

/** Decorative orbit ring with tick marks — sits behind the shield. */
function nexusRing(size = 512, ticks = 48): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  const radius = r * 0.9;

  ctx.strokeStyle = alpha(COLORS.aegis, 0.18);
  ctx.lineWidth = size * 0.004;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, TAU);
  ctx.stroke();

  for (let i = 0; i < ticks; i++) {
    const a = (i / ticks) * TAU;
    const major = i % 4 === 0;
    const len = major ? size * 0.028 : size * 0.014;
    ctx.strokeStyle = alpha(COLORS.aegis, major ? 0.5 : 0.22);
    ctx.lineWidth = major ? size * 0.006 : size * 0.0035;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * (radius - len), Math.sin(a) * (radius - len));
    ctx.lineTo(Math.cos(a) * radius, Math.sin(a) * radius);
    ctx.stroke();
  }
  return c;
}

// ---------------------------------------------------------------------------
// Threats — all face +X so the game can just rotate them toward the nexus
// ---------------------------------------------------------------------------

function threatOrb(size = 72): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  radialGlow(ctx, 0, 0, r * 0.95, COLORS.threat, 0.5, 2.6);
  polygonPath(ctx, 0, 0, r * 0.55, 6, 0);
  volumeFill(ctx, COLORS.threat, -r * 0.55, r * 0.55);
  ctx.strokeStyle = alpha(lighten(COLORS.threat, 0.75), 0.95);
  ctx.lineWidth = size * 0.035;
  ctx.stroke();
  polygonPath(ctx, 0, 0, r * 0.24, 6, 0);
  ctx.fillStyle = alpha('#FFE9EE', 0.95);
  ctx.fill();
  return c;
}

function threatLancer(size = 96): HTMLCanvasElement {
  const { c, ctx } = canvas(size, size * 0.62);
  const w = size;
  const h = size * 0.62;
  ctx.translate(w / 2, h / 2);
  radialGlow(ctx, 0, 0, h * 0.7, '#FF7A4D', 0.45, 2.7);
  ctx.beginPath();
  ctx.moveTo(w * 0.46, 0);
  ctx.lineTo(-w * 0.06, -h * 0.3);
  ctx.lineTo(-w * 0.3, -h * 0.12);
  ctx.lineTo(-w * 0.3, h * 0.12);
  ctx.lineTo(-w * 0.06, h * 0.3);
  ctx.closePath();
  volumeFill(ctx, '#FF7A4D', -h * 0.3, h * 0.3);
  ctx.strokeStyle = alpha('#FFD3B8', 0.9);
  ctx.lineWidth = size * 0.022;
  ctx.stroke();
  // Hot tip.
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, w * 0.4, 0, h * 0.2, '#FFF1E2', 0.9, 1.8);
  return c;
}

function threatSplitter(size = 84): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  radialGlow(ctx, 0, 0, r * 0.95, '#C86BFF', 0.45, 2.6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU - Math.PI / 2;
    const d = r * 0.28;
    ctx.save();
    ctx.translate(Math.cos(a) * d, Math.sin(a) * d);
    ctx.rotate(a);
    polygonPath(ctx, 0, 0, r * 0.3, 4, 0);
    volumeFill(ctx, '#C86BFF', -r * 0.3, r * 0.3);
    ctx.strokeStyle = alpha('#F0D9FF', 0.9);
    ctx.lineWidth = size * 0.026;
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, 0, 0, r * 0.26, '#FFFFFF', 0.8, 1.9);
  return c;
}

function threatBulwark(size = 92): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  radialGlow(ctx, 0, 0, r * 0.95, '#5C7CFF', 0.42, 2.6);
  // Body.
  polygonPath(ctx, -size * 0.04, 0, r * 0.46, 4, Math.PI / 4);
  volumeFill(ctx, '#5C7CFF', -r * 0.46, r * 0.46);
  ctx.strokeStyle = alpha('#C9D6FF', 0.9);
  ctx.lineWidth = size * 0.028;
  ctx.stroke();
  // Front armour plate — must be flanked, not parried head-on.
  ctx.beginPath();
  ctx.moveTo(r * 0.34, -r * 0.42);
  ctx.quadraticCurveTo(r * 0.72, 0, r * 0.34, r * 0.42);
  ctx.quadraticCurveTo(r * 0.46, 0, r * 0.34, -r * 0.42);
  ctx.closePath();
  ctx.fillStyle = '#DCE6FF';
  ctx.fill();
  ctx.strokeStyle = alpha('#FFFFFF', 0.95);
  ctx.lineWidth = size * 0.022;
  ctx.stroke();
  return c;
}

function threatSeeker(size = 80): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  radialGlow(ctx, 0, 0, r * 0.95, '#FFC24D', 0.48, 2.5);
  starPath(ctx, 0, 0, r * 0.58, r * 0.26, 5, 0);
  volumeFill(ctx, '#FFC24D', -r * 0.58, r * 0.58);
  ctx.strokeStyle = alpha('#FFF0C9', 0.95);
  ctx.lineWidth = size * 0.026;
  ctx.stroke();
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, 0, 0, r * 0.24, '#FFFFFF', 0.9, 1.8);
  return c;
}

function threatWarden(size = 320): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);

  radialGlow(ctx, 0, 0, r * 0.98, '#FF3D6E', 0.4, 2.8);

  // Outer petal crown.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    ctx.save();
    ctx.rotate(a);
    ctx.beginPath();
    ctx.moveTo(r * 0.5, 0);
    ctx.quadraticCurveTo(r * 0.78, -r * 0.16, r * 0.9, 0);
    ctx.quadraticCurveTo(r * 0.78, r * 0.16, r * 0.5, 0);
    ctx.closePath();
    const g = ctx.createLinearGradient(r * 0.5, 0, r * 0.9, 0);
    g.addColorStop(0, '#FF3D6E');
    g.addColorStop(1, shadeColor('#FF3D6E', 0.55));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = alpha('#FFC2D6', 0.8);
    ctx.lineWidth = size * 0.008;
    ctx.stroke();
    ctx.restore();
  }

  // Armoured body.
  polygonPath(ctx, 0, 0, r * 0.52, 8, Math.PI / 8);
  const body = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.05, 0, 0, r * 0.55);
  body.addColorStop(0, '#FFC2D6');
  body.addColorStop(0.5, '#FF3D6E');
  body.addColorStop(1, '#5C0A24');
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = alpha('#FFE0EA', 0.9);
  ctx.lineWidth = size * 0.012;
  ctx.stroke();

  // Inner iris.
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, 0, 0, r * 0.3, '#FFFFFF', 0.85, 2.1);
  polygonPath(ctx, 0, 0, r * 0.16, 8, Math.PI / 8);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  return c;
}

// ---------------------------------------------------------------------------
// Guardian portraits — geometric sigils, one per archetype
// ---------------------------------------------------------------------------

export type SigilShape = 'crest' | 'blade' | 'orbit' | 'prism' | 'fang' | 'bloom' | 'anchor' | 'eye';

/**
 * Portrait cards. Deliberately abstract: a sigil in a lit chamber, so the
 * placeholder never looks like a half-finished character drawing. Real sprite
 * portraits drop into the same 512x640 frame.
 */
function guardianPortrait(rarity: Rarity, shape: SigilShape, hue: string, w = 512, h = 640): HTMLCanvasElement {
  const { c, ctx } = canvas(w, h);
  const style = RARITY_STYLE[rarity];

  // Chamber backdrop.
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, shadeColor(hue, 0.72));
  bg.addColorStop(0.55, '#080C18');
  bg.addColorStop(1, '#05070F');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Floor light pooling under the sigil.
  const pool = ctx.createRadialGradient(w / 2, h * 0.62, 0, w / 2, h * 0.62, w * 0.72);
  pool.addColorStop(0, alpha(hue, 0.34));
  pool.addColorStop(0.5, alpha(hue, 0.1));
  pool.addColorStop(1, alpha(hue, 0));
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, w, h);

  // Faint architectural grid so the space reads as built, not empty.
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = alpha(style.accent, 0.5);
  ctx.lineWidth = 1;
  for (let i = 1; i < 12; i++) {
    const y = (i / 12) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let i = 1; i < 9; i++) {
    const x = (i / 9) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.restore();

  // Rear halo arc.
  ctx.save();
  ctx.translate(w / 2, h * 0.46);
  ctx.globalCompositeOperation = 'lighter';
  radialGlow(ctx, 0, 0, w * 0.44, hue, 0.4, 2.6);
  ctx.strokeStyle = alpha(style.accent, 0.55);
  ctx.lineWidth = w * 0.006;
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.33, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, w * 0.33, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
  ctx.restore();

  // The sigil itself.
  ctx.save();
  ctx.translate(w / 2, h * 0.46);
  const R = w * 0.26;
  ctx.globalCompositeOperation = 'lighter';
  drawSigil(ctx, shape, R, hue, style.accent);
  ctx.restore();

  // Rarity-tinted edge treatment.
  ctx.save();
  const edge = ctx.createLinearGradient(0, h, 0, h * 0.55);
  edge.addColorStop(0, alpha(style.color, 0.35));
  edge.addColorStop(1, alpha(style.color, 0));
  ctx.fillStyle = edge;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);
  ctx.restore();

  return c;
}

function drawSigil(ctx: CanvasRenderingContext2D, shape: SigilShape, R: number, hue: string, accent: string): void {
  const stroke = (width: number, color: string, a = 1): void => {
    ctx.strokeStyle = alpha(color, a);
    ctx.lineWidth = width;
    ctx.stroke();
  };

  radialGlow(ctx, 0, 0, R * 1.5, hue, 0.42, 2.4);

  switch (shape) {
    case 'crest': {
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(R * 0.82, -R * 0.35);
      ctx.lineTo(R * 0.62, R * 0.75);
      ctx.lineTo(0, R);
      ctx.lineTo(-R * 0.62, R * 0.75);
      ctx.lineTo(-R * 0.82, -R * 0.35);
      ctx.closePath();
      ctx.fillStyle = alpha(hue, 0.28);
      ctx.fill();
      stroke(R * 0.08, accent, 0.95);
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.62);
      ctx.lineTo(0, R * 0.6);
      stroke(R * 0.05, '#FFFFFF', 0.85);
      break;
    }
    case 'blade': {
      ctx.beginPath();
      ctx.moveTo(0, -R * 1.05);
      ctx.lineTo(R * 0.3, R * 0.2);
      ctx.lineTo(0, R * 0.95);
      ctx.lineTo(-R * 0.3, R * 0.2);
      ctx.closePath();
      ctx.fillStyle = alpha(hue, 0.34);
      ctx.fill();
      stroke(R * 0.07, accent, 0.95);
      ctx.beginPath();
      ctx.moveTo(-R * 0.78, R * 0.2);
      ctx.lineTo(R * 0.78, R * 0.2);
      stroke(R * 0.06, '#FFFFFF', 0.7);
      break;
    }
    case 'orbit': {
      for (let i = 0; i < 3; i++) {
        ctx.save();
        ctx.rotate((i / 3) * Math.PI);
        ctx.beginPath();
        ctx.ellipse(0, 0, R, R * 0.36, 0, 0, TAU);
        stroke(R * 0.055, i === 0 ? '#FFFFFF' : accent, 0.85);
        ctx.restore();
      }
      polygonPath(ctx, 0, 0, R * 0.26, 6, Math.PI / 6);
      ctx.fillStyle = alpha('#FFFFFF', 0.9);
      ctx.fill();
      break;
    }
    case 'prism': {
      polygonPath(ctx, 0, 0, R, 3, -Math.PI / 2);
      ctx.fillStyle = alpha(hue, 0.3);
      ctx.fill();
      stroke(R * 0.075, accent, 0.95);
      polygonPath(ctx, 0, 0, R * 0.52, 3, Math.PI / 2);
      stroke(R * 0.05, '#FFFFFF', 0.8);
      break;
    }
    case 'fang': {
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(dir * R * 0.18, -R * 0.95);
        ctx.quadraticCurveTo(dir * R * 0.95, 0, dir * R * 0.24, R * 0.95);
        ctx.quadraticCurveTo(dir * R * 0.42, 0, dir * R * 0.18, -R * 0.95);
        ctx.closePath();
        ctx.fillStyle = alpha(hue, 0.32);
        ctx.fill();
        stroke(R * 0.06, accent, 0.9);
      }
      break;
    }
    case 'bloom': {
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate((i / 6) * TAU);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(R * 0.42, -R * 0.42, 0, -R);
        ctx.quadraticCurveTo(-R * 0.42, -R * 0.42, 0, 0);
        ctx.closePath();
        ctx.fillStyle = alpha(hue, 0.26);
        ctx.fill();
        stroke(R * 0.045, accent, 0.85);
        ctx.restore();
      }
      radialGlow(ctx, 0, 0, R * 0.3, '#FFFFFF', 0.9, 1.9);
      break;
    }
    case 'anchor': {
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(0, R * 0.85);
      stroke(R * 0.09, accent, 0.95);
      ctx.beginPath();
      ctx.arc(0, R * 0.42, R * 0.62, Math.PI * 0.12, Math.PI * 0.88);
      stroke(R * 0.09, accent, 0.95);
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, -R * 0.6);
      ctx.lineTo(R * 0.5, -R * 0.6);
      stroke(R * 0.07, '#FFFFFF', 0.85);
      break;
    }
    case 'eye': {
      ctx.beginPath();
      ctx.moveTo(-R, 0);
      ctx.quadraticCurveTo(0, -R * 0.85, R, 0);
      ctx.quadraticCurveTo(0, R * 0.85, -R, 0);
      ctx.closePath();
      ctx.fillStyle = alpha(hue, 0.26);
      ctx.fill();
      stroke(R * 0.07, accent, 0.95);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.3, 0, TAU);
      ctx.fillStyle = alpha('#FFFFFF', 0.92);
      ctx.fill();
      break;
    }
  }
}

/** Small square emblem used in lists, the HUD and the share card. */
function guardianEmblem(shape: SigilShape, hue: string, rarity: Rarity, size = 192): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const style = RARITY_STYLE[rarity];
  const r = size / 2;

  const bg = ctx.createRadialGradient(r, r * 0.7, 0, r, r, r);
  bg.addColorStop(0, shadeColor(hue, 0.6));
  bg.addColorStop(1, '#05070F');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, size * 0.18);
  ctx.fill();

  ctx.save();
  ctx.translate(r, r);
  ctx.globalCompositeOperation = 'lighter';
  drawSigil(ctx, shape, size * 0.28, hue, style.accent);
  ctx.restore();

  ctx.strokeStyle = alpha(style.color, 0.85);
  ctx.lineWidth = size * 0.03;
  ctx.beginPath();
  ctx.roundRect(size * 0.015, size * 0.015, size * 0.97, size * 0.97, size * 0.17);
  ctx.stroke();
  return c;
}

// ---------------------------------------------------------------------------
// UI marks
// ---------------------------------------------------------------------------

function uiStar(color: string, size = 64): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  ctx.translate(size / 2, size / 2);
  starPath(ctx, 0, 0, size * 0.44, size * 0.19, 5);
  const g = ctx.createLinearGradient(0, -size * 0.44, 0, size * 0.44);
  g.addColorStop(0, lighten(color, 0.65));
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha(shadeColor(color, 0.4), 0.8);
  ctx.lineWidth = size * 0.035;
  ctx.stroke();
  return c;
}

/** Premium currency: a cut gem. */
function uiPrism(size = 96): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  radialGlow(ctx, 0, 0, r * 0.95, COLORS.ultimate, 0.45, 2.6);

  ctx.beginPath();
  ctx.moveTo(0, -r * 0.78);
  ctx.lineTo(r * 0.6, -r * 0.18);
  ctx.lineTo(0, r * 0.82);
  ctx.lineTo(-r * 0.6, -r * 0.18);
  ctx.closePath();
  const g = ctx.createLinearGradient(-r * 0.6, -r * 0.7, r * 0.6, r * 0.8);
  g.addColorStop(0, '#F0DBFF');
  g.addColorStop(0.45, COLORS.ultimate);
  g.addColorStop(1, '#4B1F73');
  ctx.fillStyle = g;
  ctx.fill();

  // Facets.
  ctx.strokeStyle = alpha('#FFFFFF', 0.7);
  ctx.lineWidth = size * 0.022;
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, -r * 0.18);
  ctx.lineTo(r * 0.6, -r * 0.18);
  ctx.moveTo(0, -r * 0.78);
  ctx.lineTo(0, r * 0.82);
  ctx.stroke();
  ctx.strokeStyle = alpha('#FFFFFF', 0.9);
  ctx.lineWidth = size * 0.028;
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.78);
  ctx.lineTo(r * 0.6, -r * 0.18);
  ctx.lineTo(0, r * 0.82);
  ctx.lineTo(-r * 0.6, -r * 0.18);
  ctx.closePath();
  ctx.stroke();
  return c;
}

/** Soft currency: a stamped alloy coin. */
function uiCore(size = 96): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  radialGlow(ctx, 0, 0, r * 0.9, COLORS.aegis, 0.35, 2.6);
  const g = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r * 0.72);
  g.addColorStop(0, '#E9FBFF');
  g.addColorStop(0.5, COLORS.shard);
  g.addColorStop(1, '#12496B');
  polygonPath(ctx, 0, 0, r * 0.7, 6, Math.PI / 6);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha('#EAFEFF', 0.85);
  ctx.lineWidth = size * 0.03;
  ctx.stroke();
  polygonPath(ctx, 0, 0, r * 0.32, 6, Math.PI / 6);
  ctx.strokeStyle = alpha('#FFFFFF', 0.7);
  ctx.lineWidth = size * 0.026;
  ctx.stroke();
  return c;
}

/** Shard currency: duplicate conversion material. */
function uiShard(size = 96): HTMLCanvasElement {
  const { c, ctx } = canvas(size);
  const r = size / 2;
  ctx.translate(r, r);
  radialGlow(ctx, 0, 0, r * 0.9, COLORS.heal, 0.4, 2.6);
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.8);
  ctx.lineTo(r * 0.5, 0);
  ctx.lineTo(0, r * 0.8);
  ctx.lineTo(-r * 0.5, 0);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.8);
  g.addColorStop(0, '#DCFFF0');
  g.addColorStop(0.5, COLORS.heal);
  g.addColorStop(1, '#0E5C3E');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = alpha('#E7FFF6', 0.9);
  ctx.lineWidth = size * 0.03;
  ctx.stroke();
  return c;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface GuardianArtSpec {
  id: string;
  rarity: Rarity;
  shape: SigilShape;
  hue: string;
}

/**
 * Register every built-in texture key. `guardians` comes from the roster data so
 * portraits stay in sync with the characters that actually exist.
 */
export function registerProceduralArt(store: TextureStore, guardians: readonly GuardianArtSpec[]): void {
  store.defineAll({
    // Nexus.
    'nexus/core': () => nexusCore(256),
    'nexus/ring': () => nexusRing(512),

    // Threats.
    'threat/orb': () => threatOrb(72),
    'threat/lancer': () => threatLancer(96),
    'threat/splitter': () => threatSplitter(84),
    'threat/bulwark': () => threatBulwark(92),
    'threat/seeker': () => threatSeeker(80),
    'threat/warden': () => threatWarden(320),

    // FX.
    'fx/spark': () => fxSpark('#FFFFFF', 64),
    'fx/spark-aegis': () => fxSpark(COLORS.aegis, 64),
    'fx/spark-threat': () => fxSpark(COLORS.threat, 64),
    'fx/spark-parry': () => fxSpark(COLORS.parry, 64),
    'fx/glow': () => fxSoftGlow('#FFFFFF', 128),
    'fx/glow-aegis': () => fxSoftGlow(COLORS.aegis, 128),
    'fx/glow-parry': () => fxSoftGlow(COLORS.parry, 128),
    'fx/glow-threat': () => fxSoftGlow(COLORS.threat, 128),
    'fx/glow-ultimate': () => fxSoftGlow(COLORS.ultimate, 128),
    'fx/ring': () => fxRing('#FFFFFF', 256),
    'fx/ring-aegis': () => fxRing(COLORS.aegis, 256),
    'fx/ring-parry': () => fxRing(COLORS.parry, 256),
    'fx/starburst': () => fxStarburst('#FFFFFF', 256),
    'fx/starburst-parry': () => fxStarburst(COLORS.parry, 256),
    'fx/starburst-legendary': () => fxStarburst(COLORS.legendary, 384),
    'fx/starburst-mythic': () => fxStarburst(COLORS.mythic, 384),
    'fx/streak': () => fxStreak('#FFFFFF', 128, 32),
    'fx/streak-aegis': () => fxStreak(COLORS.aegis, 128, 32),
    'fx/smoke': () => fxSmoke('#6E7BA6', 96),
    'fx/shard': () => fxShard(COLORS.aegis, 48),
    'fx/shard-threat': () => fxShard(COLORS.threat, 48),

    // UI.
    'ui/star': () => uiStar(COLORS.legendary, 64),
    'ui/star-empty': () => uiStar('#3A425A', 64),
    'ui/prism': () => uiPrism(96),
    'ui/core': () => uiCore(96),
    'ui/shard': () => uiShard(96),
  });

  for (const g of guardians) {
    store.define(`guardian/${g.id}/portrait`, () => guardianPortrait(g.rarity, g.shape, g.hue));
    store.define(`guardian/${g.id}/emblem`, () => guardianEmblem(g.shape, g.hue, g.rarity));
  }
}

/** Exposed for tests and for tooling that bakes these into a real atlas. */
export const __art = {
  canvas,
  radialGlow,
  polygonPath,
  starPath,
  guardianPortrait,
  guardianEmblem,
  nexusCore,
  threatOrb,
  canvasToTexture,
};

export type { Texture };
