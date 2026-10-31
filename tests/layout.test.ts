import { describe, expect, it } from 'vitest';
import {
  layoutLine,
  NYO_ALT_ID,
  parseCluster,
  shapeCluster,
  splitClusters,
  type Box,
  type GlyphMetrics,
  type LayoutOptions,
} from '../src/layout/khmer';

// A fake alphabet: every base is a 300–700 wide body between x-height and baseline,
// drawn against the same reference ក.
const REF: Box = { left: 300, right: 700, top: 330, bottom: 680 };
const base = (over: Partial<Box> = {}): GlyphMetrics => ({ box: { ...REF, ...over }, lsb: 40, rsb: 40 });
const mark = (box: Box): GlyphMetrics => ({ box, ref: REF });

const SUB: Box = { left: 380, right: 620, top: 700, bottom: 880 }; // under the base
const ABOVE: Box = { left: 420, right: 600, top: 200, bottom: 310 };
const BELOW: Box = { left: 450, right: 560, top: 700, bottom: 780 };
const E_LEFT: Box = { left: 160, right: 270, top: 300, bottom: 690 }; // េ, left of the base
const RO_LEFT: Box = { left: 200, right: 560, top: 700, bottom: 860 }; // ្រ, wraps under-left
const AA_RIGHT: Box = { left: 720, right: 820, top: 330, bottom: 680 }; // ា

const alphabet: Record<string, GlyphMetrics> = {
  u1780: base(), // ក
  u1781: base(), // ខ
  u1784: base(), // ង
  u1789: base({ bottom: 760 }), // ញ has a tail below the baseline
  u179f: base(), // ស
  'sub-u1798': mark(SUB), // ្ម
  'sub-u1789': mark(SUB), // ្ញ
  'sub-u1787': mark(SUB), // ្ជ
  'sub-u179a': mark(RO_LEFT), // ្រ
  u17c1: mark(E_LEFT), // េ
  u17b8: mark(ABOVE), // ី
  u17bb: mark(BELOW), // ុ
  u17c6: mark({ left: 470, right: 540, top: 230, bottom: 300 }), // ំ
  u17b6: mark(AA_RIGHT), // ា
  u17c4: mark(AA_RIGHT), // ោ (right part)
};

const opts: LayoutOptions = { defaultRef: REF };
const get = (id: string) => alphabet[id];

function shape(text: string) {
  const r = shapeCluster(text, get, opts);
  if (r.type !== 'glyphs') throw new Error(`expected glyphs for ${text}, got ${r.type}`);
  return r;
}

const placedBox = (g: { id: string; x: number; y: number }): Box => {
  const b = alphabet[g.id].box;
  return { left: b.left + g.x, right: b.right + g.x, top: b.top + g.y, bottom: b.bottom + g.y };
};

describe('cluster splitting', () => {
  it('groups subscripts, vowels and signs with their base', () => {
    expect(splitClusters('ក្មេង')).toEqual(['ក្មេ', 'ង']);
    expect(splitClusters('ស្រី')).toEqual(['ស្រី']);
    expect(splitClusters('ខ្ញុំ')).toEqual(['ខ្ញុំ']);
    expect(splitClusters('ក ខ')).toEqual(['ក', ' ', 'ខ']);
  });

  it('parses the parts of a syllable', () => {
    expect(parseCluster('ខ្ញុំ')).toEqual({ base: 'ខ', subscripts: ['ញ'], marks: ['ុ', 'ំ'], valid: true });
    expect(parseCluster('ិ').valid).toBe(false);
  });
});

describe('ក្មេង', () => {
  const r = shape('ក្មេ');
  const [k, sub, e] = r.glyphs;

  it('uses the base, the subscript and the prebase vowel', () => {
    expect(r.glyphs.map((g) => g.id)).toEqual(['u1780', 'sub-u1798', 'u17c1']);
  });

  it('puts the subscript under the base, centred', () => {
    const kb = placedBox(k);
    const sb = placedBox(sub);
    expect(sb.top).toBeGreaterThanOrEqual(kb.bottom);
    expect((sb.left + sb.right) / 2).toBeCloseTo((kb.left + kb.right) / 2);
  });

  it('puts េ before the base and widens the cluster for it', () => {
    expect(placedBox(e).right).toBeLessThanOrEqual(placedBox(k).left);
    expect(placedBox(e).left).toBeCloseTo(40); // left side bearing from the cluster origin
  });

  it('lays out the whole word on one line', () => {
    const line = layoutLine('ក្មេង', get, opts);
    expect(line.fallbacks).toEqual([]);
    expect(line.glyphs.map((g) => g.id)).toEqual(['u1780', 'sub-u1798', 'u17c1', 'u1784']);
    const ng = line.glyphs[3];
    expect(placedBox(ng).left).toBeGreaterThan(placedBox(line.glyphs[0]).right);
  });
});

describe('ស្រី', () => {
  const r = shape('ស្រី');
  const [s, ro, ii] = r.glyphs;

  it('treats coeng-ro as a left part and ី as an above mark', () => {
    expect(r.glyphs.map((g) => [g.id, g.kind])).toEqual([
      ['u179f', 'base'],
      ['sub-u179a', 'left'],
      ['u17b8', 'above'],
    ]);
  });

  it('keeps coeng-ro attached to the left edge of the base', () => {
    expect(placedBox(ro).left - placedBox(s).left).toBeCloseTo(RO_LEFT.left - REF.left);
  });

  it('keeps ី above the base', () => {
    expect(placedBox(ii).bottom).toBeLessThanOrEqual(placedBox(s).top);
  });
});

describe('ខ្ញុំ', () => {
  const r = shape('ខ្ញុំ');
  const [kh, sub, u, am] = r.glyphs;

  it('stacks the below vowel under the subscript', () => {
    expect(r.glyphs.map((g) => g.id)).toEqual(['u1781', 'sub-u1789', 'u17bb', 'u17c6']);
    expect(placedBox(u).top).toBeGreaterThanOrEqual(placedBox(sub).bottom + 20);
  });

  it('keeps ំ above the base', () => {
    expect(placedBox(am).bottom).toBeLessThanOrEqual(placedBox(kh).top);
  });
});

describe('joined consonant + vowel pairs', () => {
  const PAIR: Box = { left: 300, right: 820, top: 330, bottom: 680 };
  const pairMetrics: GlyphMetrics = { box: PAIR, anchorBox: REF, lsb: 40, rsb: 40 };
  const withPairs = (id: string) => (id === 'lig-u1780-u17b6' || id === 'lig-u1780-u17c4' ? pairMetrics : get(id));

  it('uses the separate vowel until the pair is drawn', () => {
    expect(shape('កា').glyphs.map((g) => g.id)).toEqual(['u1780', 'u17b6']);
  });

  it('swaps in the drawn pair', () => {
    const r = shapeCluster('កា', withPairs, opts);
    expect(r.type === 'glyphs' && r.glyphs.map((g) => g.id)).toEqual(['lig-u1780-u17b6']);
  });

  it('keeps េ separate before a joined ោ', () => {
    const r = shapeCluster('កោ', withPairs, opts);
    if (r.type !== 'glyphs') throw new Error();
    expect(r.glyphs.map((g) => g.id)).toEqual(['lig-u1780-u17c4', 'u17c1']);
    expect(placedBox({ ...r.glyphs[1], id: 'u17c1' }).right).toBeLessThanOrEqual(PAIR.left + r.glyphs[0].x);
  });

  it('centres a subscript on the consonant part, not the whole pair', () => {
    const r = shapeCluster('ក្មា', withPairs, opts);
    if (r.type !== 'glyphs') throw new Error();
    expect(r.glyphs.map((g) => g.id)).toEqual(['lig-u1780-u17b6', 'sub-u1798']);
    const sub = placedBox(r.glyphs[1]);
    expect((sub.left + sub.right) / 2).toBeCloseTo((REF.left + REF.right) / 2 + r.glyphs[0].x);
  });

  it('puts ំ on the ា part of a joined pair', () => {
    const r = shapeCluster('កាំ', withPairs, opts);
    if (r.type !== 'glyphs') throw new Error();
    expect(r.glyphs.map((g) => g.id)).toEqual(['lig-u1780-u17b6', 'u17c6']);
    const am = placedBox(r.glyphs[1]);
    const aaCentre = (REF.right + PAIR.right) / 2 + r.glyphs[0].x;
    expect((am.left + am.right) / 2).toBeCloseTo(aaCentre + 5); // this ំ is drawn 5 units right of centre
  });

  it('lets the ញ alternate win, as the font does', () => {
    const lookup = (id: string) => (id === NYO_ALT_ID ? base() : id === 'lig-u1789-u17b6' ? pairMetrics : get(id));
    const r = shapeCluster('ញ្ជា', lookup, opts);
    expect(r.type === 'glyphs' && r.glyphs[0].id).toBe(NYO_ALT_ID);
  });
});

describe('special cases', () => {
  it('splits ោ into េ before the base and the rest after it', () => {
    const r = shape('កោ');
    expect(r.glyphs.map((g) => [g.id, g.kind])).toEqual([
      ['u1780', 'base'],
      ['u17c1', 'left'],
      ['u17c4', 'right'],
    ]);
    expect(placedBox(r.glyphs[1]).right).toBeLessThanOrEqual(placedBox(r.glyphs[0]).left);
    expect(placedBox(r.glyphs[2]).left).toBeGreaterThanOrEqual(placedBox(r.glyphs[0]).right);
  });

  it('puts ំ on top of a separate ា: ាំ is one vowel', () => {
    const [, aa, am] = shape('កាំ').glyphs;
    const aaBox = placedBox(aa);
    const amBox = placedBox(am);
    expect((amBox.left + amBox.right) / 2).toBeCloseTo((aaBox.left + aaBox.right) / 2 + 5);
    expect(amBox.bottom).toBeLessThanOrEqual(aaBox.top);
  });

  it('keeps ំ over the base when there is no ា', () => {
    const [k, am] = shape('កំ').glyphs;
    expect((placedBox(am).left + placedBox(am).right) / 2).toBeCloseTo((placedBox(k).left + placedBox(k).right) / 2 + 5);
  });

  it('puts េ to the left of coeng-ro when both are present', () => {
    const r = shape('ក្រេ');
    const ro = r.glyphs.find((g) => g.id === 'sub-u179a')!;
    const e = r.glyphs.find((g) => g.id === 'u17c1')!;
    expect(placedBox(e).right).toBeLessThanOrEqual(placedBox(ro).left);
  });

  it('lowers a subscript under ញ, whose tail goes below the baseline', () => {
    const r = shape('ញ្ជ');
    expect(placedBox(r.glyphs[1]).top).toBeGreaterThanOrEqual(760);
  });

  it('follows the real base when a subscript was drawn under its own consonant', () => {
    const wide: Box = { left: 200, right: 900, top: 330, bottom: 680 }; // a wide reference letter
    const sub = { box: { left: 450, right: 650, top: 700, bottom: 880 }, ref: wide };
    const custom = (id: string) => (id === 'sub-u1798' ? sub : get(id));
    const r = shapeCluster('ក្ម', custom, opts);
    if (r.type !== 'glyphs') throw new Error();
    const base = r.glyphs[0];
    const placed = { left: sub.box.left + r.glyphs[1].x, right: sub.box.right + r.glyphs[1].x };
    expect((placed.left + placed.right) / 2 - base.x).toBeCloseTo(500); // the centre of ក
    expect(r.glyphs[1].y).toBe(0);
  });

  it('moves a subscript drawn under deep ញ back up under a normal base', () => {
    const deepRef: Box = { ...REF, bottom: 760 };
    const sub = { box: { left: 380, right: 620, top: 785, bottom: 960 }, ref: deepRef };
    const custom = (id: string) => (id === 'sub-u1789' ? sub : get(id));
    const r = shapeCluster('ក្ញ', custom, opts);
    if (r.type !== 'glyphs') throw new Error();
    expect(r.glyphs[1].y).toBe(-80);
  });

  it('uses the ញ-with-subscript alternate when it has been drawn', () => {
    const withAlt = (id: string) => (id === NYO_ALT_ID ? base() : get(id));
    const r = shapeCluster('ញ្ជ', withAlt, opts);
    expect(r.type === 'glyphs' && r.glyphs[0].id).toBe(NYO_ALT_ID);
  });

  it('falls back to the system font when a glyph is missing', () => {
    expect(shapeCluster('កុះ', get, opts)).toEqual({ type: 'fallback', text: 'កុះ', missing: ['u17c7'] });
  });

  it('adds a dotted circle for a mark with no base', () => {
    expect(shapeCluster('ិ', get, opts)).toMatchObject({ type: 'fallback', text: '◌ិ' });
  });

  it('applies manual nudges', () => {
    const nudged = (id: string) => (id === 'u17b8' ? { ...alphabet[id], offset: { x: 15, y: -10 } } : get(id));
    const a = shape('ស្រី').glyphs[2];
    const b = shapeCluster('ស្រី', nudged, opts);
    if (b.type !== 'glyphs') throw new Error();
    expect(b.glyphs[2].x - a.x).toBe(15);
    expect(b.glyphs[2].y - a.y).toBe(-10);
  });
});
