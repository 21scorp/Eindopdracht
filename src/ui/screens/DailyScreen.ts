/**
 * Daily reward.
 *
 * Shows the whole seven-day track, not just today's prize, so the player can
 * see what waiting is worth. One button, one claim, then it gets out of the
 * way — this screen opens itself, so it must also close itself quickly.
 */

import { DAILY_TRACK, rewardForDay, streakBonusFor } from '../../data/daily';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { textureImg } from '../components';
import { button, clear, h } from '../dom';

const CURRENCY_TEXTURE: Record<string, string> = {
  cores: 'ui/core',
  prisms: 'ui/prism',
  shards: 'ui/shard',
};

export class DailyScreen extends Screen {
  private track!: HTMLElement;
  private headline!: HTMLElement;
  private actions!: HTMLElement;

  constructor(private readonly app: App) {
    super('daily', 'screen screen--overlay daily');
  }

  protected override build(): void {
    this.headline = h('div', { class: 'daily__headline stack-center' });
    this.track = h('div', { class: 'daily__track' });
    this.actions = h('div', { class: 'daily__actions' });
    this.root.append(
      h('div', { class: 'daily__card panel panel--accent' }, this.headline, this.track, this.actions),
    );
  }

  protected override onEnter(): void {
    this.render();
  }

  private render(): void {
    const p = this.app.profile;
    const day = p.dailyDay;
    const streak = p.data.daily.streak;
    const bonus = streakBonusFor(streak + 1);

    clear(this.headline);
    this.headline.append(
      h('span', { class: 't-label', text: 'Daily signal' }),
      h('h2', { class: 'h-title', text: `DAY ${day}` }),
      streak > 0
        ? h('span', { class: 'daily__streak', text: `${streak} day streak` })
        : h('span', { class: 't-body', text: 'Come back tomorrow to start a streak.' }),
    );

    clear(this.track);
    for (const r of DAILY_TRACK) {
      const claimed = r.day < day;
      const current = r.day === day;
      const cell = h(
        'div',
        {
          class: `daily__cell${claimed ? ' is-claimed' : ''}${current ? ' is-current' : ''}${r.highlight ? ' is-highlight' : ''}`,
        },
        h('span', { class: 't-label', text: `D${r.day}` }),
        textureImg(CURRENCY_TEXTURE[r.currency] ?? 'ui/core', current ? 40 : 28),
        h('span', { class: 'daily__amount t-num', text: String(r.amount) }),
      );
      if (claimed) cell.appendChild(h('span', { class: 'daily__tick', text: '✓' }));
      this.track.appendChild(cell);
    }

    clear(this.actions);
    if (p.dailyAvailable) {
      const reward = rewardForDay(day);
      this.actions.append(
        button(`CLAIM ${reward.label}`, () => this.claim(), { variant: 'primary', class: 'grow' }),
      );
      if (bonus) {
        this.actions.append(
          h('p', { class: 't-body daily__bonus', text: `Reach a ${bonus.days} day streak for ${bonus.amount} extra ${bonus.currency}.` }),
        );
      }
    } else {
      this.actions.append(
        h('p', { class: 't-body', text: 'Collected. The next reward unlocks tomorrow.' }),
        button('CLOSE', () => this.app.screens.pop(), { variant: 'ghost', class: 'grow' }),
      );
    }
  }

  private claim(): void {
    const p = this.app.profile;
    const day = p.dailyDay;
    const reward = rewardForDay(day);
    const bonus = streakBonusFor(p.data.daily.streak + 1);
    if (!p.claimDaily(reward, bonus ?? undefined)) return;

    this.app.audio.uiConfirm();
    this.app.camera.punch(0.5);
    this.app.renderer.flash = Math.max(this.app.renderer.flash, 0.16);
    this.render();
    // Let the wallet animation land, then return to the game.
    window.setTimeout(() => {
      if (this.isActive) this.app.screens.pop();
    }, 900);
  }

  override onBack(): boolean {
    this.app.screens.pop();
    return true;
  }
}
