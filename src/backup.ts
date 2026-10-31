import type { CustomBrush, Glyph, Settings } from './types';

/**
 * Bump when the saved data shape changes, and add a step to migrate().
 * 1: Stage 1 (consonants only).
 * 2: Stage 2 adds subscripts, vowels, signs, independent vowels and digits, plus
 *    optional per-glyph ref/offset/lsb/rsb. Stage 1 glyphs are unchanged.
 */
export const SCHEMA_VERSION = 2;
export const APP_ID = 'khmer-letter-pad';

export interface BackupData {
  app: typeof APP_ID;
  schemaVersion: number;
  exportedAt: string;
  glyphs: Glyph[];
  customBrushes: CustomBrush[];
  settings?: Partial<Settings>;
}

export function makeBackup(glyphs: Glyph[], customBrushes: CustomBrush[], settings: Settings): BackupData {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    glyphs,
    customBrushes,
    settings,
  };
}

/** Bring older backups up to the current schema. */
export function migrate(data: BackupData): BackupData {
  let d = data;
  if (d.schemaVersion < 2) {
    // Stage 1 → 2: glyph ids and strokes stay as they are; the new fields are optional.
    d = { ...d, schemaVersion: 2, glyphs: d.glyphs.map((g) => ({ ...g })) };
  }
  return d;
}

/** Parse and validate a backup file's text. Throws an Error with a friendly message. */
export function parseBackup(text: string): BackupData {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a Khmer Letter Pad backup (it's not valid JSON).");
  }
  if (!data || data.app !== APP_ID) {
    throw new Error("This file isn't a Khmer Letter Pad backup.");
  }
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
    throw new Error('This backup was made by a newer version of the app. Please update the app first.');
  }
  if (!Array.isArray(data.glyphs) || !Array.isArray(data.customBrushes ?? [])) {
    throw new Error('This backup file looks damaged.');
  }
  for (const g of data.glyphs) {
    if (typeof g?.id !== 'string' || !Array.isArray(g.strokes)) {
      throw new Error('This backup file looks damaged.');
    }
  }
  data.customBrushes ??= [];
  return migrate(data as BackupData);
}
