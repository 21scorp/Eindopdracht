/**
 * Shared UI pieces.
 *
 * Each of these renders once and exposes an `update()` so screens can refresh
 * them without rebuilding DOM — important for the wallet, which animates on
 * every currency change.
 */

import { textures } from '../render/TextureStore';
import { RARITY_STYLE, type Rarity } from '../render/palette';
import type { Guardian } from '../data/guardians';
import type { CurrencyId, Profile } from '../meta/Profile';
import { h, fmt, fmtCompact, clear } from './dom';

const CURRENCY_META: Record<CurrencyId, { texture: string; label: string; title: string }> = {
  prisms: { texture: 'ui/prism', label: 'Prisms', title: 'Prisms — used to summon Guardians' },
  cores: { texture: 'ui/core', label: 'Cores', title: 'Cores — earned from runs' },
  shards: { texture: 'ui/shard', label: 'Shards', title: 'Shards — level up Guardians' },
};

/** Render a procedural texture into an <img> so DOM and canvas share the art. */
/**
 * Data URLs, cached by texture key.
 *
 * `toDataURL` is a PNG encode on the main thread. The roster builds sixteen
 * cards at once and took 95ms to open because of it — a visible hitch every
 * time. The bytes for a given key never change (a texture is generated once and
 * an atlas frame is immutable), so encode once and hand out the same string.
 */
const dataUrls = new Map<string, string>();

function textureDataUrl(key: string): string {
  const hit = dataUrls.get(key);
  if (hit) return hit;

  const tex = textures.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(tex.sw));
  canvas.height = Math.max(1, Math.round(tex.sh));
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(tex.image, tex.sx, tex.sy, tex.sw, tex.sh, 0, 0, canvas.width, canvas.height);

  const url = canvas.toDataURL();
  dataUrls.set(key, url);
  return url;
}

export function textureImg(key: string, size: number, className = ''): HTMLImageElement {
  const img = h('img', { class: className, alt: '', width: size, height: size });
  img.src = textureDataUrl(key);
  img.style.width = `${size}px`;
  img.style.height = 'auto';
  return img;
}

export class Wallet {
  readonly root: HTMLElement;
  private chips = new Map<CurrencyId, HTMLElement>();

  constructor(
    private readonly profile: Profile,
    currencies: CurrencyId[] = ['shards', 'cores', 'prisms'],
  ) {
    this.root = h('div', { class: 'wallet' });
    for (const c of currencies) {
      const meta = CURRENCY_META[c];
      const value = h('span', { class: 'currency__value t-num', text: fmtCompact(this.profile.balance(c)) });
      const chip = h(
        'div',
        { class: 'currency', title: meta.title, data: { currency: c } },
        textureImg(meta.texture, 20, 'currency__icon'),
        value,
      );
      this.chips.set(c, chip);
      this.root.appendChild(chip);
    }

    this.profile.events.on('currency', ({ currency }) => this.bump(currency));
    this.profile.events.on('change', () => this.update());
  }

  update(): void {
    for (const [c, chip] of this.chips) {
      const value = chip.querySelector('.currency__value');
      if (value) value.textContent = fmtCompact(this.profile.balance(c));
    }
  }

  private bump(currency: CurrencyId): void {
    this.update();
    const chip = this.chips.get(currency);
    if (!chip) return;
    chip.classList.remove('currency--gain');
    void chip.offsetWidth; // restart the animation
    chip.classList.add('currency--gain');
  }
}

export function rarityChip(rarity: Rarity): HTMLElement {
  const style = RARITY_STYLE[rarity];
  return h('span', { class: 'rarity-chip', data: { rarity } }, style.label);
}

export function stars(count: number, max = 5, size = 13): HTMLElement {
  const row = h('div', { class: 'stars', aria: { label: `${count} of ${max} stars` } });
  for (let i = 0; i < max; i++) {
    row.appendChild(textureImg(i < count ? 'ui/star' : 'ui/star-empty', size, 'stars__star'));
  }
  return row;
}

export interface GuardianCardOptions {
  level?: number;
  starCount?: number;
  owned?: boolean;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
  badge?: string;
}

/** The roster tile. Portrait, rarity edge, name, stars. */
export function guardianCard(g: Guardian, opts: GuardianCardOptions = {}): HTMLElement {
  const style = RARITY_STYLE[g.rarity];
  const card = h('button', {
    class: `gcard${opts.compact ? ' gcard--compact' : ''}${opts.selected ? ' is-selected' : ''}${opts.owned === false ? ' is-locked' : ''}`,
    type: 'button',
    data: { rarity: g.rarity, guardian: g.id },
    style: { '--rarity': style.color } as unknown as Partial<CSSStyleDeclaration>,
    onClick: opts.onClick,
    aria: { label: `${g.name}, ${style.label}` },
  });

  const art = h('div', { class: 'gcard__art' }, textureImg(`guardian/${g.id}/emblem`, 96, 'gcard__emblem'));
  card.appendChild(art);

  const body = h(
    'div',
    { class: 'gcard__body' },
    h('div', { class: 'gcard__name', text: g.name }),
    opts.compact ? null : h('div', { class: 'gcard__title', text: g.title }),
  );
  card.appendChild(body);

  const foot = h('div', { class: 'gcard__foot' });
  foot.appendChild(stars(opts.starCount ?? 1, style.stars === 5 ? 5 : 5, opts.compact ? 9 : 11));
  if (opts.level !== undefined) {
    foot.appendChild(h('span', { class: 'gcard__level t-num', text: `LV${opts.level}` }));
  }
  card.appendChild(foot);

  if (opts.badge) card.appendChild(h('span', { class: 'gcard__badge', text: opts.badge }));
  if (opts.owned === false) card.appendChild(h('span', { class: 'gcard__lock', text: 'NOT OWNED' }));

  return card;
}

/** A labelled statistic, used all over the results and detail screens. */
export function statRow(label: string, value: string, accent = false): HTMLElement {
  return h(
    'div',
    { class: `stat${accent ? ' stat--accent' : ''}` },
    h('span', { class: 'stat__label t-label', text: label }),
    h('span', { class: 'stat__value t-num', text: value }),
  );
}

export function sectionTitle(text: string, right?: Node): HTMLElement {
  return h(
    'div',
    { class: 'section-title' },
    h('h2', { class: 'h-section', text }),
    right ?? null,
  );
}

/** Top bar with a back button, a title and the wallet. */
export function topBar(opts: { title?: string; onBack?: () => void; wallet?: Wallet; right?: Node }): HTMLElement {
  const bar = h('header', { class: 'topbar' });
  if (opts.onBack) {
    bar.appendChild(
      h('button', { class: 'btn btn--ghost btn--icon topbar__back', type: 'button', onClick: opts.onBack, aria: { label: 'Back' } }, '‹'),
    );
  }
  if (opts.title) bar.appendChild(h('h1', { class: 'h-title topbar__title', text: opts.title }));
  bar.appendChild(h('div', { class: 'grow' }));
  if (opts.right) bar.appendChild(opts.right);
  if (opts.wallet) bar.appendChild(opts.wallet.root);
  return bar;
}

export interface NavItem {
  id: string;
  label: string;
  glyph: string;
  onSelect: () => void;
  badge?: () => boolean;
}

export class NavBar {
  readonly root: HTMLElement;
  private buttons = new Map<string, HTMLElement>();

  constructor(private readonly items: NavItem[]) {
    this.root = h('nav', { class: 'navbar', aria: { label: 'Main navigation' } });
    for (const item of items) {
      const btn = h(
        'button',
        {
          class: 'navbtn',
          type: 'button',
          data: { nav: item.id },
          onClick: () => item.onSelect(),
        },
        h('span', { class: 'navbtn__glyph', text: item.glyph }),
        h('span', { class: 'navbtn__label', text: item.label }),
      );
      this.buttons.set(item.id, btn);
      this.root.appendChild(btn);
    }
  }

  setActive(id: string): void {
    for (const [key, btn] of this.buttons) btn.classList.toggle('is-active', key === id);
  }

  refreshBadges(): void {
    for (const item of this.items) {
      const btn = this.buttons.get(item.id);
      if (!btn) continue;
      const show = item.badge?.() ?? false;
      btn.classList.toggle('has-badge', show);
    }
  }
}

/** A progress meter with a label, used for XP and pity. */
export function meter(value: number, max: number, label?: string): HTMLElement {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(1, value / max));
  const bar = h('div', { class: 'meter' }, h('div', { class: 'meter__fill', style: { width: `${pct * 100}%` } }));
  if (!label) return bar;
  return h(
    'div',
    { class: 'meter-row' },
    h('div', { class: 'row row--between' }, h('span', { class: 't-label', text: label }), h('span', { class: 't-label t-num', text: `${fmt(value)} / ${fmt(max)}` })),
    bar,
  );
}

/** Replace a container's children in one shot. */
export function fill(container: Element, children: Array<Node | null>): void {
  clear(container);
  for (const c of children) if (c) container.appendChild(c);
}
