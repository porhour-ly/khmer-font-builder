import { store } from './store';
import { drawGlyphAt, glyphBitmap } from './render';
import { khmerFont, khmerFontSizeUnits, KHMER_FONT_STACK, systemTextWidth } from './khmerFont';
import { EM, GUIDES } from './metrics';
import { layoutText } from './layout/khmer';
import { currentRefBox, glyphMetrics, isDraft, resolveGlyph } from './reference';
import { brushVersion } from './brushVersion';
import { h } from './ui';

const SAMPLE_WORDS = ['ក្មេង', 'ស្រី', 'ខ្ញុំ', 'សួស្ដី', 'កម្ពុជា', 'អរគុណ'];

/** Line height in ems: room for stacked subscripts below the descender. */
const LINE_EMS = 1.15;

/**
 * Live preview: text laid out with the user's glyphs by the mini layout engine.
 * Syllables that use a glyph not drawn yet fall back to the system font (grey).
 * The full version also shows the system font underneath for comparison.
 */
export function createPreview(compact: boolean): { el: HTMLElement; destroy: () => void } {
  const mine = h('canvas', { class: 'preview-canvas', 'aria-label': 'Preview with your letters' });
  const system = h('div', { class: 'preview-system', lang: 'km' });
  const input = h('input', {
    class: 'preview-input',
    type: 'text',
    value: store.settings.previewText,
    placeholder: 'Type Khmer text…',
    lang: 'km',
    autocomplete: 'off',
    spellcheck: false,
    oninput: () => store.updateSettings({ previewText: input.value }),
  });
  const wrap = h('div', { class: 'preview-canvas-wrap' }, mine);
  const legend = h('div', { class: 'preview-legend' });
  const samples = compact
    ? null
    : h(
        'div',
        { class: 'sample-words' },
        SAMPLE_WORDS.map((w) =>
          h(
            'button',
            {
              class: 'sample-word',
              lang: 'km',
              onclick: () => {
                input.value = w;
                store.updateSettings({ previewText: w });
              },
            },
            w,
          ),
        ),
      );
  const el = h(
    'section',
    { class: `preview ${compact ? 'compact' : ''}` },
    h('div', { class: 'preview-head' }, h('span', { class: 'preview-label' }, 'Preview'), input),
    samples,
    compact
      ? wrap
      : h(
          'div',
          { class: 'preview-compare' },
          h('div', { class: 'compare-col' }, h('div', { class: 'compare-label' }, 'Your letters'), wrap, legend),
          h('div', { class: 'compare-col' }, h('div', { class: 'compare-label' }, 'System font'), system),
        ),
  );

  const draw = () => {
    const width = wrap.clientWidth;
    if (!width) return;
    const emPx = compact ? 56 : 84;
    const lineH = emPx * LINE_EMS;
    const k = emPx / EM;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const fontReady = store.settings.fontReady;
    const text = store.settings.previewText;
    system.textContent = text;
    system.style.fontSize = `${khmerFontSizeUnits() * k}px`;

    const clusters = layoutText(text, glyphMetrics, { defaultRef: currentRefBox() });
    type Item = { w: number; draw: (ctx: CanvasRenderingContext2D, x: number, top: number) => void };
    const items: (Item | 'newline')[] = [];
    let fallbacks = 0;
    let drafts = 0;
    for (const c of clusters) {
      if (c.type === 'newline') items.push('newline');
      else if (c.type === 'space') items.push({ w: c.advance * k, draw: () => {} });
      else if (c.type === 'glyphs') {
        const parts = c.glyphs.map((g) => {
          if (isDraft(g.id)) drafts++;
          return { g, bmp: glyphBitmap(resolveGlyph(g.id)!, Math.round(emPx * dpr), fontReady, brushVersion()) };
        });
        items.push({
          w: c.advance * k,
          draw: (ctx, x, top) => {
            for (const { g, bmp } of parts) drawGlyphAt(ctx, bmp, x + g.x * k, top + g.y * k, emPx);
          },
        });
      } else {
        fallbacks++;
        const t = c.text;
        items.push({
          w: systemTextWidth(t) * k,
          draw: (ctx, x, top) => {
            ctx.save();
            ctx.translate(x, top);
            ctx.scale(k, k);
            ctx.font = khmerFont();
            ctx.fillStyle = '#b4b0c8';
            ctx.fillText(t, 0, GUIDES.baseline);
            ctx.restore();
          },
        });
      }
    }

    // Wrap into lines.
    const placed: { item: Item; x: number; line: number }[] = [];
    let x = 0;
    let line = 0;
    for (const it of items) {
      if (it === 'newline') {
        line++;
        x = 0;
        continue;
      }
      if (x > 0 && x + it.w > width) {
        line++;
        x = 0;
      }
      placed.push({ item: it, x, line });
      x += it.w;
    }

    const cssH = (line + 1) * lineH;
    mine.style.width = `${width}px`;
    mine.style.height = `${cssH}px`;
    mine.width = Math.round(width * dpr);
    mine.height = Math.round(cssH * dpr);
    const ctx = mine.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const p of placed) p.item.draw(ctx, p.x, p.line * lineH);

    const notes: string[] = [];
    if (fallbacks) notes.push('grey = not drawn yet');
    if (drafts) notes.push(`${drafts} auto-drafted subscript${drafts > 1 ? 's' : ''}`);
    legend.textContent = notes.join(' · ');
  };

  system.style.fontFamily = KHMER_FONT_STACK;
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };
  const unsubscribe = store.subscribe(schedule);
  const ro = new ResizeObserver(schedule);
  ro.observe(wrap);
  schedule();

  return {
    el,
    destroy: () => {
      unsubscribe();
      ro.disconnect();
      cancelAnimationFrame(frame);
    },
  };
}
