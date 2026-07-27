/**
 * Draws the arena.
 *
 * Reads `GameSession` state and paints it. No gameplay decisions happen here,
 * which means the whole visual layer can be reworked — or replaced with sprite
 * sheets — without touching a line of simulation code.
 *
 * Layering, back to front:
 *   starfield -> nebula -> grid rings -> back particles -> threat trails ->
 *   threats -> deflected shots -> nexus -> shield -> pulse -> drones ->
 *   front particles
 */

import { TAU, clamp, clamp01, lerp, normalizeAngle } from '../core/math';
import { fxRng } from '../core/Rng';
import type { ParticleSystem } from '../render/Particles';
import type { Renderer } from '../render/Renderer';
import { COLORS, alpha, lighten, mix } from '../render/palette';
import type { TextureStore } from '../render/TextureStore';
import type { GameSession } from './GameSession';
import type { Threat } from './Threat';

interface Star {
  angle: number;
  dist: number;
  size: number;
  brightness: number;
  twinkle: number;
  layer: number;
}

export class GameRenderer {
  private stars: Star[] = [];
  private time = 0;
  /** 0..1 blend toward the Overdrive gold palette. */
  private overdriveBlend = 0;
  /** 0..1 red wash when integrity is critical. */
  private dangerBlend = 0;

  constructor(
    private readonly renderer: Renderer,
    private readonly textures: TextureStore,
    private readonly particles: ParticleSystem,
  ) {
    this.buildStars();
    renderer.onResize(() => this.buildStars());
  }

  private buildStars(): void {
    const { minSide, width, height } = this.renderer.view;
    const reach = Math.hypot(width, height) / 2;
    const count = Math.round(clamp((width * height) / 5200, 90, 320));
    this.stars = [];
    for (let i = 0; i < count; i++) {
      const layer = fxRng.int(0, 2);
      this.stars.push({
        angle: fxRng.angle(),
        dist: Math.sqrt(fxRng.next()) * reach,
        size: minSide * fxRng.range(0.0014, 0.0042) * (1 + layer * 0.4),
        brightness: fxRng.range(0.18, 0.85),
        twinkle: fxRng.range(0.4, 2.4),
        layer,
      });
    }
  }

  update(dt: number, session: GameSession): void {
    this.time += dt;
    const targetOverdrive = session.overdrive ? 1 : 0;
    this.overdriveBlend += (targetOverdrive - this.overdriveBlend) * Math.min(1, dt * 4);

    const critical = session.phase === 'playing' && session.integrity <= 1 ? 1 : 0;
    this.dangerBlend += (critical - this.dangerBlend) * Math.min(1, dt * 3);
  }

  /** Accent colour for the current game state — everything tints off this. */
  get accent(): string {
    let c = COLORS.aegis;
    if (this.overdriveBlend > 0.01) c = mix(c, COLORS.overdrive, this.overdriveBlend);
    if (this.dangerBlend > 0.01) c = mix(c, COLORS.threat, this.dangerBlend * 0.55);
    return c;
  }

  draw(session: GameSession): void {
    const { renderer } = this;
    const arena = session.arena;

    this.drawBackground(session);
    this.particles.draw(renderer, true);
    this.drawEdgeWarnings(session);
    this.drawThreatTrails(session);
    this.drawThreats(session);
    this.drawNexus(session);
    this.drawShield(session);
    this.drawPulse(session);
    this.drawSentinels(session);
    this.drawMagnetize(session);
    this.particles.draw(renderer, false);
    void arena;
  }

  // ------------------------------------------------------------- background

  private drawBackground(session: GameSession): void {
    const { ctx, view } = this.renderer;
    const arena = session.arena;
    const accent = this.accent;

    // Base wash — a cool void that warms slightly toward the nexus.
    const g = ctx.createRadialGradient(arena.cx, arena.cy, 0, arena.cx, arena.cy, Math.max(view.width, view.height) * 0.75);
    g.addColorStop(0, mix(COLORS.deep, accent, 0.1 + this.overdriveBlend * 0.08));
    g.addColorStop(0.45, COLORS.abyss);
    g.addColorStop(1, COLORS.void);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.width, view.height);

    // Starfield, each layer rotating at its own rate for cheap parallax.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      const rot = this.time * (0.006 + s.layer * 0.004);
      const a = s.angle + rot;
      const x = arena.cx + Math.cos(a) * s.dist;
      const y = arena.cy + Math.sin(a) * s.dist;
      const tw = 0.65 + 0.35 * Math.sin(this.time * s.twinkle + s.angle * 7);
      ctx.globalAlpha = s.brightness * tw * 0.85;
      ctx.fillStyle = s.layer === 2 ? lighten(accent, 0.5) : '#DCE9FF';
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // Nebula: two slow, offset radial washes. Cheap, and it stops the void
    // reading as a flat black rectangle.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 2; i++) {
      const a = this.time * (0.05 + i * 0.03) + i * 2.1;
      const r = arena.unit * (0.65 + i * 0.25);
      const nx = arena.cx + Math.cos(a) * arena.unit * 0.22;
      const ny = arena.cy + Math.sin(a * 0.8) * arena.unit * 0.18;
      const ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, r);
      const col = i === 0 ? accent : COLORS.ultimate;
      ng.addColorStop(0, alpha(col, 0.055 + this.overdriveBlend * 0.04));
      ng.addColorStop(1, alpha(col, 0));
      ctx.fillStyle = ng;
      ctx.fillRect(0, 0, view.width, view.height);
    }
    ctx.restore();

    // Concentric guide rings. These are not decoration: they tell the player
    // where the pulse band and the shield radius sit.
    this.drawGuideRings(session);
  }

  private drawGuideRings(session: GameSession): void {
    const { ctx } = this.renderer;
    const arena = session.arena;
    const accent = this.accent;

    ctx.save();
    ctx.translate(arena.cx, arena.cy);

    // Slow counter-rotating tick rings.
    for (let i = 0; i < 2; i++) {
      const scale = i === 0 ? arena.shieldR * 2.34 : arena.shieldR * 1.55;
      ctx.save();
      ctx.rotate(this.time * (i === 0 ? 0.035 : -0.055));
      ctx.globalAlpha = i === 0 ? 0.32 : 0.2;
      this.textures.draw(ctx, 'nexus/ring', 0, 0, { width: scale, height: scale, tint: accent, tintAmount: 0.9 });
      ctx.restore();
    }

    // The shield radius itself — a hairline the player subconsciously reads.
    ctx.globalAlpha = 1;
    ctx.strokeStyle = alpha(accent, 0.16);
    ctx.lineWidth = Math.max(1, arena.unit * 0.0016);
    ctx.beginPath();
    ctx.arc(0, 0, arena.shieldR, 0, TAU);
    ctx.stroke();

    // Danger ring: pulses when integrity is low.
    if (this.dangerBlend > 0.02) {
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 5.5);
      ctx.strokeStyle = alpha(COLORS.threat, 0.1 + this.dangerBlend * pulse * 0.3);
      ctx.lineWidth = arena.unit * 0.004;
      ctx.beginPath();
      ctx.arc(0, 0, arena.nexusR * 1.9, 0, TAU);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---------------------------------------------------------------- threats

  /**
   * Chevrons on the screen edge marking where an off-screen threat will enter.
   *
   * A threat spawns on a rectangle just beyond the viewport, so on a narrow
   * phone one arriving from the side is hidden for roughly half its approach
   * while one arriving from above is visible for most of it. Same travel time,
   * very different warning — and at high waves, where the whole approach is
   * about a second, that difference decides runs.
   *
   * The marker fades in as the threat nears the edge and hands off to the
   * threat itself the moment it becomes visible, so nothing arrives unannounced
   * regardless of the angle it came from.
   */
  private drawEdgeWarnings(session: GameSession): void {
    const { ctx, view } = this.renderer;
    const arena = session.arena;
    // Far enough in that the marker never gets clipped by the viewport edge.
    const inset = Math.max(18, view.minSide * 0.042);
    const halfW = view.width / 2 - inset;
    const halfH = view.height / 2 - inset;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const t of session.pool.live) {
      if (!t.active || t.state !== 'incoming' || t.delay > 0) continue;

      const dx = t.x - arena.cx;
      const dy = t.y - arena.cy;
      // Only threats still outside the visible area need announcing.
      const outside = Math.abs(dx) > halfW || Math.abs(dy) > halfH;
      if (!outside) continue;

      // Where the ray from the nexus through the threat crosses the inset rect.
      const scale = Math.min(
        Math.abs(dx) > 1e-3 ? halfW / Math.abs(dx) : Number.POSITIVE_INFINITY,
        Math.abs(dy) > 1e-3 ? halfH / Math.abs(dy) : Number.POSITIVE_INFINITY,
      );
      if (!Number.isFinite(scale)) continue;
      const ex = arena.cx + dx * scale;
      const ey = arena.cy + dy * scale;

      // Present from the moment it exists, brightening and pulsing faster as it
      // nears the edge. A marker that only appears at the last instant is not a
      // warning, it is a jump scare.
      const dist = Math.hypot(dx, dy);
      const edgeDist = Math.hypot(dx * scale, dy * scale);
      const lead = Math.max(1, arena.edgeRadius(t.angle) - edgeDist);
      const approach = clamp01(1 - (dist - edgeDist) / lead);
      const pulse = 0.72 + 0.28 * Math.sin(this.time * (4 + approach * 10));
      const a = (0.28 + 0.72 * approach) * pulse * 0.95;

      const col = threatColor(t);
      const size = view.minSide * (0.019 + approach * 0.011);
      const facing = Math.atan2(-dy, -dx); // pointing inward

      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(facing);
      ctx.globalAlpha = a;

      // A short tail on the outside reads as "coming from over there".
      const tail = ctx.createLinearGradient(-size * 2.4, 0, -size * 0.4, 0);
      tail.addColorStop(0, alpha(col, 0));
      tail.addColorStop(1, alpha(col, 0.55));
      ctx.fillStyle = tail;
      ctx.fillRect(-size * 2.4, -size * 0.14, size * 2, size * 0.28);

      ctx.fillStyle = lighten(col, 0.25);
      ctx.beginPath();
      ctx.moveTo(size * 1.0, 0);
      ctx.lineTo(-size * 0.45, -size * 0.66);
      ctx.lineTo(-size * 0.12, 0);
      ctx.lineTo(-size * 0.45, size * 0.66);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      this.renderer.glowOnly((c) => {
        c.save();
        c.globalCompositeOperation = 'lighter';
        this.textures.draw(c, 'fx/glow', ex, ey, {
          width: size * 5,
          height: size * 5,
          tint: col,
          alpha: a * 0.6,
        });
        c.restore();
      }, 0.8);
    }
    ctx.restore();
  }

  private drawThreatTrails(session: GameSession): void {
    const { ctx } = this.renderer;
    const arena = session.arena;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const t of session.pool.live) {
      if (!t.active || t.delay > 0 || t.state === 'dying') continue;
      const col = threatColor(t);
      const len = t.state === 'deflected' ? t.size * 6.5 : t.size * 3.4;
      const dir = t.state === 'deflected' ? Math.atan2(t.vy, t.vx) + Math.PI : t.angle;
      const tx = t.x + Math.cos(dir) * len;
      const ty = t.y + Math.sin(dir) * len;

      // The trail must stay subordinate to the silhouette. At full width it
      // merges with the sprite and every archetype reads as the same capsule,
      // which defeats the point of giving them different shapes.
      const g = ctx.createLinearGradient(t.x, t.y, tx, ty);
      g.addColorStop(0, alpha(col, t.state === 'deflected' ? 0.7 : 0.34));
      g.addColorStop(0.35, alpha(col, t.state === 'deflected' ? 0.3 : 0.14));
      g.addColorStop(1, alpha(col, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = t.size * (t.state === 'deflected' ? 1.15 : 0.66) * t.scale;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.restore();
    void arena;
  }

  private drawThreats(session: GameSession): void {
    const { renderer } = this;
    for (const t of session.pool.live) {
      if (!t.active || t.delay > 0) continue;
      const scale = (t.size * 2) / Math.max(1, this.textures.get(t.def.texture).w);
      const s = scale * t.scale * (1 + t.flash * 0.12);
      const dying = t.state === 'dying';
      const a = dying ? clamp01(t.deathTimer / 0.22) : 1;

      renderer.emissive(
        (c) => {
          this.textures.draw(c, t.def.texture, t.x, t.y, {
            rotation: t.facing,
            scale: s,
            alpha: a,
            composite: 'source-over',
          });
          if (t.flash > 0.02) {
            c.save();
            c.globalCompositeOperation = 'lighter';
            this.textures.draw(c, t.def.texture, t.x, t.y, {
              rotation: t.facing,
              scale: s,
              alpha: t.flash * 0.9,
              tint: '#FFFFFF',
            });
            c.restore();
          }
        },
        t.state === 'deflected' ? 1.15 : 0.8,
      );

      // Boss health arc.
      if (t.boss && t.state !== 'dying') this.drawBossHealth(session, t);
    }
  }

  private drawBossHealth(session: GameSession, t: Threat): void {
    const { ctx } = this.renderer;
    const r = t.size * 1.32;
    const frac = clamp01(t.hp / t.maxHp);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.lineCap = 'round';
    ctx.strokeStyle = alpha('#000000', 0.45);
    ctx.lineWidth = t.size * 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU);
    ctx.stroke();
    ctx.strokeStyle = frac > 0.35 ? COLORS.threat : COLORS.parry;
    ctx.lineWidth = t.size * 0.1;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
    ctx.stroke();
    ctx.restore();
    void session;
  }

  // ------------------------------------------------------------------ nexus

  private drawNexus(session: GameSession): void {
    const { renderer } = this;
    const arena = session.arena;
    const accent = this.accent;
    const breathe = 1 + Math.sin(this.time * 1.9) * 0.02;
    const hurt = session.invuln > 0 ? Math.sin(session.invuln * 44) * 0.5 + 0.5 : 0;
    const size = arena.nexusR * 2 * breathe * (1 + hurt * 0.06);

    // Ground glow.
    renderer.glowOnly((c) => {
      c.save();
      c.globalCompositeOperation = 'lighter';
      this.textures.draw(c, 'fx/glow', arena.cx, arena.cy, {
        width: arena.nexusR * 7,
        height: arena.nexusR * 7,
        tint: accent,
        alpha: 0.5 + this.overdriveBlend * 0.25,
      });
      c.restore();
    }, 0.9);

    renderer.emissive((c) => {
      this.textures.draw(c, 'nexus/core', arena.cx, arena.cy, {
        width: size,
        height: size,
        rotation: this.time * 0.22,
        tint: this.overdriveBlend > 0.02 || this.dangerBlend > 0.02 ? accent : undefined,
        tintAmount: Math.max(this.overdriveBlend, this.dangerBlend) * 0.7,
      });
      if (hurt > 0.01) {
        c.save();
        c.globalCompositeOperation = 'lighter';
        this.textures.draw(c, 'nexus/core', arena.cx, arena.cy, {
          width: size,
          height: size,
          rotation: this.time * 0.22,
          tint: COLORS.threat,
          alpha: hurt * 0.7,
        });
        c.restore();
      }
    }, 1);

    this.drawIntegrity(session);
  }

  /** Integrity pips ride just outside the nexus — always in the player's focus. */
  private drawIntegrity(session: GameSession): void {
    const { ctx } = this.renderer;
    const arena = session.arena;
    const n = session.maxIntegrity;
    if (n <= 0) return;
    const r = arena.nexusR * 1.5;
    const pipR = clamp(arena.nexusR * 0.14, 2.5, 7);

    ctx.save();
    ctx.translate(arena.cx, arena.cy);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + ((i - (n - 1) / 2) / Math.max(1, n)) * 1.5;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      const alive = i < session.integrity;
      ctx.globalCompositeOperation = alive ? 'lighter' : 'source-over';
      ctx.fillStyle = alive ? alpha(COLORS.nexus, 0.95) : alpha('#2A3450', 0.9);
      ctx.beginPath();
      ctx.arc(x, y, pipR, 0, TAU);
      ctx.fill();
      if (alive) {
        ctx.strokeStyle = alpha('#FFFFFF', 0.8);
        ctx.lineWidth = pipR * 0.35;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ----------------------------------------------------------------- shield

  private drawShield(session: GameSession): void {
    this.drawShieldArc(session, session.shieldAngle, 1);
    if (session.mirror) this.drawShieldArc(session, session.shieldAngle + Math.PI, 0.78);
  }

  private drawShieldArc(session: GameSession, centre: number, strength: number): void {
    const { renderer } = this;
    const arena = session.arena;
    const half = session.arcHalf;
    const accent = this.accent;
    const thickness = arena.shieldHalfThickness * 2;

    // The arc is drawn as a strip of segments so brightness can fall off toward
    // the tips and spike in the PERFECT zone — a conic gradient could not do
    // both, and the segment count is trivial at these sizes.
    const segments = Math.max(14, Math.min(96, Math.round((half * 2) / 0.05)));

    renderer.emissive(
      (c) => {
        c.save();
        c.translate(arena.cx, arena.cy);
        c.globalCompositeOperation = 'lighter';
        c.lineCap = 'butt';

        for (let i = 0; i < segments; i++) {
          const t0 = i / segments;
          const t1 = (i + 1) / segments;
          const a0 = centre - half + t0 * half * 2;
          const a1 = centre - half + t1 * half * 2;
          const mid = (t0 + t1) / 2;
          // Falloff toward the tips.
          const edge = 1 - Math.pow(Math.abs(mid - 0.5) * 2, 2.6);
          // The PERFECT window burns brighter so the player learns where it is.
          const perfectZone = Math.abs(mid - 0.5) * 2 <= 0.34 ? 1 : 0;
          const intensity = (0.45 + edge * 0.55 + perfectZone * 0.35) * strength;

          c.strokeStyle = alpha(mix(accent, '#FFFFFF', 0.25 + perfectZone * 0.35), intensity * 0.9);
          c.lineWidth = thickness * (0.75 + edge * 0.45);
          c.beginPath();
          c.arc(0, 0, arena.shieldR, a0, a1 + 0.002);
          c.stroke();
        }

        // Crisp leading edge.
        c.strokeStyle = alpha(lighten(accent, 0.6), 0.85 * strength);
        c.lineWidth = Math.max(1.2, thickness * 0.22);
        c.beginPath();
        c.arc(0, 0, arena.shieldR + thickness * 0.42, centre - half, centre + half);
        c.stroke();

        // Tip caps.
        for (const sgn of [-1, 1]) {
          const a = centre + sgn * half;
          const x = Math.cos(a) * arena.shieldR;
          const y = Math.sin(a) * arena.shieldR;
          c.fillStyle = alpha(lighten(accent, 0.75), 0.9 * strength);
          c.beginPath();
          c.arc(x, y, thickness * 0.42, 0, TAU);
          c.fill();
        }
        c.restore();
      },
      1.15 * strength,
    );

    // Inner aiming ray — a faint line to the shield centre. Reads as intent and
    // makes the drag feel connected to the shield.
    const { ctx } = this.renderer;
    ctx.save();
    ctx.translate(arena.cx, arena.cy);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(0, 0, Math.cos(centre) * arena.shieldR, Math.sin(centre) * arena.shieldR);
    g.addColorStop(0, alpha(accent, 0));
    g.addColorStop(1, alpha(accent, 0.18 * strength));
    ctx.strokeStyle = g;
    ctx.lineWidth = arena.unit * 0.003;
    ctx.beginPath();
    ctx.moveTo(Math.cos(centre) * arena.nexusR * 1.4, Math.sin(centre) * arena.nexusR * 1.4);
    ctx.lineTo(Math.cos(centre) * arena.shieldR * 0.94, Math.sin(centre) * arena.shieldR * 0.94);
    ctx.stroke();
    ctx.restore();
  }

  private drawPulse(session: GameSession): void {
    if (!session.pulseActive) return;
    const { renderer } = this;
    const arena = session.arena;
    const t = clamp01(session.pulseTimer / session.stats.pulseWindow);
    const fade = 1 - Math.pow(t, 1.8);
    const size = session.pulseRadius * 2.35;

    renderer.emissive(
      (c) => {
        c.save();
        c.globalCompositeOperation = 'lighter';
        this.textures.draw(c, 'fx/ring', arena.cx, arena.cy, {
          width: size,
          height: size,
          tint: COLORS.parry,
          alpha: fade * 0.95,
        });
        c.restore();
      },
      1.4 * fade,
    );

    // A hard bright edge exactly at the lethal radius, so timing is learnable.
    const { ctx } = this.renderer;
    ctx.save();
    ctx.translate(arena.cx, arena.cy);
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = alpha('#FFFFFF', fade * 0.75);
    ctx.lineWidth = arena.unit * 0.0035;
    ctx.beginPath();
    ctx.arc(0, 0, session.pulseRadius, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  private drawSentinels(session: GameSession): void {
    const drones = session.getSentinels();
    if (drones.length === 0) return;
    const { renderer } = this;
    const arena = session.arena;
    const size = arena.px(0.055);

    for (const d of drones) {
      const x = arena.polarX(d.angle, d.radius);
      const y = arena.polarY(d.angle, d.radius);
      renderer.emissive(
        (c) => {
          c.save();
          c.globalCompositeOperation = 'lighter';
          this.textures.draw(c, 'fx/glow-aegis', x, y, { width: size * 2.4, height: size * 2.4, alpha: 0.6 });
          this.textures.draw(c, 'ui/core', x, y, { width: size, height: size, rotation: this.time * 3 });
          c.restore();
        },
        1.1,
      );
    }
  }

  private drawMagnetize(session: GameSession): void {
    if (session.ult.id !== 'magnetize' || session.ult.gatherTimer <= 0) return;
    const { renderer } = this;
    const t = 1 - clamp01(session.ult.gatherTimer / 0.95);
    const size = session.arena.px(0.22) * (0.4 + t * 1.2);
    renderer.emissive(
      (c) => {
        c.save();
        c.globalCompositeOperation = 'lighter';
        this.textures.draw(c, 'fx/glow-ultimate', session.ult.gatherX, session.ult.gatherY, {
          width: size,
          height: size,
          alpha: 0.5 + t * 0.5,
        });
        c.restore();
      },
      1.5,
    );
  }
}

export function threatColor(t: Threat): string {
  switch (t.kind) {
    case 'orb':
      return COLORS.threat;
    case 'lancer':
      return '#FF7A4D';
    case 'splitter':
      return '#C86BFF';
    case 'bulwark':
      return '#5C7CFF';
    case 'seeker':
      return '#FFC24D';
    case 'herald':
      return '#59F2C8';
    case 'warden':
      return COLORS.mythic;
  }
}

/** Shared helper so HUD and VFX agree on where an angle lands on screen. */
export function polarPoint(cx: number, cy: number, angle: number, radius: number): { x: number; y: number } {
  return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
}

export { lerp, normalizeAngle };
