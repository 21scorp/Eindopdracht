/**
 * Pause.
 *
 * Deliberately small and fast. A pause menu that takes a beat to appear or
 * dismiss makes the game feel heavy, so this one is a single translucent card
 * with three obvious choices and no animation longer than a frame or two.
 */

import { getGuardian } from '../../data/guardians';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { statRow } from '../components';
import { button, clear, fmt, h } from '../dom';

export class PauseScreen extends Screen {
  private body!: HTMLElement;

  constructor(private readonly app: App) {
    super('pause', 'screen screen--overlay pause');
  }

  protected override build(): void {
    this.body = h('div', { class: 'pause__stats' });

    this.root.append(
      h(
        'div',
        { class: 'pause__card panel panel--accent' },
        h('h2', { class: 'h-title', text: 'Paused' }),
        this.body,
        h(
          'div',
          { class: 'col' },
          button('RESUME', () => this.app.resume(), { variant: 'primary' }),
          button('SETTINGS', () => this.app.screens.push('settings'), { variant: 'ghost' }),
          button('END RUN', () => this.app.abandonRun(), { variant: 'ghost' }),
        ),
      ),
    );
  }

  protected override onEnter(): void {
    const s = this.app.session;
    const g = s.guardian ? getGuardian(s.guardian.id) : null;
    clear(this.body);
    this.body.append(
      statRow('Score', fmt(s.score), true),
      statRow('Wave', String(Math.max(1, s.director.wave))),
      statRow('Combo', String(s.combo)),
      statRow('Integrity', `${Math.max(0, s.integrity)} / ${s.maxIntegrity}`),
    );
    if (g) this.root.style.setProperty('--accent', g.hue);
  }

  override onBack(): boolean {
    this.app.resume();
    return true;
  }
}
