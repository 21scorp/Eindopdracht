/**
 * Roster.
 *
 * The collection, and the place you choose who to take into a run. Unowned
 * Guardians are shown too, silhouetted — a collection screen that hides what
 * you are missing removes the reason to keep pulling.
 */

import { RARITY_STYLE, RARITIES, type Rarity } from '../../render/palette';
import { GUARDIANS, MAX_LEVEL, MAX_STARS, getGuardian, perfectTolerance, scaleStats } from '../../data/guardians';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { Wallet, guardianCard, meter, rarityChip, stars, statRow, textureImg, topBar } from '../components';
import { button, clear, fmt, h } from '../dom';

type SortMode = 'rarity' | 'level' | 'name' | 'recent';

export class RosterScreen extends Screen {
  private wallet!: Wallet;
  private grid!: HTMLElement;
  private detail!: HTMLElement;
  private filters!: HTMLElement;
  private summary!: HTMLElement;
  private selected: string | null = null;
  private sort: SortMode = 'rarity';
  private showUnowned = true;

  constructor(private readonly app: App) {
    super('roster', 'screen screen--solid roster');
  }

  protected override build(): void {
    this.wallet = new Wallet(this.app.profile, ['shards']);
    this.grid = h('div', { class: 'roster__grid' });
    this.detail = h('aside', { class: 'roster__detail panel' });
    this.filters = h('div', { class: 'roster__filters' });
    this.summary = h('div', { class: 'roster__summary' });

    const sorts: Array<{ id: SortMode; label: string }> = [
      { id: 'rarity', label: 'Rarity' },
      { id: 'level', label: 'Level' },
      { id: 'recent', label: 'Newest' },
      { id: 'name', label: 'A-Z' },
    ];
    for (const s of sorts) {
      this.filters.appendChild(
        h('button', {
          class: 'chipbtn',
          type: 'button',
          text: s.label,
          data: { sort: s.id },
          onClick: () => {
            this.sort = s.id;
            this.refresh();
          },
        }),
      );
    }

    this.root.append(
      topBar({ title: 'Roster', onBack: () => this.app.screens.pop(), wallet: this.wallet }),
      this.summary,
      this.filters,
      h('div', { class: 'roster__body grow' }, h('div', { class: 'roster__scroll scroll' }, this.grid), this.detail),
    );
  }

  protected override onEnter(): void {
    this.selected ??= this.app.profile.equipped;
    this.refresh();
  }

  private refresh(): void {
    const profile = this.app.profile;

    for (const el of Array.from(this.filters.children) as HTMLElement[]) {
      if (el.dataset.sort) el.classList.toggle('is-active', el.dataset.sort === this.sort);
    }

    // Collection summary.
    const ownedCount = profile.ownedIds().length;
    clear(this.summary);
    this.summary.append(
      h(
        'div',
        { class: 'roster__count' },
        h('span', { class: 't-num roster__countnum', text: `${ownedCount}` }),
        h('span', { class: 't-label', text: `of ${GUARDIANS.length} collected` }),
      ),
      h('div', { class: 'roster__bars' }, ...RARITIES.map((r) => this.rarityBar(r))),
      // The "show what I do not have" toggle belongs next to the collection
      // count, not at the end of a scrolling row of *sort* options where it was
      // both semantically out of place and usually off the edge of a phone.
      h('button', {
        // No active state: the label already says which way it goes, and a
        // solid fill on a secondary control shouts over the collection meter.
        class: 'chipbtn roster__missing',
        type: 'button',
        text: this.showUnowned ? `Hide the ${GUARDIANS.length - ownedCount} missing` : `Show the ${GUARDIANS.length - ownedCount} missing`,
        onClick: () => {
          this.showUnowned = !this.showUnowned;
          this.refresh();
        },
      }),
    );

    // Cards.
    const list = this.sortedGuardians();
    clear(this.grid);
    for (const g of list) {
      const owned = profile.owned(g.id);
      if (!owned && !this.showUnowned) continue;
      this.grid.appendChild(
        guardianCard(g, {
          level: owned?.level,
          starCount: owned?.stars ?? 0,
          owned: !!owned,
          selected: this.selected === g.id,
          compact: true,
          badge: profile.equipped === g.id ? 'EQUIPPED' : undefined,
          onClick: () => {
            this.selected = g.id;
            this.refresh();
          },
        }),
      );
    }

    this.renderDetail();
  }

  private rarityBar(rarity: Rarity): HTMLElement {
    const style = RARITY_STYLE[rarity];
    const total = GUARDIANS.filter((g) => g.rarity === rarity).length;
    const owned = GUARDIANS.filter((g) => g.rarity === rarity && this.app.profile.owns(g.id)).length;
    return h(
      'div',
      { class: 'roster__bar', data: { rarity }, title: `${style.label}: ${owned}/${total}` },
      h('span', { class: 'roster__barlabel', text: style.label[0]! }),
      h(
        'div',
        { class: 'meter' },
        h('div', {
          class: 'meter__fill',
          style: { width: `${total ? (owned / total) * 100 : 0}%`, background: style.color },
        }),
      ),
      h('span', { class: 'roster__barcount t-num', text: `${owned}/${total}` }),
    );
  }

  private sortedGuardians(): typeof GUARDIANS {
    const profile = this.app.profile;
    const list = [...GUARDIANS];
    const rank = (r: Rarity): number => RARITIES.indexOf(r);
    switch (this.sort) {
      case 'rarity':
        list.sort((a, b) => rank(b.rarity) - rank(a.rarity) || a.name.localeCompare(b.name));
        break;
      case 'level':
        list.sort((a, b) => (profile.owned(b.id)?.level ?? 0) - (profile.owned(a.id)?.level ?? 0));
        break;
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'recent':
        list.sort((a, b) => (profile.owned(b.id)?.obtainedAt ?? 0) - (profile.owned(a.id)?.obtainedAt ?? 0));
        break;
    }
    // Owned first, always.
    list.sort((a, b) => Number(profile.owns(b.id)) - Number(profile.owns(a.id)));
    return list;
  }

  private renderDetail(): void {
    const id = this.selected;
    clear(this.detail);
    if (!id) return;

    const profile = this.app.profile;
    const g = getGuardian(id);
    const owned = profile.owned(id);
    const style = RARITY_STYLE[g.rarity];
    this.detail.style.setProperty('--accent', g.hue);
    this.detail.dataset.rarity = g.rarity;

    const stat = scaleStats(g.stats, owned?.level ?? 1, owned?.stars ?? 1);

    this.detail.append(
      h(
        'div',
        { class: 'detail__hero' },
        textureImg(`guardian/${g.id}/portrait`, 260, 'detail__portrait'),
        h('div', { class: 'detail__scrim' }),
        h(
          'div',
          { class: 'detail__caption' },
          h('div', { class: 'row', style: { gap: '8px' } }, rarityChip(g.rarity), stars(owned?.stars ?? 0, MAX_STARS, 13)),
          h('h2', { class: 'h-title', text: g.name }),
          h('span', { class: 'detail__title', text: g.title }),
        ),
      ),
      h('p', { class: 't-body detail__lore', text: g.lore }),
      h(
        'div',
        { class: 'detail__ult panel' },
        h('span', { class: 't-label', text: 'Ultimate' }),
        h('p', { text: g.ultimateText }),
      ),
      h(
        'div',
        { class: 'detail__stats' },
        statRow('Shield arc', `${Math.round((stat.arc * 180) / Math.PI)}°`),
        statRow('Perfect zone', `${Math.round(perfectTolerance(stat) * 100)}% of arc`),
        statRow('Pulse cycle', `${stat.pulseCooldown.toFixed(1)} s`),
        statRow('Deflect force', `${stat.deflectSpeed.toFixed(2)}x`),
        statRow('Integrity', String(stat.integrity)),
        statRow('Score bonus', `${Math.round((stat.scoreMult - 1) * 100)}%`, true),
      ),
    );

    if (!owned) {
      this.detail.append(
        h('p', { class: 't-body detail__locked', text: `Not yet collected. ${style.label} tier — available from any summon.` }),
        button('GO TO SUMMON', () => this.app.screens.replace('banner'), { variant: 'primary' }),
      );
      return;
    }

    // Level up.
    const cost = profile.levelUpCostFor(id);
    const shards = profile.balance('shards');
    this.detail.append(
      h(
        'div',
        { class: 'detail__level' },
        meter(owned.level, MAX_LEVEL, `Level ${owned.level} / ${MAX_LEVEL}`),
        cost === null
          ? h('p', { class: 't-label', text: 'Maximum level reached' })
          : button(`LEVEL UP`, () => {
              if (profile.levelUp(id)) this.refresh();
            }, {
              variant: 'ghost',
              sub: `${fmt(cost)} shards${shards < cost ? ` · you have ${fmt(shards)}` : ''}`,
              disabled: shards < cost,
            }),
      ),
    );

    // Star progress.
    if (owned.stars < MAX_STARS) {
      this.detail.append(
        h('p', {
          class: 't-body detail__stars',
          text: `Duplicates raise stars. ${owned.copies} cop${owned.copies === 1 ? 'y' : 'ies'} collected.`,
        }),
      );
    }

    this.detail.append(
      profile.equipped === id
        ? button('EQUIPPED', () => {}, { variant: 'ghost', disabled: true })
        : button('EQUIP', () => {
            profile.equip(id);
            this.refresh();
          }, { variant: 'primary' }),
    );
  }
}
