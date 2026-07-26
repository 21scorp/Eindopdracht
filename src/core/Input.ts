/**
 * Pointer and keyboard input, normalised into the handful of gestures the game
 * actually cares about.
 *
 * The whole game is playable with one thumb:
 *   - drag anywhere      -> aim the shield (angle relative to the nexus)
 *   - tap (short, still) -> PULSE
 *   - second finger tap  -> ULTIMATE
 *
 * Keyboard exists so the game is testable on desktop and accessible without a
 * touchscreen: arrow keys / A-D aim, space pulses, shift fires the ultimate.
 */

import { TAU, normalizeAngle } from './math';

export interface PointerSample {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: number;
  active: boolean;
}

/** A tap is a press shorter than this that never travelled further than TAP_SLOP. */
const TAP_MAX_DURATION = 0.24;
const TAP_SLOP = 18;

export type InputAction = 'pulse' | 'ultimate' | 'confirm' | 'back';

export class Input {
  private pointers = new Map<number, PointerSample>();
  private keys = new Set<string>();
  private actionQueue: InputAction[] = [];
  private disposers: Array<() => void> = [];

  /** Latest primary pointer position in CSS pixels relative to the canvas. */
  x = 0;
  y = 0;
  /** True while at least one pointer is down. */
  isDown = false;
  /** True on the frame a pointer first went down. */
  justPressed = false;
  /** True on the frame the last pointer came up. */
  justReleased = false;
  /** Number of currently active pointers. */
  pointerCount = 0;

  /** Keyboard aim axis, -1 (counter-clockwise) .. 1 (clockwise). */
  aimAxis = 0;

  /** Set true while the player is interacting with DOM UI, to suppress gameplay input. */
  suppressed = false;

  /**
   * True on devices with a precise pointer. Those aim on hover — requiring a
   * held mouse button to move the shield is exhausting on desktop, while on
   * touch there is no hover to read and a drag is the natural gesture.
   */
  readonly hoverAim: boolean;

  /** True once any touch input has been seen, which disables hover aiming. */
  private sawTouch = false;

  constructor(private readonly element: HTMLElement) {
    this.hoverAim = window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
    this.attach();
  }

  /** Should the shield follow the pointer right now? */
  get shouldAim(): boolean {
    return this.isDown || (this.hoverAim && !this.sawTouch);
  }

  private attach(): void {
    const el = this.element;

    const toLocal = (e: PointerEvent): { x: number; y: number } => {
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onDown = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') this.sawTouch = true;
      if (this.suppressed) return;
      const { x, y } = toLocal(e);
      this.pointers.set(e.pointerId, {
        id: e.pointerId,
        x,
        y,
        startX: x,
        startY: y,
        startTime: performance.now() / 1000,
        moved: 0,
        active: true,
      });
      if (this.pointers.size === 1) {
        this.x = x;
        this.y = y;
        this.justPressed = true;
      } else {
        // A second finger is the ultimate gesture.
        this.actionQueue.push('ultimate');
      }
      this.isDown = true;
      this.pointerCount = this.pointers.size;
      el.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e: PointerEvent): void => {
      if (e.pointerType === 'touch') this.sawTouch = true;
      const p = this.pointers.get(e.pointerId);
      if (!p) {
        // Hover movement with no button held — used for desktop aiming.
        if (this.hoverAim && e.pointerType === 'mouse') {
          const local = toLocal(e);
          this.x = local.x;
          this.y = local.y;
        }
        return;
      }
      const { x, y } = toLocal(e);
      p.moved += Math.hypot(x - p.x, y - p.y);
      p.x = x;
      p.y = y;
      if (this.primaryId === e.pointerId) {
        this.x = x;
        this.y = y;
      }
    };

    const onUp = (e: PointerEvent): void => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const duration = performance.now() / 1000 - p.startTime;
      const isTap = duration <= TAP_MAX_DURATION && p.moved <= TAP_SLOP;
      const wasPrimary = this.primaryId === e.pointerId;
      this.pointers.delete(e.pointerId);
      this.pointerCount = this.pointers.size;
      if (this.pointers.size === 0) {
        this.isDown = false;
        this.justReleased = true;
      }
      if (isTap && wasPrimary && !this.suppressed) {
        this.actionQueue.push('pulse');
      }
      el.releasePointerCapture?.(e.pointerId);
    };

    const onCancel = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      this.pointerCount = this.pointers.size;
      if (this.pointers.size === 0) this.isDown = false;
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.actionQueue.push('pulse');
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
        case 'KeyQ':
          this.actionQueue.push('ultimate');
          break;
        case 'Enter':
          this.actionQueue.push('confirm');
          break;
        case 'Escape':
          this.actionQueue.push('back');
          break;
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      this.keys.delete(e.code);
    };

    const onBlur = (): void => {
      this.keys.clear();
      this.pointers.clear();
      this.pointerCount = 0;
      this.isDown = false;
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    this.disposers.push(
      () => el.removeEventListener('pointerdown', onDown),
      () => el.removeEventListener('pointermove', onMove),
      () => window.removeEventListener('pointerup', onUp),
      () => window.removeEventListener('pointercancel', onCancel),
      () => window.removeEventListener('keydown', onKeyDown),
      () => window.removeEventListener('keyup', onKeyUp),
      () => window.removeEventListener('blur', onBlur),
    );
  }

  private get primaryId(): number | undefined {
    return this.pointers.keys().next().value;
  }

  /** Angle from a world point to the primary pointer, normalised to [0, TAU). */
  angleFrom(cx: number, cy: number): number {
    return normalizeAngle(Math.atan2(this.y - cy, this.x - cx));
  }

  /** Distance from a world point to the primary pointer. */
  distanceFrom(cx: number, cy: number): number {
    return Math.hypot(this.x - cx, this.y - cy);
  }

  isKeyDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** Consume all queued discrete actions for this frame. */
  drainActions(): InputAction[] {
    if (this.actionQueue.length === 0) return EMPTY_ACTIONS;
    const out = this.actionQueue;
    this.actionQueue = [];
    return out;
  }

  /** Call once per frame, after gameplay has read the state. */
  endFrame(): void {
    this.justPressed = false;
    this.justReleased = false;

    let axis = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) axis -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) axis += 1;
    this.aimAxis = axis;
  }

  /** True if the keyboard is currently driving aim, so pointer aim should yield. */
  get usingKeyboardAim(): boolean {
    return this.aimAxis !== 0;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.pointers.clear();
    this.keys.clear();
  }
}

const EMPTY_ACTIONS: InputAction[] = [];

/** Utility: normalise a delta between two angles onto a dial of `segments`. */
export function angleToSegment(angle: number, segments: number): number {
  return Math.floor((normalizeAngle(angle) / TAU) * segments) % segments;
}
