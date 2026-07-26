/**
 * Settings.
 *
 * Accessibility options are first, not buried at the bottom. Screen shake,
 * flashes and chromatic aberration are exactly the effects that make this game
 * feel good and exactly the effects that make some people unable to play it.
 */

import type { Quality } from '../../render/Renderer';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { sectionTitle, topBar } from '../components';
import { button, clear, h } from '../dom';

export class SettingsScreen extends Screen {
  private body!: HTMLElement;

  constructor(private readonly app: App) {
    super('settings', 'screen screen--overlay settings');
  }

  protected override build(): void {
    this.body = h('div', { class: 'settings__body grow scroll' });
    this.root.append(topBar({ title: 'Settings', onBack: () => this.app.screens.pop() }), this.body);
  }

  protected override onEnter(): void {
    this.refresh();
  }

  private refresh(): void {
    const s = this.app.profile.settings;
    clear(this.body);

    this.body.append(
      sectionTitle('Accessibility'),
      this.slider('Screen shake', s.screenShake, 0, 1, 0.1, (v) => {
        this.app.profile.updateSettings({ screenShake: v });
        this.app.syncSettings();
      }, (v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)),
      this.toggle('Reduce flashes', s.reducedFlash, (v) => {
        this.app.profile.updateSettings({ reducedFlash: v });
        this.app.syncSettings();
      }, 'Dims full-screen flashes and chromatic split on big hits.'),
      this.toggle('Left-handed HUD', s.leftHanded, (v) => this.app.profile.updateSettings({ leftHanded: v }), 'Mirrors the pulse and ultimate buttons.'),
      this.toggle('Haptics', s.haptics, (v) => this.app.profile.updateSettings({ haptics: v })),

      sectionTitle('Audio'),
      this.slider('Music', s.music, 0, 1, 0.05, (v) => this.app.profile.updateSettings({ music: v })),
      this.slider('Effects', s.sfx, 0, 1, 0.05, (v) => this.app.profile.updateSettings({ sfx: v })),

      sectionTitle('Performance'),
      this.choice<Quality | 'auto'>(
        'Graphics',
        s.quality,
        [
          { value: 'auto', label: 'Auto' },
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
        (v) => {
          this.app.profile.updateSettings({ quality: v });
          this.app.syncSettings();
          this.refresh();
        },
      ),
      this.toggle('Show FPS', s.showFps, (v) => this.app.profile.updateSettings({ showFps: v })),

      sectionTitle('Account'),
      h(
        'div',
        { class: 'settings__row' },
        h('div', { class: 'col', style: { gap: '2px' } },
          h('span', { class: 'settings__label', text: 'Save data' }),
          h('span', { class: 't-body', text: 'Copy your progress to another device.' }),
        ),
      ),
      h(
        'div',
        { class: 'row' },
        button('COPY SAVE', () => void this.copySave(), { variant: 'ghost', class: 'grow' }),
        button('RESTORE SAVE', () => void this.pasteSave(), { variant: 'ghost', class: 'grow' }),
      ),
      button('RESET EVERYTHING', () => this.confirmReset(), { variant: 'ghost', class: 'settings__danger' }),
      h('p', { class: 't-body settings__version', text: `AEGIS build ${__APP_VERSION__}` }),
    );
  }

  // ------------------------------------------------------------- controls

  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    format: (v: number) => string = (v) => `${Math.round(v * 100)}%`,
  ): HTMLElement {
    const readout = h('span', { class: 't-num settings__value', text: format(value) });
    const input = h('input', {
      type: 'range',
      class: 'slider',
      min: String(min),
      max: String(max),
      step: String(step),
      value: String(value),
      onInput: (e) => {
        const v = Number((e.target as HTMLInputElement).value);
        readout.textContent = format(v);
        onChange(v);
      },
    });
    return h(
      'div',
      { class: 'settings__row' },
      h('div', { class: 'row row--between' }, h('span', { class: 'settings__label', text: label }), readout),
      input,
    );
  }

  private toggle(label: string, value: boolean, onChange: (v: boolean) => void, hint?: string): HTMLElement {
    const knob = h('span', { class: 'switch__knob' });
    const sw = h('button', {
      class: `switch${value ? ' is-on' : ''}`,
      type: 'button',
      role: 'switch',
      aria: { checked: value, label },
      onClick: () => {
        const next = !sw.classList.contains('is-on');
        sw.classList.toggle('is-on', next);
        sw.setAttribute('aria-checked', String(next));
        onChange(next);
      },
    }, knob);

    return h(
      'div',
      { class: 'settings__row' },
      h(
        'div',
        { class: 'row row--between' },
        h('div', { class: 'col', style: { gap: '2px' } },
          h('span', { class: 'settings__label', text: label }),
          hint ? h('span', { class: 't-body', text: hint }) : null,
        ),
        sw,
      ),
    );
  }

  private choice<T extends string>(
    label: string,
    value: T,
    options: Array<{ value: T; label: string }>,
    onChange: (v: T) => void,
  ): HTMLElement {
    const group = h('div', { class: 'segmented' });
    for (const opt of options) {
      group.appendChild(
        h('button', {
          class: `segmented__btn${opt.value === value ? ' is-active' : ''}`,
          type: 'button',
          text: opt.label,
          onClick: () => onChange(opt.value),
        }),
      );
    }
    return h('div', { class: 'settings__row' }, h('span', { class: 'settings__label', text: label }), group);
  }

  // ---------------------------------------------------------------- actions

  private async copySave(): Promise<void> {
    const code = this.app.profile.exportSave();
    try {
      await navigator.clipboard.writeText(code);
      this.notify('Save code copied to clipboard.');
    } catch {
      window.prompt('Copy your save code:', code);
    }
  }

  private async pasteSave(): Promise<void> {
    const code = window.prompt('Paste a save code. This replaces your current progress.');
    if (!code) return;
    if (this.app.profile.importSave(code.trim())) {
      this.notify('Save restored.');
      this.app.syncSettings();
      this.app.showMenu('home');
    } else {
      this.notify('That code could not be read.');
    }
  }

  private confirmReset(): void {
    if (!window.confirm('Delete all progress, Guardians and currency? This cannot be undone.')) return;
    this.app.profile.resetAll();
    this.app.syncSettings();
    this.app.showMenu('home');
  }

  private notify(message: string): void {
    const el = h('div', { class: 'toast', text: message });
    this.root.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, 2200);
  }
}

declare const __APP_VERSION__: string;
