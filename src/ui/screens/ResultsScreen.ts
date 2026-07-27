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
import type { App, ChallengeResult, RunRewards } from '../../app/App';
import type { QuestView } from '../../meta/quests';
import type { RunStats } from '../../game/events';
import { clipFileName, type ClipResult } from '../../meta/ClipRecorder';
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
  private challenge: ChallengeResult | null = null;
  private questsCompleted: QuestView[] = [];
  private clipBox!: HTMLElement;
  private clipUrl: string | null = null;
  /** Bumped on every entry so a slow encode cannot land on a later run. */
  private visit = 0;

  constructor(private readonly app: App) {
    super('results', 'screen screen--overlay results');
  }

  protected override build(): void {
    this.headline = h('div', { class: 'results__headline' });
    this.scoreEl = h('div', { class: 'results__score t-num', text: '0' });
    this.portrait = h('div', { class: 'results__portrait' });
    this.grid = h('div', { class: 'results__grid' });
    this.rewardsEl = h('div', { class: 'results__rewards panel' });
    this.clipBox = h('div', { class: 'results__clip', hidden: true });

    this.shareBtn = button('SHARE', () => void this.share(), { variant: 'ghost', class: 'results__share' });

    this.root.append(
      h(
        'div',
        { class: 'results__top' },
        this.headline,
        this.scoreEl,
        h('div', { class: 'results__scorelabel t-label', text: 'Final score' }),
      ),
      h('div', { class: 'results__mid grow scroll' }, this.portrait, this.clipBox, this.grid, this.rewardsEl),
      h(
        'div',
        { class: 'results__actions' },
        this.shareBtn,
        button('AGAIN', () => this.again(), { variant: 'primary', class: 'grow' }),
        button('HOME', () => this.app.showMenu('home'), { variant: 'ghost' }),
      ),
    );
  }

  protected override onEnter(params?: unknown): void {
    const p = params as
      | { stats: RunStats; rewards: RunRewards; challenge?: ChallengeResult | null; questsCompleted?: QuestView[] }
      | undefined;
    if (!p) return;
    this.stats = p.stats;
    this.rewards = p.rewards;
    this.challenge = p.challenge ?? null;
    this.questsCompleted = p.questsCompleted ?? [];
    this.targetScore = p.stats.score;
    this.shownScore = 0;
    this.visit++;
    this.render();
    void this.attachClip(this.visit);
  }

  protected override onExit(): void {
    this.releaseClip();
  }

  // ------------------------------------------------------------------- clip

  /**
   * The highlight, if the encoder produced one.
   *
   * It arrives late — the recorder is still flushing when this screen opens —
   * so the panel slides in rather than blocking the results behind a spinner.
   * The preview loops silently: watching your own last ten seconds is what makes
   * someone press share, and a card with a static thumbnail does not do that.
   */
  private async attachClip(visit: number): Promise<void> {
    this.releaseClip();
    let clip: ClipResult | null = null;
    try {
      clip = await this.app.lastClip;
    } catch (err) {
      console.warn('[Results] clip failed', err);
    }
    if (!clip || visit !== this.visit || !this.isActive) return;

    const result = clip;
    const stats = this.stats;
    if (!stats) return;

    this.clipUrl = URL.createObjectURL(result.blob);
    const video = h('video', {
      class: 'results__clipvideo',
      src: this.clipUrl,
      autoplay: true,
      loop: true,
      muted: true,
      playsinline: true,
      preload: 'auto',
    }) as HTMLVideoElement;
    video.muted = true; // the attribute alone does not stop iOS asking

    clear(this.clipBox);
    this.clipBox.append(
      video,
      h(
        'div',
        { class: 'results__clipbody' },
        h('span', { class: 't-label', text: `Highlight · ${result.seconds.toFixed(0)}s` }),
        h('p', {
          class: 'results__cliptext',
          text: result.format.social
            ? 'The last stretch of your run, with sound. Post it.'
            : 'The last stretch of your run. Your browser saves WebM — convert it to post on TikTok.',
        }),
        button('SHARE CLIP', () => void this.shareClip(result), { variant: 'primary', class: 'results__clipbtn' }),
      ),
    );
    this.clipBox.removeAttribute('hidden');
    void video.play().catch(() => {
      // Autoplay refused. The controls are the fallback, not an error.
      video.controls = true;
    });
  }

  private async shareClip(clip: ClipResult): Promise<void> {
    const stats = this.stats;
    if (!stats) return;
    const name = clipFileName(stats, clip.format.extension);
    // The same challenge link the share card carries. A clip is what gets
    // watched; the link is what turns a viewer into the next run.
    const { challengeUrl } = await import('../../meta/challenge');
    const url = challengeUrl({
      seed: stats.seed,
      score: stats.score,
      wave: stats.wave,
      name: this.app.profile.data.playerName,
      guardianId: stats.guardianId,
    });
    const text = `${fmt(stats.score)} on AEGIS — wave ${stats.wave}, ${stats.maxCombo} combo. Same waves, your turn: ${url}`;

    try {
      const file = new File([clip.blob], name, { type: clip.blob.type });
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
        await nav.share({ files: [file], text, title: 'AEGIS', url });
        this.app.audio.uiConfirm();
        return;
      }
    } catch (err) {
      // A cancelled share sheet throws AbortError; that is not a failure.
      if ((err as Error)?.name === 'AbortError') return;
      console.warn('[Results] clip share failed, falling back to download', err);
    }

    const a = h('a', { href: this.clipUrl ?? '', download: name }) as HTMLAnchorElement;
    a.click();
    this.app.audio.uiConfirm();

    // No share sheet means the caption goes nowhere, so put it somewhere: the
    // clip on its own has no link back to the game.
    let copied = false;
    try {
      await navigator.clipboard?.writeText(text);
      copied = true;
    } catch {
      // Clipboard permission refused. The file still saved, which is the point.
    }
    this.notify(copied ? 'Clip saved. The caption and link are on your clipboard.' : 'Clip saved to your downloads.');
  }

  private releaseClip(): void {
    if (this.clipUrl) {
      URL.revokeObjectURL(this.clipUrl);
      this.clipUrl = null;
    }
    clear(this.clipBox);
    this.clipBox.setAttribute('hidden', 'true');
  }

  private render(): void {
    const stats = this.stats;
    const rewards = this.rewards;
    if (!stats || !rewards) return;

    const g = getGuardian(stats.guardianId);
    const style = RARITY_STYLE[g.rarity];
    this.root.style.setProperty('--accent', g.hue);

    clear(this.headline);
    if (this.challenge) {
      // A challenge result outranks a personal best: it is the reason they are
      // here, and it is the thing they will reply to.
      const beaten = this.challenge.outcome === 'beaten';
      this.headline.append(
        h('span', {
          class: `results__badge${beaten ? ' results__badge--best' : ' results__badge--miss'}`,
          text: beaten ? `BEAT ${this.challenge.challenge.name.toUpperCase()}` : 'CHALLENGE MISSED',
        }),
        h('span', {
          class: 'results__margin t-label',
          text: beaten
            ? `by ${fmt(this.challenge.margin)}`
            : `${fmt(this.challenge.margin)} short of ${fmt(this.challenge.challenge.score)}`,
        }),
      );
    } else if (rewards.personalBest) {
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

    // Objectives finished by this run, with the claim one tap away.
    if (this.questsCompleted.length > 0) {
      const box = h('div', { class: 'results__quests panel' });
      box.append(h('span', { class: 't-label', text: 'Objective complete' }));
      for (const q of this.questsCompleted) {
        box.append(h('p', { class: 'results__quest', text: q.label }));
      }
      box.append(
        button('COLLECT', () => {
          const n = this.app.quests.claimAll();
          if (n > 0) {
            this.app.audio.uiConfirm();
            this.questsCompleted = [];
            this.render();
          }
        }, { variant: 'primary' }),
      );
      this.rewardsEl.after(box);
    }
  }

  override update(dt: number): void {
    if (this.shownScore === this.targetScore) return;
    this.shownScore = damp(this.shownScore, this.targetScore, 0.13, dt);
    if (Math.abs(this.shownScore - this.targetScore) < 1) this.shownScore = this.targetScore;
    this.scoreEl.textContent = fmt(this.shownScore);
  }

  /** Retry the same challenge if there was one, otherwise a fresh run. */
  private again(): void {
    const c = this.challenge?.challenge;
    if (c) this.app.startChallengeRun(c);
    else this.app.startRun();
  }

  private async share(): Promise<void> {
    if (!this.stats) return;
    this.shareBtn.disabled = true;
    try {
      const { shareRun } = await import('../../meta/share');
      const how = await shareRun(this.app, this.stats);
      if (how === 'clipboard') this.notify('Card and challenge link copied.');
      else if (how === 'download') this.notify('Card saved. The challenge link is on your clipboard.');
    } catch (err) {
      console.warn('[Results] share failed', err);
      this.notify('Could not build the share card.');
    } finally {
      this.shareBtn.disabled = false;
    }
  }

  private notify(message: string): void {
    const el = h('div', { class: 'toast', text: message });
    this.root.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, 2600);
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
