/**
 * Drawing coordinates live in a fixed 1000 × 1000 design space (y grows downward),
 * independent of screen size. See metrics.ts for the guide lines.
 */

/** x, y in design units, pressure 0–1, t in ms since the stroke started. */
export type Point = [x: number, y: number, pressure: number, t: number];

export type RotationMode = 'none' | 'follow' | 'random';

export interface StampParams {
  /** Distance between stamps, as a fraction of the stamp size. */
  spacing: number;
  /** 0–1: how much each stamp's size varies. */
  sizeJitter: number;
  rotation: RotationMode;
  /** 0–1: sideways scatter, as a fraction of the stamp size. */
  scatter: number;
  /** 0–1 */
  opacity: number;
}

export interface Stroke {
  points: Point[];
  brushId: string;
  /** Brush size in design units. */
  size: number;
  color: string;
  /** Seed for the brush's randomness, so a stroke always redraws identically. */
  seed: number;
  /** Stamp settings at the time the stroke was drawn (stamp brushes only). */
  params?: StampParams;
}

export interface Glyph {
  id: string;
  char: string;
  strokes: Stroke[];
  /** True once the user tapped Save with at least one stroke. */
  saved: boolean;
  updatedAt: number;
  /** Dependent glyphs: ink box of the reference base they were drawn against. */
  ref?: InkBox;
  /** Manual nudge applied when laid out next to a base. */
  offset?: { x: number; y: number };
  /** Base glyphs: left and right side bearings, from the ink. */
  lsb?: number;
  rsb?: number;
}

export interface InkBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type BrushSource =
  | { type: 'emoji'; emoji: string }
  | { type: 'image'; dataUrl: string }
  | { type: 'drawn'; dataUrl: string };

export interface CustomBrush {
  id: string;
  name: string;
  source: BrushSource;
  params: StampParams;
  defaultSize: number;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  brushId: string;
  color: string;
  /** Last size used per brush id. */
  sizes: Record<string, number>;
  /** Stamp settings per stamp brush id (built-in ones; custom brushes keep their own). */
  stampParams: Record<string, StampParams>;
  ghost: boolean;
  guides: boolean;
  fontReady: boolean;
  previewText: string;
  installHintDismissed: boolean;
  /** Letter grid tab (a glyph category). */
  gridTab: string;
  exportName: string;
  exportDesigner: string;
  exportLatin: boolean;
  exportLicence: 'ofl' | 'reserved';
}
