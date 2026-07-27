/**
 * @vitest-environment happy-dom
 *
 * Highlight clips.
 *
 * The recorder itself needs a real encoder, so it is exercised by the browser
 * smoke test. What is tested here is the part that decides things: which
 * container to ask for, which of the two rolling segments to keep, and when a
 * run has become worth recording. Those are the decisions that quietly ruin a
 * feature — a WebM nobody can upload, a half-second clip, a recorder that runs
 * for the whole of every run and costs frames for nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  CLIP_FORMATS,
  HIGHLIGHT_COMBO,
  chooseSegment,
  clipFileName,
  pickFormat,
  shouldArm,
  type ClipSegment,
} from '../src/meta/ClipRecorder';

const seg = (seconds: number, parts = 1): ClipSegment => ({
  parts: Array.from({ length: parts }, () => new Blob(['x'])),
  seconds,
});

describe('container choice', () => {
  it('prefers MP4, because the platforms will not take WebM', () => {
    const format = pickFormat(() => true);
    expect(format?.extension).toBe('mp4');
    expect(format?.social).toBe(true);
  });

  it('falls back to WebM and admits it is not shareable', () => {
    const format = pickFormat((t) => t.startsWith('video/webm'));
    expect(format?.extension).toBe('webm');
    expect(format?.social).toBe(false);
  });

  it('prefers the more efficient WebM codec when both exist', () => {
    const format = pickFormat((t) => t.includes('vp9') || t === 'video/webm');
    expect(format?.mimeType).toContain('vp9');
  });

  it('returns null rather than guessing when nothing is supported', () => {
    expect(pickFormat(() => false)).toBeNull();
  });

  it('survives a browser whose isTypeSupported throws', () => {
    expect(() =>
      pickFormat((t) => {
        if (t.startsWith('video/mp4')) throw new TypeError('nope');
        return t === 'video/webm';
      }),
    ).not.toThrow();
    expect(pickFormat((t) => {
      if (t.startsWith('video/mp4')) throw new TypeError('nope');
      return t === 'video/webm';
    })?.extension).toBe('webm');
  });

  it('lists every candidate with a matching extension and mime type', () => {
    for (const f of CLIP_FORMATS) {
      expect(f.mimeType.startsWith(`video/${f.extension}`)).toBe(true);
      expect(f.social).toBe(f.extension === 'mp4');
    }
  });
});

describe('picking a segment', () => {
  it('keeps the live segment, which is the one containing the ending', () => {
    expect(chooseSegment(seg(12), seg(20), 3.5)?.seconds).toBe(12);
  });

  it('falls back to the previous segment when the live one is a stub', () => {
    expect(chooseSegment(seg(0.4), seg(19), 3.5)?.seconds).toBe(19);
  });

  it('keeps a short live segment when there is nothing else', () => {
    expect(chooseSegment(seg(1.2), null, 3.5)?.seconds).toBe(1.2);
  });

  it('handles a run that ended before the first segment closed', () => {
    expect(chooseSegment(null, seg(8), 3.5)?.seconds).toBe(8);
    expect(chooseSegment(null, null, 3.5)).toBeNull();
  });

  it('prefers a longer previous segment only when the live one is too short', () => {
    // Live is long enough: the ending wins even though the other is longer.
    expect(chooseSegment(seg(4), seg(20), 3.5)?.seconds).toBe(4);
  });
});

describe('file names', () => {
  it('describes the run without spaces or surprises', () => {
    expect(clipFileName({ wave: 12, score: 84_233.4, guardianId: 'vane' }, 'mp4')).toBe(
      'prismbreak-vane-w12-84233.mp4',
    );
  });

  it('slugs an id that is not already safe', () => {
    expect(clipFileName({ wave: 1, score: 0, guardianId: 'Nyx Prime' }, 'webm')).toBe('prismbreak-nyx-prime-w1-0.webm');
  });
});

describe('when to record', () => {
  const base = { integrity: 3, combo: 0, bossPresent: false, phase: 'playing' };

  it('stays off during an ordinary early wave', () => {
    expect(shouldArm(base)).toBe(false);
  });

  it('arms on the last life', () => {
    expect(shouldArm({ ...base, integrity: 1 })).toBe(true);
  });

  it('arms for a boss', () => {
    expect(shouldArm({ ...base, bossPresent: true })).toBe(true);
  });

  it('arms once a combo is clearly going somewhere', () => {
    expect(shouldArm({ ...base, combo: HIGHLIGHT_COMBO - 1 })).toBe(false);
    expect(shouldArm({ ...base, combo: HIGHLIGHT_COMBO })).toBe(true);
  });

  it('still arms while the death beat plays, so the ending is captured', () => {
    expect(shouldArm({ ...base, integrity: 0, phase: 'dying' })).toBe(true);
  });

  it('never arms outside a run', () => {
    for (const phase of ['idle', 'intro', 'over']) {
      expect(shouldArm({ integrity: 1, combo: 99, bossPresent: true, phase })).toBe(false);
    }
  });
});
