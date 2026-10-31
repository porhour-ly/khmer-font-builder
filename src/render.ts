import { DEFAULT_STAMP_PARAMS, FONT_READY_BRUSH, fontReadySize, getBrush, type BrushCtx, type BrushDef } from './brushes';
import { mulberry32 } from './rng';
import { EM } from './metrics';
import type { Glyph, InkBox, Stroke } from './types';

/** Maps design units to canvas pixels: pixel = unit * scale + offset. */
export interface View {
  scale: number;
  dx: number;
  dy: number;
}

/**
 * Draws one stroke incrementally. Call update() as points are added, and
 * finish() once the stroke is complete. A full redraw is just finish() on a
 * fresh renderer, which produces exactly the same pixels.
 */
export class StrokeRenderer {
  readonly brush: BrushDef;
  private b: BrushCtx;
  private view: View;
  private next = 0;

  constructor(stroke: Stroke, ctx: CanvasRenderingContext2D, view: View, fontReady = false) {
    this.brush = fontReady ? FONT_READY_BRUSH : getBrush(stroke.brushId);
    this.b = {
      ctx,
      pts: stroke.points,
      size: fontReady ? fontReadySize(stroke.brushId, stroke.size) : stroke.size,
      color: fontReady ? '#000' : stroke.color,
      rng: mulberry32(stroke.seed),
      params: stroke.params ?? DEFAULT_STAMP_PARAMS,
      pxPerUnit: view.scale,
      state: {},
    };
    this.view = view;
  }

  private run(fn: () => void): void {
    const { ctx } = this.b;
    ctx.save();
    ctx.setTransform(this.view.scale, 0, 0, this.view.scale, this.view.dx, this.view.dy);
    fn();
    ctx.restore();
  }

  update(): void {
    const { pts } = this.b;
    if (!pts.length) return;
    this.run(() => {
      if (this.next === 0) {
        this.brush.start(this.b);
        this.next = 1;
      }
      for (; this.next < pts.length; this.next++) this.brush.segment(this.b, this.next);
    });
  }

  finish(): void {
    this.update();
    if (this.b.pts.length && this.brush.end) this.run(() => this.brush.end!(this.b));
  }
}

let scratch: HTMLCanvasElement | null = null;

function scratchFor(w: number, h: number): CanvasRenderingContext2D {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const ctx = scratch.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** Composites a finished stroke layer onto a target, using the brush's opacity and blend mode. */
export function compositeLayer(target: CanvasRenderingContext2D, layer: HTMLCanvasElement, brush: BrushDef): void {
  target.save();
  target.setTransform(1, 0, 0, 1, 0, 0);
  target.globalAlpha = brush.opacity;
  target.globalCompositeOperation = brush.blend;
  target.drawImage(layer, 0, 0);
  target.restore();
}

/** Draws strokes onto a canvas. Does not clear it first. */
export function renderStrokes(target: CanvasRenderingContext2D, strokes: Stroke[], view: View, fontReady = false): void {
  const { width, height } = target.canvas;
  for (const stroke of strokes) {
    if (fontReady) {
      // Solid black: no need for a separate layer.
      new StrokeRenderer(stroke, target, view, true).finish();
      continue;
    }
    const layer = scratchFor(width, height);
    const r = new StrokeRenderer(stroke, layer, view);
    r.finish();
    compositeLayer(target, layer.canvas, r.brush);
  }
}

/**
 * Ink bounds of strokes in design units: the stroke path padded by a share of
 * each brush size. Used for layout (pad 0.5) and, more generously, for cropping.
 */
export function inkBox(strokes: Stroke[], padK = 0.5): InkBox | null {
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;
  for (const s of strokes) {
    const pad = s.size * padK;
    for (const p of s.points) {
      if (p[0] - pad < left) left = p[0] - pad;
      if (p[0] + pad > right) right = p[0] + pad;
      if (p[1] - pad < top) top = p[1] - pad;
      if (p[1] + pad > bottom) bottom = p[1] + pad;
    }
  }
  return left <= right ? { left, right, top, bottom } : null;
}

export interface GlyphBitmap {
  canvas: HTMLCanvasElement;
  /** Design-unit box the bitmap covers. */
  box: InkBox;
}

const bitmapCache = new Map<string, GlyphBitmap>();

/**
 * Glyph rendered at `pxPerEm` pixels per em, cropped to its ink (with room for
 * brush effects). Cached until the glyph changes.
 */
export function glyphBitmap(glyph: Glyph, pxPerEm: number, fontReady: boolean, version = 0): GlyphBitmap {
  const key = `${glyph.id}|${glyph.updatedAt}|${pxPerEm}|${fontReady ? 1 : 0}|${version}`;
  const hit = bitmapCache.get(key);
  if (hit) return hit;
  const box = inkBox(glyph.strokes, 1.3) ?? { left: 0, right: 1, top: 0, bottom: 1 };
  const scale = pxPerEm / EM;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil((box.right - box.left) * scale));
  canvas.height = Math.max(1, Math.ceil((box.bottom - box.top) * scale));
  renderStrokes(canvas.getContext('2d')!, glyph.strokes, { scale, dx: -box.left * scale, dy: -box.top * scale }, fontReady);
  // Keep the cache from growing without limit.
  for (const k of bitmapCache.keys()) if (k.startsWith(glyph.id + '|')) bitmapCache.delete(k);
  const entry = { canvas, box };
  bitmapCache.set(key, entry);
  return entry;
}

/** Draws a cached glyph bitmap with its em origin at (x, y) CSS pixels. */
export function drawGlyphAt(ctx: CanvasRenderingContext2D, bmp: GlyphBitmap, x: number, y: number, pxPerEmCss: number): void {
  const k = pxPerEmCss / EM;
  ctx.drawImage(bmp.canvas, x + bmp.box.left * k, y + bmp.box.top * k, (bmp.box.right - bmp.box.left) * k, (bmp.box.bottom - bmp.box.top) * k);
}

export function clearBitmapCache(): void {
  bitmapCache.clear();
}

/** Sizes a canvas for crisp drawing on retina screens. Returns the device-pixel scale. */
export function fitCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  return dpr;
}
