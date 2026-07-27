/**
 * Summon.
 *
 * The banner, the published rates, the pity counter, and the two buttons that
 * spend currency. Everything a player needs to make an informed decision is on
 * this screen before they spend — the pity counter is not hidden in a submenu,
 * because hiding it is the part of this genre that deserves the criticism.
 */

import { RARITY_STYLE } from '../../render/palette';
import { getGuardian } from '../../data/guardians';
import { BANNERS, DEFAULT_BANNER_ID, getBanner, type Banner } from '../../data/banners';
import { effectiveMythicRate, pullMany, pullsToHardPity } from '../../meta/gacha';
import { SummonCinematic } from '../../meta/SummonCinematic';
import { rarityRank } from '../../meta/gacha';
import { textures } from '../../render/TextureStore';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { Wallet, meter, textureImg, topBar } from '../components';
import { button, clear, fmt, h } from '../dom';
import type { PullResult } from '../../meta/gacha';

export class BannerScreen extends Screen {
  private wallet!: Wallet;
  private bannerId = DEFAULT_BANNER_ID;
  private tabs!: HTMLElement;
  private art!: HTMLElement;
  private info!: HTMLElement;
  private actions!: HTMLElement;
  private pulling = false;

  constructor(private readonly app: App) {
    super('banner', 'screen screen--solid banner');
  }

  protected override build(): void {
    this.wallet = new Wallet(this.app.profile, ['cores', 'prisms']);
    this.tabs = h('div', { class: 'banner__tabs' });
    this.art = h('div', { class: 'banner__art' });
    this.info = h('div', { class: 'banner__info' });
    this.actions = h('div', { class: 'banner__actions' });

    for (const b of BANNERS) {
      this.tabs.appendChild(
        h(
          'button',
          {
            class: 'banner__tab',
            type: 'button',
            data: { banner: b.id },
            onClick: () => {
              this.bannerId = b.id;
              this.refresh();
            },
          },
          h('span', { class: 'banner__tabname', text: b.name }),
          h('span', { class: 'banner__tabsub t-label', text: b.subtitle }),
        ),
      );
    }

    this.root.append(
      topBar({ title: 'Summon', onBack: () => this.app.screens.pop(), wallet: this.wallet }),
      this.tabs,
      h('div', { class: 'banner__body grow scroll' }, this.art, this.info),
      this.actions,
    );
  }

  protected override onEnter(): void {
    this.refresh();
  }

  private get banner(): Banner {
    return getBanner(this.bannerId);
  }

  private refresh(): void {
    const banner = this.banner;
    const profile = this.app.profile;
    this.root.style.setProperty('--accent', banner.accent);

    for (const tab of Array.from(this.tabs.children) as HTMLElement[]) {
      tab.classList.toggle('is-active', tab.dataset.banner === banner.id);
    }

    // --- hero art ---
    clear(this.art);
    const featuredId = banner.featured[0];
    if (featuredId) {
      const g = getGuardian(featuredId);
      this.art.append(
        textureImg(`guardian/${g.id}/portrait`, 340, 'banner__portrait'),
        h('div', { class: 'banner__scrim' }),
        h(
          'div',
          { class: 'banner__caption' },
          h('span', { class: 'rarity-chip', data: { rarity: g.rarity }, text: RARITY_STYLE[g.rarity].label }),
          h('h2', { class: 'h-display', text: g.name }),
          h('p', { class: 'banner__tagline', text: g.tagline }),
        ),
      );
    } else {
      this.art.append(
        h('div', { class: 'banner__generic' }, textureImg('ui/prism', 120), h('h2', { class: 'h-display', text: banner.name })),
      );
    }

    // --- info ---
    const pity = profile.pityFor(banner.id);
    const toHard = pullsToHardPity(banner, pity);
    const rate = effectiveMythicRate(banner, pity);

    clear(this.info);
    this.info.append(
      h('p', { class: 't-body banner__blurb', text: banner.blurb }),
      h(
        'div',
        { class: 'panel banner__pity' },
        h(
          'div',
          { class: 'row row--between' },
          h('span', { class: 't-label', text: 'Mythic guarantee' }),
          h('span', { class: 't-num', text: `${toHard} pull${toHard === 1 ? '' : 's'} away` }),
        ),
        meter(banner.pity.hardPity - toHard, banner.pity.hardPity),
        h('div', { class: 'divider' }),
        h(
          'div',
          { class: 'row row--between' },
          h('span', { class: 't-label', text: 'Current mythic rate' }),
          h('span', { class: 't-num t-accent', text: `${(rate * 100).toFixed(rate > 0.05 ? 1 : 2)}%` }),
        ),
        pity.guaranteedFeatured
          ? h('p', { class: 't-body banner__guarantee', text: 'Your next Mythic is guaranteed to be the featured Guardian.' })
          : null,
      ),
      h(
        'div',
        { class: 'banner__featured' },
        h('span', { class: 'h-section', text: 'Rate up' }),
        h(
          'div',
          { class: 'banner__featuredrow' },
          ...(banner.featured.length > 0
            ? banner.featured.map((id) => {
                const g = getGuardian(id);
                return h(
                  'div',
                  { class: 'featured-chip', data: { rarity: g.rarity } },
                  textureImg(`guardian/${g.id}/emblem`, 44),
                  h('span', { text: g.name }),
                );
              })
            : [h('span', { class: 't-body', text: 'No rate-up. Every Guardian at published rates.' })]),
        ),
      ),
      button('VIEW FULL RATES', () => this.app.screens.push('rates', { bannerId: banner.id }), { variant: 'ghost' }),
    );

    // --- actions ---
    const prisms = profile.balance('prisms');
    clear(this.actions);
    this.actions.append(
      button(`SUMMON x1`, () => void this.doPull(1), {
        variant: 'ghost',
        sub: `${fmt(banner.costSingle)} prisms`,
        disabled: prisms < banner.costSingle || this.pulling,
        class: 'grow',
      }),
      button(`SUMMON x10`, () => void this.doPull(10), {
        variant: 'primary',
        sub: `${fmt(banner.costTen)} prisms · epic guaranteed`,
        disabled: prisms < banner.costTen || this.pulling,
        class: 'grow',
      }),
    );
  }

  private async doPull(count: number): Promise<void> {
    if (this.pulling) return;
    const banner = this.banner;
    const profile = this.app.profile;
    const cost = count === 1 ? banner.costSingle : banner.costTen;

    if (!profile.debit('prisms', cost, `summon:${banner.id}:x${count}`)) {
      this.refresh();
      return;
    }

    this.pulling = true;
    this.refresh();

    const pity = profile.pityFor(banner.id);
    const owned = profile.ownedSet();
    const results = pullMany(banner, pity, profile.rng, owned, count);
    profile.commitGacha();

    // Grant everything now so the account is correct even if the player closes
    // the tab mid-cinematic.
    const granted = results.map((r) => {
      const outcome = profile.grant(r.guardian.id, `summon:${banner.id}`);
      profile.recordPull(r.rarity);
      return { result: r, outcome };
    });
    profile.save();

    const top = results.reduce((a, b) => (rarityRank(b.rarity) > rarityRank(a.rarity) ? b : a));
    const hasFeatured = results.some((r) => r.featured);

    this.app.screens.closeAll();
    const cinematic = new SummonCinematic(this.app.renderer, textures, this.app.particles, this.app.camera, {
      topRarity: top.rarity,
      count,
      featured: hasFeatured,
      onCharge: (progress, drama) => this.app.audio.summonCharge(progress, drama),
      onTell: (rarity) => this.app.audio.summonTell(rarity),
      onBurst: (rarity) => this.app.audio.summonBurst(rarity),
      onComplete: () => {
        this.app.endCinematic();
        this.pulling = false;
        detachSkip();
        this.app.screens.replace('pullresult', { granted, bannerId: banner.id });
      },
    });

    // Tapping anywhere skips the spectacle. Never trap a player in an animation
    // they have already seen a hundred times — the cards are the payoff, and the
    // build-up is only worth watching while it is still a surprise.
    const onSkip = (e: Event): void => {
      e.preventDefault();
      cinematic.skip();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') onSkip(e);
    };
    const detachSkip = (): void => {
      window.removeEventListener('pointerdown', onSkip);
      window.removeEventListener('keydown', onKey);
    };
    window.addEventListener('pointerdown', onSkip);
    window.addEventListener('keydown', onKey);

    this.app.playCinematic(cinematic);
  }

  override onBack(): boolean {
    if (this.pulling) return true;
    return false;
  }
}

export type GrantedPull = { result: PullResult; outcome: { duplicate: boolean; shards: number; starUp: boolean; copies: number } };
