/**
 * The Resonance draft.
 *
 * Three cards, one tap, back into the run. Everything about this screen is
 * built around not breaking the pace: it opens over the frozen arena instead of
 * replacing it, the cards stagger in over 200ms rather than waiting on an
 * animation, and taking one closes it immediately. A draft that takes longer
 * than the wave it interrupts is a draft players learn to dread.
 *
 * There is deliberately no skip button. Three good options and no way to
 * decline is a decision; three options and a "no thanks" is a menu.
 */

import { getResonance, type ResonanceTier } from '../../data/resonance';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { textureImg } from '../components';
import { clear, h } from '../dom';

const TIER_LABEL: Record<ResonanceTier, string> = {
  common: 'RESONANCE',
  rare: 'RARE RESONANCE',
  epic: 'EPIC RESONANCE',
};

export class ResonanceScreen extends Screen {
  private cards!: HTMLElement;
  private title!: HTMLElement;
  private held!: HTMLElement;
  private choosing = false;

  constructor(private readonly app: App) {
    super('resonance', 'screen screen--overlay resonance');
  }

  protected override build(): void {
    this.title = h('div', { class: 'resonance__title' });
    this.cards = h('div', { class: 'resonance__cards' });
    this.held = h('div', { class: 'resonance__held' });

    this.root.append(
      h(
        'div',
        { class: 'resonance__head' },
        h('span', { class: 't-label resonance__eyebrow', text: 'Wave cleared' }),
        this.title,
      ),
      this.cards,
      this.held,
    );
  }

  protected override onEnter(params?: unknown): void {
    const p = params as { offer: string[]; wave: number } | undefined;
    const offer = p?.offer ?? this.app.session.offer;
    this.choosing = false;
    this.renderHeld();

    clear(this.title);
    this.title.append(h('h2', { class: 'h-display', text: 'CHOOSE A RESONANCE' }));
    // Once, ever. The first draft is the only one where "what is this and what
    // happens to it" is a real question; after that the sentence is noise
    // between the player and three cards they already understand.
    if (!this.app.profile.hasSeenTip('resonance')) {
      this.title.append(
        h('p', {
          class: 't-body resonance__explain',
          text: 'You keep it for the rest of the run and lose it when the run ends. There is no wrong answer.',
        }),
      );
    }

    clear(this.cards);
    offer.forEach((id, i) => {
      const def = getResonance(id);
      if (!def) return;
      const card = h(
        'button',
        {
          class: `rescard rescard--${def.tier}`,
          type: 'button',
          style: { animationDelay: `${i * 70}ms` },
          onClick: () => this.choose(id),
        },
        h('span', { class: 'rescard__tier t-label', text: TIER_LABEL[def.tier] }),
        textureImg(def.icon, 72, 'rescard__icon'),
        h('span', { class: 'rescard__name', text: def.name }),
        h('span', { class: 'rescard__text', text: def.text }),
      );
      this.cards.appendChild(card);
    });
  }

  /** The cards already held, so a player can build toward something. */
  private renderHeld(): void {
    clear(this.held);
    const taken = this.app.session.resonance;
    if (taken.length === 0) return;
    this.held.append(h('span', { class: 't-label', text: 'Held' }));
    const row = h('div', { class: 'resonance__heldrow' });
    for (const id of taken) {
      const def = getResonance(id);
      if (!def) continue;
      row.append(
        h(
          'span',
          { class: `resheld resheld--${def.tier}`, title: def.text },
          textureImg(def.icon, 22),
          h('span', { text: def.name }),
        ),
      );
    }
    this.held.appendChild(row);
  }

  private choose(id: string): void {
    if (this.choosing) return;
    this.choosing = true;
    this.app.profile.markTipSeen('resonance');
    this.app.takeResonance(id);
  }

  /** No escape hatch: the draft is a decision, and the run waits for it. */
  override onBack(): boolean {
    return true;
  }
}
