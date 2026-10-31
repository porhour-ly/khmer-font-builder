import { GLYPHS, type GlyphDef } from '../glyphs';
import { fitBitmapGlyph } from './raster';
import { currentRefBox, isDraft, pairAnchorBox, resolveGlyph } from '../reference';
import { glyphIdFor } from '../layout/khmer';
import { inkBox } from '../render';
import { store } from '../store';
import type { InkBox } from '../types';
import type { Contour } from './trace';

export interface BundleGlyph {
  id: string;
  kind: string;
  box: InkBox;
  /** Joined pairs: the consonant part. */
  anchorBox?: InkBox;
  ref?: InkBox;
  offset?: { x: number; y: number };
  lsb?: number;
  rsb?: number;
  contours: Contour[];
}

export interface FontBundle {
  version: 1;
  name: string;
  designer: string;
  year: number;
  licence: string;
  includeLatin: boolean;
  /** Reference base for glyphs that don't record their own. */
  ref: InkBox;
  glyphs: BundleGlyph[];
}

export interface Readiness {
  ready: GlyphDef[];
  drafts: GlyphDef[];
  missing: GlyphDef[];
  /** Subscripts and joined pairs that can't work yet: their letters aren't all drawn. */
  blocked: GlyphDef[];
}

/** What can go into the font right now. */
export function readiness(): Readiness {
  const required = GLYPHS.filter((d) => !d.optional);
  return {
    ready: required.filter((d) => !!store.drawn(d.id)),
    drafts: required.filter((d) => isDraft(d.id)),
    missing: required.filter((d) => !resolveGlyph(d.id)),
    blocked: GLYPHS.filter((d) => {
      if (!resolveGlyph(d.id)) return false;
      if (d.category === 'subscript' && d.kind !== 'base') return !store.drawn(d.id.slice('sub-'.length));
      return !!d.pairVowel && !(store.drawn(glyphIdFor(d.base)) && store.drawn(glyphIdFor(d.pairVowel)));
    }),
  };
}

export interface GlyphIssue {
  def: GlyphDef;
  problem: string;
}

/** Below these sizes a shape probably isn't what the user meant to draw. */
const TINY_AREA = 500;
const TINY_SPAN = 40;
const MANY_PIECES = 8;

/** Traces every available glyph into outlines. Yields to the page so progress can show. */
export async function makeBundle(
  options: Pick<FontBundle, 'name' | 'designer' | 'licence' | 'includeLatin'>,
  onProgress: (done: number, total: number) => void,
): Promise<{ bundle: FontBundle; issues: GlyphIssue[] }> {
  const defs = GLYPHS.filter((d) => resolveGlyph(d.id));
  const defaultRef = currentRefBox();
  const glyphs: BundleGlyph[] = [];
  const issues: GlyphIssue[] = [];
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const g = resolveGlyph(def.id)!;
    const box = inkBox(g.strokes)!;
    const traced = fitBitmapGlyph(g.strokes);
    if (!traced.contours.length) issues.push({ def, problem: 'came out empty and was left out' });
    else if (traced.area < TINY_AREA || Math.max(box.right - box.left, box.bottom - box.top) < TINY_SPAN) {
      issues.push({ def, problem: 'is very small' });
    } else if (traced.pieces > MANY_PIECES) {
      issues.push({ def, problem: `is broken into ${traced.pieces} pieces` });
    }
    glyphs.push({
      id: def.id,
      kind: def.kind,
      box,
      anchorBox: pairAnchorBox(def, box),
      ref: def.kind === 'base' ? undefined : g.ref ?? defaultRef,
      offset: g.offset,
      lsb: g.lsb,
      rsb: g.rsb,
      contours: traced.contours,
    });
    if (i % 4 === 3) {
      onProgress(i + 1, defs.length);
      await new Promise((r) => setTimeout(r));
    }
  }
  return {
    bundle: { version: 1, ...options, year: new Date().getFullYear(), ref: defaultRef, glyphs },
    issues,
  };
}

export interface BuiltFont {
  ttf: Uint8Array;
  woff2: Uint8Array;
  report: { family: string; fileBase: string; glyphCount: number; drawnGlyphs: number; licence: string };
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function gzip(text: string): Promise<Blob | null> {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/** Sends the bundle to the build endpoint. Throws an Error with a friendly message. */
export async function buildFont(bundle: FontBundle): Promise<BuiltFont> {
  const json = JSON.stringify(bundle);
  const zipped = await gzip(json);
  let res: Response;
  try {
    res = await fetch('/api/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(zipped ? { 'X-Bundle-Encoding': 'gzip' } : {}) },
      body: zipped ?? json,
    });
  } catch {
    throw new Error('Couldn’t reach the font builder. Building a font needs an internet connection.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* handled below */
  }
  if (!res.ok || !data?.ttf) {
    throw new Error(data?.error ?? 'The font builder isn’t available right now. Please try again.');
  }
  return { ttf: fromBase64(data.ttf), woff2: fromBase64(data.woff2), report: data.report };
}
