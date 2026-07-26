/**
 * A no-op Canvas2D context for tests.
 *
 * happy-dom has no canvas implementation, and pulling in node-canvas to run a
 * few `arc()` calls would add a native build step to every install for no
 * benefit — nothing here asserts on pixels. This stub accepts every drawing
 * call and returns plausible objects, so the *logic* around rasterisation
 * (caching, key resolution, atlas override) can be tested while the drawing
 * itself is a no-op.
 */

const NOOP = (): void => {};

function makeGradient(): CanvasGradient {
  return { addColorStop: NOOP } as unknown as CanvasGradient;
}

function makeContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    canvas,
    // Style state — assignable, never read back by the code under test.
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    letterSpacing: '0px',
    shadowBlur: 0,
    shadowColor: 'transparent',
    lineDashOffset: 0,
  };

  const methods = [
    'save', 'restore', 'translate', 'rotate', 'scale', 'setTransform', 'resetTransform', 'transform',
    'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect',
    'quadraticCurveTo', 'bezierCurveTo', 'fill', 'stroke', 'clip', 'clearRect', 'fillRect',
    'strokeRect', 'fillText', 'strokeText', 'drawImage', 'putImageData', 'setLineDash',
  ];
  for (const name of methods) ctx[name] = NOOP;

  ctx.createLinearGradient = makeGradient;
  ctx.createRadialGradient = makeGradient;
  ctx.createConicGradient = makeGradient;
  ctx.createPattern = (): CanvasPattern | null => null;
  ctx.measureText = (text: string): TextMetrics => ({ width: text.length * 6 }) as TextMetrics;
  ctx.getLineDash = (): number[] => [];
  ctx.createImageData = (w: number, h: number): ImageData =>
    ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData;
  ctx.getImageData = (_x: number, _y: number, w: number, h: number): ImageData =>
    ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }) as ImageData;

  return ctx as unknown as CanvasRenderingContext2D;
}

/** Install the stub. Safe to call more than once. */
export function installCanvasStub(): void {
  if (typeof HTMLCanvasElement === 'undefined') return;
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown;
    toDataURL: () => string;
    __stubbed?: boolean;
  };
  if (proto.__stubbed) return;
  proto.__stubbed = true;
  proto.getContext = function getContext(this: HTMLCanvasElement, id: string): unknown {
    return id === '2d' ? makeContext(this) : null;
  };
  proto.toDataURL = (): string => 'data:image/png;base64,';
}
