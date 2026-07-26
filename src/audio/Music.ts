/**
 * Adaptive score.
 *
 * A 16-step sequencer running on the AudioContext clock with lookahead
 * scheduling. Six layers fade in and out with an `intensity` value the game
 * drives from wave number, combo and Overdrive, so the music escalates with the
 * run rather than looping indifferently underneath it.
 *
 *   pad      always      sustained fifths, the bed
 *   sub      > 0.05      root note on the downbeats
 *   kick     > 0.12      body thump
 *   pulse    > 0.28      gated eighths, the drive
 *   hats     > 0.34      sixteenth ticks
 *   arp      > 0.5       pentatonic sixteenth arpeggio
 *   lead     > 0.78      sparse melody, effectively the Overdrive layer
 *
 * The scale is minor pentatonic, which cannot produce a wrong note against the
 * pad — that matters when the "composition" is decided by an intensity value at
 * runtime.
 */

import { clamp01, damp } from '../core/math';
import { Rng } from '../core/Rng';
import { AudioEngine, midiToFreq } from './AudioEngine';

const STEPS = 16;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD = 0.12;

/** Minor pentatonic degrees, in semitones from the root. */
const SCALE = [0, 3, 5, 7, 10];

/** Root notes the score rotates through as the run deepens. */
const ROOTS = [33, 31, 36, 29, 34]; // A1, G1, C2, F1, A#1

export class MusicDirector {
  /** 0..1. The game sets this; every layer reads it. */
  targetIntensity = 0;
  private intensity = 0;

  /** Set true during Overdrive for the brighter voicing. */
  overdrive = false;

  private timer: number | null = null;
  private step = 0;
  private nextNoteTime = 0;
  private rootIndex = 0;
  private bar = 0;
  private rng = new Rng('aegis-music');
  private running = false;
  private lastUpdate = 0;

  constructor(private readonly engine: AudioEngine) {}

  get isRunning(): boolean {
    return this.running;
  }

  get bpm(): number {
    // Tempo lifts with intensity, which does more for perceived pressure than
    // any amount of extra percussion.
    return 116 + this.intensity * 26;
  }

  private get stepDuration(): number {
    return 60 / this.bpm / 4;
  }

  start(): void {
    if (this.running || !this.engine.isReady) return;
    this.running = true;
    this.step = 0;
    this.bar = 0;
    this.nextNoteTime = this.engine.now + 0.08;
    this.lastUpdate = performance.now();
    this.timer = window.setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Set the target and let it glide; instant intensity jumps sound like bugs. */
  setIntensity(value: number): void {
    this.targetIntensity = clamp01(value);
  }

  /** Jump to a different tonal centre — used when a boss arrives. */
  shiftRoot(index?: number): void {
    this.rootIndex = index ?? (this.rootIndex + 1) % ROOTS.length;
  }

  private tick(): void {
    if (!this.engine.isReady) return;

    const now = performance.now();
    const dt = Math.min(0.25, (now - this.lastUpdate) / 1000);
    this.lastUpdate = now;
    this.intensity = damp(this.intensity, this.targetIntensity, 0.9, dt);

    while (this.nextNoteTime < this.engine.now + SCHEDULE_AHEAD) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += this.stepDuration;
      this.step = (this.step + 1) % STEPS;
      if (this.step === 0) this.bar++;
    }
  }

  private note(degree: number, octave = 0): number {
    const root = ROOTS[this.rootIndex]!;
    const idx = ((degree % SCALE.length) + SCALE.length) % SCALE.length;
    const oct = Math.floor(degree / SCALE.length) + octave;
    return midiToFreq(root + SCALE[idx]! + oct * 12);
  }

  private scheduleStep(step: number, time: number): void {
    const t = Math.max(0, time - this.engine.now);
    const i = this.intensity;

    // --- pad: one long chord per two bars ---------------------------------
    if (step === 0 && this.bar % 2 === 0) {
      const dur = this.stepDuration * STEPS * 2;
      const voices = this.overdrive ? [0, 2, 4, 7] : [0, 2, 4];
      for (const d of voices) {
        this.engine.tone({
          freq: this.note(d, 2),
          type: 'sawtooth',
          attack: 0.9,
          hold: dur * 0.35,
          decay: dur * 0.7,
          gain: 0.028 + i * 0.018,
          filter: 500 + i * 900,
          q: 0.7,
          delay: t,
          send: 0.5,
          bus: 'music',
          detune: this.rng.signedRange(9),
        });
      }
    }

    // --- sub: root on the downbeat and the "and" of 3 ----------------------
    if (i > 0.05 && (step === 0 || step === 10)) {
      this.engine.tone({
        freq: this.note(0, 0),
        type: 'sine',
        attack: 0.01,
        hold: 0.04,
        decay: this.stepDuration * 3,
        gain: 0.26 + i * 0.1,
        delay: t,
        bus: 'music',
      });
    }

    // --- kick ---------------------------------------------------------------
    if (i > 0.12 && (step === 0 || step === 4 || step === 8 || step === 12)) {
      this.engine.tone({
        freq: 130,
        freqTo: 42,
        type: 'sine',
        attack: 0.002,
        decay: 0.17,
        gain: 0.34 + i * 0.12,
        delay: t,
        bus: 'music',
      });
      this.engine.noise({
        duration: 0.03,
        filter: 2200,
        gain: 0.05 + i * 0.03,
        type: 'highpass',
        delay: t,
        bus: 'music',
      });
    }

    // --- pulse: gated eighths, the main driver ------------------------------
    if (i > 0.28 && step % 2 === 0) {
      const accent = step % 8 === 0 ? 1.25 : 1;
      this.engine.tone({
        freq: this.note(0, 1),
        type: 'sawtooth',
        attack: 0.006,
        decay: this.stepDuration * 1.5,
        gain: (0.05 + i * 0.06) * accent,
        filter: 420 + i * 1500,
        filterTo: 320,
        q: 5,
        delay: t,
        send: 0.14,
        bus: 'music',
      });
    }

    // --- hats ---------------------------------------------------------------
    if (i > 0.34 && step % 2 === 1) {
      this.engine.noise({
        duration: step % 4 === 3 ? 0.07 : 0.03,
        filter: 7200,
        type: 'highpass',
        gain: 0.028 + i * 0.03,
        delay: t,
        pan: this.rng.signedRange(0.35),
        bus: 'music',
      });
    }

    // --- arp ----------------------------------------------------------------
    if (i > 0.5) {
      const pattern = ARP_PATTERNS[this.bar % ARP_PATTERNS.length]!;
      const degree = pattern[step % pattern.length];
      if (degree !== null && degree !== undefined) {
        this.engine.tone({
          freq: this.note(degree, 2),
          type: this.overdrive ? 'square' : 'triangle',
          attack: 0.004,
          decay: this.stepDuration * 2.2,
          gain: 0.035 + i * 0.035,
          filter: 1600 + i * 3200,
          q: 1.4,
          delay: t,
          pan: ((step % 4) - 1.5) * 0.22,
          send: 0.32,
          bus: 'music',
        });
      }
    }

    // --- lead: only at the top of the intensity range -----------------------
    if (i > 0.78 && this.bar % 2 === 1) {
      const lead = LEAD_PATTERN[step];
      if (lead !== null && lead !== undefined) {
        this.engine.tone({
          freq: this.note(lead, 3),
          type: 'sawtooth',
          attack: 0.01,
          hold: this.stepDuration * 0.6,
          decay: this.stepDuration * 3,
          gain: 0.05,
          filter: 3000,
          q: 2.2,
          delay: t,
          send: 0.45,
          bus: 'music',
          detune: 6,
        });
      }
    }
  }
}

/** `null` is a rest. Values are scale degrees. */
const ARP_PATTERNS: Array<Array<number | null>> = [
  [0, null, 2, null, 4, null, 2, null, 5, null, 4, null, 2, null, 0, null],
  [0, 2, 4, 2, 5, 4, 2, 0, 0, 2, 4, 7, 5, 4, 2, 0],
  [4, null, 2, null, 0, null, 2, null, 4, null, 5, null, 7, null, 5, null],
  [0, null, null, 4, null, null, 2, null, 5, null, null, 4, null, 2, null, null],
];

const LEAD_PATTERN: Array<number | null> = [
  7, null, null, 5, null, 4, null, null, 5, null, null, 7, null, null, 9, null,
];
