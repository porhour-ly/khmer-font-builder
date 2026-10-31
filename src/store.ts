import * as db from './db';
import { makeBackup, SCHEMA_VERSION, type BackupData } from './backup';
import { GLYPH_BY_ID, GLYPHS, requiredIn, type Category } from './glyphs';
import type { CustomBrush, Glyph, Settings, Stroke } from './types';

const DEFAULT_SETTINGS: Settings = {
  brushId: 'pen',
  color: '#1d1d1f',
  sizes: {},
  stampParams: {},
  ghost: true,
  guides: true,
  fontReady: false,
  previewText: 'ក្មេង ស្រី ខ្ញុំ',
  installHintDismissed: false,
  gridTab: 'consonant',
  exportName: '',
  exportDesigner: '',
  exportLatin: true,
  exportLicence: 'ofl',
};

type Listener = () => void;

/** In-memory app state, persisted to IndexedDB. */
class Store {
  glyphs = new Map<string, Glyph>();
  brushes = new Map<string, CustomBrush>();
  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();
  private pendingGlyphs = new Set<string>();
  private glyphTimer: number | undefined;
  private settingsTimer: number | undefined;

  async load(): Promise<void> {
    const [glyphs, brushes, settings] = await Promise.all([
      db.getAll<Glyph>('glyphs'),
      db.getAll<CustomBrush>('brushes'),
      db.getMeta<Partial<Settings>>('settings'),
    ]);
    this.glyphs = new Map(glyphs.map((g) => [g.id, g]));
    this.brushes = new Map(brushes.map((b) => [b.id, b]));
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    await db.setMeta('schemaVersion', SCHEMA_VERSION);
    db.requestPersistence();
    // Write pending changes before the page goes away (e.g. switching apps on iPad).
    const flush = () => this.flush();
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
    window.addEventListener('pagehide', flush);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  glyph(id: string): Glyph {
    let g = this.glyphs.get(id);
    if (!g) {
      g = { id, char: GLYPH_BY_ID.get(id)?.chars ?? '', strokes: [], saved: false, updatedAt: 0 };
    }
    return g;
  }

  /** A glyph only if it has been drawn. */
  drawn(id: string): Glyph | undefined {
    const g = this.glyphs.get(id);
    return g && g.strokes.length ? g : undefined;
  }

  setStrokes(id: string, strokes: Stroke[], extra: Partial<Pick<Glyph, 'ref'>> = {}): void {
    const g = { ...this.glyph(id), ...extra, strokes, updatedAt: Date.now() };
    if (!strokes.length) g.saved = false;
    this.glyphs.set(id, g);
    this.queueGlyph(id);
    this.emit();
  }

  /** Updates position and spacing settings of a glyph. */
  setGlyphProps(id: string, patch: Partial<Pick<Glyph, 'offset' | 'lsb' | 'rsb' | 'ref'>>): void {
    this.glyphs.set(id, { ...this.glyph(id), ...patch, updatedAt: Date.now() });
    this.queueGlyph(id);
    this.emit();
  }

  /** Marks the glyph as finished. Returns false when there is nothing drawn. */
  markSaved(id: string): boolean {
    const g = this.glyph(id);
    if (!g.strokes.length) return false;
    this.glyphs.set(id, { ...g, saved: true, updatedAt: Date.now() });
    this.queueGlyph(id);
    this.emit();
    return true;
  }

  /** Glyphs that have drawings but haven't been saved yet. */
  unsavedDrawn(): string[] {
    return GLYPHS.filter((d) => {
      const g = this.glyphs.get(d.id);
      return !!g && g.strokes.length > 0 && !g.saved;
    }).map((d) => d.id);
  }

  /** Saves every drawn letter at once. Returns how many were newly saved. */
  saveAll(): number {
    const ids = this.unsavedDrawn();
    const now = Date.now();
    for (const id of ids) {
      this.glyphs.set(id, { ...this.glyph(id), saved: true, updatedAt: now });
      this.queueGlyph(id);
    }
    if (ids.length) this.emit();
    return ids.length;
  }

  /** Saved glyphs in a category, or across all categories (optional glyphs excluded). */
  savedCount(category?: Category): number {
    const defs = category ? requiredIn(category) : GLYPHS.filter((g) => !g.optional);
    return defs.filter((d) => this.isDone(d.id)).length;
  }

  isDone(id: string): boolean {
    const g = this.glyphs.get(id);
    return !!g && g.saved && g.strokes.length > 0;
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    clearTimeout(this.settingsTimer);
    this.settingsTimer = window.setTimeout(() => db.setMeta('settings', this.settings), 300);
    this.emit();
  }

  async saveBrush(brush: CustomBrush): Promise<void> {
    this.brushes.set(brush.id, brush);
    await db.put('brushes', brush);
    this.emit();
  }

  async deleteBrush(id: string): Promise<void> {
    this.brushes.delete(id);
    await db.remove('brushes', id);
    if (this.settings.brushId === id) this.updateSettings({ brushId: 'pen' });
    this.emit();
  }

  exportData(): BackupData {
    this.flush();
    return makeBackup([...this.glyphs.values()], [...this.brushes.values()], this.settings);
  }

  /** Replaces everything with the backup's contents. */
  async importData(data: BackupData): Promise<void> {
    await Promise.all([db.clear('glyphs'), db.clear('brushes')]);
    this.glyphs = new Map(data.glyphs.map((g) => [g.id, g]));
    this.brushes = new Map(data.customBrushes.map((b) => [b.id, b]));
    await Promise.all([
      ...data.glyphs.map((g) => db.put('glyphs', g)),
      ...data.customBrushes.map((b) => db.put('brushes', b)),
    ]);
    if (data.settings) this.updateSettings(data.settings);
    this.emit();
  }

  private queueGlyph(id: string): void {
    this.pendingGlyphs.add(id);
    clearTimeout(this.glyphTimer);
    this.glyphTimer = window.setTimeout(() => this.flush(), 250);
  }

  flush(): void {
    clearTimeout(this.glyphTimer);
    for (const id of this.pendingGlyphs) {
      const g = this.glyphs.get(id);
      if (g) db.put('glyphs', g);
    }
    this.pendingGlyphs.clear();
  }
}

export const store = new Store();
