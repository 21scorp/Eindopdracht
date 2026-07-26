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
import { textures } from '../render/TextureStore';
import { registerProceduralArt } from '../render/procgen';
import { GUARDIANS, getGuardian } from '../data/guardians';
import { REWARDS, XP } from '../data/balance';
import { GameSession } from '../game/GameSession';
import { GameRenderer } from '../game/GameRenderer';
import { Vfx } from '../game/Vfx';
import { Hud } from '../game/Hud';
import type { RunStats } from '../game/events';
import { Profile } from '../meta/Profile';
import { ScreenStack } from '../ui/Screen';

export type AppMode = 'menu' | 'playing' | 'cinema';

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

  mode: AppMode = 'menu';

  /** Set while a cinematic owns the canvas. Returns true when it is finished. */
  cinematic: { update(dt: number): void; draw(): void; done: boolean } | null = null;

  /** Idle-arena state so the menu background stays alive. */
  private menuTime = 0;

  private lastRunStats: RunStats | null = null;
  private lastRunRewards: RunRewards | null = null;

  private adaptiveTimer = 0;
  private lowFrameStreak = 0;
  /** True while a press that started on a canvas HUD button is still held. */
  private hudCaptured = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.profile = new Profile();

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
    this.screens = new ScreenStack(uiRoot);

    this.renderer.onResize((view) => {
      this.session.arena.update(view);
    });

    this.session.events.on('runEnd', ({ stats }) => this.handleRunEnd(stats));

    this.loop = new Loop({
      update: (dt) => this.update(dt),
      render: (dt) => this.render(dt),
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.profile.save();
        if (this.mode === 'playing') this.pause();
      } else {
        this.loop.resetClock();
      }
    });

    window.addEventListener('pagehide', () => this.profile.save());
  }

  // ------------------------------------------------------------------- boot

  async boot(): Promise<void> {
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

    this.camera.setVignette(this.session.integrity <= 1 ? 1 : 0);
  }

  private updateMenu(dt: number): void {
    this.menuTime += dt;
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
      }
    }

    this.camera.apply(r);
    r.composite();
    r.endFrame();

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
    this.mode = 'menu';
    this.input.suppressed = true;
    this.session.phase = 'idle';
    this.camera.reset();
    this.screens.replace(screen);
  }

  startRun(): void {
    const id = this.profile.equipped;
    const guardian = getGuardian(id);
    const owned = this.profile.owned(id);
    const seed = `${this.profile.data.playerId}-${Date.now()}`;

    this.screens.closeAll();
    this.mode = 'playing';
    this.input.suppressed = false;
    this.hud.reset();
    this.particles.clear();
    this.camera.reset();
    this.session.arena.update(this.renderer.view);
    this.session.start(guardian, owned?.level ?? 1, owned?.stars ?? 1, seed);
    this.vfx.showBanner('HOLD THE LINE', guardian.name, guardian.hue, 1.6);
  }

  pause(): void {
    if (this.mode !== 'playing') return;
    this.input.suppressed = true;
    this.screens.push('pause');
  }

  resume(): void {
    if (this.mode !== 'playing') return;
    this.screens.closeAll();
    this.input.suppressed = false;
    this.loop.resetClock();
  }

  abandonRun(): void {
    if (this.mode !== 'playing') return;
    this.session.end();
  }

  private handleRunEnd(stats: RunStats): void {
    this.lastRunStats = stats;
    this.lastRunRewards = this.payoutRun(stats);
    this.mode = 'menu';
    this.input.suppressed = true;
    this.profile.save();
    this.screens.replace('results', { stats, rewards: this.lastRunRewards });
  }

  /** Convert a run into currency and XP. */
  private payoutRun(stats: RunStats): RunRewards {
    this.profile.rollDailyIfNeeded();
    const earnedToday = this.profile.data.daily.coresEarned;

    const raw = stats.score * REWARDS.coresPerScore + stats.wave * REWARDS.coresPerWave;
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

  get lastRun(): { stats: RunStats; rewards: RunRewards } | null {
    if (!this.lastRunStats || !this.lastRunRewards) return null;
    return { stats: this.lastRunStats, rewards: this.lastRunRewards };
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

  /** Push accessibility and performance settings into the engine. */
  syncSettings(): void {
    const s = this.profile.settings;
    this.camera.intensity = clamp(s.screenShake, 0, 1);
    this.renderer.effectScale = s.reducedFlash ? 0.28 : 1;
    this.hud.mirrored = s.leftHanded;
    this.applyQualitySetting();
  }
}
