import { describe, expect, it } from 'vitest';
import { marchContours, signedArea, traceBitmap, type Contour, type Pt } from '../src/export/trace';

/** Soft-edged bitmap from a signed distance function (negative = inside). */
function bitmap(w: number, h: number, sdf: (x: number, y: number) => number): Uint8Array {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      a[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, 0.5 - sdf(x + 0.5, y + 0.5))));
    }
  }
  return a;
}

const circle = (cx: number, cy: number, r: number) => (x: number, y: number) => Math.hypot(x - cx, y - cy) - r;

function samplePoints(c: Contour): Pt[] {
  const out: Pt[] = [];
  let p = c.start;
  for (const [x1, y1, x2, y2, x, y] of c.curves) {
    for (let t = 0; t <= 1; t += 0.1) {
      const u = 1 - t;
      out.push([
        u * u * u * p[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
        u * u * u * p[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
      ]);
    }
    p = [x, y];
  }
  return out;
}

describe('tracing', () => {
  it('finds one clockwise loop around a disc', () => {
    const loops = marchContours(bitmap(120, 120, circle(60, 60, 40)), 120, 120);
    expect(loops).toHaveLength(1);
    expect(signedArea(loops[0])).toBeGreaterThan(0);
    expect(signedArea(loops[0])).toBeCloseTo(Math.PI * 1600, -2);
  });

  it('gives a ring an outer loop and a hole running the other way', () => {
    const ring = bitmap(160, 160, (x, y) => Math.abs(Math.hypot(x - 80, y - 80) - 50) - 12);
    const areas = marchContours(ring, 160, 160).map(signedArea).sort((a, b) => b - a);
    expect(areas).toHaveLength(2);
    expect(areas[0]).toBeGreaterThan(0);
    expect(areas[1]).toBeLessThan(0);
  });

  it('fits a smooth circle with few curves, close to the true shape', () => {
    const r = traceBitmap(bitmap(240, 240, circle(120, 120, 90)), 240, 240);
    expect(r.contours).toHaveLength(1);
    expect(r.contours[0].curves.length).toBeLessThanOrEqual(12);
    for (const [x, y] of samplePoints(r.contours[0])) expect(Math.abs(Math.hypot(x - 120, y - 120) - 90)).toBeLessThan(2.5);
  });

  it('keeps the corners of a square sharp', () => {
    const square = (x: number, y: number) => Math.max(Math.abs(x - 100) - 60, Math.abs(y - 100) - 60);
    const r = traceBitmap(bitmap(200, 200, square), 200, 200);
    const pts = r.contours[0].curves.map((c) => [c[4], c[5]]);
    const nearCorner = (cx: number, cy: number) => pts.some(([x, y]) => Math.hypot(x - cx, y - cy) < 4);
    expect([nearCorner(40, 40), nearCorner(160, 40), nearCorner(160, 160), nearCorner(40, 160)]).toEqual([true, true, true, true]);
  });

  it('applies the origin, drops specks and counts pieces', () => {
    const two = (x: number, y: number) => Math.min(circle(50, 50, 30)(x, y), circle(150, 50, 30)(x, y), circle(100, 120, 2)(x, y));
    const r = traceBitmap(bitmap(200, 160, two), 200, 160, 1000, 500);
    expect(r.pieces).toBe(2);
    expect(r.contours).toHaveLength(2);
    expect(r.contours[0].start[0]).toBeGreaterThan(1000);
    expect(r.contours[0].start[1]).toBeGreaterThan(500);
  });
});
