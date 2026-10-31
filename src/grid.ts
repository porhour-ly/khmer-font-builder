import { store } from './store';
import { CATEGORIES, glyphsIn, requiredIn, REQUIRED_TOTAL, type Category, type GlyphDef } from './glyphs';
import { draftGlyph, drawReference, frameOffset } from './reference';
import { glyphIdFor } from './layout/khmer';
import { EM } from './metrics';
import { fitCanvas, renderStrokes } from './render';
import { brushVersion, bumpBrushVersion } from './brushVersion';
import { createPreview } from './preview';
import { parseBackup } from './backup';
import { registerCustomBrush } from './brushes';
import { celebrateSave } from './confetti';
import { confirmDialog, h, saveFile, toast } from './ui';

function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
}

async function exportBackup(): Promise<void> {
  const json = JSON.stringify(store.exportData());
  const date = new Date().toISOString().slice(0, 10);
  const name = `khmer-letter-pad-backup-${date}.json`;
  const file = new File([json], name, { type: 'application/json' });
  await saveFile(file, 'Backup saved');
}

async function importBackup(file: File): Promise<void> {
  try {
    const data = parseBackup(await file.text());
    const current = [...store.glyphs.values()].filter((g) => g.strokes.length).length;
    const incoming = data.glyphs.filter((g) => g.strokes.length).length;
    const ok = await confirmDialog(
      current
        ? `Replace your ${current} drawn letters with the ${incoming} letters in this backup?`
        : `Restore ${incoming} letters from this backup?`,
      'Restore',
      current > 0,
    );
    if (!ok) return;
    await store.importData(data);
    await Promise.all(data.customBrushes.map(registerCustomBrush));
    bumpBrushVersion();
    toast('Backup restored ✨');
  } catch (e) {
    toast((e as Error).message, 4000);
  }
}

export function mountGrid(root: HTMLElement): () => void {
  const count = h('span', { class: 'progress-count' });
  const totalCount = h('span', { class: 'total-count' });
  const bar = h('div', { class: 'progress-fill' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const tabCounts = new Map<Category, HTMLElement>();
  const grid = h('div', { class: 'letter-grid' });
  const sectionTitle = h('h2');
  const hint = h('p', { class: 'section-hint' });
  const banner = h('div', { class: 'complete-banner', hidden: true });
  let tiles = new Map<string, { def: GlyphDef; canvas: HTMLCanvasElement; tile: HTMLAnchorElement; key: string }>();

  const HINTS: Record<Category, string> = {
    consonant: 'Draw each letter sitting on the baseline.',
    subscript: 'Draw just the subscript, in the clear area. The pink hint shows its shape, and your own consonant appears above it once you’ve drawn it. Only ណ, ល and ហ get an auto-draft, because their subscripts are small copies.',
    vowel: 'Draw each vowel in place around ក. For ើ ឿ ៀ ោ ៅ, draw only the new part: the left part reuses your េ.',
    pair: 'Optional. Draw the consonant and vowel as one joined shape, such as កា or សា. Any you skip use the separate consonant and vowel. For pairs like កោ and កៅ, leave out the left part: it’s added for you from your េ.',
    sign: 'Draw each sign in place around ក. ។ and ៗ stand on their own.',
    independent: 'Independent vowels stand on their own, like consonants.',
    digit: 'Khmer digits stand on their own.',
  };

  let tab = (CATEGORIES.find((c) => c.id === store.settings.gridTab)?.id ?? 'consonant') as Category;

  for (const c of CATEGORIES) {
    const n = h('span', { class: 'tab-count' });
    tabCounts.set(c.id, n);
    tabs.append(
      h(
        'button',
        {
          role: 'tab',
          'data-tab': c.id,
          onclick: () => {
            tab = c.id;
            store.updateSettings({ gridTab: c.id });
            buildTiles();
          },
        },
        c.tab,
        n,
      ),
    );
  }

  const buildTiles = () => {
    const cat = CATEGORIES.find((c) => c.id === tab)!;
    sectionTitle.textContent = cat.title;
    hint.textContent = HINTS[tab];
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    tiles = new Map();
    grid.replaceChildren();
    for (const d of glyphsIn(tab)) {
      const canvas = h('canvas', { class: 'thumb' });
      const tile = h(
        'a',
        { class: `tile ${d.optional ? 'optional' : ''}`, href: `#/draw/${d.id}`, 'aria-label': `Draw ${d.label} (${d.name})` },
        canvas,
        h('span', { class: 'tile-name', lang: 'km' }, d.optional && !d.pairVowel ? 'optional' : d.name),
        h('span', { class: 'tile-check' }, '✓'),
        h('span', { class: 'tile-draft' }, 'draft'),
      );
      tiles.set(d.id, { def: d, canvas, tile, key: '' });
      grid.append(tile);
    }
    schedule();
  };

  const saveAllBtn = h('button', { class: 'btn small primary', hidden: true, onclick: () => saveAll() });
  const saveAll = () => {
    const before = store.savedCount(tab);
    const n = store.saveAll();
    if (!n) return;
    const after = store.savedCount(tab);
    if (requiredIn(tab).length && celebrateSave(saveAllBtn, before, after, requiredIn(tab).length)) {
      toast(store.savedCount() === REQUIRED_TOTAL ? '🎉 Every glyph is drawn! Your alphabet is complete!' : `🎉 All ${after} ${sectionTitle.textContent?.toLowerCase()} drawn!`, 4000);
    } else {
      toast(`Saved ${n} glyph${n === 1 ? '' : 's'}  ·  ${store.savedCount()}/${REQUIRED_TOTAL} in total`);
    }
  };

  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: () => {
      const f = fileInput.files?.[0];
      if (f) importBackup(f);
      fileInput.value = '';
    },
  });

  const installHint =
    !isStandalone() && !store.settings.installHintDismissed
      ? h(
          'div',
          { class: 'install-hint' },
          h(
            'span',
            {},
            '📲 Tip: tap Share → “Add to Home Screen” so the app works offline and Safari keeps your drawings. Save a backup now and then too.',
          ),
          h(
            'button',
            {
              class: 'btn small ghost',
              onclick: (e: Event) => {
                store.updateSettings({ installHintDismissed: true });
                (e.currentTarget as HTMLElement).parentElement?.remove();
              },
            },
            'Got it',
          ),
        )
      : null;

  const preview = createPreview(false);

  root.replaceChildren(
    h(
      'div',
      { class: 'grid-view' },
      h(
        'header',
        { class: 'topbar' },
        h('h1', {}, h('span', { class: 'logo', lang: 'km' }, 'ក'), 'Khmer Letter Pad'),
        h(
          'div',
          { class: 'header-actions' },
          totalCount,
          h('a', { class: 'btn small primary', href: '#/export' }, '⬇ Export font'),
          h('button', { class: 'btn small ghost', onclick: exportBackup }, '⤓ Backup'),
          h('button', { class: 'btn small ghost', onclick: () => fileInput.click() }, '⤒ Restore'),
          fileInput,
        ),
      ),
      installHint,
      h(
        'main',
        { class: 'grid-main' },
        h(
          'section',
          {},
          tabs,
          h('div', { class: 'section-head' }, sectionTitle, h('div', { class: 'section-actions' }, saveAllBtn, count)),
          h('div', { class: 'progress' }, bar),
          hint,
          banner,
          grid,
        ),
        preview.el,
      ),
    ),
  );

  /** Optional tabs track everything in them; the rest track required glyphs. */
  const tabProgress = (c: Category) => {
    const required = requiredIn(c);
    const defs = required.length ? required : glyphsIn(c);
    return { done: defs.filter((d) => store.isDone(d.id)).length, total: defs.length, optional: !required.length };
  };

  const render = () => {
    const { done, total: required, optional } = tabProgress(tab);
    count.textContent = `${done}/${required}`;
    bar.style.width = `${(done / required) * 100}%`;
    totalCount.textContent = `${store.savedCount()}/${REQUIRED_TOTAL}`;
    totalCount.title = 'Glyphs saved in total';
    banner.hidden = optional || done < required;
    banner.textContent = `🎉 All ${required} ${sectionTitle.textContent?.toLowerCase()} drawn!`;
    for (const c of CATEGORIES) {
      const { done: n, total: t } = tabProgress(c.id);
      const el = tabCounts.get(c.id)!;
      el.textContent = n === t ? '✓' : `${n}/${t}`;
      el.classList.toggle('complete', n === t);
    }
    const unsaved = store.unsavedDrawn().length;
    saveAllBtn.hidden = unsaved === 0;
    saveAllBtn.textContent = `✓ Save all (${unsaved})`;

    const fontReady = store.settings.fontReady;
    for (const t of tiles.values()) {
      const g = store.glyph(t.def.id);
      const draft = !g.strokes.length ? draftGlyph(t.def) : undefined;
      const w = Math.round(t.tile.clientWidth - 16);
      if (w <= 0) continue;
      t.tile.classList.toggle('done', store.isDone(t.def.id));
      t.tile.classList.toggle('draft', g.strokes.length > 0 && !g.saved);
      t.tile.classList.toggle('auto-draft', !!draft);
      const key = `${g.updatedAt}|${draft?.updatedAt ?? 0}|${w}|${fontReady}|${brushVersion()}|${store.glyph(glyphIdFor(t.def.base)).updatedAt}|${store.glyph('u1780').updatedAt}`;
      if (key === t.key) continue;
      t.key = key;
      const dpr = fitCanvas(t.canvas, w, w);
      const ctx = t.canvas.getContext('2d')!;
      const scale = (w * dpr) / EM;
      // Empty base glyphs show the ghost letter; dependent ones always show their reference base.
      drawReference(ctx, t.def, scale, !g.strokes.length && !draft);
      if (g.strokes.length) {
        const off = frameOffset(t.def, g);
        renderStrokes(ctx, g.strokes, { scale, dx: off.x * scale, dy: off.y * scale }, fontReady);
      } else if (draft) {
        ctx.globalAlpha = 0.5;
        renderStrokes(ctx, draft.strokes, { scale, dx: 0, dy: 0 }, fontReady);
        ctx.globalAlpha = 1;
      }
    }
  };

  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(render);
  };
  const unsubscribe = store.subscribe(schedule);
  const ro = new ResizeObserver(schedule);
  ro.observe(grid);
  buildTiles();

  return () => {
    unsubscribe();
    ro.disconnect();
    preview.destroy();
  };
}
