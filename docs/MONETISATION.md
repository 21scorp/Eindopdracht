# Monetisation

**No real money moves in this build.** The shipped `PurchaseProvider` is a mock
that completes instantly, charges nothing, and the shop says so on screen. What
exists is the shape of a real store, so switching payments on is implementing
one interface rather than reworking the economy.

---

## Connecting a real provider

`StoreService` never talks to a platform. It talks to this:

```ts
export interface PurchaseProvider {
  readonly id: string;
  isAvailable(): Promise<boolean>;
  getPrices(productIds: string[]): Promise<Record<string, string>>;
  purchase(productId: string): Promise<PurchaseReceipt>;
  restore(): Promise<PurchaseReceipt[]>;
}
```

Implement it for your platform and hand it over:

```ts
store.setProvider(new PlayBillingProvider());
```

Three rules the implementation must hold to, because `StoreService` assumes them:

**Return `completed` only after the platform has confirmed the charge.** Grants
are applied the moment a receipt says `completed`, and consumables cannot be
un-granted.

**Prices must come from the platform, not from `store.ts`.** The `priceLabel`
fields are placeholders for the mock. Real storefronts localise currency,
formatting and tax, and shipping a hardcoded `€2.99` to a Japanese player is
both wrong and, in several jurisdictions, illegal.

**`restore()` returns entitlements only.** Consumables are not restorable on any
platform. `StoreService.restore` already ignores anything without an
`entitlements` grant; a provider that returns consumable receipts is inviting a
duplication exploit.

### Receipt validation

The mock does none. A real integration must validate server-side before
granting, because a client-side grant is trivially forged from the console. The
seam for that is inside your provider's `purchase()`: call your backend, have it
verify with Apple/Google/Stripe, and only then resolve `completed`.

Once a backend exists, `Profile` should stop being the source of truth for
entitlements and become a cache of what the server says.

---

## The catalog

Products live in `src/meta/store.ts`. Each declares its exact contents as a
`ProductGrant`, and the shop renders that list directly onto the card — the
player sees precisely what they are buying before they buy it, generated from
the same object that performs the grant.

`firstTimeBonus` is applied only when `purchaseCount === 0`, and the card labels
it as one-time.

Adding a product is a data change:

```ts
{
  id: 'prisms.xl',
  kind: 'currency',
  name: 'Vault of Prisms',
  blurb: '7,500 Prisms',
  priceLabel: '€49.99',
  priceCents: 4999,
  grant: { currency: { prisms: 7500 } },
  badge: 'BEST VALUE',
  accent: '#FFB020',
  texture: 'ui/prism',
}
```

Product ids must match the ids registered in App Store Connect / Play Console
exactly.

---

## The line this codebase holds

These are decisions, not oversights. They are recorded here so a future change
that crosses one of them is a deliberate choice rather than a drift.

**Published rates are the real rates.** The Rates screen renders from the same
config object `pullOnce` uses. There is no separate display table that could
fall out of step, and `tests/gacha.test.ts` asserts every published guarantee.

**Rates never vary by player.** Not by spend, not by session length, not by
account age, not by whether someone is close to churning. The roll depends on
the banner config, the pity counters and the persisted RNG stream. Nothing else
is passed to it.

**The expected cost is published, not just the headline rate.** The Rates screen
shows a simulated average prisms-per-Mythic, computed by running the actual pull
function a few thousand times. "0.7%" alone is technically true and practically
misleading, because pity is what determines what people really pay.

**Pity is visible and never resets on its own.** The counter is on the summon
screen, not buried in a submenu. Hiding it is the part of this genre that earns
the criticism it gets.

**No summon is worth nothing.** Every duplicate converts to Shards and star
progress at a published rate.

**Nothing purchasable affects rates or gates content.** Packs contain currency
and one permanent quality-of-life entitlement. There is no paid power that
cannot be earned, and no paid summon rate.

**The shop is never the screen that opens on launch.** The daily reward is.

**Runs are capped, gently.** Core income has a daily soft cap, past which
earning continues at a reduced rate rather than stopping. A hard wall punishes
the players who play the most.

---

## What is missing before taking money

- [ ] Server-side receipt validation
- [ ] An account system, so purchases survive losing a device
- [ ] Platform-localised pricing from the store, not the catalog
- [ ] Regional compliance: published rates are mandatory in several markets and
      the format is prescribed in some of them
- [ ] Age gating and spend limits where required
- [ ] A refund path that reverses entitlements
- [ ] Analytics on the funnel, so the economy can be tuned on evidence rather
      than on the projection in `npm run balance`
