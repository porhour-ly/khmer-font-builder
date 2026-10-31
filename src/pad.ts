import { store } from './store';
import { CATEGORIES, GLYPH_BY_ID, GLYPHS, glyphsIn, requiredIn, REQUIRED_TOTAL } from './glyphs';
import { currentRefBox, draftGlyph, drawFaint, drawReference, frameOffset, isDraft, isSubscript, subscriptRegions } from './reference';
import { inkBox } from './render';
import { EM, GUIDES } from './metrics';
import { compositeLayer, fitCanvas, renderStrokes, StrokeRenderer, type View } from './render';
import { newSeed } from './rng';
import {
  DEFAULT_STAMP_PARAMS,
  getBrush,
  isStampBrush,
  PAINT_BRUSHES,
  STAMP_BRUSHES,
  FONT_READY_BRUSH,
  type BrushDef,
} from './brushes';
import { celebrateSave } from './confetti';
import { createPreview } from './preview';
import { openCustomBrushEditor, openStampSettings, renderBrushSample } from './brushEditor';
import { h, toast, confirmDialog } from './ui';
import type { Point, StampParams, Stroke } from './types';

const SWATCHES = ['#1d1d1f', '#e63946', '#f4845f', '#f7b801', '#43aa8b', '#277da1', '#7b2cbf', '#ff70a6', '#8d6e63', '#ffffff'];

/** Pen or finger: once an Apple Pencil is seen, fingers stop drawing (palm rejection). */
let penSeen = false;

export function currentStampParams(brushId: string): StampParams {
  const custom = store.brushes.get(brushId);
  if (custom) return custom.params;
  return store.settings.stampParams[brushId] ?? DEFAULT_STAMP_PARAMS;
}

export function currentSize(brushId: string): number {
  return store.settings.sizes[brushId] ?? getBrush(brushId).defaultSize;
}

type Mode = 'draw' | 'move' | 'spacing';
const DEFAULT_BEARING = 40;

export function mountPad(root: HTMLElement, glyphId: string): () => void {
  const def = GLYPH_BY_ID.get(glyphId) ?? GLYPHS[0];
  const LIST = glyphsIn(def.category);
  const category = CATEGORIES.find((c) => c.id === def.category)!;
  const letter = { id: def.id, char: def.label, name: def.name };
  const index = LIST.indexOf(def);
  const dependent = def.kind !== 'base';
  const cleanups: (() => void)[] = [];
  /** False once the user leaves this letter, so late dialog answers don't touch it. */
  let alive = true;

  const initial = store.glyph(letter.id);
  let strokes: Stroke[] = [...initial.strokes];
  /** Reference base box this glyph is stored against (set on its first stroke). */
  const glyphRef = initial.ref ?? (dependent ? currentRefBox(def) : undefined);
  let offset = initial.offset ?? { x: 0, y: 0 };
  let lsb = initial.lsb ?? DEFAULT_BEARING;
  let rsb = initial.rsb ?? DEFAULT_BEARING;
  let mode: Mode = 'draw';
  /** Where stored strokes appear on the pad (follows the reference base, plus the nudge). */
  let shift = frameOffset(def, { ...initial, ref: glyphRef, offset });
  const recomputeShift = () => (shift = frameOffset(def, { ...initial, ref: glyphRef, offset }));
  const undoStack: Stroke[][] = [];
  const redoStack: Stroke[][] = [];

  // ---------- canvases ----------
  const bg = h('canvas', { class: 'layer' });
  const art = h('canvas', { class: 'layer' });
  const live = h('canvas', { class: 'layer live' });
  const stack = h('div', { class: 'canvas-stack' }, bg, art, live);
  const area = h('div', { class: 'canvas-area' }, stack);
  let view: View = { scale: 1, dx: 0, dy: 0 };
  /** View for this glyph's own strokes. */
  const glyphView = (): View => ({ scale: view.scale, dx: shift.x * view.scale, dy: shift.y * view.scale });
  let side = 0;

  const drawBg = () => {
    const ctx = bg.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fffdf8';
    ctx.fillRect(0, 0, bg.width, bg.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
    if (store.settings.guides) {
      const lines: [keyof typeof GUIDES, string, string][] = [
        ['ascender', 'ascender', '#c9c3e6'],
        ['xHeight', 'x-height', '#a99ee0'],
        ['baseline', 'baseline', '#7b6cd9'],
        ['descender', 'descender', '#c9c3e6'],
      ];
      for (const [key, label, color] of lines) {
        const y = GUIDES[key];
        ctx.strokeStyle = color;
        ctx.lineWidth = key === 'baseline' ? 3 : 2;
        ctx.setLineDash(key === 'baseline' ? [] : [14, 12]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(EM, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.font = '24px -apple-system, system-ui, sans-serif';
        ctx.fillText(label, 14, y - 8);
      }
    }
    drawReference(ctx, def, view.scale, store.settings.ghost, true);
    const draft = !strokes.length ? draftGlyph(def) : undefined;
    if (draft) drawFaint(ctx, draft.strokes, view, 0.35);
  };

  const drawArt = () => {
    const ctx = art.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, art.width, art.height);
    renderStrokes(ctx, strokes, glyphView(), store.settings.fontReady);
    drawOverlay();
  };

  const resize = () => {
    const s = Math.floor(Math.min(area.clientWidth, area.clientHeight));
    if (!s || s === side) return;
    side = s;
    stack.style.width = stack.style.height = `${s}px`;
    let dpr = 1;
    for (const c of [bg, art, live]) dpr = fitCanvas(c, s, s);
    view = { scale: (s * dpr) / EM, dx: 0, dy: 0 };
    drawBg();
    drawArt();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(area);
  cleanups.push(() => ro.disconnect());

  // ---------- history ----------
  const commit = (next: Stroke[]) => {
    undoStack.push(strokes);
    redoStack.length = 0;
    strokes = next;
    saveStrokes();
    updateHistoryButtons();
  };
  const saveStrokes = () => store.setStrokes(letter.id, strokes, glyphRef ? { ref: glyphRef } : {});
  const undo = () => {
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push(strokes);
    strokes = prev;
    saveStrokes();
    drawArt();
    updateHistoryButtons();
  };
  const redo = () => {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(strokes);
    strokes = next;
    saveStrokes();
    drawArt();
    updateHistoryButtons();
  };
  const clearAll = () => {
    if (!strokes.length) return;
    commit([]);
    drawArt();
  };

  // ---------- drawing ----------
  let active: { id: number; touch: boolean; stroke: Stroke; renderer: StrokeRenderer; brush: BrushDef } | null = null;
  let frame = 0;

  const toPoint = (e: PointerEvent, t0: number): Point => {
    const r = stack.getBoundingClientRect();
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : 0.5;
    return [
      Math.round((((e.clientX - r.left) / r.width) * EM - shift.x) * 10) / 10,
      Math.round((((e.clientY - r.top) / r.height) * EM - shift.y) * 10) / 10,
      Math.round(pressure * 100) / 100,
      Math.round(e.timeStamp - t0),
    ];
  };

  // ---------- two-finger tap = undo ----------
  // Uses touch events rather than pointer events: iPad Safari reports
  // multi-finger touches most reliably this way. Apple Pencil touches
  // (touchType "stylus") are ignored.
  const TAP_MAX_MS = 400;
  const TAP_MAX_MOVE = 30; // CSS pixels
  let tap: { start: number; maxFingers: number; valid: boolean; origin: Map<number, [number, number]> } | null = null;

  const fingers = (list: TouchList) => [...list].filter((t) => (t as Touch & { touchType?: string }).touchType !== 'stylus');

  const cancelActiveStroke = () => {
    if (!active) return;
    active = null;
    cancelAnimationFrame(frame);
    frame = 0;
    const lctx = live.getContext('2d')!;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, live.width, live.height);
  };

  const onTouchStart = (e: TouchEvent) => {
    e.preventDefault(); // no scrolling, zooming or magnifier while drawing
    const down = fingers(e.touches);
    if (!down.length) return;
    if (!tap) tap = { start: performance.now(), maxFingers: 0, valid: true, origin: new Map() };
    for (const t of down) if (!tap.origin.has(t.identifier)) tap.origin.set(t.identifier, [t.clientX, t.clientY]);
    tap.maxFingers = Math.max(tap.maxFingers, down.length);
    if (performance.now() - tap.start > TAP_MAX_MS) tap.valid = false;
    // A second finger means a gesture: drop the stroke the first finger started.
    if (down.length >= 2 && active?.touch) cancelActiveStroke();
  };

  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (!tap) return;
    for (const t of fingers(e.touches)) {
      const o = tap.origin.get(t.identifier);
      if (o && Math.hypot(t.clientX - o[0], t.clientY - o[1]) > TAP_MAX_MOVE) tap.valid = false;
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (!tap || fingers(e.touches).length) return;
    const t = tap;
    tap = null;
    if (t.valid && t.maxFingers === 2 && performance.now() - t.start <= TAP_MAX_MS) {
      if (undoStack.length) {
        undo();
        toast('↶ Undo', 900);
      } else {
        toast('Nothing to undo', 900);
      }
    }
  };

  /** Subscript pads only take strokes in the subscript's own area. */
  const regions = isSubscript(def) ? subscriptRegions(def) : null;
  const canDrawAt = (e: PointerEvent) => {
    if (!regions) return true;
    const [x, y] = unitsAt(e);
    return regions.some((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom);
  };

  let t0 = 0;
  const onDown = (e: PointerEvent) => {
    if (active) return;
    if (e.pointerType === 'touch' && tap && tap.maxFingers >= 2) return;
    if (e.pointerType === 'pen') penSeen = true;
    else if (e.pointerType === 'touch' && penSeen) return;
    if (e.button > 0) return;
    e.preventDefault();
    if (mode !== 'draw') {
      startDrag(e);
      return;
    }
    if (!canDrawAt(e)) {
      toast('Draw the subscript in the clear area', 1400);
      return;
    }
    try {
      live.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone; drawing still works without capture */
    }
    t0 = e.timeStamp;
    const { brushId, color } = store.settings;
    const stroke: Stroke = {
      points: [toPoint(e, t0)],
      brushId,
      size: currentSize(brushId),
      color,
      seed: newSeed(),
    };
    if (isStampBrush(brushId)) stroke.params = { ...currentStampParams(brushId) };
    const fontReady = store.settings.fontReady;
    const renderer = new StrokeRenderer(stroke, live.getContext('2d')!, glyphView(), fontReady);
    const brush = fontReady ? FONT_READY_BRUSH : renderer.brush;
    live.style.opacity = String(brush.opacity);
    live.style.mixBlendMode = brush.blend === 'source-over' ? 'normal' : brush.blend;
    active = { id: e.pointerId, touch: e.pointerType === 'touch', stroke, renderer, brush };
    renderer.update();
  };

  const onMove = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      moveDrag(e);
      return;
    }
    if (!active || e.pointerId !== active.id) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const pts = active.stroke.points;
    for (const ev of events.length ? events : [e]) {
      if (!canDrawAt(ev)) continue;
      const p = toPoint(ev, t0);
      const last = pts[pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.2) pts.push(p);
    }
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        active?.renderer.update();
      });
    }
  };

  const onUp = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) {
      endDrag();
      return;
    }
    if (!active || e.pointerId !== active.id) return;
    const { stroke, renderer, brush } = active;
    active = null;
    cancelAnimationFrame(frame);
    frame = 0;
    renderer.finish();
    const lctx = live.getContext('2d')!;
    compositeLayer(art.getContext('2d')!, live, brush);
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, live.width, live.height);
    commit([...strokes, stroke]);
  };

  // ---------- move (nudge) and spacing modes ----------
  let drag: { id: number; startX: number; startY: number; offset: { x: number; y: number }; side?: 'l' | 'r'; lsb: number; rsb: number } | null = null;

  const unitsAt = (e: PointerEvent): [number, number] => {
    const r = stack.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * EM, ((e.clientY - r.top) / r.height) * EM];
  };

  /** Ink box of this glyph as shown on the pad. */
  const shownBox = () => {
    const b = inkBox(strokes);
    return b && { left: b.left + shift.x, right: b.right + shift.x, top: b.top + shift.y, bottom: b.bottom + shift.y };
  };

  const startDrag = (e: PointerEvent) => {
    const [x, y] = unitsAt(e);
    let side: 'l' | 'r' | undefined;
    if (mode === 'spacing') {
      const b = shownBox();
      if (!b) return;
      side = Math.abs(x - (b.left - lsb)) < Math.abs(x - (b.right + rsb)) ? 'l' : 'r';
    } else if (!strokes.length) {
      return;
    }
    try {
      live.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    drag = { id: e.pointerId, startX: x, startY: y, offset: { ...offset }, side, lsb, rsb };
  };

  const moveDrag = (e: PointerEvent) => {
    if (!drag) return;
    const [x, y] = unitsAt(e);
    const dx = Math.round(x - drag.startX);
    const dy = Math.round(y - drag.startY);
    if (mode === 'move') {
      offset = { x: drag.offset.x + dx, y: drag.offset.y + dy };
      recomputeShift();
      drawArt();
    } else {
      const clamp = (v: number) => Math.max(-150, Math.min(400, v));
      if (drag.side === 'l') lsb = clamp(drag.lsb - dx);
      else rsb = clamp(drag.rsb + dx);
      drawOverlay();
    }
  };

  const endDrag = () => {
    drag = null;
    if (mode === 'move') store.setGlyphProps(letter.id, { offset });
    else store.setGlyphProps(letter.id, { lsb, rsb });
  };

  /** Spacing lines (spacing mode) drawn on the live layer. */
  const drawOverlay = () => {
    if (active) return;
    const ctx = live.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, live.width, live.height);
    live.style.opacity = '1';
    live.style.mixBlendMode = 'normal';
    const b = mode === 'spacing' ? shownBox() : null;
    if (!b) return;
    ctx.setTransform(view.scale, 0, 0, view.scale, 0, 0);
    const l = b.left - lsb;
    const r = b.right + rsb;
    ctx.fillStyle = 'rgba(123, 108, 217, 0.08)';
    ctx.fillRect(0, 0, l, EM);
    ctx.fillRect(r, 0, EM - r, EM);
    ctx.strokeStyle = '#7b6cd9';
    ctx.lineWidth = 4;
    for (const x of [l, r]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, EM);
      ctx.stroke();
      ctx.fillStyle = '#7b6cd9';
      ctx.beginPath();
      ctx.arc(x, EM / 2, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.font = '600 26px -apple-system, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.round(lsb)}`, l, 40);
    ctx.fillText(`${Math.round(rsb)}`, r, 40);
    ctx.fillText(`width ${Math.round(r - l)}`, (l + r) / 2, EM - 30);
  };

  live.addEventListener('pointerdown', onDown);
  live.addEventListener('pointermove', onMove);
  live.addEventListener('pointerup', onUp);
  live.addEventListener('pointercancel', onUp);
  stack.addEventListener('touchstart', onTouchStart, { passive: false });
  stack.addEventListener('touchmove', onTouchMove, { passive: false });
  stack.addEventListener('touchend', onTouchEnd);
  stack.addEventListener('touchcancel', () => (tap = null));

  // ---------- top bar ----------
  const go = (id: string) => (location.hash = `#/draw/${id}`);
  const prevLetter = LIST[(index - 1 + LIST.length) % LIST.length];
  const nextLetter = LIST[(index + 1) % LIST.length];
  const catTotal = requiredIn(def.category).length;
  const doneMessage = () =>
    store.savedCount() === REQUIRED_TOTAL
      ? `🎉 Every glyph is drawn! Your alphabet is complete!`
      : `🎉 All ${catTotal} ${category.title.toLowerCase()} drawn! Amazing!`;

  const saveBtn = h('button', { class: 'btn primary save-btn', onclick: () => save() }, 'Save ✓');
  const doneBadge = h('span', { class: 'done-badge' }, '✓ saved');
  const draftBadge = h('span', { class: 'draft-badge' }, 'auto-draft');

  const save = () => {
    const before = store.savedCount(def.category);
    const wasDone = store.isDone(letter.id);
    if (!store.markSaved(letter.id)) {
      toast(isDraft(def.id) ? 'Draw it, or tap “Start from draft” ✨' : 'Draw something first ✏️');
      return;
    }
    const after = store.savedCount(def.category);
    updateDone();
    if (!def.optional && celebrateSave(saveBtn, before, after, catTotal)) {
      toast(doneMessage(), 4000);
      setTimeout(() => (location.hash = '#/'), 2200);
      return;
    }
    if (def.optional) celebrateSave(saveBtn, 0, 0, 1);
    toast(def.optional ? `Saved ${letter.char}` : `Saved ${letter.char}  ·  ${after}/${catTotal}`);
    if (!wasDone) {
      // Keep the flow going: jump to the next glyph that isn't done yet.
      const next = [...LIST.slice(index + 1), ...LIST.slice(0, index)].find((l) => (!l.optional || l.category === 'pair') && !store.isDone(l.id));
      if (next) setTimeout(() => go(next.id), 650);
    }
  };

  const saveAllCount = h('span', { class: 'count' });
  const saveAllBtn = h(
    'button',
    { class: 'btn save-all-btn', title: 'Save every drawn letter', onclick: () => saveAll() },
    h('span', { class: 'save-all-label' }, 'Save all '),
    saveAllCount,
  );

  const saveAll = () => {
    const before = store.savedCount(def.category);
    const n = store.saveAll();
    if (!n) {
      toast('Everything is already saved ✓');
      return;
    }
    const after = store.savedCount(def.category);
    updateDone();
    if (celebrateSave(saveAllBtn, before, after, catTotal)) {
      toast(doneMessage(), 4000);
      return;
    }
    toast(`Saved ${n} glyph${n === 1 ? '' : 's'}  ·  ${store.savedCount()}/${REQUIRED_TOTAL} in total`);
  };

  const updateDone = () => {
    doneBadge.classList.toggle('show', store.isDone(letter.id));
    draftBadge.classList.toggle('show', !strokes.length && isDraft(def.id));
    const n = store.unsavedDrawn().length;
    saveAllCount.textContent = String(n);
    saveAllBtn.hidden = n === 0;
  };
  cleanups.push(store.subscribe(updateDone));

  const topbar = h(
    'header',
    { class: 'topbar pad-topbar' },
    h('a', { class: 'btn ghost back-btn', href: '#/', 'aria-label': 'Back to letters' }, '‹', h('span', { class: 'back-label' }, ' Letters')),
    h(
      'div',
      { class: 'letter-nav' },
      h('button', { class: 'btn icon', 'aria-label': 'Previous letter', onclick: () => go(prevLetter.id) }, '◀'),
      h(
        'div',
        { class: 'letter-title' },
        h('span', { class: 'letter-char', lang: 'km' }, letter.char),
        h('span', { class: 'letter-meta' }, h('b', {}, letter.name), ` ${index + 1} / ${LIST.length}`, doneBadge, draftBadge),
      ),
      h('button', { class: 'btn icon', 'aria-label': 'Next letter', onclick: () => go(nextLetter.id) }, '▶'),
    ),
    h('div', { class: 'save-group' }, saveAllBtn, saveBtn),
  );

  // ---------- tools ----------
  const undoBtn = h('button', { class: 'tool', onclick: undo, title: 'Undo' }, h('span', {}, '↶'), 'Undo');
  const redoBtn = h('button', { class: 'tool', onclick: redo, title: 'Redo' }, h('span', {}, '↷'), 'Redo');
  const clearBtn = h(
    'button',
    {
      class: 'tool',
      title: 'Clear',
      onclick: async () => {
        if (strokes.length > 3 && !(await confirmDialog('Clear this letter? You can still undo.', 'Clear', true))) return;
        if (alive) clearAll();
      },
    },
    h('span', {}, '✕'),
    'Clear',
  );
  let hadStrokes = strokes.length > 0;
  const updateHistoryButtons = () => {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
    clearBtn.disabled = !strokes.length;
    draftBtn.hidden = !!strokes.length || !isDraft(def.id);
    // The auto-draft preview in the background comes and goes with the first stroke.
    if (hadStrokes !== strokes.length > 0) {
      hadStrokes = strokes.length > 0;
      drawBg();
      updateDone();
    }
  };

  const draftBtn = h(
    'button',
    {
      class: 'btn small draft-btn',
      hidden: true,
      onclick: () => {
        const d = draftGlyph(def);
        if (!d || strokes.length) return;
        commit(d.strokes.map((st) => ({ ...st, points: st.points.map((p) => [p[0] - shift.x, p[1] - shift.y, p[2], p[3]] as Point) })));
        drawArt();
        toast('Draft copied: now make it your own ✏️');
      },
    },
    '✨ Start from draft',
  );

  const modeBtns = new Map<Mode, HTMLButtonElement>();
  const setMode = (m: Mode) => {
    mode = m;
    for (const [k, b] of modeBtns) b.setAttribute('aria-selected', String(k === m));
    live.classList.toggle('moving', m !== 'draw');
    resetMoveBtn.hidden = m !== 'move';
    drawOverlay();
  };
  const modeRow = h('div', { class: 'segmented mode-row', role: 'tablist' });
  for (const [m, label] of [
    ['draw', '✏️ Draw'],
    [dependent ? 'move' : 'spacing', dependent ? '✥ Move' : '↔ Spacing'],
  ] as [Mode, string][]) {
    const b = h('button', { type: 'button', role: 'tab', onclick: () => setMode(m) }, label);
    modeBtns.set(m, b);
    modeRow.append(b);
  }
  const resetMoveBtn = h(
    'button',
    {
      class: 'btn small',
      hidden: true,
      onclick: () => {
        offset = { x: 0, y: 0 };
        recomputeShift();
        store.setGlyphProps(letter.id, { offset });
        drawArt();
      },
    },
    'Reset position',
  );

  const toggle = (key: 'ghost' | 'guides' | 'fontReady', icon: string, label: string) => {
    const btn = h(
      'button',
      {
        class: 'tool toggle',
        onclick: () => {
          store.updateSettings({ [key]: !store.settings[key] });
          btn.setAttribute('aria-pressed', String(store.settings[key]));
          if (key === 'fontReady') drawArt();
          else drawBg();
        },
      },
      h('span', {}, icon),
      label,
    );
    btn.setAttribute('aria-pressed', String(store.settings[key]));
    return btn;
  };

  const brushGrid = h('div', { class: 'brush-sections' });
  const settingsBtn = h('button', { class: 'btn small', onclick: () => openBrushSettings() }, '⚙︎ Brush settings');
  const sizeValue = h('span', { class: 'size-value' });
  const sizeSlider = h('input', {
    type: 'range',
    min: 4,
    max: 220,
    step: 1,
    class: 'size-slider',
    oninput: () => {
      const v = Number(sizeSlider.value);
      store.updateSettings({ sizes: { ...store.settings.sizes, [store.settings.brushId]: v } });
      sizeValue.textContent = String(v);
    },
  });
  const swatchRow = h('div', { class: 'swatches' });
  const colorInput = h('input', {
    type: 'color',
    class: 'color-input',
    'aria-label': 'Custom colour',
    oninput: () => setColor(colorInput.value),
  });

  const setColor = (c: string) => {
    store.updateSettings({ color: c });
    refreshTools(true);
  };

  for (const c of SWATCHES) {
    swatchRow.append(
      h('button', {
        class: 'swatch',
        style: { background: c },
        'data-color': c,
        'aria-label': `Colour ${c}`,
        onclick: () => setColor(c),
      }),
    );
  }
  swatchRow.append(colorInput);

  const chip = (brush: BrushDef) => {
    const c = h('canvas', { class: 'chip-canvas' });
    const btn = h(
      'button',
      {
        class: 'brush-chip',
        'data-brush': brush.id,
        title: brush.name,
        onclick: () => {
          if (store.settings.brushId === brush.id && isStampBrush(brush.id)) {
            openBrushSettings();
            return;
          }
          store.updateSettings({ brushId: brush.id });
          refreshTools(false);
        },
      },
      c,
      h('span', {}, brush.name),
    );
    requestAnimationFrame(() => renderBrushSample(c, brush.id, 72, 40, store.settings.color, currentStampParams(brush.id)));
    return btn;
  };

  const buildBrushes = () => {
    brushGrid.replaceChildren(
      h('h3', {}, 'Paint'),
      h('div', { class: 'chips' }, PAINT_BRUSHES.map(chip)),
      h('h3', {}, 'Stamps'),
      h('div', { class: 'chips' }, STAMP_BRUSHES.map(chip)),
      h('h3', {}, 'My brushes'),
      h(
        'div',
        { class: 'chips' },
        [...store.brushes.values()].sort((a, b) => a.createdAt - b.createdAt).map((cb) => chip(getBrush(cb.id))),
        h(
          'button',
          {
            class: 'brush-chip new',
            onclick: async () => {
              const created = await openCustomBrushEditor();
              if (alive && created && created !== 'deleted') {
                store.updateSettings({ brushId: created.id });
                buildBrushes();
                refreshTools(false);
              }
            },
          },
          h('span', { class: 'plus' }, '+'),
          h('span', {}, 'New brush'),
        ),
      ),
    );
    refreshTools(false);
  };

  const openBrushSettings = async () => {
    const id = store.settings.brushId;
    const custom = store.brushes.get(id);
    if (custom) {
      const res = await openCustomBrushEditor(custom);
      if (res !== null && alive) {
        buildBrushes();
        drawArt();
      }
    } else if (isStampBrush(id)) {
      await openStampSettings(id);
      if (alive) buildBrushes();
    }
  };

  /** Updates selection states; re-renders chip previews when the colour changed. */
  const refreshTools = (colorChanged: boolean) => {
    const { brushId, color } = store.settings;
    for (const el of brushGrid.querySelectorAll<HTMLButtonElement>('.brush-chip[data-brush]')) {
      el.classList.toggle('selected', el.dataset.brush === brushId);
      if (colorChanged) {
        const id = el.dataset.brush!;
        if (getBrush(id).usesColor) renderBrushSample(el.querySelector('canvas')!, id, 72, 40, color, currentStampParams(id));
      }
    }
    for (const el of swatchRow.querySelectorAll<HTMLButtonElement>('.swatch')) {
      el.classList.toggle('selected', el.dataset.color === color);
    }
    colorInput.value = color.length === 7 ? color : '#000000';
    const usesColor = getBrush(brushId).usesColor;
    swatchRow.classList.toggle('dim', !usesColor);
    settingsBtn.hidden = !isStampBrush(brushId);
    const size = currentSize(brushId);
    sizeSlider.value = String(size);
    sizeValue.textContent = String(size);
  };

  const tools = h(
    'aside',
    { class: 'tools' },
    h('div', { class: 'tool-row' }, undoBtn, redoBtn, clearBtn),
    h(
      'div',
      { class: 'tool-row' },
      toggle('ghost', '👻', 'Ghost'),
      toggle('guides', '☰', 'Guides'),
      toggle('fontReady', '◼︎', 'Font view'),
    ),
    modeRow,
    resetMoveBtn,
    draftBtn,
    h('div', { class: 'size-row' }, h('label', {}, 'Size'), sizeSlider, sizeValue),
    swatchRow,
    settingsBtn,
    brushGrid,
  );

  const preview = createPreview(true);
  cleanups.push(preview.destroy);

  root.replaceChildren(
    h('div', { class: 'pad-view' }, topbar, h('div', { class: 'pad-main' }, area, tools), preview.el),
  );
  buildBrushes();
  updateHistoryButtons();
  updateDone();
  setMode('draw');
  resize();

  // Keyboard shortcuts for desktop testing.
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (e.key === 'ArrowLeft') go(prevLetter.id);
    else if (e.key === 'ArrowRight') go(nextLetter.id);
  };
  window.addEventListener('keydown', onKey);
  cleanups.push(() => window.removeEventListener('keydown', onKey));

  return () => {
    alive = false;
    store.flush();
    for (const fn of cleanups) fn();
  };
}
