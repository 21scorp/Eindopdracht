/**
 * In-app purchases.
 *
 * No real money moves in this build. What exists is the shape of a real store,
 * so switching on payments later is a matter of implementing one interface
 * rather than reworking the economy:
 *
 *   PurchaseProvider   the platform bridge (App Store / Play Billing / Stripe)
 *   StoreService       catalog, entitlement grants, ledger, restore
 *
 * `MockProvider` is what ships today. It never charges anything, and every
 * purchase it "completes" is clearly labelled in the UI as a simulation.
 *
 * Design rules that keep this the honest kind of monetisation:
 *  - every pack states its exact contents up front, no "chance to receive"
 *  - the first-purchase bonus is one-time and says so
 *  - nothing purchasable increases gacha rates or gates gameplay content
 *  - the shop is never the screen that opens when the app launches
 */

import { EventBus } from '../core/EventBus';
import type { CurrencyId, Profile } from './Profile';

export type ProductKind = 'currency' | 'bundle' | 'pass' | 'permanent';

export interface ProductGrant {
  currency?: Partial<Record<CurrencyId, number>>;
  guardians?: string[];
  entitlements?: string[];
}

export interface Product {
  id: string;
  kind: ProductKind;
  name: string;
  /** Short line under the name. */
  blurb: string;
  /** Display price. Real pricing comes from the platform at runtime. */
  priceLabel: string;
  /** Price in minor units, used only for sorting and value maths. */
  priceCents: number;
  grant: ProductGrant;
  /** Extra granted only the first time this product is bought. */
  firstTimeBonus?: ProductGrant;
  /** Marketing badge: 'BEST VALUE', 'POPULAR'. */
  badge?: string;
  /** Purchase limit; undefined means unlimited. */
  limit?: number;
  accent: string;
  /** Percentage more prisms per unit currency than the base tier. */
  bonusPercent?: number;
  texture: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: 'prisms.small',
    kind: 'currency',
    name: 'Handful of Prisms',
    blurb: '300 Prisms',
    priceLabel: '€2.99',
    priceCents: 299,
    grant: { currency: { prisms: 300 } },
    firstTimeBonus: { currency: { prisms: 300 } },
    accent: '#4DE1FF',
    texture: 'ui/prism',
  },
  {
    id: 'prisms.medium',
    kind: 'currency',
    name: 'Pouch of Prisms',
    blurb: '1,000 Prisms',
    priceLabel: '€8.99',
    priceCents: 899,
    grant: { currency: { prisms: 1000 } },
    firstTimeBonus: { currency: { prisms: 1000 } },
    bonusPercent: 11,
    badge: 'POPULAR',
    accent: '#A45CFF',
    texture: 'ui/prism',
  },
  {
    id: 'prisms.large',
    kind: 'currency',
    name: 'Cache of Prisms',
    blurb: '3,400 Prisms',
    priceLabel: '€26.99',
    priceCents: 2699,
    grant: { currency: { prisms: 3400 } },
    firstTimeBonus: { currency: { prisms: 3400 } },
    bonusPercent: 26,
    badge: 'BEST VALUE',
    accent: '#FFB020',
    texture: 'ui/prism',
  },
  {
    id: 'bundle.starter',
    kind: 'bundle',
    name: 'Signal Boost',
    blurb: '1,600 Prisms · 5,000 Cores · 600 Shards',
    priceLabel: '€4.99',
    priceCents: 499,
    grant: { currency: { prisms: 1600, cores: 5000, shards: 600 } },
    limit: 1,
    badge: 'ONE TIME',
    accent: '#5CFFAE',
    texture: 'ui/core',
  },
  {
    id: 'permanent.archive',
    kind: 'permanent',
    name: 'Archive Access',
    blurb: 'Permanent +20% Cores from every run, and run history that never expires.',
    priceLabel: '€6.99',
    priceCents: 699,
    grant: { entitlements: ['archive'], currency: { prisms: 300 } },
    limit: 1,
    accent: '#FF3D6E',
    texture: 'ui/shard',
  },
];

export const PRODUCT_BY_ID: ReadonlyMap<string, Product> = new Map(PRODUCTS.map((p) => [p.id, p]));

// ---------------------------------------------------------------------------

export type PurchaseStatus = 'completed' | 'cancelled' | 'failed' | 'unavailable';

export interface PurchaseReceipt {
  productId: string;
  status: PurchaseStatus;
  /** Platform transaction id. Empty for the mock provider. */
  transactionId: string;
  at: number;
  /** True when this came from a restore rather than a fresh purchase. */
  restored: boolean;
  error?: string;
}

/**
 * The platform bridge. A real implementation wraps StoreKit, Play Billing or a
 * Stripe checkout session; the service above it does not care which.
 */
export interface PurchaseProvider {
  readonly id: string;
  /** True when purchases can actually be made right now. */
  isAvailable(): Promise<boolean>;
  /** Platform-localised prices, keyed by product id. */
  getPrices(productIds: string[]): Promise<Record<string, string>>;
  purchase(productId: string): Promise<PurchaseReceipt>;
  restore(): Promise<PurchaseReceipt[]>;
}

/**
 * The provider used in this build. It completes instantly, charges nothing, and
 * reports itself as a simulation so the UI can say so plainly.
 */
export class MockProvider implements PurchaseProvider {
  readonly id = 'mock';
  /** Set false to exercise the "store unavailable" path. */
  available = true;
  /** Set to force a specific outcome in tests. */
  forcedStatus: PurchaseStatus | null = null;

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async getPrices(productIds: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of productIds) {
      const p = PRODUCT_BY_ID.get(id);
      if (p) out[id] = p.priceLabel;
    }
    return out;
  }

  async purchase(productId: string): Promise<PurchaseReceipt> {
    await new Promise((r) => setTimeout(r, 420));
    const status = this.forcedStatus ?? 'completed';
    return {
      productId,
      status,
      transactionId: status === 'completed' ? `mock_${Date.now().toString(36)}` : '',
      at: Date.now(),
      restored: false,
    };
  }

  async restore(): Promise<PurchaseReceipt[]> {
    return [];
  }
}

export type StoreEvents = {
  purchased: { product: Product; receipt: PurchaseReceipt; granted: ProductGrant };
  failed: { productId: string; status: PurchaseStatus; error?: string };
  pricesUpdated: { prices: Record<string, string> };
};

export class StoreService {
  readonly events = new EventBus<StoreEvents>();
  private prices: Record<string, string> = {};
  private inFlight = new Set<string>();

  constructor(
    private readonly profile: Profile,
    private provider: PurchaseProvider = new MockProvider(),
  ) {}

  /** True when this build cannot take real money. Drives the UI's disclaimer. */
  get isSimulated(): boolean {
    return this.provider.id === 'mock';
  }

  setProvider(provider: PurchaseProvider): void {
    this.provider = provider;
  }

  async refreshPrices(): Promise<void> {
    try {
      this.prices = await this.provider.getPrices(PRODUCTS.map((p) => p.id));
      this.events.emit('pricesUpdated', { prices: this.prices });
    } catch (err) {
      console.warn('[Store] price lookup failed', err);
    }
  }

  priceFor(product: Product): string {
    return this.prices[product.id] ?? product.priceLabel;
  }

  /** Products still purchasable for this account, in catalog order. */
  available(): Product[] {
    return PRODUCTS.filter((p) => p.limit === undefined || this.profile.purchaseCount(p.id) < p.limit);
  }

  isSoldOut(product: Product): boolean {
    return product.limit !== undefined && this.profile.purchaseCount(product.id) >= product.limit;
  }

  /** Contents of the *next* purchase, including any first-time bonus. */
  effectiveGrant(product: Product): ProductGrant {
    const first = this.profile.purchaseCount(product.id) === 0 && product.firstTimeBonus;
    if (!first) return product.grant;
    return mergeGrants(product.grant, product.firstTimeBonus!);
  }

  async purchase(productId: string): Promise<PurchaseReceipt> {
    const product = PRODUCT_BY_ID.get(productId);
    if (!product) {
      const receipt: PurchaseReceipt = { productId, status: 'failed', transactionId: '', at: Date.now(), restored: false, error: 'Unknown product' };
      this.events.emit('failed', { productId, status: 'failed', error: 'Unknown product' });
      return receipt;
    }
    if (this.inFlight.has(productId)) {
      return { productId, status: 'failed', transactionId: '', at: Date.now(), restored: false, error: 'Already in progress' };
    }
    if (this.isSoldOut(product)) {
      this.events.emit('failed', { productId, status: 'unavailable', error: 'Purchase limit reached' });
      return { productId, status: 'unavailable', transactionId: '', at: Date.now(), restored: false };
    }

    this.inFlight.add(productId);
    try {
      const receipt = await this.provider.purchase(productId);
      if (receipt.status !== 'completed') {
        this.events.emit('failed', { productId, status: receipt.status, error: receipt.error });
        return receipt;
      }
      const granted = this.effectiveGrant(product);
      this.applyGrant(granted, `purchase:${productId}`);
      this.profile.recordPurchase(productId, granted.entitlements ?? []);
      this.events.emit('purchased', { product, receipt, granted });
      return receipt;
    } finally {
      this.inFlight.delete(productId);
    }
  }

  async restore(): Promise<number> {
    const receipts = await this.provider.restore();
    let restored = 0;
    for (const r of receipts) {
      if (r.status !== 'completed') continue;
      const product = PRODUCT_BY_ID.get(r.productId);
      if (!product) continue;
      // Restores re-grant entitlements only. Consumables are not restorable —
      // that is the platform rule everywhere, and pretending otherwise causes
      // support tickets.
      const entitlements = product.grant.entitlements ?? [];
      if (entitlements.length === 0) continue;
      this.profile.recordPurchase(product.id, entitlements);
      restored++;
    }
    return restored;
  }

  private applyGrant(grant: ProductGrant, reason: string): void {
    if (grant.currency) {
      for (const [currency, amount] of Object.entries(grant.currency)) {
        if (amount && amount > 0) this.profile.credit(currency as CurrencyId, amount, reason);
      }
    }
    for (const id of grant.guardians ?? []) {
      this.profile.grant(id, reason);
    }
    // Entitlements are recorded by `recordPurchase` so they survive a restore.
  }
}

export function mergeGrants(a: ProductGrant, b: ProductGrant): ProductGrant {
  const currency: Partial<Record<CurrencyId, number>> = { ...a.currency };
  for (const [k, v] of Object.entries(b.currency ?? {})) {
    const key = k as CurrencyId;
    currency[key] = (currency[key] ?? 0) + (v ?? 0);
  }
  return {
    currency,
    guardians: [...(a.guardians ?? []), ...(b.guardians ?? [])],
    entitlements: [...(a.entitlements ?? []), ...(b.entitlements ?? [])],
  };
}

/** Human-readable contents list for a grant, used on the product card. */
export function describeGrant(grant: ProductGrant): string[] {
  const out: string[] = [];
  const names: Record<CurrencyId, string> = { prisms: 'Prisms', cores: 'Cores', shards: 'Shards' };
  for (const [k, v] of Object.entries(grant.currency ?? {})) {
    if (v && v > 0) out.push(`${v.toLocaleString('en-US')} ${names[k as CurrencyId]}`);
  }
  for (const g of grant.guardians ?? []) out.push(`Guardian: ${g.toUpperCase()}`);
  for (const e of grant.entitlements ?? []) out.push(ENTITLEMENT_LABELS[e] ?? e);
  return out;
}

export const ENTITLEMENT_LABELS: Record<string, string> = {
  archive: '+20% Cores from runs, permanently',
};
