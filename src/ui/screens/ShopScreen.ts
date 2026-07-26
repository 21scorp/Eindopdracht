/**
 * Shop.
 *
 * Two halves: things you buy with Cores (earned by playing) and things that
 * would cost real money. The second half is clearly marked as a simulation in
 * this build, because a store that looks live but silently does nothing is
 * worse than no store at all.
 */

import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { Wallet, sectionTitle, textureImg, topBar } from '../components';
import { button, clear, fmt, h } from '../dom';
import { StoreService, describeGrant, type Product } from '../../meta/store';

/** Cores -> Prisms conversion, the free path to summons. */
const EXCHANGES = [
  { id: 'exchange.small', cores: 2000, prisms: 160, label: 'Single summon', limitPerDay: 3 },
  { id: 'exchange.large', cores: 9000, prisms: 800, label: 'Bulk conversion', limitPerDay: 1 },
];

export class ShopScreen extends Screen {
  private wallet!: Wallet;
  private body!: HTMLElement;
  private store!: StoreService;
  private busy = false;
  private toast: HTMLElement | null = null;

  constructor(private readonly app: App) {
    super('shop', 'screen screen--solid shop');
  }

  protected override build(): void {
    this.store = new StoreService(this.app.profile);
    void this.store.refreshPrices();
    this.wallet = new Wallet(this.app.profile);
    this.body = h('div', { class: 'shop__body grow scroll' });

    this.store.events.on('purchased', ({ product, granted }) => {
      this.showToast(`${product.name} added — ${describeGrant(granted).join(', ')}`);
      this.refresh();
    });
    this.store.events.on('failed', ({ status }) => {
      this.showToast(status === 'cancelled' ? 'Purchase cancelled' : 'Purchase could not be completed');
      this.busy = false;
      this.refresh();
    });

    this.root.append(topBar({ title: 'Shop', onBack: () => this.app.screens.pop(), wallet: this.wallet }), this.body);
  }

  protected override onEnter(): void {
    this.refresh();
  }

  private refresh(): void {
    clear(this.body);

    // --- exchange -----------------------------------------------------------
    this.body.append(sectionTitle('Exchange'));
    const exchangeGrid = h('div', { class: 'shop__grid' });
    for (const ex of EXCHANGES) {
      const affordable = this.app.profile.canAfford('cores', ex.cores);
      exchangeGrid.appendChild(
        h(
          'div',
          { class: 'shopcard panel' },
          h(
            'div',
            { class: 'shopcard__head' },
            textureImg('ui/prism', 42),
            h(
              'div',
              { class: 'col', style: { gap: '2px' } },
              h('span', { class: 'shopcard__name', text: `${fmt(ex.prisms)} Prisms` }),
              h('span', { class: 't-label', text: ex.label }),
            ),
          ),
          button(`${fmt(ex.cores)} CORES`, () => this.exchange(ex.cores, ex.prisms), {
            variant: affordable ? 'primary' : 'ghost',
            disabled: !affordable,
          }),
        ),
      );
    }
    this.body.appendChild(exchangeGrid);

    // --- packs --------------------------------------------------------------
    this.body.append(sectionTitle('Prism packs'));
    if (this.store.isSimulated) {
      this.body.appendChild(
        h('p', {
          class: 'shop__notice',
          text: 'Payments are not connected in this build. These buttons complete instantly and charge nothing — they exist so the flow can be tested end to end.',
        }),
      );
    }

    const grid = h('div', { class: 'shop__grid' });
    for (const product of this.store.available()) {
      grid.appendChild(this.productCard(product));
    }
    this.body.appendChild(grid);

    const soldOut = [...this.store.available()];
    void soldOut;

    this.body.append(
      h('div', { class: 'divider' }),
      h('p', {
        class: 't-body shop__fineprint',
        text: 'Nothing in this shop changes summon rates or locks gameplay content. Every pack states its exact contents before purchase.',
      }),
      button('RESTORE PURCHASES', () => void this.restore(), { variant: 'ghost' }),
    );
  }

  private productCard(product: Product): HTMLElement {
    const grant = this.store.effectiveGrant(product);
    const first = this.app.profile.purchaseCount(product.id) === 0 && !!product.firstTimeBonus;
    const card = h('div', {
      class: `shopcard shopcard--product panel${product.badge ? ' has-badge' : ''}`,
      style: { '--accent': product.accent } as unknown as Partial<CSSStyleDeclaration>,
    });

    if (product.badge) card.appendChild(h('span', { class: 'shopcard__badge', text: product.badge }));

    card.append(
      h(
        'div',
        { class: 'shopcard__head' },
        textureImg(product.texture, 52),
        h(
          'div',
          { class: 'col', style: { gap: '2px' } },
          h('span', { class: 'shopcard__name', text: product.name }),
          h('span', { class: 't-label', text: product.blurb }),
        ),
      ),
      h('ul', { class: 'shopcard__contents' }, ...describeGrant(grant).map((line) => h('li', { text: line }))),
    );

    if (first) card.appendChild(h('span', { class: 'shopcard__first', text: 'First purchase: contents doubled' }));
    if (product.bonusPercent) {
      card.appendChild(h('span', { class: 'shopcard__bonus', text: `+${product.bonusPercent}% value` }));
    }

    card.appendChild(
      button(this.store.priceFor(product), () => void this.buy(product.id), {
        variant: 'primary',
        disabled: this.busy,
      }),
    );
    return card;
  }

  private exchange(cores: number, prisms: number): void {
    const p = this.app.profile;
    if (!p.debit('cores', cores, 'exchange')) return;
    p.credit('prisms', prisms, 'exchange');
    this.showToast(`+${fmt(prisms)} Prisms`);
    this.refresh();
  }

  private async buy(productId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.refresh();
    await this.store.purchase(productId);
    this.busy = false;
    this.refresh();
  }

  private async restore(): Promise<void> {
    const n = await this.store.restore();
    this.showToast(n > 0 ? `Restored ${n} purchase${n === 1 ? '' : 's'}` : 'Nothing to restore');
  }

  private showToast(message: string): void {
    this.toast?.remove();
    this.toast = h('div', { class: 'toast', text: message });
    this.root.appendChild(this.toast);
    const el = this.toast;
    setTimeout(() => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 300);
    }, 2400);
  }
}
