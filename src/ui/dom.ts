/**
 * A very small DOM builder.
 *
 * Menus are DOM rather than canvas — real text, real focus order, real screen
 * reader support — but they should not need a framework. `h()` covers
 * everything the UI does: create, set attributes, attach handlers, nest.
 */

export type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  /** Anything in here becomes a `data-*` attribute. */
  data?: Record<string, string | number | boolean | undefined>;
  /** Anything in here becomes an `aria-*` attribute. */
  aria?: Record<string, string | number | boolean | undefined>;
  onClick?: (e: MouseEvent) => void;
  onPointerDown?: (e: PointerEvent) => void;
  onInput?: (e: Event) => void;
  onChange?: (e: Event) => void;
  [key: string]: unknown;
}

const DIRECT_PROPS = new Set([
  'class',
  'id',
  'text',
  'html',
  'style',
  'data',
  'aria',
  'onClick',
  'onPointerDown',
  'onInput',
  'onChange',
]);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);

  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.html !== undefined) el.innerHTML = props.html;

  if (typeof props.style === 'string') el.setAttribute('style', props.style);
  else if (props.style) Object.assign(el.style, props.style);

  if (props.data) {
    for (const [k, v] of Object.entries(props.data)) {
      if (v !== undefined) el.dataset[k] = String(v);
    }
  }
  if (props.aria) {
    for (const [k, v] of Object.entries(props.aria)) {
      if (v !== undefined) el.setAttribute(`aria-${k}`, String(v));
    }
  }

  if (props.onClick) el.addEventListener('click', props.onClick as EventListener);
  if (props.onPointerDown) el.addEventListener('pointerdown', props.onPointerDown as EventListener);
  if (props.onInput) el.addEventListener('input', props.onInput as EventListener);
  if (props.onChange) el.addEventListener('change', props.onChange as EventListener);

  for (const [key, value] of Object.entries(props)) {
    if (DIRECT_PROPS.has(key) || value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) continue;
    el.setAttribute(key, String(value));
  }

  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** A button that already carries the design system's classes. */
export function button(
  label: string,
  onClick: () => void,
  opts: { variant?: 'primary' | 'ghost' | 'hero' | 'default'; sub?: string; class?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const classes = ['btn'];
  if (opts.variant === 'primary') classes.push('btn--primary');
  if (opts.variant === 'hero') classes.push('btn--primary', 'btn--hero');
  if (opts.variant === 'ghost') classes.push('btn--ghost');
  if (opts.class) classes.push(opts.class);

  const el = h(
    'button',
    {
      class: classes.join(' '),
      type: 'button',
      onClick: () => onClick(),
    },
    opts.sub ? h('span', {}, label, h('span', { class: 'btn__sub', text: opts.sub })) : label,
  );
  if (opts.disabled) el.disabled = true;
  return el;
}

/** Format a number with thin thousands separators. */
export function fmt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 12.4K / 1.2M for tight chips. */
export function fmtCompact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Wait for the next frame — lets a freshly inserted element transition in. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
