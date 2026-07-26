/**
 * The game's colour system.
 *
 * One rule keeps the look expensive instead of cheap: the background is
 * near-black and *desaturated*, and every saturated colour is emissive. Nothing
 * bright is ever flat — it always carries a glow pass. Rarity colours are the
 * only place we use full-chroma hues, so a Legendary reads instantly.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Deliberately not `as const`: these are colour *values*, and narrowing them to
 * string literals would make every variable holding one incompatible with every
 * other. A plain object literal still gives us key checking via `ColorKey`.
 */
export const COLORS = {
  // Base surfaces — cool, dark, low chroma.
  void: '#04050B',
  abyss: '#070A14',
  deep: '#0B1020',
  panel: '#111729',
  panelHi: '#1A2138',
  line: '#26304C',
  lineSoft: '#1B2338',

  // Text.
  text: '#EAF0FF',
  textDim: '#93A0BE',
  textFaint: '#5C6885',

  // Brand / gameplay accents.
  aegis: '#4DE1FF', // the shield — electric cyan
  aegisDeep: '#0E7FA8',
  nexus: '#B9E9FF', // the core you defend
  threat: '#FF4D6D', // incoming hostile
  threatDeep: '#8E1030',
  parry: '#FFE66D', // the perfect-timing colour
  overdrive: '#FFB020', // combo state
  ultimate: '#C86BFF',
  heal: '#5CFFAE',
  shard: '#7FD4FF',

  // Rarity ramp.
  common: '#8A94A6',
  rare: '#3FA9FF',
  epic: '#A45CFF',
  legendary: '#FFB020',
  mythic: '#FF3D6E',
};

export type ColorKey = keyof typeof COLORS;

/** Parse `#rgb`, `#rrggbb` or `#rrggbbaa` into components. Alpha is ignored. */
export function hexToRgb(hex: string): Rgb {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const to = (v: number): string =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** `rgba()` string from a hex colour plus an alpha. The workhorse of the renderer. */
export function alpha(hex: string, a: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
}

/** Linear blend between two hex colours. */
export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const k = Math.max(0, Math.min(1, t));
  return rgbToHex({
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
  });
}

/** Push a colour toward white — used for hot cores and impact flashes. */
export function lighten(hex: string, t: number): string {
  return mix(hex, '#FFFFFF', t);
}

export function darken(hex: string, t: number): string {
  return mix(hex, '#000000', t);
}

/** HSL -> hex. Handy for prismatic/mythic shimmer where the hue animates. */
export function hsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(1, s));
  const lum = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lum - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) [r, g, b] = [c, x, 0];
  else if (hue < 120) [r, g, b] = [x, c, 0];
  else if (hue < 180) [r, g, b] = [0, c, x];
  else if (hue < 240) [r, g, b] = [0, x, c];
  else if (hue < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex({ r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 });
}

/** Rarity tiers, ordered from lowest to highest. */
export const RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythic'] as const;
export type Rarity = (typeof RARITIES)[number];

export interface RarityStyle {
  key: Rarity;
  label: string;
  /** Main colour of the tier. */
  color: string;
  /** Secondary colour for gradients and sweeps. */
  accent: string;
  /** How many stars the collection UI shows. */
  stars: number;
  /** Multiplier on the intensity of the pull cinematic. */
  drama: number;
  /** Whether the tier animates its hue (mythic only). */
  prismatic: boolean;
}

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  common: {
    key: 'common',
    label: 'Common',
    color: COLORS.common,
    accent: '#C3CBD9',
    stars: 1,
    drama: 0.15,
    prismatic: false,
  },
  rare: {
    key: 'rare',
    label: 'Rare',
    color: COLORS.rare,
    accent: '#8FD8FF',
    stars: 2,
    drama: 0.35,
    prismatic: false,
  },
  epic: {
    key: 'epic',
    label: 'Epic',
    color: COLORS.epic,
    accent: '#E0A6FF',
    stars: 3,
    drama: 0.6,
    prismatic: false,
  },
  legendary: {
    key: 'legendary',
    label: 'Legendary',
    color: COLORS.legendary,
    accent: '#FFE9A8',
    stars: 4,
    drama: 0.85,
    prismatic: false,
  },
  mythic: {
    key: 'mythic',
    label: 'Mythic',
    color: COLORS.mythic,
    accent: '#FFC2D6',
    stars: 5,
    drama: 1,
    prismatic: true,
  },
};

export function rarityIndex(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/** Mythic shimmer: a hue that sweeps as a function of time and position. */
export function prismatic(time: number, offset = 0): string {
  return hsl(time * 90 + offset * 140, 0.85, 0.62);
}
