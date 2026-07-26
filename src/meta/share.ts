/**
 * The share card.
 *
 * A run only spreads if the artefact you can post looks better than a
 * screenshot of a phone screen. So we render a purpose-built 1080x1350 card
 * (Instagram's portrait ratio, which also crops cleanly to a TikTok frame),
 * with the score as the hero and the Guardian portrait as the backdrop.
 *
 * Delivery order: Web Share with a file (native sheet on mobile) -> clipboard
 * image -> download. Each fallback is silent so the button always does
 * *something*.
 */

import { TAU } from '../core/math';
import { RARITY_STYLE } from '../render/palette';
import { textures } from '../render/TextureStore';
import { getGuardian } from '../data/guardians';
import type { RunStats } from '../game/events';
import type { App } from '../app/App';

const CARD_W = 1080;
const CARD_H = 1350;

export interface ShareCardOptions {
  stats: RunStats;
  playerName: string;
  bestScore: number;
  /** Shown at the bottom so a viewer knows where to go. */
  callToAction?: string;
}

export function renderShareCard(opts: ShareCardOptions): HTMLCanvasElement {
  const { stats } = opts;
  const g = getGuardian(stats.guardianId);
  const style = RARITY_STYLE[g.rarity];

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d')!;

  // --- background -----------------------------------------------------------
  const bg = ctx.createLinearGradient(0, 0, 0, CARD_H);
  bg.addColorStop(0, '#080C18');
  bg.addColorStop(0.55, '#05070F');
  bg.addColorStop(1, '#04050B');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Portrait, blurred and dimmed, filling the upper two-thirds.
  const portrait = textures.get(`guardian/${g.id}/portrait`);
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.filter = 'blur(2px)';
  const pw = CARD_W * 1.08;
  const ph = (pw * portrait.sh) / portrait.sw;
  ctx.drawImage(portrait.image, portrait.sx, portrait.sy, portrait.sw, portrait.sh, (CARD_W - pw) / 2, -ph * 0.06, pw, ph);
  ctx.filter = 'none';
  ctx.restore();

  // Scrim so type stays readable over any art.
  const scrim = ctx.createLinearGradient(0, CARD_H * 0.18, 0, CARD_H);
  scrim.addColorStop(0, 'rgba(4,5,11,0)');
  scrim.addColorStop(0.42, 'rgba(4,5,11,0.72)');
  scrim.addColorStop(1, 'rgba(4,5,11,0.98)');
  ctx.fillStyle = scrim;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // Accent bloom behind the score.
  const bloom = ctx.createRadialGradient(CARD_W / 2, CARD_H * 0.6, 0, CARD_W / 2, CARD_H * 0.6, CARD_W * 0.8);
  bloom.addColorStop(0, hexA(g.hue, 0.22));
  bloom.addColorStop(1, hexA(g.hue, 0));
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // --- frame ----------------------------------------------------------------
  ctx.strokeStyle = hexA(style.color, 0.55);
  ctx.lineWidth = 3;
  roundRectPath(ctx, 28, 28, CARD_W - 56, CARD_H - 56, 34);
  ctx.stroke();
  ctx.strokeStyle = hexA('#FFFFFF', 0.08);
  ctx.lineWidth = 1;
  roundRectPath(ctx, 40, 40, CARD_W - 80, CARD_H - 80, 26);
  ctx.stroke();

  // Corner ticks — cheap, and they make the frame feel designed.
  ctx.strokeStyle = hexA(style.color, 0.9);
  ctx.lineWidth = 5;
  const tick = 46;
  for (const [cx, cy, sx, sy] of [
    [56, 56, 1, 1],
    [CARD_W - 56, 56, -1, 1],
    [56, CARD_H - 56, 1, -1],
    [CARD_W - 56, CARD_H - 56, -1, -1],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + sx * tick, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx, cy + sy * tick);
    ctx.stroke();
  }

  // --- header ---------------------------------------------------------------
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.font = `700 34px ${FONT}`;
  ctx.letterSpacing = '18px';
  ctx.fillStyle = hexA('#EAF0FF', 0.9);
  ctx.fillText('A E G I S', CARD_W / 2, 132);

  ctx.font = `600 22px ${FONT}`;
  ctx.letterSpacing = '9px';
  ctx.fillStyle = hexA(g.hue, 0.95);
  ctx.fillText('HOLD THE LINE', CARD_W / 2, 176);
  ctx.letterSpacing = '0px';

  // --- score ----------------------------------------------------------------
  const scoreText = stats.score.toLocaleString('en-US');
  const scoreSize = scoreText.length > 8 ? 150 : scoreText.length > 6 ? 178 : 204;
  ctx.font = `700 ${scoreSize}px ${FONT}`;
  const scoreY = CARD_H * 0.545;

  ctx.save();
  ctx.shadowColor = hexA(g.hue, 0.75);
  ctx.shadowBlur = 60;
  const sg = ctx.createLinearGradient(0, scoreY - scoreSize, 0, scoreY + scoreSize * 0.18);
  sg.addColorStop(0, '#FFFFFF');
  sg.addColorStop(1, g.hue);
  ctx.fillStyle = sg;
  ctx.fillText(scoreText, CARD_W / 2, scoreY);
  ctx.restore();

  ctx.font = `600 26px ${FONT}`;
  ctx.letterSpacing = '12px';
  ctx.fillStyle = hexA('#93A0BE', 1);
  ctx.fillText('FINAL SCORE', CARD_W / 2, scoreY + 54);
  ctx.letterSpacing = '0px';

  // --- stat strip -----------------------------------------------------------
  const strip = [
    { label: 'WAVE', value: String(stats.wave) },
    { label: 'COMBO', value: String(stats.maxCombo) },
    { label: 'PARRIES', value: String(stats.parries) },
    { label: 'PRECISION', value: `${Math.round(stats.accuracy * 100)}%` },
  ];
  const stripY = scoreY + 148;
  const cellW = (CARD_W - 200) / strip.length;
  strip.forEach((s, i) => {
    const x = 100 + cellW * (i + 0.5);
    ctx.font = `700 62px ${FONT}`;
    ctx.fillStyle = '#EAF0FF';
    ctx.fillText(s.value, x, stripY);
    ctx.font = `600 19px ${FONT}`;
    ctx.letterSpacing = '5px';
    ctx.fillStyle = hexA('#5C6885', 1);
    ctx.fillText(s.label, x, stripY + 34);
    ctx.letterSpacing = '0px';
    if (i < strip.length - 1) {
      ctx.strokeStyle = hexA('#26304C', 0.9);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(100 + cellW * (i + 1), stripY - 48);
      ctx.lineTo(100 + cellW * (i + 1), stripY + 34);
      ctx.stroke();
    }
  });

  // --- guardian badge -------------------------------------------------------
  const badgeY = CARD_H - 258;
  const emblem = textures.get(`guardian/${g.id}/emblem`);
  const es = 108;
  ctx.save();
  ctx.shadowColor = hexA(style.color, 0.6);
  ctx.shadowBlur = 34;
  ctx.drawImage(emblem.image, emblem.sx, emblem.sy, emblem.sw, emblem.sh, CARD_W / 2 - es / 2, badgeY - es / 2, es, es);
  ctx.restore();

  ctx.font = `700 46px ${FONT}`;
  ctx.letterSpacing = '6px';
  ctx.fillStyle = '#EAF0FF';
  ctx.fillText(g.name, CARD_W / 2, badgeY + 108);
  ctx.font = `600 20px ${FONT}`;
  ctx.letterSpacing = '7px';
  ctx.fillStyle = style.color;
  ctx.fillText(style.label.toUpperCase(), CARD_W / 2, badgeY + 142);
  ctx.letterSpacing = '0px';

  // Rarity stars.
  const starY = badgeY + 172;
  const starTex = textures.get('ui/star');
  const ss = 26;
  const total = style.stars;
  for (let i = 0; i < total; i++) {
    const x = CARD_W / 2 + (i - (total - 1) / 2) * (ss + 8);
    ctx.drawImage(starTex.image, starTex.sx, starTex.sy, starTex.sw, starTex.sh, x - ss / 2, starY - ss / 2, ss, ss);
  }

  // --- footer ---------------------------------------------------------------
  ctx.font = `600 22px ${FONT}`;
  ctx.letterSpacing = '5px';
  ctx.fillStyle = hexA('#93A0BE', 0.95);
  const cta = opts.callToAction ?? 'BEAT THIS';
  ctx.fillText(`${opts.playerName.toUpperCase()}   ·   ${cta}`, CARD_W / 2, CARD_H - 78);
  ctx.letterSpacing = '0px';

  // Personal-best flourish.
  if (stats.score >= opts.bestScore && stats.score > 0) {
    drawRibbon(ctx, CARD_W / 2, 236, 'PERSONAL BEST', style.color);
  }

  return canvas;
}

function drawRibbon(ctx: CanvasRenderingContext2D, cx: number, cy: number, text: string, color: string): void {
  ctx.save();
  ctx.font = `700 24px ${FONT}`;
  ctx.letterSpacing = '8px';
  const w = ctx.measureText(text).width + 64;
  const h = 52;
  ctx.fillStyle = hexA(color, 0.18);
  ctx.strokeStyle = hexA(color, 0.85);
  ctx.lineWidth = 2;
  roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 1);
  ctx.restore();
}

/** Deliver the card through whichever channel this browser supports. */
export async function shareRun(app: App, stats: RunStats): Promise<'share' | 'clipboard' | 'download'> {
  const canvas = renderShareCard({
    stats,
    playerName: app.profile.data.playerName,
    bestScore: app.profile.data.stats.bestScore,
  });

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not encode the share card');

  const file = new File([blob], `aegis-${stats.score}.png`, { type: 'image/png' });
  const text = `${stats.score.toLocaleString('en-US')} on AEGIS — wave ${stats.wave}, ${stats.maxCombo} combo. Beat it.`;

  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'AEGIS', text });
      return 'share';
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return 'share';
    }
  }

  if (navigator.clipboard && 'ClipboardItem' in window) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'clipboard';
    } catch {
      // fall through to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'download';
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function hexA(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]! : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const FONT = "'Chakra Petch', 'Rajdhani', system-ui, sans-serif";

export { TAU };
