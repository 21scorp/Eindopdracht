/**
 * Challenge.
 *
 * The landing screen for someone arriving from a shared link. It has one job:
 * make the target feel beatable and get them into a run in one tap. Everything
 * else — the collection, the shop, the tutorial — can wait until after they
 * have played once.
 */

import { RARITY_STYLE } from '../../render/palette';
import { getGuardian } from '../../data/guardians';
import type { Challenge } from '../../meta/challenge';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { textureImg } from '../components';
import { button, clear, fmt, h } from '../dom';

export class ChallengeScreen extends Screen {
  private card!: HTMLElement;
  private actions!: HTMLElement;
  private challenge: Challenge | null = null;

  constructor(private readonly app: App) {
    super('challenge', 'screen screen--solid challenge');
  }

  protected override build(): void {
    this.card = h('div', { class: 'challenge__card panel panel--accent' });
    this.actions = h('div', { class: 'challenge__actions' });
    this.root.append(
      h('div', { class: 'challenge__body grow' }, this.card),
      this.actions,
    );
  }

  protected override onEnter(params?: unknown): void {
    const c = (params as { challenge?: Challenge } | undefined)?.challenge ?? this.app.pendingChallenge;
    if (!c) {
      this.app.showMenu('home');
      return;
    }
    this.challenge = c;
    this.render(c);
  }

  private render(c: Challenge): void {
    const g = getGuardian(c.guardianId);
    const style = RARITY_STYLE[g.rarity];
    this.root.style.setProperty('--accent', g.hue);

    clear(this.card);
    this.card.append(
      h('span', { class: 't-label', text: 'Incoming challenge' }),
      h('h1', { class: 'h-display challenge__name', text: c.name.toUpperCase() }),
      h('p', { class: 't-body', text: 'held the line on this exact sequence of waves. Same seed, same order, same threats. Yours to beat.' }),

      h(
        'div',
        { class: 'challenge__target' },
        h('span', { class: 'challenge__score t-num', text: fmt(c.score) }),
        h('span', { class: 't-label', text: `reached wave ${c.wave}` }),
      ),

      h(
        'div',
        { class: 'challenge__guardian' },
        textureImg(`guardian/${g.id}/emblem`, 56),
        h(
          'div',
          { class: 'col', style: { gap: '2px' } },
          h('span', { class: 'challenge__gname', text: g.name }),
          h('span', { class: 't-label', style: { color: style.color }, text: style.label }),
        ),
        h('div', { class: 'grow' }),
        h('span', { class: 't-label', text: 'their pick' }),
      ),
    );

    clear(this.actions);
    this.actions.append(
      button('ACCEPT', () => this.accept(), { variant: 'hero', class: 'grow' }),
      button('SKIP', () => this.decline(), { variant: 'ghost' }),
    );
  }

  private accept(): void {
    if (!this.challenge) return;
    this.app.startChallengeRun(this.challenge);
  }

  private decline(): void {
    this.app.clearChallenge();
    this.app.showMenu('home');
  }

  override onBack(): boolean {
    this.decline();
    return true;
  }
}
