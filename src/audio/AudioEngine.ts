/**
 * Audio.
 *
 * Everything is synthesised at runtime — no sample files, so the bundle stays
 * tiny, nothing needs licensing, and a sound can be tuned by changing a number
 * instead of re-exporting a wav.
 *
 * Structure:
 *
 *   ctx
 *    ├─ master (gain, limiter-ish soft clip)
 *    │   ├─ musicBus  ── reverb send
 *    │   └─ sfxBus    ── reverb send
 *    └─ reverb (convolver over a generated impulse)
 *
 * Browsers will not start an AudioContext without a gesture, so the engine
 * boots suspended and `unlock()` is wired to the first pointer or key event.
 */

import { clamp, clamp01 } from '../core/math';

export interface ToneOptions {
  freq: number;
  /** Slide to this frequency over the note's life. */
  freqTo?: number;
  type?: OscillatorType;
  attack?: number;
  hold?: number;
  decay?: number;
  gain?: number;
  detune?: number;
  /** Low-pass cutoff; omit for no filter. */
  filter?: number;
  filterTo?: number;
  q?: number;
  /** Seconds from now. */
  delay?: number;
  /** 0 = centre, -1 = left, 1 = right. */
  pan?: number;
  /** Reverb send, 0..1. */
  send?: number;
  bus?: 'sfx' | 'music';
}

export interface NoiseOptions {
  duration: number;
  gain?: number;
  filter?: number;
  filterTo?: number;
  q?: number;
  type?: BiquadFilterType;
  attack?: number;
  delay?: number;
  pan?: number;
  send?: number;
  bus?: 'sfx' | 'music';
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbReturn!: GainNode;
  private noiseBuffer!: AudioBuffer;

  private musicVolume = 0.55;
  private sfxVolume = 0.8;
  private started = false;
  private unlockHandlers: Array<() => void> = [];

  /** Voice budget: prevents a 40-particle wave clear from producing 40 notes. */
  private voices = 0;
  private readonly maxVoices = 26;
  private lastVoiceReset = 0;

  get isReady(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  /** Wire up the one-time unlock. Safe to call before any user interaction. */
  install(): void {
    const unlock = (): void => {
      void this.unlock();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, unlock, { once: false, passive: true });
      this.unlockHandlers.push(() => window.removeEventListener(ev, unlock));
    }
  }

  async unlock(): Promise<void> {
    if (this.started) {
      if (this.ctx?.state === 'suspended') await this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor({ latencyHint: 'interactive' });
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);

      this.reverb = ctx.createConvolver();
      this.reverb.buffer = makeImpulse(ctx, 2.1, 2.6);
      this.reverbReturn = ctx.createGain();
      this.reverbReturn.gain.value = 0.5;
      this.reverb.connect(this.reverbReturn);
      this.reverbReturn.connect(this.master);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxVolume;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);

      this.noiseBuffer = makeNoise(ctx, 2);

      this.started = true;
      if (ctx.state === 'suspended') await ctx.resume();
      for (const off of this.unlockHandlers) off();
      this.unlockHandlers = [];
    } catch (err) {
      console.warn('[Audio] could not start', err);
    }
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = clamp01(music);
    this.sfxVolume = clamp01(sfx);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musicBus.gain.setTargetAtTime(this.musicVolume, t, 0.06);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume, t, 0.06);
  }

  /** Duck the music briefly — used under the summon burst and on death. */
  duck(amount: number, seconds: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicVolume * (1 - clamp01(amount)), t + 0.05);
    g.linearRampToValueAtTime(this.musicVolume, t + 0.05 + seconds);
  }

  get musicDestination(): GainNode | null {
    return this.ctx ? this.musicBus : null;
  }

  get reverbNode(): ConvolverNode | null {
    return this.ctx ? this.reverb : null;
  }

  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  private bus(name: 'sfx' | 'music'): GainNode {
    return name === 'music' ? this.musicBus : this.sfxBus;
  }

  /** Reserve a voice slot; returns false when the budget is spent this frame. */
  private takeVoice(): boolean {
    if (!this.ctx) return false;
    const t = this.ctx.currentTime;
    if (t - this.lastVoiceReset > 0.05) {
      this.voices = 0;
      this.lastVoiceReset = t;
    }
    if (this.voices >= this.maxVoices) return false;
    this.voices++;
    return true;
  }

  /** A single synthesised note. */
  tone(opts: ToneOptions): void {
    const ctx = this.ctx;
    if (!ctx || !this.takeVoice()) return;

    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const attack = opts.attack ?? 0.004;
    const hold = opts.hold ?? 0;
    const decay = opts.decay ?? 0.18;
    const peak = opts.gain ?? 0.2;

    const osc = ctx.createOscillator();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, opts.freq), t0);
    if (opts.freqTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqTo), t0 + attack + hold + decay);
    }
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t0);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    if (hold > 0) env.gain.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);

    let node: AudioNode = osc;
    if (opts.filter !== undefined) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(opts.filter, t0);
      if (opts.filterTo !== undefined) {
        f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.filterTo), t0 + attack + hold + decay);
      }
      f.Q.value = opts.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(env);

    this.route(env, opts.pan ?? 0, opts.send ?? 0, opts.bus ?? 'sfx');

    osc.start(t0);
    osc.stop(t0 + attack + hold + decay + 0.05);
  }

  /** A filtered noise burst — impacts, air, texture. */
  noise(opts: NoiseOptions): void {
    const ctx = this.ctx;
    if (!ctx || !this.takeVoice()) return;

    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const attack = opts.attack ?? 0.002;
    const peak = opts.gain ?? 0.15;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 1;

    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.filter ?? 1800, t0);
    if (opts.filterTo !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(60, opts.filterTo), t0 + opts.duration);
    }
    f.Q.value = opts.q ?? 1.2;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

    src.connect(f);
    f.connect(env);
    this.route(env, opts.pan ?? 0, opts.send ?? 0, opts.bus ?? 'sfx');

    src.start(t0);
    src.stop(t0 + opts.duration + 0.05);
  }

  /** Several tones at once. */
  chord(freqs: number[], opts: Omit<ToneOptions, 'freq'>): void {
    freqs.forEach((f, i) => this.tone({ ...opts, freq: f, delay: (opts.delay ?? 0) + i * 0.006 }));
  }

  private route(source: AudioNode, pan: number, send: number, bus: 'sfx' | 'music'): void {
    const ctx = this.ctx!;
    let out: AudioNode = source;
    if (pan !== 0 && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      out.connect(p);
      out = p;
    }
    out.connect(this.bus(bus));
    if (send > 0) {
      const s = ctx.createGain();
      s.gain.value = clamp01(send);
      out.connect(s);
      s.connect(this.reverb);
    }
  }

  dispose(): void {
    for (const off of this.unlockHandlers) off();
    this.unlockHandlers = [];
    void this.ctx?.close();
    this.ctx = null;
    this.started = false;
  }
}

/** Exponentially decaying noise, used as a cheap reverb impulse response. */
function makeImpulse(ctx: AudioContext, seconds: number, decay: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // A short pre-delay of near-silence makes the tail read as a space
      // rather than as a smear over the transient.
      const pre = t < 0.012 ? t / 0.012 : 1;
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * pre;
    }
  }
  return buffer;
}

function makeNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(1, length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** Equal-temperament frequency for a MIDI note number. */
export function midiToFreq(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

export const audio = new AudioEngine();
