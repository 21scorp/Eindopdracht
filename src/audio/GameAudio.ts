/**
 * Sound design.
 *
 * Maps gameplay events onto the synth. The one idea that does most of the work:
 * **consecutive hits climb a pentatonic scale**. Every block is a note one step
 * higher than the last, so a combo is audibly a melody going up, and losing it
 * is audibly a fall. That single mechanic is why people keep tapping.
 */

import { clamp, clamp01 } from '../core/math';
import { RARITY_STYLE, type Rarity } from '../render/palette';
import type { GameSession } from '../game/GameSession';
import type { GameEvents } from '../game/events';
import { AudioEngine, midiToFreq } from './AudioEngine';
import { MusicDirector } from './Music';
import { haptics } from './haptics';

/** Minor pentatonic, two octaves — the ladder a combo climbs. */
const LADDER = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27, 29, 31, 34, 36];
const ROOT = 57; // A3

export class GameAudio {
  readonly music: MusicDirector;
  private disposers: Array<() => void> = [];
  private session: GameSession | null = null;
  private comboStep = 0;

  constructor(private readonly engine: AudioEngine) {
    this.music = new MusicDirector(engine);
  }

  /** Attach to a session's event bus. Safe to call again for a new session. */
  bind(session: GameSession): void {
    this.unbind();
    this.session = session;

    const on = <K extends keyof GameEvents>(event: K, fn: (p: GameEvents[K]) => void): void => {
      this.disposers.push(session.events.on(event, fn));
    };

    on('hit', (e) => this.onHit(e.quality, e.combo, e.threat.x, session.arena.cx, session.arena.unit));
    on('damage', (e) => this.onDamage(e.fatal));
    on('comboBreak', (e) => this.onComboBreak(e.combo));
    on('pulse', (e) => this.onPulse(e.success, e.caught));
    on('pulseReady', () => this.blip(midiToFreq(ROOT + 12), 0.045, 0.05));
    on('overdriveStart', () => this.onOverdrive());
    on('overdriveEnd', () => {
      this.music.overdrive = false;
    });
    on('waveStart', (e) => this.onWaveStart(e.wave, e.boss));
    on('waveClear', () => this.onWaveClear());
    on('bossSpawn', () => this.onBossSpawn());
    on('bossKilled', () => this.onBossKilled());
    on('bossEnraged', () => this.onBossEnraged());
    on('ultimateReady', () => this.onUltimateReady());
    on('ultimateFired', () => this.onUltimateFired());
    on('lastStand', () => this.onLastStand());
    // A Herald firing is the one sound that has to cut through a busy wave: it
    // is the only threat whose damage arrives from somewhere the player is not
    // already looking.
    on('heraldShot', () => {
      this.engine.tone({ freq: 880, freqTo: 300, type: 'sawtooth', attack: 0.003, decay: 0.2, gain: 0.055, filter: 2600, send: 0.35 });
      this.engine.noise({ duration: 0.16, filter: 2200, filterTo: 700, type: 'bandpass', gain: 0.045 });
    });
    on('runStart', () => {
      this.comboStep = 0;
      this.music.overdrive = false;
      this.music.shiftRoot(0);
      this.music.setIntensity(0.18);
      this.music.start();
    });
    on('runEnd', () => this.onRunEnd());
  }

  unbind(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.session = null;
  }

  /** Called each frame so the score can track the run's pressure. */
  update(): void {
    const s = this.session;
    if (!s || s.phase !== 'playing') return;
    // Intensity blends how deep the run is with how hot the player is right now.
    const wavePressure = clamp01((s.director.wave - 1) / 14);
    const comboPressure = clamp01(s.combo / 40);
    const dangerPressure = s.integrity <= 1 ? 0.25 : 0;
    this.music.setIntensity(clamp01(0.2 + wavePressure * 0.5 + comboPressure * 0.35 + dangerPressure));
  }

  // --------------------------------------------------------------- gameplay

  private onHit(quality: string, combo: number, x: number, cx: number, unit: number): void {
    const pan = clamp((x - cx) / (unit * 0.6), -0.7, 0.7);
    this.comboStep = combo;
    const rung = LADDER[Math.min(LADDER.length - 1, Math.floor(this.comboStep / 2))]!;
    const freq = midiToFreq(ROOT + rung);

    switch (quality) {
      case 'block':
        this.engine.tone({
          freq,
          type: 'triangle',
          attack: 0.002,
          decay: 0.13,
          gain: 0.11,
          filter: 4200,
          pan,
          send: 0.18,
        });
        this.engine.noise({ duration: 0.045, filter: 3400, gain: 0.05, pan });
        haptics.tap(6);
        break;

      case 'perfect':
        this.engine.tone({ freq, type: 'triangle', attack: 0.002, decay: 0.2, gain: 0.15, pan, send: 0.28 });
        this.engine.tone({
          freq: freq * 2,
          type: 'sine',
          attack: 0.002,
          decay: 0.26,
          gain: 0.09,
          pan,
          send: 0.4,
          delay: 0.012,
        });
        this.engine.noise({ duration: 0.06, filter: 6200, type: 'highpass', gain: 0.06, pan });
        haptics.tap(11);
        break;

      case 'parry':
        this.engine.chord([freq, freq * 1.5, freq * 2, freq * 3], {
          type: 'triangle',
          attack: 0.003,
          decay: 0.42,
          gain: 0.1,
          pan,
          send: 0.5,
        });
        this.engine.tone({
          freq: freq * 0.5,
          freqTo: freq * 1.6,
          type: 'sawtooth',
          attack: 0.004,
          decay: 0.24,
          gain: 0.12,
          filter: 900,
          filterTo: 5200,
          q: 3,
          pan,
        });
        this.engine.noise({ duration: 0.13, filter: 900, filterTo: 8000, gain: 0.11, pan, send: 0.3 });
        haptics.pattern([16, 24, 22]);
        break;

      case 'chain':
        this.engine.tone({
          freq: freq * 1.5,
          type: 'square',
          attack: 0.002,
          decay: 0.1,
          gain: 0.06,
          filter: 5200,
          pan,
          send: 0.24,
        });
        break;
    }
  }

  private onDamage(fatal: boolean): void {
    this.engine.duck(fatal ? 0.85 : 0.45, fatal ? 1.2 : 0.35);
    this.engine.tone({
      freq: 220,
      freqTo: 48,
      type: 'sawtooth',
      attack: 0.004,
      decay: fatal ? 1.4 : 0.5,
      gain: 0.3,
      filter: 1800,
      filterTo: 180,
      q: 3,
      send: 0.45,
    });
    this.engine.noise({ duration: fatal ? 0.8 : 0.3, filter: 1400, filterTo: 140, gain: 0.2, send: 0.4 });
    haptics.pattern(fatal ? [40, 60, 90] : [30, 40, 20]);
  }

  private onComboBreak(combo: number): void {
    if (combo < 8) return;
    // The ladder falls back down — the inverse of the sound that built it.
    for (let i = 0; i < 4; i++) {
      const rung = LADDER[Math.max(0, Math.min(LADDER.length - 1, Math.floor(combo / 2) - i * 2))]!;
      this.engine.tone({
        freq: midiToFreq(ROOT + rung),
        type: 'triangle',
        attack: 0.003,
        decay: 0.16,
        gain: 0.07,
        delay: i * 0.045,
        send: 0.3,
      });
    }
    this.comboStep = 0;
  }

  private onPulse(success: boolean, caught: number): void {
    this.engine.tone({
      freq: 180,
      freqTo: success ? 1400 : 520,
      type: 'sine',
      attack: 0.003,
      decay: 0.22,
      gain: 0.13,
      send: 0.3,
    });
    this.engine.noise({ duration: 0.18, filter: 400, filterTo: 6000, gain: 0.07, send: 0.25 });
    if (caught >= 4) {
      this.engine.chord([midiToFreq(ROOT + 12), midiToFreq(ROOT + 16), midiToFreq(ROOT + 19), midiToFreq(ROOT + 24)], {
        type: 'triangle',
        attack: 0.004,
        decay: 0.7,
        gain: 0.09,
        send: 0.6,
      });
      haptics.pattern([20, 30, 20, 30, 40]);
    }
  }

  private onOverdrive(): void {
    this.music.overdrive = true;
    this.music.setIntensity(0.9);
    for (let i = 0; i < 5; i++) {
      this.engine.tone({
        freq: midiToFreq(ROOT + LADDER[i * 2]!),
        type: 'sawtooth',
        attack: 0.01,
        hold: 0.08,
        decay: 0.5,
        gain: 0.09,
        filter: 1200,
        filterTo: 6000,
        q: 2,
        delay: i * 0.05,
        send: 0.55,
      });
    }
    haptics.pattern([30, 40, 30, 40, 60]);
  }

  private onWaveStart(wave: number, boss: boolean): void {
    if (boss) return;
    if (wave % 4 === 1 && wave > 1) this.music.shiftRoot();
    this.engine.tone({ freq: 96, freqTo: 52, type: 'sine', attack: 0.004, decay: 0.42, gain: 0.24 });
    this.engine.noise({ duration: 0.5, filter: 180, filterTo: 2400, gain: 0.05, type: 'lowpass', send: 0.4 });
  }

  private onWaveClear(): void {
    [0, 4, 7].forEach((d, i) => {
      this.engine.tone({
        freq: midiToFreq(ROOT + 12 + d),
        type: 'triangle',
        attack: 0.004,
        decay: 0.34,
        gain: 0.08,
        delay: i * 0.06,
        send: 0.5,
      });
    });
  }

  private onBossSpawn(): void {
    this.music.shiftRoot(1);
    this.music.setIntensity(0.85);
    this.engine.duck(0.5, 1.4);
    this.engine.tone({ freq: 58, type: 'sawtooth', attack: 0.6, hold: 0.7, decay: 1.6, gain: 0.22, filter: 320, send: 0.6 });
    this.engine.tone({ freq: 400, freqTo: 60, type: 'square', attack: 0.01, decay: 1.1, gain: 0.1, filter: 900, send: 0.5 });
    this.engine.noise({ duration: 1.4, filter: 120, filterTo: 900, gain: 0.09, type: 'lowpass', send: 0.6 });
    haptics.pattern([60, 80, 60, 80, 120]);
  }

  private onBossKilled(): void {
    this.engine.duck(0.7, 1.1);
    this.engine.noise({ duration: 1.5, filter: 5200, filterTo: 90, gain: 0.24, send: 0.7 });
    this.engine.tone({ freq: 90, freqTo: 34, type: 'sine', attack: 0.003, decay: 1.5, gain: 0.34 });
    [0, 7, 12, 16, 19, 24].forEach((d, i) => {
      this.engine.tone({
        freq: midiToFreq(ROOT + d),
        type: 'triangle',
        attack: 0.006,
        hold: 0.1,
        decay: 1.1,
        gain: 0.09,
        delay: 0.1 + i * 0.055,
        send: 0.7,
      });
    });
    haptics.pattern([80, 60, 120]);
  }

  private onUltimateReady(): void {
    [12, 16, 19].forEach((d, i) =>
      this.engine.tone({
        freq: midiToFreq(ROOT + d),
        type: 'sine',
        attack: 0.02,
        decay: 0.5,
        gain: 0.06,
        delay: i * 0.07,
        send: 0.6,
      }),
    );
  }

  private onUltimateFired(): void {
    this.engine.duck(0.4, 0.7);
    this.engine.tone({
      freq: 120,
      freqTo: 2400,
      type: 'sawtooth',
      attack: 0.01,
      decay: 0.55,
      gain: 0.16,
      filter: 600,
      filterTo: 9000,
      q: 4,
      send: 0.5,
    });
    this.engine.chord([midiToFreq(ROOT), midiToFreq(ROOT + 7), midiToFreq(ROOT + 12), midiToFreq(ROOT + 19)], {
      type: 'sawtooth',
      attack: 0.008,
      hold: 0.14,
      decay: 0.9,
      gain: 0.09,
      filter: 4200,
      send: 0.65,
    });
    this.engine.noise({ duration: 0.7, filter: 300, filterTo: 9000, gain: 0.14, send: 0.5 });
    haptics.pattern([40, 30, 70]);
  }

  /** The turn. Low, loud and slightly detuned — the fight got worse. */
  private onBossEnraged(): void {
    for (const f of [58, 87, 116.5]) {
      this.engine.tone({ freq: f, type: 'sawtooth', attack: 0.01, decay: 1.3, gain: 0.075, filter: 620, send: 0.5 });
    }
    this.engine.noise({ duration: 1.1, filter: 180, filterTo: 1800, type: 'lowpass', gain: 0.08, send: 0.7 });
    this.engine.duck(0.35, 0.8);
    haptics.tap(30);
  }

  private onLastStand(): void {
    for (let i = 0; i < 2; i++) {
      this.engine.tone({
        freq: 880,
        type: 'square',
        attack: 0.004,
        hold: 0.05,
        decay: 0.12,
        gain: 0.07,
        delay: i * 0.22,
        filter: 2400,
      });
    }
    haptics.pattern([50, 80, 50]);
  }

  private onRunEnd(): void {
    this.music.setIntensity(0.12);
    this.music.overdrive = false;
    this.comboStep = 0;
  }

  // ------------------------------------------------------------------ gacha

  /** A rising drone under the summon charge. `progress` is 0..1. */
  summonCharge(progress: number, drama: number): void {
    this.engine.tone({
      freq: 60 + progress * 90,
      freqTo: 90 + progress * 200,
      type: 'sawtooth',
      attack: 0.05,
      hold: 0.1,
      decay: 0.35,
      gain: 0.06 + drama * 0.05,
      filter: 300 + progress * 2200,
      q: 4,
      send: 0.6,
    });
  }

  /** The rarity reveal. Voice count and brightness scale with the tier. */
  summonTell(rarity: Rarity): void {
    const drama = RARITY_STYLE[rarity].drama;
    this.engine.duck(0.55, 1.3);
    const voices = 2 + Math.round(drama * 4);
    const degrees = [0, 7, 12, 16, 19, 24];
    for (let i = 0; i < voices; i++) {
      this.engine.tone({
        freq: midiToFreq(ROOT - 12 + degrees[i % degrees.length]!),
        type: drama > 0.7 ? 'sawtooth' : 'triangle',
        attack: 0.006,
        hold: 0.12 + drama * 0.2,
        decay: 1 + drama * 1.4,
        gain: 0.08,
        filter: 1400 + drama * 5000,
        q: 1.6,
        delay: i * 0.028,
        send: 0.7,
      });
    }
    this.engine.noise({ duration: 0.5 + drama * 0.6, filter: 200, filterTo: 9000, gain: 0.1 + drama * 0.1, send: 0.6 });
    haptics.pattern(drama > 0.7 ? [50, 40, 60, 40, 120] : [30, 40, 50]);
  }

  summonBurst(rarity: Rarity): void {
    const drama = RARITY_STYLE[rarity].drama;
    this.engine.tone({ freq: 140, freqTo: 34, type: 'sine', attack: 0.003, decay: 1.1 + drama, gain: 0.3 });
    this.engine.noise({ duration: 1.1 + drama, filter: 8000, filterTo: 120, gain: 0.18 + drama * 0.1, send: 0.7 });
    if (drama >= 0.6) {
      [0, 4, 7, 11, 14].forEach((d, i) =>
        this.engine.tone({
          freq: midiToFreq(ROOT + d),
          type: 'triangle',
          attack: 0.008,
          hold: 0.12,
          decay: 1.6,
          gain: 0.08,
          delay: 0.12 + i * 0.06,
          send: 0.75,
        }),
      );
    }
  }

  /** A card landing on the results grid. */
  cardReveal(rarity: Rarity, index: number): void {
    const drama = RARITY_STYLE[rarity].drama;
    this.engine.tone({
      freq: midiToFreq(ROOT + LADDER[Math.min(LADDER.length - 1, index)]! + Math.round(drama * 12)),
      type: drama > 0.6 ? 'triangle' : 'sine',
      attack: 0.003,
      decay: 0.28 + drama * 0.5,
      gain: 0.07 + drama * 0.06,
      send: 0.4 + drama * 0.3,
    });
    if (drama >= 0.6) {
      this.engine.noise({ duration: 0.3, filter: 3000, filterTo: 9000, type: 'highpass', gain: 0.06, send: 0.5 });
      haptics.tap(18);
    }
  }

  // --------------------------------------------------------------------- ui

  uiTap(): void {
    this.blip(midiToFreq(ROOT + 7), 0.035, 0.045);
    haptics.tap(4);
  }

  uiConfirm(): void {
    this.blip(midiToFreq(ROOT + 12), 0.05, 0.07);
    this.blip(midiToFreq(ROOT + 19), 0.04, 0.09, 0.04);
    haptics.tap(8);
  }

  /**
   * The draft opening: a rising three-note arpeggio over a soft swell.
   *
   * Deliberately unlike every other cue in the game — nothing else in a run
   * plays a chord — so the sound alone says the wave is over and the next
   * fifteen seconds belong to the player rather than to the director.
   */
  draftOpen(): void {
    this.engine.noise({ duration: 0.55, filter: 300, filterTo: 4200, type: 'bandpass', gain: 0.05, send: 0.6 });
    const notes = [0, 7, 12, 19];
    notes.forEach((n, i) => {
      this.engine.tone({
        freq: midiToFreq(ROOT + 12 + n),
        type: 'triangle',
        attack: 0.006,
        decay: 0.42,
        gain: 0.075 - i * 0.008,
        delay: i * 0.07,
        send: 0.45,
      });
    });
    this.engine.duck(0.4, 0.5);
    haptics.tap(12);
  }

  /** Taking a card: the same chord, landed rather than rising. */
  draftTaken(): void {
    for (const n of [0, 12, 19, 24]) {
      this.engine.tone({
        freq: midiToFreq(ROOT + n),
        type: 'sine',
        attack: 0.003,
        decay: 0.5,
        gain: 0.06,
        send: 0.4,
      });
    }
    haptics.tap(16);
  }

  uiBack(): void {
    this.blip(midiToFreq(ROOT + 5), 0.035, 0.06);
  }

  uiDenied(): void {
    this.engine.tone({ freq: 180, freqTo: 120, type: 'square', attack: 0.004, decay: 0.16, gain: 0.06, filter: 900 });
  }

  private blip(freq: number, gain: number, decay: number, delay = 0): void {
    this.engine.tone({ freq, type: 'sine', attack: 0.002, decay, gain, delay, send: 0.2 });
  }
}

export function createGameAudio(engine: AudioEngine): GameAudio {
  return new GameAudio(engine);
}
