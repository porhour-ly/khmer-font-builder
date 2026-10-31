import { GUIDES } from './metrics';

/** System Khmer fonts: iOS/macOS, then common Android/Windows/Linux ones. */
export const KHMER_FONT_STACK =
  '"Khmer Sangam MN","Khmer MN","Noto Sans Khmer","Noto Serif Khmer","Khmer OS","Khmer UI","Leelawadee UI",sans-serif';

/** Font size (in design units) that makes a consonant body span x-height to baseline. */
let fontSizeUnits = 520;

/** Measures the system font once so the ghost letter lines up with the guides. */
export async function calibrateKhmerFont(): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `100px ${KHMER_FONT_STACK}`;
  const h = ctx.measureText('ក').actualBoundingBoxAscent;
  if (h > 5) fontSizeUnits = (100 * (GUIDES.baseline - GUIDES.xHeight)) / h;
}

/** Size of the system font in design units (consonant body = x-height to baseline). */
export function khmerFontSizeUnits(): number {
  return fontSizeUnits;
}

export function khmerFont(): string {
  return `${fontSizeUnits}px ${KHMER_FONT_STACK}`;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measurer(): CanvasRenderingContext2D {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = khmerFont();
  return measureCtx;
}

/** Ink box (design units) of text drawn with drawKhmerCentered at cx = 500. */
export function systemInkBox(text: string): { left: number; right: number; top: number; bottom: number } {
  const m = measurer().measureText(text);
  const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  return {
    left: 500 - inkW / 2,
    right: 500 + inkW / 2,
    top: GUIDES.baseline - m.actualBoundingBoxAscent,
    bottom: GUIDES.baseline + m.actualBoundingBoxDescent,
  };
}

/** Width of text in the system font, in design units. */
export function systemTextWidth(text: string): number {
  return measurer().measureText(text).width;
}

/**
 * Draws a system-font cluster (e.g. "កោ") so that its base letter's ink is
 * centred at baseCenterX. `prebase` is the part shapers put before the base.
 */
export function drawKhmerAligned(
  ctx: CanvasRenderingContext2D,
  text: string,
  base: string,
  prebase: string | undefined,
  baseCenterX: number,
  color: string,
): void {
  const m = measurer().measureText(base);
  const baseInkCenter = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  const prebaseShift = prebase ? systemTextWidth(base + prebase) - m.width : 0;
  ctx.save();
  ctx.font = khmerFont();
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(text, baseCenterX - baseInkCenter - prebaseShift, GUIDES.baseline);
  ctx.restore();
}

/** Erases a letter placed as drawKhmerAligned places it, edges included. */
export function eraseKhmerBase(ctx: CanvasRenderingContext2D, base: string, baseCenterX: number): void {
  const m = measurer().measureText(base);
  const x = baseCenterX - (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2;
  ctx.save();
  ctx.font = khmerFont();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = 8;
  ctx.fillText(base, x, GUIDES.baseline);
  ctx.strokeText(base, x, GUIDES.baseline);
  ctx.restore();
}

/** Draws text in the system Khmer font, sitting on the baseline, with its ink centred at cx. */
export function drawKhmerCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, color: string): void {
  ctx.save();
  ctx.font = khmerFont();
  ctx.fillStyle = color;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const m = ctx.measureText(text);
  const inkLeft = -m.actualBoundingBoxLeft;
  const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  ctx.fillText(text, cx - inkW / 2 - inkLeft, GUIDES.baseline);
  ctx.restore();
}
