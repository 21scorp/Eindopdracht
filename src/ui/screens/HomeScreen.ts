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
      h('div', { class: 'home__actions' }, play),
      this.nav.root,
    );
  }

  protected override onEnter(): void {
    this.refresh();
    this.nav.setActive('home');
    this.nav.refreshBadges();
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
    clear(this.statsRow);
    this.statsRow.append(
      statRow('Best score', fmtCompact(profile.data.stats.bestScore), true),
      statRow('Best wave', String(profile.data.stats.bestWave)),
      statRow('Best combo', String(profile.data.stats.bestCombo)),
      statRow('Integrity', String(stat.integrity)),
    );

    if (profile.data.daily.streak > 1) {
      this.statsRow.appendChild(statRow('Day streak', `${profile.data.daily.streak}`, true));
    }
    void fmt;
  }

  override onBack(): boolean {
    return false;
  }
}
