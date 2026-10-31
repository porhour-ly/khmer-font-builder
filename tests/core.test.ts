import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/rng';
import { LETTERS, idFor } from '../src/letters';
import { makeBackup, parseBackup, SCHEMA_VERSION } from '../src/backup';
import type { Settings } from '../src/types';

describe('rng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});

describe('letters', () => {
  it('has the 33 consonants with unique ids', () => {
    expect(LETTERS).toHaveLength(33);
    expect(new Set(LETTERS.map((l) => l.id)).size).toBe(33);
    expect(idFor('ក')).toBe('u1780');
    expect(LETTERS.at(-1)!.char).toBe('អ');
  });
});

describe('backup', () => {
  const settings = { brushId: 'pen' } as Settings;
  const glyph = { id: 'u1780', char: 'ក', strokes: [], saved: false, updatedAt: 1 };

  it('round-trips', () => {
    const text = JSON.stringify(makeBackup([glyph], [], settings));
    const parsed = parseBackup(text);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.glyphs).toEqual([glyph]);
  });

  it('migrates a Stage 1 backup without losing drawings', () => {
    const v1 = { ...makeBackup([{ ...glyph, strokes: [{ points: [[1, 2, 0.5, 0]], brushId: 'pen', size: 30, color: '#000', seed: 1 }] }] as any, [], settings), schemaVersion: 1 };
    const parsed = parseBackup(JSON.stringify(v1));
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.glyphs[0].strokes).toHaveLength(1);
    expect(parsed.glyphs[0].id).toBe('u1780');
  });

  it('rejects other files with a friendly message', () => {
    expect(() => parseBackup('not json')).toThrow(/not valid JSON/);
    expect(() => parseBackup('{"hello":1}')).toThrow(/isn't a Khmer Letter Pad backup/);
    expect(() =>
      parseBackup(JSON.stringify({ ...makeBackup([], [], settings), schemaVersion: SCHEMA_VERSION + 1 })),
    ).toThrow(/newer version/);
  });
});
