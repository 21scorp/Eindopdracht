/**
 * Haptics.
 *
 * `navigator.vibrate` is Android-only in practice — iOS Safari ignores it — so
 * this is a bonus, never load-bearing. Every call is cheap and silently does
 * nothing where unsupported.
 *
 * Rate limiting matters more than it looks: firing a vibration on every block
 * during a 40-combo makes the phone buzz continuously, which reads as a fault
 * rather than as feedback.
 */

const MIN_INTERVAL_MS = 45;

class Haptics {
  enabled = true;
  private last = 0;
  private readonly supported =
    typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  private canFire(): boolean {
    if (!this.enabled || !this.supported) return false;
    const now = performance.now();
    if (now - this.last < MIN_INTERVAL_MS) return false;
    this.last = now;
    return true;
  }

  /** A single short pulse, in milliseconds. */
  tap(ms = 8): void {
    if (!this.canFire()) return;
    try {
      navigator.vibrate(Math.max(1, Math.min(40, ms)));
    } catch {
      /* nothing to do */
    }
  }

  /** An on/off pattern. Values alternate vibrate/pause. */
  pattern(steps: number[]): void {
    if (!this.canFire()) return;
    try {
      navigator.vibrate(steps.map((s) => Math.max(1, Math.min(200, s))));
    } catch {
      /* nothing to do */
    }
  }

  stop(): void {
    if (!this.supported) return;
    try {
      navigator.vibrate(0);
    } catch {
      /* nothing to do */
    }
  }
}

export const haptics = new Haptics();
