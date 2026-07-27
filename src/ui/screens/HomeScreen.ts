/**
 * Home.
 *
 * The equipped Guardian is the hero of this screen, at full portrait size. That
 * is deliberate: the thing you pulled for should be the thing you look at every
 * time you open the game, otherwise the collection has no emotional payoff
 * between runs.
 */

import { RARITY_STYLE } from '../../render/palette';
import { getGuardian, scaleStats } from '../../data/guardians';
import { dailyRunNumber } from '../../meta/dailyRun';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { NavBar, Wallet, meter, rarityChip, stars, statRow, textureImg } from '../components';
import { button, fmt, fmtCompact, h, clear } from '../dom';

export class HomeScreen extends Screen {
  private wallet!: Wallet;
  private nav!: NavBar;
  private hero!: HTMLElement;
  private statsRow!: HTMLElement;
  private levelChip!: HTMLElement;
  private dailyBtn!: HTMLElement;
  private questBtn!: HTMLElement;
  private dailyRunBtn!: HTMLElement;
  /** Only auto-open the daily reward once per session, however often we return. */
  private dailyShown = false;

  constructor(private readonly app: App) {
    super('home', 'screen screen--overlay home');
  }

  protected override build(): void {
    const profile = this.app.profile;
    // Only the two currencies you spend from this screen. Shards belong on the
    // roster, where they are actually used, and a third chip does not fit a
    // narrow phone header without shrinking everything else.
    this.wallet = new Wallet(profile, ['cores', 'prisms']);

    this.levelChip = h('button', {
      class: 'levelchip',
      type: 'button',
      onClick: () => this.app.screens.push('profile'),
      aria: { label: 'Account profile' },
    });

    const header = h(
      'header',
      { class: 'home__header' },
      this.levelChip,
      h('div', { class: 'grow' }),
      this.wallet.root,
      h('button', {
        class: 'btn btn--ghost btn--icon',
        type: 'button',
        text: '⚙',
        onClick: () => this.app.screens.push('settings'),
        aria: { label: 'Settings' },
      }),
    );

    this.hero = h('div', { class: 'home__hero' });
    this.statsRow = h('div', { class: 'home__stats' });

    const play = button('HOLD THE LINE', () => this.app.startRun(), { variant: 'hero', class: 'home__play' });

    // The shared seed, right under the ordinary run: it is a second reason to
    // start rather than a mode to go looking for.
    this.dailyRunBtn = h('button', { class: 'dailyrun', type: 'button', onClick: () => this.app.startDailyRun() });

    this.dailyBtn = h('button', {
      class: 'dailybtn',
      type: 'button',
      onClick: () => this.app.screens.push('daily'),
      aria: { label: 'Daily reward' },
    });

    this.questBtn = h('button', {
      class: 'dailybtn dailybtn--quests',
      type: 'button',
      onClick: () => this.app.screens.push('quests'),
      aria: { label: 'Daily objectives' },
    });

    this.nav = new NavBar([
      { id: 'home', label: 'Home', glyph: '◈', onSelect: () => this.app.screens.replace('home') },
      { id: 'roster', label: 'Roster', glyph: '☰', onSelect: () => this.app.screens.push('roster') },
      {
        id: 'summon',
        label: 'Summon',
        glyph: '✦',
        onSelect: () => this.app.screens.push('banner'),
        badge: () => this.app.profile.balance('prisms') >= 160,
      },
      { id: 'shop', label: 'Shop', glyph: '◇', onSelect: () => this.app.screens.push('shop') },
    ]);

    this.root.append(
      header,
      h('div', { class: 'home__body grow' }, this.hero, this.statsRow),
      h(
        'div',
        { class: 'home__actions' },
        h('div', { class: 'home__chores' }, this.dailyBtn, this.questBtn),
        play,
        this.dailyRunBtn,
      ),
      this.nav.root,
    );
  }

  protected override onEnter(): void {
    this.refresh();
    this.nav.setActive('home');
    this.nav.refreshBadges();

    // Open the daily reward on arrival, once per day. It is the one thing the
    // player should not have to go looking for.
    //
    // Except on the very first visit. Handing someone a login bonus before they
    // have played a single wave is the most free-to-play thing a game can do,
    // and it answers a question nobody asked yet. A brand-new account gets the
    // game first; the reward is still there, badged, the moment they come back
    // from their first run.
    const firstVisit = this.app.profile.data.stats.runs === 0;
    if (this.app.profile.dailyAvailable && !this.dailyShown && !firstVisit) {
      this.dailyShown = true;
      window.setTimeout(() => this.app.screens.push('daily'), 420);
    }
  }

  private refresh(): void {
    const profile = this.app.profile;
    const id = profile.equipped;
    const g = getGuardian(id);
    const owned = profile.owned(id);
    const style = RARITY_STYLE[g.rarity];
    const stat = scaleStats(g.stats, owned?.level ?? 1, owned?.stars ?? 1);

    this.root.style.setProperty('--accent', g.hue);
    this.root.style.setProperty('--rarity', style.color);

    // Level chip.
    clear(this.levelChip);
    this.levelChip.append(
      h('span', { class: 'levelchip__num t-num', text: String(profile.data.level) }),
      h(
        'span',
        { class: 'levelchip__meta' },
        h('span', { class: 't-label', text: profile.data.playerName }),
        meter(profile.data.xp, profile.xpToNext),
      ),
    );

    // Hero card.
    clear(this.hero);
    const portrait = textureImg(`guardian/${g.id}/portrait`, 320, 'hero__portrait');
    this.hero.append(
      h(
        'button',
        {
          class: 'hero__frame',
          type: 'button',
          data: { rarity: g.rarity },
          onClick: () => this.app.screens.push('roster'),
          aria: { label: `Change Guardian. Currently ${g.name}` },
        },
        portrait,
        h('div', { class: 'hero__scrim' }),
        h(
          'div',
          { class: 'hero__info' },
          h('div', { class: 'row', style: { gap: '8px' } }, rarityChip(g.rarity), stars(owned?.stars ?? 1, 5, 12)),
          h('h2', { class: 'h-display hero__name', text: g.name }),
          h('p', { class: 'hero__title', text: g.title }),
          h('p', { class: 'hero__tagline t-body', text: g.tagline }),
        ),
        h('span', { class: 'hero__swap t-label', text: 'Tap to change' }),
      ),
      h(
        'div',
        { class: 'hero__ult panel' },
        h('span', { class: 't-label', text: 'Ultimate' }),
        h('p', { class: 'hero__ulttext', text: g.ultimateText }),
      ),
    );

    // Quick stats.
    //
    // A brand-new account has nothing to put here, and four zeroes in a row is
    // the worst possible first impression: it reads as an empty save file
    // rather than as a game about to start. Until there is a run to report,
    // this space says what the game is instead of what you have not done.
    clear(this.statsRow);
    if (profile.data.stats.runs === 0) {
      this.statsRow.classList.add('home__stats--empty');
      this.statsRow.append(
        h(
          'div',
          { class: 'home__firstrun' },
          h('span', { class: 't-label', text: 'First run' }),
          h('p', {
            class: 'home__firstruntext',
            text: 'Drag to move the shield. Tap to pulse. Nothing else — everything after that is timing.',
          }),
        ),
      );
    } else {
      this.statsRow.classList.remove('home__stats--empty');
      this.statsRow.append(
        statRow('Best score', fmtCompact(profile.data.stats.bestScore), true),
        statRow('Best wave', String(profile.data.stats.bestWave)),
        statRow('Best combo', String(profile.data.stats.bestCombo)),
        statRow('Integrity', String(stat.integrity)),
      );

      if (profile.data.daily.streak > 1) {
        this.statsRow.appendChild(statRow('Day streak', `${profile.data.daily.streak}`, true));
      }
    }

    const quests = this.app.quests.list();
    const claimable = quests.filter((q) => q.complete && !q.claimed).length;
    const done = quests.filter((q) => q.complete).length;
    clear(this.questBtn);
    this.questBtn.classList.toggle('is-ready', claimable > 0);
    this.questBtn.append(
      h('span', { class: 'dailybtn__glyph', text: claimable > 0 ? '★' : '☆' }),
      h(
        'span',
        { class: 'col', style: { gap: '0' } },
        h('span', { class: 'dailybtn__title', text: claimable > 0 ? `${claimable} TO CLAIM` : 'OBJECTIVES' }),
        h('span', { class: 't-label', text: `${done} of ${quests.length} done` }),
      ),
    );

    clear(this.dailyBtn);
    const available = profile.dailyAvailable;
    this.dailyBtn.classList.toggle('is-ready', available);
    this.dailyBtn.append(
      h('span', { class: 'dailybtn__glyph', text: available ? '◆' : '◇' }),
      h(
        'span',
        { class: 'col', style: { gap: '0' } },
        // "Daily reward" and "Daily Run" are different things, and two chips
        // both starting with DAILY read as one feature shown twice.
        h('span', { class: 'dailybtn__title', text: available ? 'REWARD READY' : 'REWARD CLAIMED' }),
        h('span', { class: 't-label', text: `Day ${profile.dailyDay} of 7` }),
      ),
    );
    // --- the shared seed ---
    const run = profile.dailyRun;
    clear(this.dailyRunBtn);
    this.dailyRunBtn.classList.toggle('is-fresh', run.plays === 0);
    this.dailyRunBtn.append(
      h(
        'span',
        { class: 'col', style: { gap: '1px' } },
        h('span', { class: 'dailyrun__title', text: `DAILY RUN #${dailyRunNumber(run.date)}` }),
        h('span', {
          class: 't-label',
          text:
            run.plays === 0
              ? 'Same waves for everyone today'
              : `Your best today: ${fmt(run.best)} · wave ${run.wave}`,
        }),
      ),
      h('span', { class: 'dailyrun__go', text: run.plays === 0 ? 'PLAY' : 'AGAIN' }),
    );
  }

  override onBack(): boolean {
    return false;
  }
}
