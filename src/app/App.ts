/**
 * Application shell.
 *
 * Owns the engine objects, the profile, the screen stack and the single game
 * loop that drives all of them. Screens never touch the renderer directly; they
 * ask the app to change mode, and the app decides what gets simulated and drawn.
 *
 * Three modes:
 *   menu    the arena idles behind translucent UI (it doubles as the menu art)
 *   playing full simulation, canvas HUD, DOM out of the way
 *   cinema  a full-screen canvas sequence owns the frame (the gacha pull)
 */

import { Loop } from '../core/Loop';
import { Input } from '../core/Input';
import { clamp } from '../core/math';
import { Renderer, type Quality } from '../render/Renderer';
import { ParticleSystem } from '../render/Particles';
import { Camera } from '../render/Camera';
import { DebugOverlay } from '../render/DebugOverlay';
import { textures } from '../render/TextureStore';
import { registerProceduralArt } from '../render/procgen';
import { GUARDIANS, getGuardian } from '../data/guardians';
import { REWARDS, XP } from '../data/balance';
import { GameSession } from '../game/GameSession';
import { GameRenderer } from '../game/GameRenderer';
import { Vfx } from '../game/Vfx';
import { Hud } from '../game/Hud';
import { Coach } from '../game/Coach';
import type { RunStats } from '../game/events';
import { Profile } from '../meta/Profile';
import { QuestTracker, type QuestView } from '../meta/quests';
import { ClipRecorder, shouldArm, type ClipResult } from '../meta/ClipRecorder';
import { RESONANCE_BY_ID } from '../data/resonance';
import { dailyRunNumber, dailyRunSeed } from '../meta/dailyRun';
import { clearChallengeFromUrl, evaluateChallenge, readChallengeFromUrl, type Challenge } from '../meta/challenge';
import { ScreenStack } from '../ui/Screen';
import { audio } from '../audio/AudioEngine';
import { GameAudio } from '../audio/GameAudio';
import { haptics } from '../audio/haptics';

export type AppMode = 'menu' | 'playing' | 'cinema';

export interface ChallengeResult {
  challenge: Challenge;
  outcome: 'beaten' | 'missed';
  margin: number;
}

export interface RunRewards {
  cores: number;
  prisms: number;
  xp: number;
  personalBest: boolean;
  levelsGained: number;
  softCapped: boolean;
}

export class App {
  readonly renderer: Renderer;
  readonly input: Input;
  readonly particles: ParticleSystem;
  readonly camera: Camera;
  readonly session: GameSession;
  readonly gameRenderer: GameRenderer;
  readonly vfx: Vfx;
  readonly hud: Hud;
  readonly profile: Profile;
  readonly screens: ScreenStack;
  readonly loop: Loop;
  readonly audio: GameAudio;
  readonly coach: Coach;
  readonly debug: DebugOverlay;
  readonly quests: QuestTracker;
  readonly clips: ClipRecorder;

  mode: AppMode = 'menu';

  /** True while a run is frozen behind the pause menu. */
  paused = false;

  /** Set while a cinematic owns the canvas. Returns true when it is finished. */
  cinematic: { update(dt: number): void; draw(): void; done: boolean } | null = null;

  /** Idle-arena state so the menu background stays alive. */
  private menuTime = 0;

  /** True while the current run is today's shared-seed Daily Run. */
  dailyRunActive = false;
  /** Set when the finished run was a Daily Run, for the results screen. */
  lastDaily: { number: number; best: number; plays: number; improved: boolean; rewarded: boolean } | null = null;

  /** A challenge read from the URL, waiting to be accepted. */
  pendingChallenge: Challenge | null = null;
  /** The challenge the current run is attempting, if any. */
  activeChallenge: Challenge | null = null;

  private lastRunStats: RunStats | null = null;
  private lastRunRewards: RunRewards | null = null;

  /** Resolves with the finished highlight clip, or null when there is none. */
  lastClip: Promise<ClipResult | null> = Promise.resolve(null);

  private adaptiveTimer = 0;
  private lowFrameStreak = 0;
  private clipStress = 0;
  private clipBaselineFps = 60;
  /** True while a press that started on a canvas HUD button is still held. */
  private hudCaptured = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.profile = new Profile();
    this.quests = new QuestTracker(this.profile);

    this.renderer = new Renderer(canvas);
    this.applyQualitySetting();

    this.input = new Input(canvas);
    this.particles = new ParticleSystem(textures, 1600);
    this.camera = new Camera();
    this.camera.intensity = this.profile.settings.screenShake;

    registerProceduralArt(
      textures,
      GUARDIANS.map((g) => ({ id: g.id, rarity: g.rarity, shape: g.shape, hue: g.hue })),
    );

    this.session = new GameSession();
    this.session.arena.update(this.renderer.view);
    this.gameRenderer = new GameRenderer(this.renderer, textures, this.particles);
    this.vfx = new Vfx(this.session, this.particles, this.camera, this.renderer);
    this.hud = new Hud(this.renderer, textures);
    this.coach = new Coach(this.renderer);
    this.debug = new DebugOverlay(this.renderer);
    this.screens = new ScreenStack(uiRoot);

    this.audio = new GameAudio(audio);
    this.audio.bind(this.session);
    this.clips = new ClipRecorder(canvas, audio);
    audio.install();
    this.syncSettings();

    this.renderer.onResize((view) => {
      // Everything in flight is stored in pixels against the old arena, so the
      // session has to be told how much the arena moved, not just that it did.
      const a = this.session.arena;
      const previous = { shieldR: a.shieldR, cx: a.cx, cy: a.cy };
      a.update(view);
      if (this.mode === 'playing') this.session.rescale(previous);
    });

    this.session.events.on('runEnd', ({ stats }) => this.handleRunEnd(stats));
    this.session.events.on('waveClear', ({ wave }) => this.offerResonance(wave));

    this.loop = new Loop({
      update: (dt) => this.update(dt),
      render: (dt) => this.render(dt),
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.profile.save();
        this.audio.music.stop();
        if (this.mode === 'playing') this.pause();
      } else {
        this.loop.resetClock();
        if (this.mode === 'playing') this.audio.music.start();
      }
    });

    window.addEventListener('pagehide', () => this.profile.save());
  }

  // ------------------------------------------------------------------- boot

  async boot(): Promise<void> {
    // A challenge link is the first thing a new player may ever see, so it is
    // read before anything else decides what screen to open.
    this.pendingChallenge = readChallengeFromUrl();
    clearChallengeFromUrl();

    // If a real sprite atlas has been dropped into /public/assets, it silently
    // takes over every texture key. Otherwise the procedural art is used.
    await textures.tryLoadAtlas('assets/atlas.json');

    // Warm the textures the first frames need so boot does not stutter.
    textures.preload([
      'nexus/core',
      'nexus/ring',
      'fx/spark',
      'fx/glow',
      'fx/ring',
      'threat/orb',
      'ui/prism',
      'ui/core',
      'ui/shard',
    ]);

    this.loop.start();
  }

  // ----------------------------------------------------------------- update

  private update(dt: number): void {
    // The camera ticks on real time so hitstop expires while everything else
    // is frozen.
    this.camera.update(dt);

    switch (this.mode) {
      case 'playing':
        this.updatePlaying(dt);
        break;
      case 'menu':
        this.updateMenu(dt);
        break;
      case 'cinema':
        this.cinematic?.update(dt);
        if (this.cinematic?.done) this.cinematic = null;
        this.particles.update(dt);
        break;
    }

    this.screens.update(dt);
    this.input.endFrame();
  }

  private updatePlaying(dt: number): void {
    // A paused run is frozen, not merely deaf to input. Everything below the
    // input block advances the world, so the early return has to come first:
    // without it the pause menu was a way to lose a run while reading it.
    if (this.paused) {
      this.input.drainActions();
      this.hudCaptured = false;
      return;
    }

    const simDt = this.camera.isFrozen ? 0 : dt;

    if (!this.input.suppressed) {
      // HUD buttons are drawn on the canvas, so they are hit-tested here rather
      // than by the DOM. A press that lands on one captures the gesture so it
      // neither aims the shield nor fires a pulse on release.
      if (this.input.justPressed && !this.hudCaptured) {
        if (this.hud.hitTest(this.input.x, this.input.y, this.hud.hit.pause)) {
          this.hudCaptured = true;
          this.pause();
        } else if (this.hud.hitTest(this.input.x, this.input.y, this.hud.hit.ultimate)) {
          this.hudCaptured = true;
          this.session.fireUltimate();
        }
      }

      if (this.hudCaptured) {
        this.input.drainActions();
        if (!this.input.isDown) this.hudCaptured = false;
      } else {
        for (const action of this.input.drainActions()) {
          if (action === 'pulse') this.session.pulse();
          else if (action === 'ultimate') this.session.fireUltimate();
          else if (action === 'back') this.pause();
        }
        if (this.input.usingKeyboardAim) {
          this.session.aimAxis(this.input.aimAxis, dt);
        } else if (this.input.shouldAim) {
          this.session.aimAt(this.input.x, this.input.y);
        }
      }
    } else {
      this.input.drainActions();
      this.hudCaptured = false;
    }

    this.session.update(simDt);
    this.particles.update(simDt);
    this.gameRenderer.update(dt, this.session);
    this.vfx.update(dt);
    this.vfx.ambient(simDt);
    this.hud.update(dt, this.session);
    this.coach.suppressed = this.vfx.bannerVisible;
    this.coach.update(dt, this.session);
    this.audio.update();

    this.camera.setVignette(this.session.integrity <= 1 ? 1 : 0);
    this.considerClip(dt);
  }

  /**
   * Start recording once the run turns into something worth watching, and stop
   * paying for it if the device cannot afford it.
   *
   * The affordability test is relative, not absolute. A phone that was already
   * running at 40fps is not being hurt by the encoder, and killing its clip on
   * an absolute threshold would mean nobody on a mid-range device ever gets one.
   * What matters is the drop from the rate the run was holding a moment before
   * the recorder armed.
   */
  private considerClip(dt: number): void {
    if (!this.profile.settings.clips || !this.clips.supported) return;

    if (this.clips.recording) {
      const floor = Math.max(20, this.clipBaselineFps * 0.72);
      this.clipStress = this.loop.fps < floor ? this.clipStress + dt : 0;
      // Two solid seconds below the floor is the encoder, not a hitch.
      if (this.clipStress > 2) {
        console.info(
          `[App] highlight capture abandoned — ${this.loop.fps.toFixed(0)}fps against a ${floor.toFixed(0)}fps floor`,
        );
        this.clips.abandon();
      }
      return;
    }

    const arm = shouldArm({
      integrity: this.session.integrity,
      combo: this.session.combo,
      bossPresent: this.session.pool.findBoss() !== null,
      phase: this.session.phase,
    });
    if (arm) {
      this.clipStress = 0;
      this.clipBaselineFps = this.loop.fps;
      this.clips.start();
    }
  }

  private updateMenu(dt: number): void {
    this.menuTime += dt;
    // The score starts as soon as the browser lets us make sound, not when a
    // run begins — silence on the home screen makes the game feel unfinished.
    if (!this.audio.music.isRunning) this.audio.music.start();
    this.particles.update(dt);
    this.gameRenderer.update(dt, this.session);
    this.vfx.update(dt);
    // Consume input so a tap on the arena behind a menu does nothing.
    this.input.drainActions();
  }

  // ----------------------------------------------------------------- render

  private render(dt: number): void {
    const r = this.renderer;
    r.begin();

    if (this.mode === 'cinema' && this.cinematic) {
      this.cinematic.draw();
    } else {
      this.gameRenderer.draw(this.session);
      if (this.mode === 'playing') {
        this.vfx.draw();
        this.hud.draw(this.session, this.gameRenderer.accent);
        this.coach.draw(this.session);
      }
    }

    this.camera.apply(r);
    r.composite();

    // After the composite, so the readout is not itself blurred and shaken.
    this.debug.sample(dt);
    this.debug.draw({
      fps: this.loop.fps,
      quality: this.renderer.quality,
      entities: this.session.pool.live.length,
      particles: this.particles.count,
      textures: textures.stats.generated,
      atlas: textures.atlasLoaded,
    });

    r.endFrame();

    // After `endFrame`, so the clip carries the finished, composited image —
    // bloom, grain, HUD and all — rather than a bare scene buffer.
    if (this.mode === 'playing' && !this.paused) this.clips.frame();

    this.adaptiveQuality(dt);
  }

  /**
   * Drop quality if the device cannot hold the frame budget. A gacha game that
   * stutters during a pull feels broken in a way no amount of art fixes.
   */
  private adaptiveQuality(dt: number): void {
    if (this.profile.settings.quality !== 'auto') return;
    this.adaptiveTimer += dt;
    if (dt > 1 / 45) this.lowFrameStreak++;
    else this.lowFrameStreak = Math.max(0, this.lowFrameStreak - 1);

    if (this.adaptiveTimer < 3) return;
    this.adaptiveTimer = 0;

    if (this.lowFrameStreak > 40 && this.renderer.quality !== 'low') {
      const next: Quality = this.renderer.quality === 'high' ? 'medium' : 'low';
      this.renderer.applyQuality(next);
      this.lowFrameStreak = 0;
      console.info(`[App] quality reduced to ${next} (fps ${this.loop.fps.toFixed(0)})`);
    }
  }

  private applyQualitySetting(): void {
    const q = this.profile.settings.quality;
    if (q !== 'auto') this.renderer.applyQuality(q);
  }

  // ------------------------------------------------------------------- flow

  /** Enter the menu mode: the arena idles as a live background. */
  showMenu(screen = 'home'): void {
    // A cinematic left running would never complete — only `cinema` mode ticks
    // it — and its completion callback is what releases the screen that started
    // it. Leaving one hanging is how the Summon buttons end up disabled for the
    // rest of the session.
    if (this.cinematic) this.endCinematic();
    this.mode = 'menu';
    this.audio.music.setIntensity(0.1);
    this.input.suppressed = true;
    this.session.phase = 'idle';
    this.camera.reset();
    this.screens.replace(screen);
  }

  /**
   * Today's shared seed.
   *
   * Not a separate mode: the same run with a fixed seed, so everything that
   * works in a normal run — the draft, the clip, the share card — works here
   * without a second code path to keep in step.
   */
  startDailyRun(): void {
    this.activeChallenge = null;
    this.pendingChallenge = null;
    // Set *after* the run starts, because `startRun` clears the flag for every
    // caller. Deriving it from the seed instead would mean a hand-crafted
    // challenge link carrying today's seed counted as a Daily attempt.
    this.startRun(dailyRunSeed());
    this.dailyRunActive = true;
  }

  /** Replay a challenger's exact wave sequence. */
  startChallengeRun(challenge: Challenge): void {
    this.activeChallenge = challenge;
    this.pendingChallenge = null;
    this.startRun(challenge.seed);
  }

  clearChallenge(): void {
    this.pendingChallenge = null;
    this.activeChallenge = null;
  }

  startRun(seedOverride?: string): void {
    // Every run is an ordinary run unless `startDailyRun` says otherwise
    // immediately afterwards — including "again" from a Daily's results.
    this.dailyRunActive = false;
    const id = this.profile.equipped;
    const guardian = getGuardian(id);
    const owned = this.profile.owned(id);
    const seed = seedOverride ?? `${this.profile.data.playerId}-${Date.now()}`;
    if (!seedOverride) this.activeChallenge = null;
    this.hud.challengeTarget = this.activeChallenge?.score ?? 0;

    this.screens.closeAll();
    this.paused = false;
    this.clips.discard();
    this.lastClip = Promise.resolve(null);
    this.clipStress = 0;
    this.mode = 'playing';
    this.input.suppressed = false;
    this.hud.reset();
    this.particles.clear();
    this.camera.reset();
    this.session.arena.update(this.renderer.view);
    this.session.start(guardian, owned?.level ?? 1, owned?.stars ?? 1, seed);
    this.vfx.showBanner('HOLD THE LINE', guardian.name, guardian.hue, 1.6);

    // First run ever: coach the two verbs in situ rather than up front.
    if (!this.profile.hasSeenTip('basics')) {
      this.coach.start(() => this.profile.markTipSeen('basics'));
    } else {
      this.coach.stop();
    }
  }

  /**
   * Open the draft, if this wave owes one.
   *
   * Deliberately on `waveClear` rather than on the next wave starting: the
   * director's calm beat is already a pause in the action, so the draft lands
   * in a gap instead of interrupting one.
   */
  private offerResonance(wave: number): void {
    if (this.mode !== 'playing' || this.paused) return;
    if (!this.session.draftDue(wave)) return;
    const offer = this.session.rollOffer(wave);
    if (offer.length === 0) return;

    this.paused = true;
    this.clips.pauseRecording();
    this.input.suppressed = true;
    this.audio.music.setIntensity(0.35);
    this.audio.draftOpen();
    this.screens.push('resonance', { offer, wave });
  }

  /** Take a card and drop straight back into the run. */
  takeResonance(id: string): void {
    if (!this.session.takeResonance(id)) return;
    this.audio.draftTaken();
    this.screens.closeAll();
    this.paused = false;
    this.clips.resumeRecording();
    this.input.suppressed = false;
    this.loop.resetClock();
    const def = RESONANCE_BY_ID.get(id);
    if (def) this.vfx.showBanner(def.name, def.text, this.gameRenderer.accent, 1.5);
  }

  pause(): void {
    if (this.mode !== 'playing' || this.paused) return;
    this.paused = true;
    this.clips.pauseRecording();
    this.input.suppressed = true;
    this.screens.push('pause');
  }

  resume(): void {
    if (this.mode !== 'playing') return;
    this.paused = false;
    this.clips.resumeRecording();
    this.screens.closeAll();
    this.input.suppressed = false;
    // Escape reaches here through the DOM handler, but the same keypress also
    // queued a `back` action on the input layer — which the next frame would
    // read as "pause" and put the menu straight back up. Whatever was pressed
    // to get here has already been acted on.
    this.input.drainActions();
    // The loop has been accumulating real time behind the menu; without this
    // the first frame back would step the simulation by however long the menu
    // was open.
    this.loop.resetClock();
  }

  abandonRun(): void {
    if (this.mode !== 'playing') return;
    this.paused = false;
    this.session.end();
  }

  private handleRunEnd(stats: RunStats): void {
    // Kick this off before anything else: the encoder needs a moment to flush,
    // and the results screen picks the promise up and shows the button late.
    this.lastClip = this.clips.recording ? this.clips.finish() : Promise.resolve(null);
    this.lastRunStats = stats;
    this.lastRunRewards = this.payoutRun(stats);
    // Quests read the finished run's own stats rather than subscribing to
    // events, so a system that re-emits one cannot double-count progress.
    this.lastQuestsCompleted = this.quests.recordRun(stats);

    if (this.dailyRunActive) {
      const { improved, rewarded } = this.profile.recordDailyRun({ score: stats.score, wave: stats.wave });
      const record = this.profile.dailyRun;
      this.lastDaily = {
        number: dailyRunNumber(record.date),
        best: record.best,
        plays: record.plays,
        improved,
        rewarded,
      };
    } else {
      this.lastDaily = null;
    }
    this.lastChallengeResult = this.activeChallenge
      ? { challenge: this.activeChallenge, ...evaluateChallenge(this.activeChallenge, stats.score) }
      : null;
    this.mode = 'menu';
    this.input.suppressed = true;
    this.profile.save();
    this.screens.replace('results', {
      stats,
      rewards: this.lastRunRewards,
      challenge: this.lastChallengeResult,
      questsCompleted: this.lastQuestsCompleted,
      daily: this.lastDaily,
    });
  }

  private lastQuestsCompleted: QuestView[] = [];

  private lastChallengeResult: ChallengeResult | null = null;

  /** Convert a run into currency and XP. */
  private payoutRun(stats: RunStats): RunRewards {
    this.profile.rollDailyIfNeeded();
    const earnedToday = this.profile.data.daily.coresEarned;

    // CORE TITHE and friends multiply the raw take, before the daily soft cap —
    // a card that says "30% more Cores" has to mean it on the runs where it
    // matters, not only on the ones under the cap.
    const raw = (stats.score * REWARDS.coresPerScore + stats.wave * REWARDS.coresPerWave) * (stats.coreMult ?? 1);
    // Beyond the daily soft cap, earnings continue at a reduced rate rather
    // than stopping. A hard wall punishes the players who play the most.
    const beforeCap = Math.max(0, REWARDS.dailyCoreSoftCap - earnedToday);
    const uncapped = Math.min(raw, beforeCap);
    const capped = (raw - uncapped) * REWARDS.softCapRate;
    let cores = Math.round(uncapped + capped);

    const { personalBest } = this.profile.recordRun({
      score: stats.score,
      wave: stats.wave,
      combo: stats.maxCombo,
      kills: stats.kills,
      parries: stats.parries,
      perfects: stats.perfects,
      bossKills: stats.bossKills,
      seconds: stats.duration,
    });
    if (personalBest) cores += REWARDS.coresPersonalBest;

    let prisms = 0;
    for (let i = 0; i < stats.wave; i++) {
      if (this.profile.rng.chance(REWARDS.prismChancePerWave)) prisms += REWARDS.prismPerDrop;
    }
    this.profile.commitGacha();

    const xp = Math.round(stats.score * XP.perScore + stats.wave * XP.perWave);

    if (cores > 0) this.profile.credit('cores', cores, 'run');
    if (prisms > 0) this.profile.credit('prisms', prisms, 'run');
    this.profile.noteCoresEarned(cores);
    const { levelsGained } = this.profile.addXp(xp);

    return {
      cores,
      prisms,
      xp,
      personalBest,
      levelsGained,
      softCapped: capped > 0,
    };
  }

  get lastRun(): { stats: RunStats; rewards: RunRewards; challenge: ChallengeResult | null } | null {
    if (!this.lastRunStats || !this.lastRunRewards) return null;
    return { stats: this.lastRunStats, rewards: this.lastRunRewards, challenge: this.lastChallengeResult };
  }

  // -------------------------------------------------------------- cinematic

  /** Hand the canvas to a cinematic sequence until it reports `done`. */
  playCinematic(seq: { update(dt: number): void; draw(): void; done: boolean }): void {
    this.cinematic = seq;
    this.mode = 'cinema';
  }

  endCinematic(): void {
    this.cinematic = null;
    this.mode = 'menu';
  }

  /** Push accessibility, audio and performance settings into the engine. */
  syncSettings(): void {
    const s = this.profile.settings;
    this.camera.intensity = clamp(s.screenShake, 0, 1);
    this.renderer.effectScale = s.reducedFlash ? 0.28 : 1;
    this.hud.mirrored = s.leftHanded;
    haptics.enabled = s.haptics;
    this.debug.enabled = s.showFps;
    audio.setVolumes(s.music, s.sfx);
    this.applyQualitySetting();
  }
}
