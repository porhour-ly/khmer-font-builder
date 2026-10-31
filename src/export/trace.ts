/**
 * Turns a glyph's rasterized "font view" into clean closed outlines.
 *
 * 1. Marching squares follows the edge of the ink, with sub-pixel accuracy
 *    from the anti-aliased alpha. Overlapping strokes are already merged in
 *    the raster, so the outlines have no overlaps.
 * 2. Each loop is split at sharp corners and fitted with cubic Béziers
 *    (Schneider's algorithm).
 *
 * Pure code (no DOM), so it can be unit tested.
 */

export type Pt = [x: number, y: number];

/** A closed outline: a start point, then cubic segments [c1x, c1y, c2x, c2y, x, y]. */
export interface Contour {
  start: Pt;
  curves: number[][];
}

const TOP = 0;
const LEFT = 1;

/**
 * Finds closed loops around the ink. Outer loops run clockwise on screen and
 * holes counter-clockwise, which is what TrueType expects after flipping y.
 * The outermost row and column of the bitmap must be empty.
 */
export function marchContours(alpha: ArrayLike<number>, w: number, h: number, threshold = 128): Pt[][] {
  const at = (x: number, y: number) => alpha[y * w + x];
  const edgeId = (x: number, y: number, side: number) => (y * w + x) * 2 + side;
  const next = new Map<number, number>();
  const pos = new Map<number, Pt>();

  const topEdge = (x: number, y: number) => {
    const id = edgeId(x, y, TOP);
    if (!pos.has(id)) {
      const a = at(x, y);
      const b = at(x + 1, y);
      pos.set(id, [x + 0.5 + (threshold - a) / (b - a), y + 0.5]);
    }
    return id;
  };
  const leftEdge = (x: number, y: number) => {
    const id = edgeId(x, y, LEFT);
    if (!pos.has(id)) {
      const a = at(x, y);
      const d = at(x, y + 1);
      pos.set(id, [x + 0.5, y + 0.5 + (threshold - a) / (d - a)]);
    }
    return id;
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = at(x, y) >= threshold;
      const b = at(x + 1, y) >= threshold;
      const c = at(x + 1, y + 1) >= threshold;
      const d = at(x, y + 1) >= threshold;
      const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => topEdge(x, y);
      const L = () => leftEdge(x, y);
      const R = () => leftEdge(x + 1, y);
      const B = () => topEdge(x, y + 1);
      const link = (from: number, to: number) => next.set(from, to);
      switch (code) {
        case 8: link(T(), L()); break; // a
        case 4: link(R(), T()); break; // b
        case 2: link(B(), R()); break; // c
        case 1: link(L(), B()); break; // d
        case 12: link(R(), L()); break; // a b
        case 3: link(L(), R()); break; // c d
        case 9: link(T(), B()); break; // a d
        case 6: link(B(), T()); break; // b c
        case 7: link(L(), T()); break; // all but a
        case 11: link(T(), R()); break; // all but b
        case 13: link(R(), B()); break; // all but c
        case 14: link(B(), L()); break; // all but d
        case 10: {
          // a c diagonal: the centre decides whether they connect.
          const inside = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= threshold;
          if (inside) {
            link(T(), R());
            link(B(), L());
          } else {
            link(T(), L());
            link(B(), R());
          }
          break;
        }
        case 5: {
          // b d diagonal.
          const inside = (at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1)) / 4 >= threshold;
          if (inside) {
            link(L(), T());
            link(R(), B());
          } else {
            link(R(), T());
            link(L(), B());
          }
          break;
        }
      }
    }
  }

  const loops: Pt[][] = [];
  const visited = new Set<number>();
  for (const start of next.keys()) {
    if (visited.has(start)) continue;
    const loop: Pt[] = [];
    let id: number | undefined = start;
    while (id !== undefined && !visited.has(id)) {
      visited.add(id);
      loop.push(pos.get(id)!);
      id = next.get(id);
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Positive for loops that run clockwise on screen (y down). */
export function signedArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

// ---------- vector helpers ----------

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const norm = (a: Pt): Pt => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

// ---------- corners ----------

/** Indices of sharp corners in a closed loop. */
export function findCorners(poly: Pt[], window = 6, angleDeg = 55): number[] {
  const n = poly.length;
  if (n < window * 4) return [];
  const limit = Math.cos((angleDeg * Math.PI) / 180);
  const sharp: { i: number; c: number }[] = [];
  const cosAt = (i: number) => {
    const p = poly[i];
    const a = norm(sub(poly[(i - window + n) % n], p));
    const b = norm(sub(poly[(i + window) % n], p));
    return -dot(a, b); // 1 when straight, lower when bent
  };
  for (let i = 0; i < n; i++) {
    const c = cosAt(i);
    if (c >= limit) continue;
    let best = true;
    for (let k = 1; k <= window && best; k++) {
      if (cosAt((i + k) % n) < c || cosAt((i - k + n) % n) < c) best = false;
    }
    if (best) sharp.push({ i, c });
  }
  return sharp.map((s) => s.i);
}

// ---------- Schneider curve fitting ----------

type Bez = [Pt, Pt, Pt, Pt];

function bezierAt(b: Bez, t: number): Pt {
  const u = 1 - t;
  const k0 = u * u * u;
  const k1 = 3 * u * u * t;
  const k2 = 3 * u * t * t;
  const k3 = t * t * t;
  return [
    k0 * b[0][0] + k1 * b[1][0] + k2 * b[2][0] + k3 * b[3][0],
    k0 * b[0][1] + k1 * b[1][1] + k2 * b[2][1] + k3 * b[3][1],
  ];
}

function chordParams(pts: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + len(sub(pts[i], pts[i - 1])));
  const total = u[u.length - 1] || 1;
  return u.map((v) => v / total);
}

function generateBezier(pts: Pt[], u: number[], t1: Pt, t2: Pt): Bez {
  const first = pts[0];
  const last = pts[pts.length - 1];
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i];
    const s = 1 - t;
    const b0 = s * s * s;
    const b1 = 3 * s * s * t;
    const b2 = 3 * s * t * t;
    const b3 = t * t * t;
    const a0 = mul(t1, b1);
    const a1 = mul(t2, b2);
    c00 += dot(a0, a0);
    c01 += dot(a0, a1);
    c11 += dot(a1, a1);
    const tmp = sub(pts[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dot(a0, tmp);
    x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const chord = len(sub(last, first));
  let al = Math.abs(det) > 1e-9 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = Math.abs(det) > 1e-9 ? (c00 * x1 - c01 * x0) / det : 0;
  if (al < chord * 1e-3 || ar < chord * 1e-3 || al > chord * 3 || ar > chord * 3) al = ar = chord / 3;
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function maxError(pts: Pt[], b: Bez, u: number[]): { err: number; at: number } {
  let err = 0;
  let at = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const d = sub(bezierAt(b, u[i]), pts[i]);
    const e = dot(d, d);
    if (e > err) {
      err = e;
      at = i;
    }
  }
  return { err, at };
}

function reparameterize(pts: Pt[], u: number[], b: Bez): number[] {
  const d1: Pt[] = [mul(sub(b[1], b[0]), 3), mul(sub(b[2], b[1]), 3), mul(sub(b[3], b[2]), 3)];
  const d2: Pt[] = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
  return u.map((t, i) => {
    const s = 1 - t;
    const q = sub(bezierAt(b, t), pts[i]);
    const q1 = add(add(mul(d1[0], s * s), mul(d1[1], 2 * s * t)), mul(d1[2], t * t));
    const q2 = add(mul(d2[0], s), mul(d2[1], t));
    const denom = dot(q1, q1) + dot(q, q2);
    if (Math.abs(denom) < 1e-9) return t;
    return Math.min(1, Math.max(0, t - dot(q, q1) / denom));
  });
}

function fitCubic(pts: Pt[], t1: Pt, t2: Pt, tol2: number, out: Bez[]): void {
  if (pts.length === 2) {
    const d = len(sub(pts[1], pts[0])) / 3;
    out.push([pts[0], add(pts[0], mul(t1, d)), add(pts[1], mul(t2, d)), pts[1]]);
    return;
  }
  let u = chordParams(pts);
  let bez = generateBezier(pts, u, t1, t2);
  let { err, at } = maxError(pts, bez, u);
  if (err < tol2) {
    out.push(bez);
    return;
  }
  if (err < tol2 * 16) {
    for (let i = 0; i < 4; i++) {
      u = reparameterize(pts, u, bez);
      bez = generateBezier(pts, u, t1, t2);
      ({ err, at } = maxError(pts, bez, u));
      if (err < tol2) {
        out.push(bez);
        return;
      }
    }
  }
  at = Math.max(1, Math.min(pts.length - 2, at));
  const w = Math.min(3, at, pts.length - 1 - at);
  const center = norm(sub(pts[at - w], pts[at + w]));
  fitCubic(pts.slice(0, at + 1), t1, center, tol2, out);
  fitCubic(pts.slice(at), mul(center, -1), t2, tol2, out);
}

function endTangent(pts: Pt[], fromStart: boolean): Pt {
  const k = Math.min(4, pts.length - 1);
  return fromStart ? norm(sub(pts[k], pts[0])) : norm(sub(pts[pts.length - 1 - k], pts[pts.length - 1]));
}

/** Fits a closed loop with cubic curves. tolerance is in design units. */
export function fitLoop(poly: Pt[], tolerance = 1.2): Contour {
  const corners = findCorners(poly);
  const n = poly.length;
  // Smooth loops have no natural ends, so split them at two opposite points.
  const breaks = corners.length ? corners : [0, Math.floor(n / 2)];
  const curves: Bez[] = [];
  for (let i = 0; i < breaks.length; i++) {
    const a = breaks[i];
    const b = breaks[(i + 1) % breaks.length];
    const run: Pt[] = [];
    for (let k = a; ; k = (k + 1) % n) {
      run.push(poly[k]);
      if (k === b && run.length > 1) break;
    }
    if (corners.length) {
      fitCubic(run, endTangent(run, true), endTangent(run, false), tolerance * tolerance, curves);
    } else {
      // No corners: share a smooth tangent across the join.
      const before = (i: number) => poly[(i - 3 + n) % n];
      const after = (i: number) => poly[(i + 3) % n];
      const ta = norm(sub(after(a), before(a)));
      const tb = norm(sub(before(b), after(b)));
      fitCubic(run, ta, tb, tolerance * tolerance, curves);
    }
  }
  return {
    start: curves[0][0],
    curves: curves.map((c) => [c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]]),
  };
}

export interface TraceResult {
  contours: Contour[];
  /** Total ink area in square units. */
  area: number;
  /** Number of separate pieces of ink (outer loops). */
  pieces: number;
}

/** Specks smaller than this (square units) are dropped. */
const MIN_AREA = 40;

/**
 * Traces a bitmap whose pixel (0,0) sits at design position (originX, originY)
 * with one pixel per design unit.
 */
export function traceBitmap(alpha: ArrayLike<number>, w: number, h: number, originX = 0, originY = 0): TraceResult {
  const contours: Contour[] = [];
  let area = 0;
  let pieces = 0;
  for (const loop of marchContours(alpha, w, h)) {
    const a = signedArea(loop);
    if (Math.abs(a) < MIN_AREA) continue;
    area += a;
    if (a > 0) pieces++;
    const c = fitLoop(loop.map(([x, y]) => [x + originX, y + originY] as Pt));
    contours.push({
      start: [Math.round(c.start[0]), Math.round(c.start[1])],
      curves: c.curves.map((s) => s.map(Math.round)),
    });
  }
  return { contours, area, pieces };
}
