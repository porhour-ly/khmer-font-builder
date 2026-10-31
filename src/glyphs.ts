import { LETTERS } from './letters';
import {
  COENG,
  DOTTED_CIRCLE,
  glyphIdFor,
  MARK_KINDS,
  NYO_ALT_ID,
  SPLIT_LEFT_PART,
  SPLIT_VOWELS,
  subscriptIdFor,
  subscriptKind,
  type PartKind,
} from './layout/khmer';

export type Category = 'consonant' | 'subscript' | 'vowel' | 'sign' | 'independent' | 'digit';

export interface GlyphDef {
  id: string;
  /** The characters this glyph stands for. */
  chars: string;
  /** Short label for titles and tiles. */
  label: string;
  /** Romanized or descriptive name. */
  name: string;
  category: Category;
  /** 'base' glyphs stand alone; the others are drawn around a reference base letter. */
  kind: PartKind;
  /** System-font text shown as the ghost reference. */
  ghost: string;
  /** Letter this glyph is drawn against: its own consonant for subscripts, otherwise ក. */
  base: string;
  /** Text whose extra width sits before the base in the ghost (prebase parts). */
  ghostPrebase?: string;
  /** Consonant id to auto-draft this subscript from. */
  draftFrom?: string;
  /** Split vowel: its left part is the user's េ. */
  split?: boolean;
  /** Not counted toward progress. */
  optional?: boolean;
}

export interface CategoryDef {
  id: Category;
  title: string;
  /** Short tab label. */
  tab: string;
}

export const CATEGORIES: CategoryDef[] = [
  { id: 'consonant', title: 'Consonants', tab: 'Consonants' },
  { id: 'subscript', title: 'Subscripts', tab: 'Subscripts' },
  { id: 'vowel', title: 'Vowels', tab: 'Vowels' },
  { id: 'sign', title: 'Signs', tab: 'Signs' },
  { id: 'independent', title: 'Independent vowels', tab: 'Independent' },
  { id: 'digit', title: 'Digits', tab: 'Digits' },
];

/** The base letter vowels and signs are drawn against. */
export const REF_BASE = 'ក';
export const REF_BASE_ID = glyphIdFor(REF_BASE);

/** Subscripts that look like a different consonant than their own. */
const DRAFT_SOURCE: Record<string, string> = { 'ត': 'ដ' };

const VOWELS: [string, string][] = [
  ['ា', 'aa'], ['ិ', 'i'], ['ី', 'ii'], ['ឹ', 'eu'], ['ឺ', 'euu'], ['ុ', 'u'], ['ូ', 'uu'], ['ួ', 'ua'],
  ['ើ', 'oe'], ['ឿ', 'ue'], ['ៀ', 'ie'], ['េ', 'e'], ['ែ', 'ae'], ['ៃ', 'ai'], ['ោ', 'ao'], ['ៅ', 'au'],
];

const SIGNS: [string, string][] = [
  ['ំ', 'nikahit'], ['ះ', 'reahmuk'], ['៉', 'musakatoan'], ['៊', 'treisap'], ['់', 'bantoc'],
  ['៌', 'robat'], ['៍', 'toandakhiat'], ['័', 'samyok sannya'], ['។', 'khan'], ['ៗ', 'lek too'],
];

const INDEPENDENT: [string, string][] = [
  ['ឥ', 'i'], ['ឦ', 'ii'], ['ឧ', 'u'], ['ឩ', 'uu'], ['ឪ', 'ov'], ['ឫ', 'ry'], ['ឬ', 'ryy'],
  ['ឭ', 'ly'], ['ឮ', 'lyy'], ['ឯ', 'e'], ['ឰ', 'ai'], ['ឱ', 'o'], ['ឲ', 'ao'], ['ឳ', 'au'],
];

const DIGITS = '០១២៣៤៥៦៧៨៩';

function markDef(ch: string, name: string, category: Category): GlyphDef {
  const kind = MARK_KINDS[ch];
  if (!kind) return { id: glyphIdFor(ch), chars: ch, label: ch, name, category, kind: 'base', ghost: ch, base: ch };
  const split = SPLIT_VOWELS.has(ch);
  return {
    id: glyphIdFor(ch),
    chars: ch,
    label: DOTTED_CIRCLE + ch,
    name,
    category,
    kind,
    ghost: REF_BASE + ch,
    base: REF_BASE,
    ghostPrebase: split ? SPLIT_LEFT_PART : kind === 'left' ? ch : undefined,
    split,
  };
}

const consonants: GlyphDef[] = LETTERS.map((l) => ({
  id: l.id,
  chars: l.char,
  label: l.char,
  name: l.name,
  category: 'consonant',
  kind: 'base',
  ghost: l.char,
  base: l.char,
}));

const subscripts: GlyphDef[] = LETTERS.filter((l) => l.char !== 'ឡ').map((l) => {
  const kind = subscriptKind(l.char);
  const source = DRAFT_SOURCE[l.char] ?? l.char;
  return {
    id: subscriptIdFor(l.char),
    chars: COENG + l.char,
    label: DOTTED_CIRCLE + COENG + l.char,
    name: `sub ${l.name}`,
    category: 'subscript',
    kind,
    ghost: l.char + COENG + l.char,
    base: l.char,
    ghostPrebase: kind === 'left' ? COENG + l.char : undefined,
    // Coeng-ro wraps around the base, so it can't be drafted from រ.
    draftFrom: kind === 'below' ? glyphIdFor(source) : undefined,
  };
});

const nyoAlt: GlyphDef = {
  id: NYO_ALT_ID,
  chars: 'ញ',
  label: 'ញ',
  name: 'ញ before a subscript',
  category: 'subscript',
  kind: 'base',
  ghost: 'ញ',
  base: 'ញ',
  optional: true,
};

export const GLYPHS: GlyphDef[] = [
  ...consonants,
  ...subscripts,
  nyoAlt,
  ...VOWELS.map(([c, n]) => markDef(c, n, 'vowel')),
  ...SIGNS.map(([c, n]) => markDef(c, n, 'sign')),
  ...INDEPENDENT.map(([c, n]) => markDef(c, n, 'independent')),
  ...[...DIGITS].map((c, i) => markDef(c, String(i), 'digit')),
];

export const GLYPH_BY_ID = new Map(GLYPHS.map((g) => [g.id, g]));

export function glyphsIn(category: Category): GlyphDef[] {
  return GLYPHS.filter((g) => g.category === category);
}

export function requiredIn(category: Category): GlyphDef[] {
  return glyphsIn(category).filter((g) => !g.optional);
}

export const REQUIRED_TOTAL = GLYPHS.filter((g) => !g.optional).length;
