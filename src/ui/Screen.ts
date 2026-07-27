/**
 * Screen base class and the stack that manages them.
 *
 * Screens are DOM subtrees that live in `#ui`. Only one is "active" at a time,
 * but inactive screens stay mounted so returning to them is instant and their
 * scroll position survives — the roster is a list people flick through, and
 * losing your place in it every time is the kind of small friction that adds up.
 */

import { clear } from './dom';

export abstract class Screen {
  readonly root: HTMLElement;
  protected mounted = false;
  protected active = false;

  constructor(
    readonly name: string,
    className = 'screen screen--solid',
  ) {
    this.root = document.createElement('section');
    this.root.className = className;
    this.root.dataset.screen = name;
    this.root.setAttribute('aria-hidden', 'true');
  }

  /** Build the DOM. Called once, lazily, the first time the screen is shown. */
  protected abstract build(): void;

  /** Called every time the screen becomes visible. Refresh dynamic content here. */
  protected onEnter(_params?: unknown): void {}

  /** Called when the screen is hidden. */
  protected onExit(): void {}

  /** Called each animation frame while active, for anything that animates. */
  update(_dt: number): void {}

  /** Return true to consume a back gesture / Escape key. */
  onBack(): boolean {
    return false;
  }

  show(params?: unknown): void {
    if (!this.mounted) {
      this.build();
      this.mounted = true;
    }
    this.active = true;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.classList.add('is-active');
    this.onEnter(params);
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.classList.remove('is-active');
    this.onExit();
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Force a rebuild on next show — used when the design depends on save state. */
  invalidate(): void {
    if (!this.mounted) return;
    clear(this.root);
    this.mounted = false;
  }
}

export class ScreenStack {
  private screens = new Map<string, Screen>();
  private stack: string[] = [];

  constructor(private readonly container: HTMLElement) {}

  register(screen: Screen): void {
    this.screens.set(screen.name, screen);
    this.container.appendChild(screen.root);
  }

  get(name: string): Screen | undefined {
    return this.screens.get(name);
  }

  get current(): Screen | undefined {
    const top = this.stack[this.stack.length - 1];
    return top ? this.screens.get(top) : undefined;
  }

  get currentName(): string | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** Replace the whole stack with one screen. */
  replace(name: string, params?: unknown): void {
    for (const s of this.stack) this.screens.get(s)?.hide();
    this.stack = [];
    this.push(name, params);
  }

  /** Show a screen on top of the current one. */
  push(name: string, params?: unknown): void {
    const screen = this.screens.get(name);
    if (!screen) {
      console.warn(`[ScreenStack] unknown screen "${name}"`);
      return;
    }
    if (this.currentName === name) {
      screen.show(params);
      return;
    }
    // Keep the screen below visible when the new one is a translucent overlay.
    const translucent = screen.root.classList.contains('screen--overlay');
    if (!translucent) this.current?.hide();
    this.stack.push(name);
    screen.show(params);
  }

  pop(): void {
    const top = this.stack.pop();
    if (top) this.screens.get(top)?.hide();
    // Always re-show, even when the screen underneath stayed visible behind a
    // translucent overlay. Returning to a screen has to refresh it: claiming a
    // daily reward and closing the sheet must not leave "REWARD READY" sitting
    // on the home screen.
    this.current?.show();
  }

  /** Close every screen. Used when gameplay takes over the viewport. */
  closeAll(): void {
    for (const name of this.stack) this.screens.get(name)?.hide();
    this.stack = [];
  }

  handleBack(): boolean {
    const top = this.current;
    if (!top) return false;
    if (top.onBack()) return true;
    if (this.stack.length > 1) {
      this.pop();
      return true;
    }
    return false;
  }

  update(dt: number): void {
    for (const name of this.stack) {
      this.screens.get(name)?.update(dt);
    }
  }
}
