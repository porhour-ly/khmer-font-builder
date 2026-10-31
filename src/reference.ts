import { store } from './store';
import { GLYPH_BY_ID, REF_BASE, type GlyphDef } from './glyphs';
import { inkBox, renderStrokes, type View } from './render';
import { drawKhmerAligned, drawKhmerCentered, eraseKhmerBase, systemInkBox } from './khmerFont';
import { anchorOffsetX, glyphIdFor, SPLIT_LEFT_PART, type Box, type GlyphMetrics, type MarkKind } from './layout/khmer';
import { EM, GUIDES } from './metrics';
import type { Glyph, Stroke } from './types';

/** Scale of an auto-drafted subscript relative to its consonant. */
export const DRAFT_SCALE = 0.65;
const GHOST = 'rgba(110, 96, 190, 0.16)';
const GHOST_COMBO = 'rgba(230, 57, 120, 0.16)';

/**
 * Ink box of a glyph's reference letter: the user's own drawing if there is
 * one, otherwise the system font's. Defaults to ក, the shared layout reference.
 */
export function currentRefBox(def?: GlyphDef): Box {
  const base = def?.base ?? REF_BASE;
  const g = store.drawn(glyphIdFor(base));
  return (g && inkBox(g.strokes)) || systemInkBox(base);
}

/**
 * Auto-drafted subscript: the consonant shrunk and placed under its own full
 * form. Used until the user draws the subscript themselves.
 */
export function draftGlyph(def: GlyphDef | undefined): Glyph | undefined {
  if (!def?.draftFrom || store.drawn(def.id)) return undefined;
  const src = store.drawn(def.draftFrom);
  const box = src && inkBox(src.strokes);
  if (!src || !box) return undefined;
  const ref = currentRefBox(def);
  const s = DRAFT_SCALE;
  const cx = (box.left + box.right) / 2;
  const targetX = (ref.left + ref.right) / 2;
  const top = Math.max(GUIDES.baseline, ref.bottom) + 25;
  const strokes: Stroke[] = src.strokes.map((st) => ({
    ...st,
    size: st.size * s,
    points: st.points.map(([x, y, p, t]) => [targetX + (x - cx) * s, top + (y - box.top) * s, p, t]),
  }));
  const refStamp = store.glyph(glyphIdFor(def.base)).updatedAt;
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
  const ref = currentRefBox(def);
  return { x: anchorOffsetX(def.kind as MarkKind, ref, glyph.ref ?? ref) + off.x, y: off.y };
}

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Subscripts: the ghost is the subscript alone, and only its area is drawable. */
export const isSubscript = (def: GlyphDef) => def.category === 'subscript' && def.kind !== 'base';

const ZONE_TOP = GUIDES.baseline + 6;
const ZONE_PAD = 45;
const subscriptGhosts = new Map<string, { canvas: HTMLCanvasElement; upper: Rect | null }>();

/**
 * The system font's subscript with its base letter removed, plus the box of
 * any part above the baseline (្រ and subscripts with an arm). Shaped on ក
 * because it has no tail or other form that changes above a subscript.
 */
function subscriptGhost(def: GlyphDef) {
  const hit = subscriptGhosts.get(def.id);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = EM;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  drawKhmerAligned(ctx, REF_BASE + def.chars, REF_BASE, def.ghostPrebase, EM / 2, '#e63978');
  eraseKhmerBase(ctx, REF_BASE, EM / 2);
  const rows = ctx.getImageData(0, 0, EM, ZONE_TOP - 10).data;
  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let count = 0;
  for (let y = 0; y < ZONE_TOP - 10; y++) {
    for (let x = 0; x < EM; x++) {
      if (rows[(y * EM + x) * 4 + 3] > 96) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        count++;
      }
    }
  }
  const upper = count > 150 ? { left, right, top, bottom: ZONE_TOP } : null;
  const entry = { canvas, upper };
  subscriptGhosts.set(def.id, entry);
  return entry;
}

/** Horizontal move from the ghost's frame to where this subscript belongs. */
function subscriptGhostShift(def: GlyphDef): number {
  return anchorOffsetX(def.kind as MarkKind, currentRefBox(def), systemInkBox(REF_BASE));
}

/** Where a subscript may be drawn: the zone under the baseline, plus any arm above it. */
export function subscriptRegions(def: GlyphDef): Rect[] {
  const regions: Rect[] = [{ left: 0, right: EM, top: ZONE_TOP, bottom: EM }];
  const { upper } = subscriptGhost(def);
  if (upper) {
    const dx = subscriptGhostShift(def);
    regions.push({
      left: Math.max(0, upper.left + dx - ZONE_PAD),
      right: Math.min(EM, upper.right + dx + ZONE_PAD),
      top: Math.max(0, upper.top - ZONE_PAD),
      bottom: ZONE_TOP,
    });
  }
  return regions;
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
 * subscripts the ghost subscript and the user's own consonant, if drawn (with
 * `shade`, the off-limits area greyed out); for vowels and signs the reference base, the system-font combination
 * (when ghost is on) and, for split vowels, the user's េ.
 * `scale` is canvas pixels per design unit.
 */
export function drawReference(ctx: CanvasRenderingContext2D, def: GlyphDef, scale: number, ghost: boolean, shade = false): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  if (isSubscript(def)) {
    if (shade) {
      // Grey out everything that isn't part of the subscript.
      ctx.beginPath();
      ctx.rect(0, 0, EM, EM);
      for (const r of subscriptRegions(def)) ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top);
      ctx.fillStyle = 'rgba(100, 96, 125, 0.13)';
      ctx.fill('evenodd');
    }
    // The user's own consonant stays visible as context. It's never the system font's.
    const own = store.drawn(glyphIdFor(def.base));
    if (own) drawFaint(ctx, own.strokes, { scale, dx: 0, dy: 0 }, 0.3);
    if (ghost) {
      ctx.globalAlpha = 0.28;
      ctx.drawImage(subscriptGhost(def).canvas, subscriptGhostShift(def), 0, EM, EM);
    }
    ctx.restore();
    return;
  }
  if (def.kind === 'base') {
    if (ghost) drawKhmerCentered(ctx, def.ghost, EM / 2, GHOST);
    ctx.restore();
    return;
  }

  const ref = currentRefBox(def);
  const refCenter = (ref.left + ref.right) / 2;

  if (ghost) drawKhmerAligned(ctx, def.ghost, def.base, def.ghostPrebase, refCenter, GHOST_COMBO);

  const view: View = { scale, dx: 0, dy: 0 };
  const userBase = store.drawn(glyphIdFor(def.base));
  if (userBase) drawFaint(ctx, userBase.strokes, view, 0.22);
  else drawKhmerCentered(ctx, def.base, EM / 2, 'rgba(110, 96, 190, 0.28)');

  if (def.split) {
    const e = store.drawn(glyphIdFor(SPLIT_LEFT_PART));
    if (e) {
      const dx = anchorOffsetX('left', ref, e.ref ?? ref) + (e.offset?.x ?? 0);
      drawFaint(ctx, e.strokes, { scale, dx: dx * scale, dy: (e.offset?.y ?? 0) * scale }, 0.3);
    }
  }
  ctx.restore();
}
