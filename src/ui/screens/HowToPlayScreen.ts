/**
 * How to play.
 *
 * The reference the in-run coach cannot be: every mechanic, every threat, every
 * scoring rule, all readable at any time. Written from the same `COACH_STEPS`
 * data as the coaching hints, so the two can never disagree.
 */

import { COACH_STEPS } from '../../game/Coach';
import { THREAT_LIST } from '../../data/threats';
import { SCORING } from '../../data/balance';
import { COLORS } from '../../render/palette';
import { threatColor } from '../../game/GameRenderer';
import type { App } from '../../app/App';
import { Screen } from '../Screen';
import { DRAFT_INTERVAL, RESONANCE } from '../../data/resonance';
import { sectionTitle, textureImg, topBar } from '../components';
import { clear, h } from '../dom';

const SCORE_ROWS: Array<{ name: string; points: number; combo: number; how: string }> = [
  { name: 'Block', points: SCORING.block, combo: SCORING.comboBlock, how: 'Contact anywhere on the shield arc.' },
  { name: 'Perfect', points: SCORING.perfect, combo: SCORING.comboPerfect, how: 'Contact near the centre of the arc. Deals double to armour.' },
  { name: 'Parry', points: SCORING.parry, combo: SCORING.comboParry, how: 'Caught by the pulse ring, at any angle.' },
  { name: 'Chain', points: SCORING.chain, combo: SCORING.comboChain, how: 'A deflected shot destroying another threat.' },
];

export class HowToPlayScreen extends Screen {
  private body!: HTMLElement;

  constructor(private readonly app: App) {
    super('howtoplay', 'screen screen--overlay howto');
  }

  protected override build(): void {
    this.body = h('div', { class: 'howto__body grow scroll' });
    this.root.append(topBar({ title: 'How to play', onBack: () => this.app.screens.pop() }), this.body);
  }

  protected override onEnter(): void {
    clear(this.body);

    this.body.append(
      h('p', {
        class: 't-body howto__intro',
        text: 'You defend one point. Everything converges on it. Nothing you block is wasted — it becomes the shot that kills the next one.',
      }),

      sectionTitle('The two verbs'),
      ...COACH_STEPS.slice(0, 3).map((step) =>
        h(
          'div',
          { class: 'howto__step panel' },
          h('span', { class: 'howto__steptitle', text: step.title }),
          h('p', { class: 't-body', text: step.body }),
        ),
      ),

      sectionTitle('Scoring'),
      h(
        'div',
        { class: 'howto__scores' },
        ...SCORE_ROWS.map((row) =>
          h(
            'div',
            { class: 'howto__scorerow' },
            h('span', { class: 'howto__scorename', text: row.name }),
            h('span', { class: 'howto__scorepts t-num', text: `${row.points}` }),
            h('span', { class: 'howto__scorecombo t-label', text: `+${row.combo} combo` }),
            h('span', { class: 't-body howto__scorehow', text: row.how }),
          ),
        ),
      ),
      h('p', {
        class: 't-body',
        text: `Every ${SCORING.multiplierStep} combo raises your multiplier by ${SCORING.multiplierGain}x, up to ${SCORING.multiplierMax}x. At ${SCORING.overdriveThreshold} combo you enter OVERDRIVE and everything scores double. Taking damage breaks the chain — in Overdrive you keep part of it.`,
      }),

      sectionTitle('Resonance'),
      h('p', {
        class: 't-body',
        text: `Every ${DRAFT_INTERVAL} waves the run pauses and offers three upgrades. Take one — you keep it for the rest of the run and lose it when the run ends. There is no skip, and there are no wrong answers, only different runs.`,
      }),
      h(
        'div',
        { class: 'howto__resonance' },
        ...RESONANCE.filter((r) => r.tier !== 'common')
          .slice(0, 4)
          .map((r) =>
            h(
              'div',
              { class: 'howto__threat' },
              textureImg(r.icon, 42),
              h(
                'div',
                { class: 'col', style: { gap: '2px' } },
                h('span', { class: 'howto__threatname', text: r.name }),
                h('span', { class: 't-body', text: r.text }),
              ),
            ),
          ),
      ),

      sectionTitle('What is coming for you'),
      h(
        'div',
        { class: 'howto__threats' },
        ...THREAT_LIST.map((t) =>
          h(
            'div',
            { class: 'howto__threat', style: { '--accent': threatColor({ kind: t.kind } as never) } as unknown as Partial<CSSStyleDeclaration> },
            textureImg(t.texture, 46),
            h(
              'div',
              { class: 'col', style: { gap: '2px' } },
              h('span', { class: 'howto__threatname', text: t.label }),
              h('span', { class: 't-body', text: threatBlurb(t.kind) }),
            ),
          ),
        ),
      ),

      sectionTitle('Controls'),
      h(
        'div',
        { class: 'howto__controls' },
        control('Drag anywhere', 'Aim the shield'),
        control('Tap', 'Pulse'),
        control('Two-finger tap', 'Ultimate'),
        control('A / D or ← →', 'Aim (keyboard)'),
        control('Space', 'Pulse (keyboard)'),
        control('Shift or Q', 'Ultimate (keyboard)'),
        control('Esc', 'Pause'),
      ),

      h('p', {
        class: 't-body howto__closing',
        style: { color: COLORS.textDim },
        text: 'Every Guardian changes these numbers. A wide arc forgives your positioning; a narrow one scores more for demanding it.',
      }),
    );
  }
}

function control(input: string, action: string): HTMLElement {
  return h(
    'div',
    { class: 'howto__control' },
    h('span', { class: 'howto__key', text: input }),
    h('span', { class: 't-body', text: action }),
  );
}

function threatBlurb(kind: string): string {
  switch (kind) {
    case 'orb':
      return 'Straight in, steady. The baseline — cover the angle.';
    case 'lancer':
      return 'Fast and thin. You will not have time to reposition twice.';
    case 'splitter':
      return 'Curves inward and breaks into three on death. Deal with the aftermath.';
    case 'bulwark':
      return 'Armoured. A plain block bounces off it — pulse it, perfect it, or chain into it.';
    case 'seeker':
      return 'Steers toward whichever side your shield is not covering.';
    case 'herald':
      return 'Stops outside your shield and shells the nexus. You cannot block it — your pulse is the only thing that reaches that far.';
    case 'warden':
      return 'Boss. Heavily armoured, fires its own volleys, and sheds a ring of orbs when it falls.';
    default:
      return '';
  }
}
