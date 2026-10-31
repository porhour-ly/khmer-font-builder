/**
 * Mini Khmer layout engine.
 *
 * Turns Khmer text into positioned glyphs drawn by the user. It is standalone
 * (no DOM), so it can be unit tested and later mirrored by the OpenType rules
 * in Stage 3. See NOTES.md for the rules implemented and the known gaps.
 *
 * Coordinates are design units in a 1000-unit em, y growing downward.
 *
 * Glyph ids:
 *   u1780        a single character (ក), named after its code point
 *   sub-u1798    a subscript consonant (្ម, coeng + ម)
 *   u1789.alt    ញ shape used when it carries a subscript (optional)
 *   lig-u1780-u17b6  a consonant and vowel drawn as one joined shape (កា, optional)
 *
 * How marks are positioned: every dependent glyph (vowel, sign, subscript)
 * is drawn in the same em as a reference letter (its own consonant for
 * subscripts, ក for vowels and signs), and remembers that letter's ink box
 * (`ref`). At layout time the glyph is moved so it keeps the
 * same relationship to the real base as it had to the reference base:
 *   above / below marks keep their offset from the base's centre,
 *   left parts (prebase vowels, coeng-ro) keep their offset from the base's left edge,
 *   right parts (ា, ះ, right halves of split vowels) keep their offset from the right edge.
 * Then marks are stacked so they don't collide.
 */

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type MarkKind = 'above' | 'below' | 'left' | 'right';
export type PartKind = 'base' | MarkKind;

export const COENG = '្';
export const DOTTED_CIRCLE = '◌';
export const NYO_ALT_ID = 'u1789.alt';
const ZWNJ = '‌';
const ZWJ = '‍';
const NYO = 'ញ';
const RO = 'រ';

const cp = (ch: string) => ch.codePointAt(0) ?? 0;
export const isConsonant = (ch: string) => cp(ch) >= 0x1780 && cp(ch) <= 0x17a2;
export const isIndependentVowel = (ch: string) => cp(ch) >= 0x17a3 && cp(ch) <= 0x17b3;
export const isKhmerDigit = (ch: string) => cp(ch) >= 0x17e0 && cp(ch) <= 0x17e9;

/** Where each dependent vowel and sign goes relative to its base. */
export const MARK_KINDS: Record<string, MarkKind> = {
  'ា': 'right',
  'ិ': 'above',
  'ី': 'above',
  'ឹ': 'above',
  'ឺ': 'above',
  'ុ': 'below',
  'ូ': 'below',
  'ួ': 'below',
  'ើ': 'above',
  'ឿ': 'right',
  'ៀ': 'right',
  'េ': 'left',
  'ែ': 'left',
  'ៃ': 'left',
  'ោ': 'right',
  'ៅ': 'right',
  'ំ': 'above',
  'ះ': 'right',
  'ៈ': 'right',
  '៉': 'above',
  '៊': 'above',
  '់': 'above',
  '៌': 'above',
  '៍': 'above',
  '៎': 'above',
  '៏': 'above',
  '័': 'above',
  '៑': 'above',
  '៝': 'above',
};

/**
 * Split vowels are typed after the consonant but have a part drawn before it.
 * The left part always looks like េ, so it uses the េ glyph (as OpenType
 * shapers do); the vowel's own glyph holds only the remaining part.
 */
export const SPLIT_VOWELS = new Set(['ើ', 'ឿ', 'ៀ', 'ោ', 'ៅ']);
export const SPLIT_LEFT_PART = 'េ';

/**
 * Vowels that join the consonant and change its shape. Each consonant + vowel
 * can be drawn as one glyph; a pair that isn't drawn uses the separate vowel.
 * For ោ and ៅ the pair holds the consonant and right part: េ stays separate.
 */
export const PAIR_VOWELS = ['ា', 'ោ', 'ៅ'];

export const glyphIdFor = (ch: string) => 'u' + cp(ch).toString(16);
const AA_ID = glyphIdFor('ា');
const NIKAHIT_ID = glyphIdFor('ំ');
export const pairIdFor = (consonant: string, vowel: string) => `lig-${glyphIdFor(consonant)}-${glyphIdFor(vowel)}`;
export const subscriptIdFor = (consonant: string) => 'sub-' + glyphIdFor(consonant);
/** Coeng-ro is written to the left of the base; all other subscripts go below. */
export const subscriptKind = (consonant: string): MarkKind => (consonant === RO ? 'left' : 'below');

export function isCombining(ch: string): boolean {
  return ch === COENG || ch in MARK_KINDS || ch === ZWJ || ch === ZWNJ;
}

/** Splits text into syllable clusters: a base followed by its subscripts, vowels and signs. */
export function splitClusters(text: string): string[] {
  const out: string[] = [];
  let afterCoeng = false;
  for (const ch of text) {
    const joins = out.length > 0 && (afterCoeng || isCombining(ch)) && ch !== '\n' && !/\s/.test(ch);
    if (joins) out[out.length - 1] += ch;
    else out.push(ch);
    afterCoeng = ch === COENG;
  }
  return out;
}

export interface ParsedCluster {
  base: string | null;
  /** Consonants written with coeng, in order (up to two in valid text). */
  subscripts: string[];
  /** Vowels and signs, in typed order. */
  marks: string[];
  valid: boolean;
}

export function parseCluster(cluster: string): ParsedCluster {
  const chars = [...cluster].filter((c) => c !== ZWJ && c !== ZWNJ);
  const result: ParsedCluster = { base: null, subscripts: [], marks: [], valid: true };
  if (!chars.length || isCombining(chars[0])) {
    result.valid = false;
    return result;
  }
  result.base = chars[0];
  for (let i = 1; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === COENG) {
      const next = chars[i + 1];
      if (next && isConsonant(next)) {
        result.subscripts.push(next);
        i++;
      } else {
        result.valid = false;
      }
    } else if (ch in MARK_KINDS) {
      result.marks.push(ch);
    } else {
      result.valid = false;
    }
  }
  if (result.subscripts.length > 2) result.valid = false;
  return result;
}

/** What the engine needs to know about a drawn glyph. */
export interface GlyphMetrics {
  /** Ink bounds in the glyph's own em. */
  box: Box;
  /** Joined pairs: the consonant part, which marks and subscripts centre on. */
  anchorBox?: Box;
  /** Ink bounds of the reference base the glyph was drawn against (dependent glyphs). */
  ref?: Box;
  /** Manual nudge, added after positioning. */
  offset?: { x: number; y: number };
  /** Side bearings (base glyphs): space before and after the ink. */
  lsb?: number;
  rsb?: number;
}

/** Returns metrics for a glyph id, or undefined if it hasn't been drawn. */
export type MetricsLookup = (id: string) => GlyphMetrics | undefined;

export interface LayoutOptions {
  /** Reference base box used for glyphs that don't record their own. */
  defaultRef: Box;
  /** Minimum space between stacked marks. */
  gap?: number;
  /** Width of a space character. */
  spaceWidth?: number;
  defaultBearing?: number;
}

export interface PlacedGlyph {
  id: string;
  kind: PartKind;
  /** Where the glyph's em origin goes, relative to the cluster's origin. */
  x: number;
  y: number;
}

export type ShapedCluster =
  | { type: 'glyphs'; text: string; glyphs: PlacedGlyph[]; advance: number }
  | { type: 'fallback'; text: string; missing: string[] }
  | { type: 'space'; text: string; advance: number }
  | { type: 'newline'; text: string };

interface Component {
  id: string;
  kind: PartKind;
}

/** The glyphs a cluster needs, in placement order. */
export function clusterComponents(p: ParsedCluster, has: (id: string) => boolean): Component[] {
  if (!p.base) return [];
  const useAlt = p.base === NYO && p.subscripts.length > 0 && has(NYO_ALT_ID);
  const pairVowel = useAlt || !isConsonant(p.base) ? undefined : p.marks.find((m) => PAIR_VOWELS.includes(m));
  const pairId = pairVowel && has(pairIdFor(p.base, pairVowel)) ? pairIdFor(p.base, pairVowel) : null;
  const baseId = pairId ?? (useAlt ? NYO_ALT_ID : glyphIdFor(p.base));
  const parts: Component[] = [{ id: baseId, kind: 'base' }];
  for (const c of p.subscripts) parts.push({ id: subscriptIdFor(c), kind: subscriptKind(c) });
  for (const m of p.marks) {
    if (SPLIT_VOWELS.has(m)) parts.push({ id: glyphIdFor(SPLIT_LEFT_PART), kind: 'left' });
    if (pairId && m === pairVowel) continue; // already part of the joined glyph
    parts.push({ id: glyphIdFor(m), kind: MARK_KINDS[m] });
  }
  return parts;
}

const centerX = (b: Box) => (b.left + b.right) / 2;
const shift = (b: Box, x: number, y: number): Box => ({ left: b.left + x, right: b.right + x, top: b.top + y, bottom: b.bottom + y });
const union = (a: Box | null, b: Box): Box =>
  a
    ? { left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) }
    : b;
const overlapsX = (a: Box, b: Box) => a.left < b.right && b.left < a.right;

/** Horizontal move that keeps a dependent glyph attached to the real base. */
export function anchorOffsetX(kind: MarkKind, base: Box, ref: Box): number {
  if (kind === 'left') return base.left - ref.left;
  if (kind === 'right') return base.right - ref.right;
  return centerX(base) - centerX(ref);
}

export function shapeCluster(cluster: string, get: MetricsLookup, opts: LayoutOptions): ShapedCluster {
  if (cluster === '\n') return { type: 'newline', text: cluster };
  if (/^\s+$/.test(cluster)) return { type: 'space', text: cluster, advance: opts.spaceWidth ?? 280 };

  const parsed = parseCluster(cluster);
  if (!parsed.valid || !parsed.base) {
    // Shapers show a dotted circle for marks without a base.
    const text = parsed.base ? cluster : DOTTED_CIRCLE + cluster;
    return { type: 'fallback', text, missing: [] };
  }
  const comps = clusterComponents(parsed, (id) => !!get(id));
  const metrics = comps.map((c) => get(c.id));
  const missing = comps.filter((_, i) => !metrics[i]).map((c) => c.id);
  if (missing.length) return { type: 'fallback', text: cluster, missing };

  const gap = opts.gap ?? 20;
  const bearing = opts.defaultBearing ?? 40;
  const baseM = metrics[0]!;
  const bb = baseM.anchorBox ?? baseM.box;
  let leftEdge = baseM.box.left;
  let rightEdge = baseM.box.right;
  let above: Box | null = null;
  let below: Box | null = null;
  let ink: Box = baseM.box;
  const placed: PlacedGlyph[] = [{ id: comps[0].id, kind: 'base', x: 0, y: 0 }];
  // ាំ is one vowel: ំ sits on ា, which may be a separate glyph or part of a joined pair.
  let aaPart: Box | null =
    comps[0].id.endsWith(`-${AA_ID}`) && baseM.anchorBox ? { ...baseM.box, left: baseM.anchorBox.right } : null;

  for (let i = 1; i < comps.length; i++) {
    const kind = comps[i].kind as MarkKind;
    const m = metrics[i]!;
    const ref = m.ref ?? opts.defaultRef;
    let x = 0;
    let y = 0;
    if (kind === 'left') {
      // Chain to the left of whatever is already there (e.g. េ before coeng-ro).
      x = leftEdge - ref.left;
    } else if (kind === 'right') {
      x = rightEdge - ref.right;
    } else {
      const onAa = comps[i].id === NIKAHIT_ID ? aaPart : null;
      const under = onAa ?? bb;
      x = anchorOffsetX(kind, under, ref);
      if (kind === 'above') {
        y = Math.min(under.top, opts.defaultRef.top) - ref.top; // taller base: lift the mark
        if (above) {
          const b = shift(m.box, x, y);
          if (overlapsX(b, above) && b.bottom + gap > above.top) y += above.top - gap - b.bottom;
        }
      } else {
        // Deeper base (e.g. ញ): lower the mark. A subscript drawn under a deep
        // letter moves back up under a normal one.
        y = Math.max(bb.bottom, opts.defaultRef.bottom) - ref.bottom;
        if (below) {
          const b = shift(m.box, x, y);
          if (overlapsX(b, below) && b.top < below.bottom + gap) y += below.bottom + gap - b.top;
        }
      }
    }
    x += m.offset?.x ?? 0;
    y += m.offset?.y ?? 0;
    const b = shift(m.box, x, y);
    if (kind === 'left') leftEdge = Math.min(leftEdge, b.left);
    if (kind === 'right') rightEdge = Math.max(rightEdge, b.right);
    if (comps[i].id === AA_ID) aaPart = b;
    if (kind === 'above') above = union(above, b);
    if (kind === 'below') below = union(below, b);
    ink = union(ink, b);
    placed.push({ id: comps[i].id, kind, x, y });
  }

  const origin = ink.left - (baseM.lsb ?? bearing);
  const advance = ink.right + (baseM.rsb ?? bearing) - origin;
  for (const p of placed) p.x -= origin;
  return { type: 'glyphs', text: cluster, glyphs: placed, advance };
}

export function layoutText(text: string, get: MetricsLookup, opts: LayoutOptions): ShapedCluster[] {
  return splitClusters(text).map((c) => shapeCluster(c, get, opts));
}

/**
 * Flat list of glyph ids with absolute x/y offsets for one line of text.
 * Fallback clusters (not drawn yet) get `fallbackWidth` each and are listed separately.
 */
export function layoutLine(
  text: string,
  get: MetricsLookup,
  opts: LayoutOptions & { fallbackWidth?: (text: string) => number },
): { glyphs: (PlacedGlyph & { cluster: number })[]; fallbacks: { text: string; x: number }[]; width: number } {
  const glyphs: (PlacedGlyph & { cluster: number })[] = [];
  const fallbacks: { text: string; x: number }[] = [];
  let x = 0;
  layoutText(text.replace(/\n/g, ' '), get, opts).forEach((c, i) => {
    if (c.type === 'glyphs') {
      for (const g of c.glyphs) glyphs.push({ ...g, x: g.x + x, cluster: i });
      x += c.advance;
    } else if (c.type === 'space') {
      x += c.advance;
    } else if (c.type === 'fallback') {
      fallbacks.push({ text: c.text, x });
      x += opts.fallbackWidth?.(c.text) ?? 500;
    }
  });
  return { glyphs, fallbacks, width: x };
}
