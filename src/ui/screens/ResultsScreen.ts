/**
 * Run results.
 *
 * The most important screen for retention, so it does three jobs in order:
 *   1. tell you how you did, with the number counting up so it feels earned
 *   2. pay you, visibly, and show what the payout unlocked
 *   3. put "again" under your thumb before the adrenaline fades
 *
 * The share card lives here too — this is the moment someone wants to post.
 */

import { damp } from '../../core/math';
import { RARITY_STYLE } from '../../render/palette';
import { getGuardian } from '../../data/guardians';
import type { App, RunRewards } from '../../app/App';
import type { RunStats } from '../../game/events';
import { Screen } from '../Screen';
import { statRow, textureImg } from '../components';
import { button, clear, fmt, fmtTime, h } from '../dom';

export class ResultsScreen extends Screen {
  private scoreEl!: HTMLElement;
  private targetScore = 0;
  private shownScore = 0;
  private grid!: HTMLElement;
  private rewardsEl!: HTMLElement;
  private headline!: HTMLElement;
  private portrait!: HTMLElement;
  private shareBtn!: HTMLButtonElement;
  private stats: RunStats | null = null;
  private rewards: RunRewards | null = null;

  constructor(private readonly app: App) {
    super('results', 'screen screen--overlay results');
  }

  protected override build(): void {
    this.headline = h('div', { class: 'results__headline' });
    this.scoreEl = h('div', { class: 'results__score t-num', text: '0' });
    this.portrait = h('div', { class: 'results__portrait' });
    this.grid = h('div', { class: 'results__grid' });
    this.rewardsEl = h('div', { class: 'results__rewards panel' });

    this.shareBtn = button('SHARE', () => void this.share(), { variant: 'ghost', class: 'results__share' });

    this.root.append(
      h(
        'div',
        { class: 'results__top' },
        this.headline,
        this.scoreEl,
        h('div', { class: 'results__scorelabel t-label', text: 'Final score' }),
      ),
      h('div', { class: 'results__mid grow scroll' }, this.portrait, this.grid, this.rewardsEl),
      h(
        'div',
        { class: 'results__actions' },
        this.shareBtn,
        button('AGAIN', () => this.app.startRun(), { variant: 'primary', class: 'grow' }),
        button('HOME', () => this.app.showMenu('home'), { variant: 'ghost' }),
      ),
    );
  }

  protected override onEnter(params?: unknown): void {
    const p = params as { stats: RunStats; rewards: RunRewards } | undefined;
    if (!p) return;
    this.stats = p.stats;
    this.rewards = p.rewards;
    this.targetScore = p.stats.score;
    this.shownScore = 0;
    this.render();
  }

  private render(): void {
    const stats = this.stats;
    const rewards = this.rewards;
    if (!stats || !rewards) return;

    const g = getGuardian(stats.guardianId);
    const style = RARITY_STYLE[g.rarity];
    this.root.style.setProperty('--accent', g.hue);

    clear(this.headline);
    if (rewards.personalBest) {
      this.headline.append(h('span', { class: 'results__badge results__badge--best', text: 'NEW PERSONAL BEST' }));
    } else if (stats.wave >= 10) {
      this.headline.append(h('span', { class: 'results__badge', text: `WAVE ${stats.wave} REACHED` }));
    } else {
      this.headline.append(h('span', { class: 'results__badge', text: 'RUN COMPLETE' }));
    }

    clear(this.portrait);
    this.portrait.append(
      textureImg(`guardian/${g.id}/emblem`, 64, 'results__emblem'),
      h(
        'div',
        { class: 'results__who' },
        h('span', { class: 'results__name', text: g.name }),
        h('span', { class: 'results__rarity t-label', style: { color: style.color }, text: style.label }),
      ),
      h('div', { class: 'grow' }),
      h('div', { class: 'results__time t-num', text: fmtTime(stats.duration) }),
    );

    clear(this.grid);
    this.grid.append(
      statRow('Wave', String(stats.wave), true),
      statRow('Max combo', String(stats.maxCombo), stats.maxCombo >= 30),
      statRow('Parries', String(stats.parries)),
      statRow('Perfects', String(stats.perfects)),
      statRow('Chains', String(stats.chains)),
      statRow('Precision', `${Math.round(stats.accuracy * 100)}%`),
      statRow('Threats down', String(stats.kills)),
      statRow('Wardens', String(stats.bossKills)),
    );

    clear(this.rewardsEl);
    this.rewardsEl.append(h('span', { class: 't-label', text: 'Earned' }));
    const row = h('div', { class: 'results__rewardrow' });
    row.append(rewardChip('ui/core', rewards.cores, 'Cores'));
    if (rewards.prisms > 0) row.append(rewardChip('ui/prism', rewards.prisms, 'Prisms'));
    row.append(rewardChip('ui/shard', rewards.xp, 'XP', true));
    this.rewardsEl.append(row);

    if (rewards.levelsGained > 0) {
      this.rewardsEl.append(
        h('p', {
          class: 'results__levelup',
          text: `Account level ${this.app.profile.data.level} — rewards added to your wallet.`,
        }),
      );
    }
    if (rewards.softCapped) {
      this.rewardsEl.append(
        h('p', {
          class: 't-body results__note',
          text: 'Daily core bonus reached — further runs still earn at a reduced rate.',
        }),
      );
    }
  }

  override update(dt: number): void {
    if (this.shownScore === this.targetScore) return;
    this.shownScore = damp(this.shownScore, this.targetScore, 0.13, dt);
    if (Math.abs(this.shownScore - this.targetScore) < 1) this.shownScore = this.targetScore;
    this.scoreEl.textContent = fmt(this.shownScore);
  }

  private async share(): Promise<void> {
    if (!this.stats) return;
    this.shareBtn.disabled = true;
    try {
      const { shareRun } = await import('../../meta/share');
      await shareRun(this.app, this.stats);
    } catch (err) {
      console.warn('[Results] share failed', err);
    } finally {
      this.shareBtn.disabled = false;
    }
  }

  override onBack(): boolean {
    this.app.showMenu('home');
    return true;
  }
}

function rewardChip(texture: string, amount: number, label: string, isXp = false): HTMLElement {
  return h(
    'div',
    { class: 'rewardchip' },
    isXp ? h('span', { class: 'rewardchip__xp', text: 'XP' }) : textureImg(texture, 26),
    h('span', { class: 'rewardchip__amount t-num', text: `+${fmt(amount)}` }),
    h('span', { class: 'rewardchip__label t-label', text: label }),
  );
}
