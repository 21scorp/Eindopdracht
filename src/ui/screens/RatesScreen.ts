/**
 * Published rates.
 *
 * Rendered directly from the banner config that the roll uses, so the numbers
 * on this screen cannot drift from the numbers in the code. It also shows the
 * *expected* prism cost of a mythic, computed by simulating the real pull
 * function — the headline 0.7% is technically true and practically misleading
 * on its own, and pity is what actually determines what people pay.
 */

import { Rng } from '../../core/Rng';
import { RARITIES, RARITY_STYLE } from '../../render/palette';
import { GUARDIANS } from '../../data/guardians';
import { getBanner, type Banner } from '../../data/banners';
import { simulateAverageMythicCost } from '../../meta/gacha';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { sectionTitle, topBar } from '../components';
import { clear, fmt, h } from '../dom';

export class RatesScreen extends Screen {
  private body!: HTMLElement;
  private bannerId = 'standard';

  constructor(private readonly app: App) {
    super('rates', 'screen screen--overlay rates');
  }

  protected override build(): void {
    this.body = h('div', { class: 'rates__body grow scroll' });
    this.root.append(topBar({ title: 'Summon rates', onBack: () => this.app.screens.pop() }), this.body);
  }

  protected override onEnter(params?: unknown): void {
    const p = params as { bannerId?: string } | undefined;
    if (p?.bannerId) this.bannerId = p.bannerId;
    this.refresh();
  }

  private refresh(): void {
    const banner = getBanner(this.bannerId);
    const pity = this.app.profile.pityFor(banner.id);
    clear(this.body);
    this.root.style.setProperty('--accent', banner.accent);

    this.body.append(
      h('h2', { class: 'h-title', text: banner.name }),
      h('p', { class: 't-body', text: banner.blurb }),

      sectionTitle('Base rates per summon'),
      this.rateTable(banner),

      sectionTitle('Guarantees'),
      h(
        'ul',
        { class: 'rates__list' },
        h('li', { text: `Every ${banner.pity.epicFloor} summons guarantees an Epic or better.` }),
        h('li', { text: `Every ${banner.pity.legendaryPity} summons guarantees a Legendary or better.` }),
        h('li', {
          text: `The Mythic rate begins rising at summon ${banner.pity.softPityStart}, increasing by ${(
            banner.pity.softPityStep * 100
          ).toFixed(0)} percentage points each summon.`,
        }),
        h('li', { text: `Summon ${banner.pity.hardPity} without a Mythic is guaranteed to be one.` }),
        banner.featured.length > 0
          ? h('li', {
              text: `A Mythic has a ${(banner.featuredMythicChance * 100).toFixed(
                0,
              )}% chance to be the featured Guardian. If it is not, your next Mythic is guaranteed to be.`,
            })
          : null,
        h('li', { text: 'Counters carry across sessions and are never reset by the game.' }),
      ),

      sectionTitle('What this costs in practice'),
      this.expectation(banner),

      sectionTitle('Your counters'),
      h(
        'div',
        { class: 'rates__counters' },
        counter('Summons on this banner', String(pity.total)),
        counter('Since last Mythic', String(pity.sinceMythic)),
        counter('Since last Legendary', String(pity.sinceLegendary)),
        counter('Since last Epic', String(pity.sinceEpic)),
        counter('Featured guaranteed', pity.guaranteedFeatured ? 'Yes' : 'No'),
      ),

      sectionTitle('Pool'),
      this.pool(banner),

      h('p', {
        class: 't-body rates__note',
        text: 'These figures are read directly from the same configuration the summon uses. Duplicates convert to Shards and star progress; no summon result is ever worth nothing.',
      }),
    );
  }

  private rateTable(banner: Banner): HTMLElement {
    const table = h('div', { class: 'ratetable' });
    for (const r of [...RARITIES].reverse()) {
      const style = RARITY_STYLE[r];
      const pct = banner.rates[r] * 100;
      table.appendChild(
        h(
          'div',
          { class: 'ratetable__row', data: { rarity: r } },
          h('span', { class: 'ratetable__name', style: { color: style.color }, text: style.label }),
          h(
            'div',
            { class: 'meter' },
            h('div', { class: 'meter__fill', style: { width: `${Math.max(1.5, pct)}%`, background: style.color } }),
          ),
          h('span', { class: 'ratetable__pct t-num', text: `${pct.toFixed(pct < 1 ? 2 : 1)}%` }),
        ),
      );
    }
    return table;
  }

  private expectation(banner: Banner): HTMLElement {
    // Simulated with a throwaway RNG so it never touches the account's stream.
    const rng = new Rng('rates-preview');
    const avgCost = simulateAverageMythicCost(banner, rng, 2500);
    const avgPulls = avgCost / banner.costSingle;
    return h(
      'div',
      { class: 'panel rates__expectation' },
      h(
        'div',
        { class: 'row row--between' },
        h('span', { class: 't-label', text: 'Average summons per Mythic' }),
        h('span', { class: 't-num t-accent', text: avgPulls.toFixed(1) }),
      ),
      h(
        'div',
        { class: 'row row--between' },
        h('span', { class: 't-label', text: 'Average prisms per Mythic' }),
        h('span', { class: 't-num', text: fmt(avgCost) }),
      ),
      h('p', {
        class: 't-body',
        text: 'Simulated over 2,500 runs of the exact function this game uses to roll. Your own results will vary either side of this.',
      }),
    );
  }

  private pool(banner: Banner): HTMLElement {
    const excluded = new Set(banner.excluded ?? []);
    const wrap = h('div', { class: 'rates__pool' });
    for (const r of [...RARITIES].reverse()) {
      const list = GUARDIANS.filter((g) => g.rarity === r && !excluded.has(g.id));
      if (list.length === 0) continue;
      wrap.appendChild(
        h(
          'div',
          { class: 'rates__poolrow', data: { rarity: r } },
          h('span', { class: 'rates__poollabel', style: { color: RARITY_STYLE[r].color }, text: RARITY_STYLE[r].label }),
          h(
            'span',
            { class: 'rates__poolnames' },
            list
              .map((g) => (banner.featured.includes(g.id) ? `${g.name} ★` : g.name))
              .join('   ·   '),
          ),
        ),
      );
    }
    return wrap;
  }
}

function counter(label: string, value: string): HTMLElement {
  return h(
    'div',
    { class: 'rates__counter' },
    h('span', { class: 't-label', text: label }),
    h('span', { class: 't-num', text: value }),
  );
}
