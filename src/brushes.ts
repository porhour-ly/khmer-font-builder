import type { CustomBrush, Point, StampParams } from './types';

/**
 * A brush draws a stroke one segment at a time, so the same code renders
 * live while drawing and later when redrawing from saved data. All randomness
 * comes from b.rng (seeded per stroke), so redraws are identical.
 *
 * Each stroke is drawn onto its own transparent layer, which is then
 * composited with the brush's opacity and blend mode. That way a
 * semi-transparent marker doesn't get darker where the stroke overlaps itself.
 */
export interface BrushCtx {
  ctx: CanvasRenderingContext2D;
  pts: Point[];
  size: number;
  color: string;
  rng: () => number;
  params: StampParams;
  /** Device pixels per design unit (for effects measured in pixels, like blur). */
  pxPerUnit: number;
  /** Scratch space a brush can keep between segments. */
  state: Record<string, any>;
}

export interface BrushDef {
  id: string;
  name: string;
  kind: 'paint' | 'stamp' | 'custom';
  defaultSize: number;
  /** Opacity used when compositing the finished stroke layer. */
  opacity: number;
  blend: GlobalCompositeOperation;
  usesColor: boolean;
  /** Draw the first point. */
  start(b: BrushCtx): void;
  /** Draw from point i-1 to point i. */
  segment(b: BrushCtx, i: number): void;
  /** Draw anything left after the last point. */
  end?(b: BrushCtx): void;
}

export const DEFAULT_STAMP_PARAMS: StampParams = {
  spacing: 0.8,
  sizeJitter: 0.25,
  rotation: 'random',
  scatter: 0.15,
  opacity: 1,
};

// ---------- helpers ----------

const pressureWidth = (b: BrushCtx, p: number) => b.size * (0.35 + 0.9 * p);

function mid(a: Point, c: Point): [number, number] {
  return [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
}

/**
 * Smooth path through the points: each segment is a quadratic curve between
 * midpoints, using the previous point as the control point.
 */
function curveSegment(b: BrushCtx, i: number): void {
  const { ctx, pts } = b;
  const prev = pts[i - 1];
  const from = i >= 2 ? mid(pts[i - 2], prev) : [prev[0], prev[1]];
  const to = mid(prev, pts[i]);
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.quadraticCurveTo(prev[0], prev[1], to[0], to[1]);
  ctx.stroke();
}

function curveEnd(b: BrushCtx): void {
  const { ctx, pts } = b;
  const n = pts.length;
  if (n < 2) return;
  const from = mid(pts[n - 2], pts[n - 1]);
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
  ctx.stroke();
}

function dot(b: BrushCtx, x: number, y: number, r: number): void {
  b.ctx.beginPath();
  b.ctx.arc(x, y, Math.max(r, 0.5), 0, Math.PI * 2);
  b.ctx.fill();
}

/**
 * Calls fn at evenly spaced positions along segment i, carrying the leftover
 * distance into the next segment so spacing stays even across the stroke.
 */
function walk(
  b: BrushCtx,
  i: number,
  spacing: number,
  fn: (x: number, y: number, p: number, angle: number) => void,
): void {
  const a = b.pts[i - 1];
  const c = b.pts[i];
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const angle = Math.atan2(dy, dx);
  let d: number = b.state.carry ?? spacing;
  while (d <= len) {
    const t = d / len;
    fn(a[0] + dx * t, a[1] + dy * t, a[2] + (c[2] - a[2]) * t, angle);
    d += spacing;
  }
  b.state.carry = d - len;
}

function segLength(b: BrushCtx, i: number): number {
  const a = b.pts[i - 1];
  const c = b.pts[i];
  return Math.hypot(c[0] - a[0], c[1] - a[1]);
}

function segAngle(b: BrushCtx, i: number): number {
  const a = b.pts[i - 1];
  const c = b.pts[i];
  return Math.atan2(c[1] - a[1], c[0] - a[0]);
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** amount > 0 mixes toward white, < 0 toward black. */
function shade(hex: string, amount: number, alpha = 1): string {
  const [r, g, bl] = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (v: number) => Math.round(v + (target - v) * k);
  return `rgba(${mix(r)},${mix(g)},${mix(bl)},${alpha})`;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, bl] = hexToRgb(hex);
  return `rgba(${r},${g},${bl},${alpha})`;
}

/** Pen-style stroke shared by pen, rainbow and the font-ready view. */
function penLike(id: string, name: string, colorFor?: (b: BrushCtx, i: number) => string): BrushDef {
  return {
    id,
    name,
    kind: 'paint',
    defaultSize: 36,
    opacity: 1,
    blend: 'source-over',
    usesColor: !colorFor,
    start(b) {
      b.ctx.fillStyle = colorFor ? colorFor(b, 0) : b.color;
      dot(b, b.pts[0][0], b.pts[0][1], pressureWidth(b, b.pts[0][2]) / 2);
    },
    segment(b, i) {
      const { ctx, pts } = b;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colorFor ? colorFor(b, i) : b.color;
      ctx.lineWidth = pressureWidth(b, (pts[i - 1][2] + pts[i][2]) / 2);
      curveSegment(b, i);
    },
    end(b) {
      const n = b.pts.length;
      if (n < 2) return;
      b.ctx.lineCap = 'round';
      b.ctx.strokeStyle = colorFor ? colorFor(b, n - 1) : b.color;
      b.ctx.lineWidth = pressureWidth(b, b.pts[n - 1][2]);
      curveEnd(b);
    },
  };
}

/**
 * Thick paint made only of bristle lines (acrylic, oil). There is no solid
 * base stroke: a base drawn per segment would paint over the previous
 * segment's streaks, so the bristles together cover the full width instead.
 */
function bristleBrush(
  id: string,
  name: string,
  opts: { bristles: number; variation: number; shine: boolean },
): BrushDef {
  const setup = (b: BrushCtx) => {
    if (b.state.bristles) return;
    const n = opts.bristles;
    b.state.bristles = Array.from({ length: n }, (_, k) => ({
      offset: (k + 0.5) / n - 0.5 + (b.rng() - 0.5) * (0.6 / n),
      width: (1.7 + b.rng() * 0.8) / n,
      color: shade(b.color, (b.rng() * 2 - 1) * opts.variation),
    }));
  };
  const lines = (b: BrushCtx, a: Point, c: Point, w: number, ang: number) => {
    const { ctx } = b;
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    ctx.lineCap = 'round';
    for (const br of b.state.bristles) {
      const off = br.offset * w;
      ctx.strokeStyle = br.color;
      ctx.lineWidth = br.width * w;
      ctx.beginPath();
      ctx.moveTo(a[0] + nx * off, a[1] + ny * off);
      ctx.lineTo(c[0] + nx * off, c[1] + ny * off);
      ctx.stroke();
    }
    if (opts.shine) {
      const off = -0.22 * w;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = w * 0.06;
      ctx.beginPath();
      ctx.moveTo(a[0] + nx * off, a[1] + ny * off);
      ctx.lineTo(c[0] + nx * off, c[1] + ny * off);
      ctx.stroke();
    }
  };
  return {
    id,
    name,
    kind: 'paint',
    defaultSize: 60,
    opacity: 1,
    blend: 'source-over',
    usesColor: true,
    start(b) {
      setup(b);
      b.ctx.fillStyle = b.color;
      dot(b, b.pts[0][0], b.pts[0][1], pressureWidth(b, b.pts[0][2]) * 0.45);
    },
    segment(b, i) {
      setup(b);
      const a = b.pts[i - 1];
      const c = b.pts[i];
      lines(b, a, c, pressureWidth(b, (a[2] + c[2]) / 2), segAngle(b, i));
    },
  };
}

/** Grainy dry media built from many small specks (chalk, crayon). */
function grainBrush(
  id: string,
  name: string,
  opts: { widthK: number; specks: number; minAlpha: number; maxAlpha: number; speck: number; defaultSize: number },
): BrushDef {
  const grain = (b: BrushCtx, x: number, y: number, p: number, angle: number) => {
    const { ctx } = b;
    const w = pressureWidth(b, p) * opts.widthK;
    for (let k = 0; k < opts.specks; k++) {
      const across = b.rng() - 0.5;
      const along = (b.rng() - 0.5) * w * 0.3;
      // Fewer, fainter specks toward the edges for a soft, broken edge.
      const edge = 1 - Math.abs(across) * 1.6;
      const alpha = (opts.minAlpha + b.rng() * (opts.maxAlpha - opts.minAlpha)) * Math.max(edge, 0.15);
      const s = opts.speck * w * (0.6 + b.rng() * 0.8);
      const sx = x + Math.cos(angle) * along - Math.sin(angle) * across * w;
      const sy = y + Math.sin(angle) * along + Math.cos(angle) * across * w;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(angle + (b.rng() - 0.5) * 0.6);
      ctx.fillStyle = rgba(b.color, alpha);
      ctx.fillRect(-s, -s * 0.3, s * 2, s * 0.6);
      ctx.restore();
    }
  };
  return {
    id,
    name,
    kind: 'paint',
    defaultSize: opts.defaultSize,
    opacity: 1,
    blend: 'source-over',
    usesColor: true,
    start(b) {
      b.state.carry = 0;
      grain(b, b.pts[0][0], b.pts[0][1], b.pts[0][2], 0);
    },
    segment(b, i) {
      const w = b.size * opts.widthK;
      walk(b, i, Math.max(w * 0.07, 0.8), (x, y, p, angle) => grain(b, x, y, p, angle));
    },
  };
}

// ---------- paint brushes ----------

const pen = penLike('pen', 'Pen');

const marker: BrushDef = {
  id: 'marker',
  name: 'Marker',
  kind: 'paint',
  defaultSize: 50,
  opacity: 0.7,
  blend: 'multiply',
  usesColor: true,
  start(b) {
    b.ctx.fillStyle = b.color;
    dot(b, b.pts[0][0], b.pts[0][1], b.size * 0.55);
  },
  segment(b, i) {
    b.ctx.lineCap = 'round';
    b.ctx.lineJoin = 'round';
    b.ctx.strokeStyle = b.color;
    b.ctx.lineWidth = b.size * 1.1;
    curveSegment(b, i);
  },
  end(b) {
    b.ctx.lineCap = 'round';
    b.ctx.strokeStyle = b.color;
    b.ctx.lineWidth = b.size * 1.1;
    curveEnd(b);
  },
};

const NIB_ANGLE = -Math.PI / 4;

const calligraphy: BrushDef = {
  id: 'calligraphy',
  name: 'Calligraphy',
  kind: 'paint',
  defaultSize: 56,
  opacity: 1,
  blend: 'source-over',
  usesColor: true,
  start(b) {
    const [x, y, p] = b.pts[0];
    const half = (b.size * (0.5 + 0.8 * p)) / 2;
    const nx = Math.cos(NIB_ANGLE) * half;
    const ny = Math.sin(NIB_ANGLE) * half;
    b.ctx.strokeStyle = b.color;
    b.ctx.lineWidth = b.size * 0.08;
    b.ctx.beginPath();
    b.ctx.moveTo(x - nx, y - ny);
    b.ctx.lineTo(x + nx, y + ny);
    b.ctx.stroke();
  },
  segment(b, i) {
    const { ctx, pts } = b;
    const a = pts[i - 1];
    const c = pts[i];
    const ha = (b.size * (0.5 + 0.8 * a[2])) / 2;
    const hc = (b.size * (0.5 + 0.8 * c[2])) / 2;
    const cx = Math.cos(NIB_ANGLE);
    const cy = Math.sin(NIB_ANGLE);
    ctx.fillStyle = b.color;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.size * 0.04;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a[0] - cx * ha, a[1] - cy * ha);
    ctx.lineTo(a[0] + cx * ha, a[1] + cy * ha);
    ctx.lineTo(c[0] + cx * hc, c[1] + cy * hc);
    ctx.lineTo(c[0] - cx * hc, c[1] - cy * hc);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  },
};

const pencil: BrushDef = {
  id: 'pencil',
  name: 'Pencil',
  kind: 'paint',
  defaultSize: 18,
  opacity: 0.9,
  blend: 'multiply',
  usesColor: true,
  start(b) {
    b.state.carry = 0;
    pencil.segment(b, 0);
  },
  segment(b, i) {
    const speck = (x: number, y: number, p: number) => {
      const w = b.size * (0.5 + 0.7 * p);
      for (let k = 0; k < 4; k++) {
        const r = (b.rng() - 0.5) * w;
        const r2 = (b.rng() - 0.5) * w;
        const s = b.size * (0.06 + b.rng() * 0.08);
        b.ctx.fillStyle = rgba(b.color, 0.25 + b.rng() * 0.5);
        b.ctx.fillRect(x + r, y + r2, s, s);
      }
    };
    if (i === 0) {
      const [x, y, p] = b.pts[0];
      speck(x, y, p);
      return;
    }
    walk(b, i, Math.max(b.size * 0.08, 0.6), speck);
  },
};

const watercolor: BrushDef = {
  id: 'watercolor',
  name: 'Watercolor',
  kind: 'paint',
  defaultSize: 70,
  opacity: 0.85,
  blend: 'multiply',
  usesColor: true,
  start(b) {
    b.state.carry = 0;
    const [x, y, p] = b.pts[0];
    watercolorBlob(b, x, y, p);
  },
  segment(b, i) {
    walk(b, i, Math.max(b.size * 0.07, 1), (x, y, p) => watercolorBlob(b, x, y, p));
  },
};

function watercolorBlob(b: BrushCtx, x: number, y: number, p: number): void {
  const { ctx } = b;
  const r = b.size * 0.5 * (0.6 + 0.6 * b.rng()) * (0.7 + 0.6 * p);
  const ox = (b.rng() - 0.5) * b.size * 0.25;
  const oy = (b.rng() - 0.5) * b.size * 0.25;
  ctx.fillStyle = rgba(b.color, 0.045);
  ctx.beginPath();
  ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
  ctx.fill();
  // A faint darker rim, like pigment collecting at the edge of a wet patch.
  ctx.strokeStyle = rgba(b.color, 0.012);
  ctx.lineWidth = b.size * 0.05;
  ctx.stroke();
}

const acrylic = bristleBrush('acrylic', 'Acrylic', { bristles: 14, variation: 0.22, shine: false });
const oil = bristleBrush('oil', 'Oil', { bristles: 22, variation: 0.38, shine: true });

const spray: BrushDef = {
  id: 'spray',
  name: 'Spray',
  kind: 'paint',
  defaultSize: 70,
  opacity: 1,
  blend: 'source-over',
  usesColor: true,
  start(b) {
    sprayDots(b, b.pts[0][0], b.pts[0][1], b.pts[0][2], 30);
  },
  segment(b, i) {
    const len = segLength(b, i);
    const a = b.pts[i - 1];
    const c = b.pts[i];
    const count = Math.min(Math.ceil((len / Math.max(b.size, 1)) * 40), 200);
    for (let k = 0; k < count; k++) {
      const t = b.rng();
      sprayDots(b, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, c[2], 1);
    }
  },
};

function sprayDots(b: BrushCtx, x: number, y: number, p: number, n: number): void {
  for (let k = 0; k < n; k++) {
    // Product of two randoms concentrates dots toward the centre.
    const r = b.size * 0.65 * (0.6 + 0.6 * p) * b.rng() * Math.sqrt(b.rng());
    const ang = b.rng() * Math.PI * 2;
    b.ctx.fillStyle = rgba(b.color, 0.4 + b.rng() * 0.5);
    dot(b, x + Math.cos(ang) * r, y + Math.sin(ang) * r, b.size * (0.012 + b.rng() * 0.02));
  }
}

const chalk = grainBrush('chalk', 'Chalk', { widthK: 1, specks: 8, minAlpha: 0.3, maxAlpha: 0.9, speck: 0.12, defaultSize: 50 });
const crayon = grainBrush('crayon', 'Crayon', { widthK: 0.8, specks: 14, minAlpha: 0.65, maxAlpha: 1, speck: 0.07, defaultSize: 40 });

const neon: BrushDef = {
  id: 'neon',
  name: 'Neon',
  kind: 'paint',
  defaultSize: 40,
  opacity: 1,
  blend: 'source-over',
  usesColor: true,
  start(b) {
    const [x, y] = b.pts[0];
    b.ctx.shadowColor = b.color;
    b.ctx.shadowBlur = b.size * 0.8 * b.pxPerUnit;
    b.ctx.fillStyle = b.color;
    dot(b, x, y, b.size * 0.25);
    b.ctx.shadowBlur = 0;
    b.ctx.fillStyle = 'rgba(255,255,255,0.9)';
    dot(b, x, y, b.size * 0.08);
  },
  segment(b, i) {
    const { ctx } = b;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = b.color;
    ctx.shadowBlur = b.size * 0.8 * b.pxPerUnit;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.size * 0.5;
    curveSegment(b, i);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = b.size * 0.16;
    curveSegment(b, i);
  },
  end(b) {
    const { ctx } = b;
    ctx.lineCap = 'round';
    ctx.shadowColor = b.color;
    ctx.shadowBlur = b.size * 0.8 * b.pxPerUnit;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.size * 0.5;
    curveEnd(b);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = b.size * 0.16;
    curveEnd(b);
  },
};

const rainbow = penLike('rainbow', 'Rainbow', (b, i) => {
  if (i > 0) b.state.dist = (b.state.dist ?? 0) + segLength(b, i);
  return `hsl(${((b.state.dist ?? 0) * 0.5) % 360}, 90%, 55%)`;
});

// ---------- stamp brushes ----------

/** Images used by stamp brushes, keyed by brush id. */
const stampImages = new Map<string, CanvasImageSource>();

const STAMP_RES = 160;

/** Renders an emoji into a square canvas, centred on its visible ink. */
export function emojiToCanvas(emoji: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = STAMP_RES;
  const ctx = c.getContext('2d')!;
  ctx.font = `${STAMP_RES * 0.78}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(emoji);
  const inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const x = STAMP_RES / 2 + (m.actualBoundingBoxLeft - inkW / 2);
  const y = STAMP_RES / 2 + (inkH ? m.actualBoundingBoxAscent - inkH / 2 : STAMP_RES * 0.3);
  ctx.fillText(emoji, x, y);
  return c;
}

/** Fits any image into a square transparent canvas. */
export function imageToSquareCanvas(img: CanvasImageSource & { width: number; height: number }, res = 256): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = res;
  const ctx = c.getContext('2d')!;
  const w = img.width || res;
  const h = img.height || res;
  const k = res / Math.max(w, h);
  ctx.drawImage(img, (res - w * k) / 2, (res - h * k) / 2, w * k, h * k);
  return c;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = src;
  });
}

function stampImage(id: string): CanvasImageSource | undefined {
  return stampImages.get(id);
}

function placeStamp(b: BrushCtx, id: string, x: number, y: number, angle: number): void {
  const { params, ctx } = b;
  // Always use the same number of random draws per stamp, whatever the settings.
  const rJitter = b.rng();
  const rRot = b.rng();
  const rScatter = b.rng();
  const s = Math.max(b.size * (1 + (rJitter * 2 - 1) * params.sizeJitter), 1);
  const rot = params.rotation === 'follow' ? angle : params.rotation === 'random' ? rRot * Math.PI * 2 : 0;
  const off = (rScatter * 2 - 1) * params.scatter * b.size;
  const px = x - Math.sin(angle) * off;
  const py = y + Math.cos(angle) * off;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(rot);
  ctx.globalAlpha = params.opacity;
  const img = stampImage(id);
  if (img) {
    ctx.drawImage(img, -s / 2, -s / 2, s, s);
  } else {
    ctx.fillStyle = '#ccc';
    ctx.beginPath();
    ctx.arc(0, 0, s / 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function stampBrush(id: string, name: string, kind: 'stamp' | 'custom', defaultSize = 70): BrushDef {
  return {
    id,
    name,
    kind,
    defaultSize,
    opacity: 1,
    blend: 'source-over',
    usesColor: false,
    start(b) {
      b.state.carry = Math.max(b.size * b.params.spacing, 2);
      placeStamp(b, id, b.pts[0][0], b.pts[0][1], 0);
    },
    segment(b, i) {
      walk(b, i, Math.max(b.size * b.params.spacing, 2), (x, y, _p, angle) => placeStamp(b, id, x, y, angle));
    },
  };
}

const STAMPS: [string, string, string][] = [
  ['heart', 'Heart', '❤️'],
  ['cat', 'Cat', '🐱'],
  ['butterfly', 'Butterfly', '🦋'],
  ['star', 'Star', '⭐'],
  ['flower', 'Flower', '🌸'],
  ['sparkle', 'Sparkle', '✨'],
];

export const PAINT_BRUSHES: BrushDef[] = [
  pen, marker, calligraphy, pencil, watercolor, acrylic, oil, spray, chalk, crayon, neon, rainbow,
];

export const STAMP_BRUSHES: BrushDef[] = STAMPS.map(([id, name]) => stampBrush(id, name, 'stamp'));

const BUILT_IN = new Map<string, BrushDef>([...PAINT_BRUSHES, ...STAMP_BRUSHES].map((b) => [b.id, b]));
const customDefs = new Map<string, BrushDef>();

/** Call once at startup: renders the built-in emoji stamps. */
export function initStampImages(): void {
  for (const [id, , emoji] of STAMPS) stampImages.set(id, emojiToCanvas(emoji));
}

/** (Re)registers a custom brush and loads its image. */
export async function registerCustomBrush(cb: CustomBrush): Promise<void> {
  customDefs.set(cb.id, stampBrush(cb.id, cb.name, 'custom', cb.defaultSize));
  try {
    if (cb.source.type === 'emoji') {
      stampImages.set(cb.id, emojiToCanvas(cb.source.emoji));
    } else {
      stampImages.set(cb.id, imageToSquareCanvas(await loadImage(cb.source.dataUrl)));
    }
  } catch {
    stampImages.delete(cb.id);
  }
}

export function unregisterCustomBrush(id: string): void {
  customDefs.delete(id);
  stampImages.delete(id);
}

/** Looks up a brush. Unknown ids (e.g. a deleted custom brush) fall back to the pen. */
export function getBrush(id: string): BrushDef {
  return BUILT_IN.get(id) ?? customDefs.get(id) ?? pen;
}

export function isStampBrush(id: string): boolean {
  const k = getBrush(id).kind;
  return k === 'stamp' || k === 'custom';
}

/** Solid black round pen used for the "font-ready" view: what the font will be made from. */
export const FONT_READY_BRUSH: BrushDef = { ...penLike('font-ready', 'Font-ready'), usesColor: false };

/** Pen width used for a stroke in the font-ready view. */
export function fontReadySize(brushId: string, size: number): number {
  return isStampBrush(brushId) ? Math.min(Math.max(size * 0.4, 16), 80) : size;
}
