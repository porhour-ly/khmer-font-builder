import { inkBox, renderStrokes } from '../render';
import type { Stroke } from '../types';
import { traceBitmap, type TraceResult } from './trace';

let canvas: HTMLCanvasElement | null = null;

/** Rasterizes strokes in the font view at one pixel per design unit, then traces them. */
export function fitBitmapGlyph(strokes: Stroke[]): TraceResult {
  const box = inkBox(strokes, 0.8);
  if (!box) return { contours: [], area: 0, pieces: 0 };
  const margin = 4;
  const ox = Math.floor(box.left) - margin;
  const oy = Math.floor(box.top) - margin;
  const w = Math.ceil(box.right - box.left) + margin * 2;
  const h = Math.ceil(box.bottom - box.top) + margin * 2;
  canvas ??= document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  renderStrokes(ctx, strokes, { scale: 1, dx: -ox, dy: -oy }, true);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 3];
  return traceBitmap(alpha, w, h, ox, oy);
}
