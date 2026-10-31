export interface LetterDef {
  id: string;
  char: string;
  /** Romanized name, shown under the letter. */
  name: string;
  category: 'consonant';
}

const CONSONANTS: [string, string][] = [
  ['ក', 'ka'], ['ខ', 'kha'], ['គ', 'ko'], ['ឃ', 'kho'], ['ង', 'ngo'],
  ['ច', 'cha'], ['ឆ', 'chha'], ['ជ', 'cho'], ['ឈ', 'chho'], ['ញ', 'nho'],
  ['ដ', 'da'], ['ឋ', 'tha'], ['ឌ', 'do'], ['ឍ', 'tho'], ['ណ', 'na'],
  ['ត', 'ta'], ['ថ', 'tha'], ['ទ', 'to'], ['ធ', 'tho'], ['ន', 'no'],
  ['ប', 'ba'], ['ផ', 'pha'], ['ព', 'po'], ['ភ', 'pho'], ['ម', 'mo'],
  ['យ', 'yo'], ['រ', 'ro'], ['ល', 'lo'], ['វ', 'vo'],
  ['ស', 'sa'], ['ហ', 'ha'], ['ឡ', 'la'], ['អ', 'a'],
];

/** Glyph id for a single character, e.g. ក → "u1780". */
export function idFor(char: string): string {
  return 'u' + char.codePointAt(0)!.toString(16);
}

export const LETTERS: LetterDef[] = CONSONANTS.map(([char, name]) => ({
  id: idFor(char),
  char,
  name,
  category: 'consonant',
}));

export const LETTER_BY_ID = new Map(LETTERS.map((l) => [l.id, l]));
export const LETTER_BY_CHAR = new Map(LETTERS.map((l) => [l.char, l]));
