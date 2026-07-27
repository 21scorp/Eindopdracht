/**
 * Daily objectives.
 *
 * A short list with a progress bar each, and one button that takes everything
 * finished. Nothing here should require reading — a glance says how close you
 * are and whether there is anything to collect.
 */

import { DAILY_QUEST_COUNT } from '../../data/quests';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { Wallet, topBar } from '../components';
import { button, clear, fmt, h } from '../dom';

const CURRENCY_LABEL: Record<string, string> = {
  cores: 'Cores',
  prisms: 'Prisms',
  shards: 'Shards',
};

export class QuestsScreen extends Screen {
  private wallet!: Wallet;
  private list!: HTMLElement;
  private actions!: HTMLElement;

  constructor(private readonly app: App) {
    super('quests', 'screen screen--overlay quests');
  }

  protected override build(): void {
    // Two chips, not three: with three the title has to truncate on a 412px
    // phone, and a clipped screen title reads as a bug.
    this.wallet = new Wallet(this.app.profile, ['cores', 'prisms']);
    this.list = h('div', { class: 'quests__list grow scroll' });
    this.actions = h('div', { class: 'quests__actions' });
    this.root.append(
      topBar({ title: 'Objectives', onBack: () => this.app.screens.pop(), wallet: this.wallet }),
      h('p', {
        class: 't-body quests__intro',
        text: `${DAILY_QUEST_COUNT} new objectives every day. All of them are reachable in a good run — none of them ask you to grind.`,
      }),
      this.list,
      this.actions,
    );
  }

  protected override onEnter(): void {
    this.refresh();
  }

  private refresh(): void {
    const quests = this.app.quests.list();
    clear(this.list);

    for (const q of quests) {
      const pct = Math.min(1, q.progress / q.target);
      const row = h(
        'div',
        { class: `quest${q.complete ? ' is-complete' : ''}${q.claimed ? ' is-claimed' : ''}` },
        h(
          'div',
          { class: 'quest__head' },
          h('span', { class: 'quest__label', text: q.label }),
          h('span', {
            class: 'quest__reward t-num',
            text: `+${fmt(q.def.reward.amount)} ${CURRENCY_LABEL[q.def.reward.currency] ?? ''}`,
          }),
        ),
        h('div', { class: 'meter' }, h('div', { class: 'meter__fill', style: { width: `${pct * 100}%` } })),
        h(
          'div',
          { class: 'quest__foot' },
          h('span', {
            class: 't-label',
            text: q.claimed ? 'Collected' : `${fmt(q.progress)} / ${fmt(q.target)}`,
          }),
          q.complete && !q.claimed
            ? button('CLAIM', () => {
                if (this.app.quests.claim(q.def.id)) {
                  this.app.audio.uiConfirm();
                  this.refresh();
                }
              }, { variant: 'primary', class: 'quest__claim' })
            : null,
        ),
      );
      this.list.appendChild(row);
    }

    clear(this.actions);
    const claimable = quests.filter((q) => q.complete && !q.claimed).length;
    if (claimable > 1) {
      this.actions.append(
        button(`CLAIM ALL (${claimable})`, () => {
          const n = this.app.quests.claimAll();
          if (n > 0) this.app.audio.uiConfirm();
          this.refresh();
        }, { variant: 'primary', class: 'grow' }),
      );
    }
    this.actions.append(button('CLOSE', () => this.app.screens.pop(), { variant: 'ghost' }));
  }
}
