/**
 * Profile.
 *
 * Lifetime numbers and the currency ledger. The ledger exists so a player can
 * always answer "where did my prisms go" without contacting support, and so we
 * can answer it too.
 */

import type { App } from '../../app/App';
import { XP } from '../../data/balance';
import { Screen } from '../Screen';
import { meter, sectionTitle, statRow, topBar } from '../components';
import { clear, fmt, fmtTime, h } from '../dom';

export class ProfileScreen extends Screen {
  private body!: HTMLElement;

  constructor(private readonly app: App) {
    super('profile', 'screen screen--overlay profile');
  }

  protected override build(): void {
    this.body = h('div', { class: 'profile__body grow scroll' });
    this.root.append(topBar({ title: 'Profile', onBack: () => this.app.screens.pop() }), this.body);
  }

  protected override onEnter(): void {
    this.refresh();
  }

  private refresh(): void {
    const p = this.app.profile;
    const s = p.data.stats;
    clear(this.body);

    const nameInput = h('input', {
      class: 'nameinput',
      type: 'text',
      maxlength: '14',
      value: p.data.playerName,
      onChange: (e) => {
        const v = (e.target as HTMLInputElement).value.trim().slice(0, 14) || 'GUARDIAN';
        p.data.playerName = v;
        p.save();
      },
    });

    this.body.append(
      h(
        'div',
        { class: 'profile__head panel' },
        h('div', { class: 'profile__level t-num', text: String(p.data.level) }),
        h(
          'div',
          { class: 'col grow', style: { gap: '6px' } },
          nameInput,
          p.data.level >= XP.maxLevel
            ? h('span', { class: 't-label', text: 'Maximum level' })
            : meter(p.data.xp, p.xpToNext, 'Account XP'),
        ),
      ),

      sectionTitle('Records'),
      h(
        'div',
        { class: 'profile__grid' },
        statRow('Best score', fmt(s.bestScore), true),
        statRow('Best wave', String(s.bestWave)),
        statRow('Best combo', String(s.bestCombo)),
        statRow('Runs', fmt(s.runs)),
        statRow('Time played', fmtTime(s.totalPlaySeconds)),
        statRow('Threats down', fmt(s.totalKills)),
        statRow('Parries', fmt(s.totalParries)),
        statRow('Perfects', fmt(s.totalPerfects)),
        statRow('Wardens felled', fmt(s.totalBossKills)),
        statRow('Day streak', String(p.data.daily.streak)),
      ),

      sectionTitle('Summons'),
      h(
        'div',
        { class: 'profile__grid' },
        statRow('Total pulls', fmt(s.pulls)),
        statRow('Mythics', String(s.mythicsPulled)),
        statRow('Legendaries', String(s.legendariesPulled)),
        statRow('Collected', `${p.ownedIds().length}`),
      ),

      sectionTitle('Ledger'),
      this.ledger(),
    );
  }

  private ledger(): HTMLElement {
    const entries = [...this.app.profile.data.ledger].reverse().slice(0, 60);
    if (entries.length === 0) {
      return h('p', { class: 't-body', text: 'No transactions yet.' });
    }
    const list = h('div', { class: 'ledger' });
    for (const e of entries) {
      list.appendChild(
        h(
          'div',
          { class: `ledger__row${e.delta >= 0 ? ' is-credit' : ' is-debit'}` },
          h('span', { class: 'ledger__reason', text: prettyReason(e.reason) }),
          h('span', { class: 'ledger__currency t-label', text: e.currency }),
          h('span', { class: 'ledger__delta t-num', text: `${e.delta >= 0 ? '+' : ''}${fmt(e.delta)}` }),
          h('span', { class: 'ledger__balance t-num', text: fmt(e.balance) }),
        ),
      );
    }
    return list;
  }
}

function prettyReason(reason: string): string {
  const [kind, ...rest] = reason.split(':');
  const detail = rest.join(':');
  switch (kind) {
    case 'run':
      return 'Run reward';
    case 'summon':
      return `Summon ${detail.split(':')[1] ?? ''}`.trim();
    case 'duplicate':
      return `Duplicate ${detail.toUpperCase()}`;
    case 'levelup':
      return `Level up ${detail.toUpperCase()}`;
    case 'purchase':
      return `Purchase ${detail}`;
    case 'exchange':
      return 'Exchange';
    default:
      return reason;
  }
}
