/**
 * Pull results.
 *
 * Cards land one at a time, lowest rarity first, so the sequence *builds*. The
 * best card is always last — a ten-pull that opens with the mythic wastes the
 * other nine reveals.
 *
 * Duplicates are never presented as a loss: the card shows exactly what the
 * copy converted into, and a star-up gets its own flourish.
 */

import { RARITY_STYLE } from '../../render/palette';
import { MAX_STARS } from '../../data/guardians';
import { rarityRank } from '../../meta/gacha';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { stars, textureImg } from '../components';
import { button, clear, delay, fmt, h } from '../dom';
import type { GrantedPull } from './BannerScreen';

const REVEAL_STAGGER = 130;

export class PullResultScreen extends Screen {
  private grid!: HTMLElement;
  private headline!: HTMLElement;
  private actions!: HTMLElement;
  private granted: GrantedPull[] = [];
  private bannerId = '';
  private revealing = false;

  constructor(private readonly app: App) {
    super('pullresult', 'screen screen--solid pullresult');
  }

  protected override build(): void {
    this.headline = h('div', { class: 'pullresult__headline' });
    this.grid = h('div', { class: 'pullresult__grid' });
    this.actions = h('div', { class: 'pullresult__actions' });

    this.root.append(
      this.headline,
      h('div', { class: 'pullresult__body grow scroll' }, this.grid),
      this.actions,
    );
  }

  protected override onEnter(params?: unknown): void {
    const p = params as { granted: GrantedPull[]; bannerId: string } | undefined;
    if (!p) return;
    this.granted = p.granted;
    this.bannerId = p.bannerId;
    void this.run();
  }

  private async run(): Promise<void> {
    this.revealing = true;
    const sorted = [...this.granted].sort((a, b) => rarityRank(a.result.rarity) - rarityRank(b.result.rarity));
    const top = sorted[sorted.length - 1]!;
    const style = RARITY_STYLE[top.result.rarity];
    this.root.style.setProperty('--accent', style.color);

    clear(this.headline);
    this.headline.append(
      h('span', { class: 't-label', text: this.granted.length > 1 ? `${this.granted.length} Guardians` : 'Guardian' }),
      h('h1', { class: 'h-display', text: top.result.duplicate && this.granted.length === 1 ? 'SIGNAL ECHO' : 'SIGNAL ACQUIRED' }),
    );

    clear(this.grid);
    clear(this.actions);
    this.grid.classList.toggle('pullresult__grid--single', this.granted.length === 1);

    const skipAll = button('REVEAL ALL', () => this.revealAll(), { variant: 'ghost' });
    this.actions.append(skipAll);

    // Every card is placed face-down first, then flipped in sequence. Building
    // the grid up card by card would reflow the layout under the player's eyes
    // on every reveal.
    const cards = sorted.map((g, i) => this.buildCard(g, i === sorted.length - 1));
    for (const card of cards) this.grid.appendChild(card);

    for (let i = 0; i < cards.length; i++) {
      if (!this.revealing) break;
      await delay(REVEAL_STAGGER + rarityRank(sorted[i]!.result.rarity) * 70);
      if (!this.revealing) break;
      cards[i]!.classList.add('is-revealed');
      this.app.audio.cardReveal(sorted[i]!.result.rarity, i);
      if (rarityRank(sorted[i]!.result.rarity) >= 3) {
        this.app.camera.addTrauma(0.12);
        this.app.renderer.flash = Math.max(this.app.renderer.flash, 0.14);
        this.app.renderer.flashColor = RARITY_STYLE[sorted[i]!.result.rarity].color;
      }
    }

    this.finish();
  }

  private revealAll(): void {
    this.revealing = false;
    for (const card of Array.from(this.grid.children)) card.classList.add('is-revealed');
    this.finish();
  }

  private finish(): void {
    this.revealing = false;
    for (const card of Array.from(this.grid.children)) card.classList.add('is-revealed');
    clear(this.actions);
    const prisms = this.app.profile.balance('prisms');
    const banner = this.bannerId;
    this.actions.append(
      button('SUMMON AGAIN', () => this.app.screens.replace('banner', { bannerId: banner }), {
        variant: 'primary',
        class: 'grow',
        disabled: prisms < 160,
      }),
      button('DONE', () => this.app.showMenu('home'), { variant: 'ghost' }),
    );
  }

  private buildCard(g: GrantedPull, isTop: boolean): HTMLElement {
    const { result, outcome } = g;
    const guardian = result.guardian;
    const style = RARITY_STYLE[result.rarity];

    const card = h('div', {
      class: `pcard${isTop ? ' pcard--hero' : ''}${result.featured ? ' pcard--featured' : ''}`,
      data: { rarity: result.rarity },
      style: { '--rarity': style.color } as unknown as Partial<CSSStyleDeclaration>,
    });

    const inner = h('div', { class: 'pcard__inner' });

    // Back face — what you see before the flip.
    inner.appendChild(h('div', { class: 'pcard__back' }, h('span', { class: 'pcard__backmark', text: '✦' })));

    // Front face. The hero card is a full-bleed portrait with the text over it;
    // the small cards keep art and text in separate bands, because overlaid
    // type at 96px wide is unreadable no matter how heavy the scrim.
    const front = h('div', { class: 'pcard__front' });
    const meta = h('div', { class: 'pcard__meta' });

    if (isTop) {
      front.append(
        textureImg(`guardian/${guardian.id}/portrait`, 300, 'pcard__art'),
        h('div', { class: 'pcard__scrim' }),
      );
      meta.append(
        h('span', { class: 'rarity-chip', data: { rarity: result.rarity }, text: style.label }),
        h('span', { class: 'pcard__name', text: guardian.name }),
        h('span', { class: 'pcard__title', text: guardian.title }),
        stars(this.app.profile.owned(guardian.id)?.stars ?? 1, MAX_STARS, 15),
      );
    } else {
      front.append(
        h('div', { class: 'pcard__artwrap' }, textureImg(`guardian/${guardian.id}/emblem`, 120, 'pcard__emblem')),
      );
      meta.append(
        h('span', { class: 'pcard__name', text: guardian.name }),
        stars(this.app.profile.owned(guardian.id)?.stars ?? 1, MAX_STARS, 9),
      );
    }

    const flags = h('div', { class: 'pcard__flags' });
    if (outcome.duplicate) {
      if (outcome.starUp) flags.appendChild(h('span', { class: 'pcard__flag pcard__flag--star', text: 'STAR UP' }));
      flags.appendChild(h('span', { class: 'pcard__flag', text: `+${fmt(outcome.shards)} shards` }));
    } else {
      flags.appendChild(h('span', { class: 'pcard__flag pcard__flag--new', text: 'NEW' }));
    }
    if (result.featured) flags.appendChild(h('span', { class: 'pcard__flag pcard__flag--featured', text: 'RATE UP' }));
    meta.appendChild(flags);

    front.appendChild(meta);
    inner.appendChild(front);
    card.appendChild(inner);
    return card;
  }

  override onBack(): boolean {
    if (this.revealing) {
      this.revealAll();
      return true;
    }
    this.app.showMenu('home');
    return true;
  }
}
