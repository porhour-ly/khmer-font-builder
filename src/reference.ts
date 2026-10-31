import { store } from './store';
import { GLYPH_BY_ID, REF_BASE, REF_BASE_ID, type GlyphDef } from './glyphs';
import { inkBox, renderStrokes, type View } from './render';
import { drawKhmerAligned, drawKhmerCentered, systemInkBox } from './khmerFont';
import { anchorOffsetX, glyphIdFor, SPLIT_LEFT_PART, type Box, type GlyphMetrics, type MarkKind } from './layout/khmer';
import { EM, GUIDES } from './metrics';
import type { Glyph, Stroke } from './types';

/** Scale of an auto-drafted subscript relative to its consonant. */
export const DRAFT_SCALE = 0.65;
const GHOST = 'rgba(110, 96, 190, 0.16)';
const GHOST_COMBO = 'rgba(230, 57, 120, 0.16)';

/** The reference base box: the user's own ក if drawn, otherwise the system font's. */
export function currentRefBox(): Box {
  const g = store.drawn(REF_BASE_ID);
  return (g && inkBox(g.strokes)) || systemInkBox(REF_BASE);
}

/**
 * Auto-drafted subscript: the consonant shrunk and placed under the reference
 * base. Used until the user draws the subscript themselves.
 */
export function draftGlyph(def: GlyphDef | undefined): Glyph | undefined {
  if (!def?.draftFrom || store.drawn(def.id)) return undefined;
  const src = store.drawn(def.draftFrom);
  const box = src && inkBox(src.strokes);
  if (!src || !box) return undefined;
  const ref = currentRefBox();
  const s = DRAFT_SCALE;
  const cx = (box.left + box.right) / 2;
  const targetX = (ref.left + ref.right) / 2;
  const top = GUIDES.baseline + 25;
  const strokes: Stroke[] = src.strokes.map((st) => ({
    ...st,
    size: st.size * s,
    points: st.points.map(([x, y, p, t]) => [targetX + (x - cx) * s, top + (y - box.top) * s, p, t]),
  }));
  const refStamp = store.glyph(REF_BASE_ID).updatedAt;
  return { id: `draft:${def.id}`, char: def.chars, strokes, saved: false, updatedAt: src.updatedAt + refStamp, ref };
}

/** The glyph to use for an id: the user's drawing, or an auto-draft. */
export function resolveGlyph(id: string): Glyph | undefined {
  return store.drawn(id) ?? draftGlyph(GLYPH_BY_ID.get(id));
}

export function isDraft(id: string): boolean {
  return !store.drawn(id) && !!draftGlyph(GLYPH_BY_ID.get(id));
}

/** Metrics for the layout engine. */
export function glyphMetrics(id: string): GlyphMetrics | undefined {
  const g = resolveGlyph(id);
  const box = g && inkBox(g.strokes);
  if (!g || !box) return undefined;
  return { box, ref: g.ref, offset: g.offset, lsb: g.lsb, rsb: g.rsb };
}

/**
 * Where a dependent glyph's strokes show up in the pad: its stored strokes are
 * moved to follow the current reference base, plus any manual nudge.
 */
export function frameOffset(def: GlyphDef, glyph: Glyph): { x: number; y: number } {
  const off = glyph.offset ?? { x: 0, y: 0 };
  if (def.kind === 'base') return off;
  const ref = currentRefBox();
  return { x: anchorOffsetX(def.kind as MarkKind, ref, glyph.ref ?? ref) + off.x, y: off.y };
}

let faintCanvas: HTMLCanvasElement | null = null;

/** Draws strokes as a faint solid silhouette (used for reference letters). */
export function drawFaint(ctx: CanvasRenderingContext2D, strokes: Stroke[], view: View, alpha: number): void {
  const { width, height } = ctx.canvas;
  faintCanvas ??= document.createElement('canvas');
  faintCanvas.width = width;
  faintCanvas.height = height;
  const f = faintCanvas.getContext('2d')!;
  renderStrokes(f, strokes, view, true);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(faintCanvas, 0, 0);
  ctx.restore();
}

/**
 * Draws what a glyph is drawn against: the ghost letter for base glyphs; for
 * dependent glyphs the reference base, the subscript zone, the system-font
 * combination (when ghost is on) and, for split vowels, the user's េ.
 * `scale` is canvas pixels per design unit.
 */
export function drawReference(ctx: CanvasRenderingContext2D, def: GlyphDef, scale: number, ghost: boolean): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (def.kind === 'base') {
    if (ghost) drawKhmerCentered(ctx, def.ghost, EM / 2, GHOST);
    ctx.restore();
    return;
  }

  const ref = currentRefBox();
  const refCenter = (ref.left + ref.right) / 2;

  if (def.kind === 'below' && def.category === 'subscript') {
    ctx.fillStyle = 'rgba(123, 108, 217, 0.07)';
    ctx.fillRect(0, GUIDES.baseline + 12, EM, EM - GUIDES.baseline - 12);
    ctx.fillStyle = 'rgba(123, 108, 217, 0.55)';
    ctx.font = '24px -apple-system, system-ui, sans-serif';
    ctx.fillText('subscript zone', 14, EM - 18);
  }

  if (ghost) drawKhmerAligned(ctx, def.ghost, REF_BASE, def.ghostPrebase, refCenter, GHOST_COMBO);

  const view: View = { scale, dx: 0, dy: 0 };
  const userBase = store.drawn(REF_BASE_ID);
  if (userBase) drawFaint(ctx, userBase.strokes, view, 0.22);
  else drawKhmerCentered(ctx, REF_BASE, EM / 2, 'rgba(110, 96, 190, 0.28)');

  if (def.split) {
    const e = store.drawn(glyphIdFor(SPLIT_LEFT_PART));
    if (e) {
      const dx = anchorOffsetX('left', ref, e.ref ?? ref) + (e.offset?.x ?? 0);
      drawFaint(ctx, e.strokes, { scale, dx: dx * scale, dy: (e.offset?.y ?? 0) * scale }, 0.3);
    }
  }
  ctx.restore();
}
