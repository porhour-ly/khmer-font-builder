import { CATEGORIES, type Category, type GlyphDef } from '../glyphs';
import { burst } from '../confetti';
import { store } from '../store';
import { h, saveFile, toast } from '../ui';
import { KHMER_FONT_STACK } from '../khmerFont';
import { buildFont, makeBundle, readiness, type BuiltFont, type GlyphIssue } from './bundle';

const TEST_WORDS = ['ក្មេង', 'ស្រី', 'ខ្ញុំ', 'សួស្ដី', 'កម្ពុជា', 'ភាសាខ្មែរ', 'ស្ត្រី', 'កោះ', 'អរគុណ', '១២៣'];

let fontCounter = 0;

function listLabels(defs: GlyphDef[], max = 24): string {
  const shown = defs.slice(0, max).map((d) => d.label).join(' ');
  return defs.length > max ? `${shown} … and ${defs.length - max} more` : shown;
}

/** The Export screen: name the font, build it, try it, download it. */
export function mountExport(root: HTMLElement): () => void {
  let alive = true;
  let loadedFace: FontFace | null = null;
  const s = store.settings;

  const nameInput = h('input', {
    type: 'text',
    value: s.exportName,
    placeholder: 'e.g. My Khmer Hand',
    maxLength: 40,
    oninput: () => store.updateSettings({ exportName: nameInput.value }),
  });
  const designerInput = h('input', {
    type: 'text',
    value: s.exportDesigner,
    placeholder: 'Your name',
    maxLength: 80,
    oninput: () => store.updateSettings({ exportDesigner: designerInput.value }),
  });
  const latinInput = h('input', {
    type: 'checkbox',
    checked: s.exportLatin,
    onchange: () => {
      store.updateSettings({ exportLatin: latinInput.checked });
      updateLicence();
    },
  });
  const licenceSelect = h(
    'select',
    { onchange: () => store.updateSettings({ exportLicence: licenceSelect.value as 'ofl' | 'reserved' }) },
    h('option', { value: 'ofl' }, 'SIL Open Font License (free to share)'),
    h('option', { value: 'reserved' }, 'All rights reserved'),
  );
  licenceSelect.value = s.exportLicence;
  const licenceNote = h('p', { class: 'hint' });
  const updateLicence = () => {
    const latin = latinInput.checked;
    licenceSelect.disabled = latin;
    if (latin) licenceSelect.value = 'ofl';
    else licenceSelect.value = store.settings.exportLicence;
    licenceNote.textContent = latin
      ? 'The Latin letters come from Patrick Hand, whose licence requires fonts made with it to use the SIL Open Font License too. Turn off Latin to choose another licence.'
      : 'Your own drawings, so the choice is yours.';
  };

  // ---------- readiness ----------
  const status = readiness();
  const total = status.ready.length + status.drafts.length + status.missing.length;
  const missingByCategory = CATEGORIES.map((c) => ({
    title: c.title,
    id: c.id as Category,
    defs: status.missing.filter((d) => d.category === c.id),
  })).filter((c) => c.defs.length);

  const readyPanel = h(
    'section',
    { class: 'panel' },
    h('h2', {}, 'What goes in the font'),
    h(
      'p',
      {},
      h('b', {}, `${status.ready.length} of ${total}`),
      ' glyphs drawn',
      status.drafts.length ? `, plus ${status.drafts.length} auto-drafted subscripts` : '',
      '.',
    ),
    status.drafts.length
      ? h('p', { class: 'warn' }, `✨ Auto-drafts will be used for: `, h('span', { lang: 'km' }, listLabels(status.drafts)))
      : null,
    status.blocked.length
      ? h(
          'p',
          { class: 'warn' },
          '⚠️ These need their separate consonant or vowel drawn before they’ll work: ',
          h('span', { lang: 'km' }, listLabels(status.blocked)),
        )
      : null,
    missingByCategory.length
      ? h(
          'div',
          { class: 'warn' },
          h('p', {}, '⚠️ Not drawn yet. Text using these will show another font’s letters:'),
          h(
            'ul',
            {},
            missingByCategory.map((c) => h('li', {}, h('b', {}, `${c.title}: `), h('span', { lang: 'km' }, listLabels(c.defs)))),
          ),
        )
      : h('p', { class: 'good' }, '✓ Every glyph is ready.'),
  );

  // ---------- build ----------
  const progress = h('div', { class: 'progress', hidden: true }, h('div', { class: 'progress-fill' }));
  const progressFill = progress.firstElementChild as HTMLElement;
  const buildStatus = h('p', { class: 'hint', role: 'status' });
  const buildBtn = h('button', { class: 'btn primary build-btn', onclick: () => build() }, 'Build my font');
  const result = h('div', { class: 'export-result' });

  const build = async () => {
    const name = nameInput.value.trim();
    if (!name) {
      toast('Give your font a name first');
      nameInput.focus();
      return;
    }
    buildBtn.disabled = true;
    progress.hidden = false;
    progressFill.style.width = '0';
    buildStatus.textContent = 'Tracing your drawings…';
    result.replaceChildren();
    try {
      const { bundle, issues } = await makeBundle(
        {
          name,
          designer: designerInput.value.trim(),
          licence: latinInput.checked ? 'ofl' : licenceSelect.value,
          includeLatin: latinInput.checked,
        },
        (done, n) => (progressFill.style.width = `${(done / n) * 85}%`),
      );
      if (!alive) return;
      if (!bundle.glyphs.length) throw new Error('Draw some letters first.');
      buildStatus.textContent = 'Building the font…';
      const font = await buildFont(bundle);
      if (!alive) return;
      progressFill.style.width = '100%';
      buildStatus.textContent = '';
      await showResult(font, issues);
      const r = buildBtn.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height / 2, 70);
      buildBtn.textContent = 'Build again';
    } catch (e) {
      buildStatus.textContent = (e as Error).message;
    } finally {
      buildBtn.disabled = false;
      progress.hidden = true;
    }
  };

  // ---------- result: tester and downloads ----------
  const showResult = async (font: BuiltFont, issues: GlyphIssue[]) => {
    if (loadedFace) document.fonts.delete(loadedFace);
    const family = `KLPExport${++fontCounter}`;
    const copy = font.woff2.slice().buffer;
    loadedFace = new FontFace(family, copy);
    await loadedFace.load();
    document.fonts.add(loadedFace);
    const stack = `"${family}", ${KHMER_FONT_STACK}`;

    const tester = h('textarea', {
      class: 'type-tester',
      rows: 2,
      value: 'ខ្ញុំស្រឡាញ់ភាសាខ្មែរ Hello!',
      lang: 'km',
      style: { fontFamily: stack },
      spellcheck: false,
    });
    const sizeInput = h('input', {
      type: 'range',
      min: 24,
      max: 120,
      value: 56,
      oninput: () => (tester.style.fontSize = `${sizeInput.value}px`),
    });
    tester.style.fontSize = '56px';

    const words = h(
      'div',
      { class: 'word-suite' },
      TEST_WORDS.map((w) =>
        h(
          'div',
          { class: 'word-row' },
          h('span', { class: 'word-mine', lang: 'km', style: { fontFamily: stack } }, w),
          h('span', { class: 'word-system', lang: 'km', style: { fontFamily: KHMER_FONT_STACK } }, w),
        ),
      ),
    );

    const base = font.report.fileBase;
    const download = (bytes: Uint8Array, ext: string, type: string) =>
      saveFile(new File([bytes.slice().buffer], `${base}-Regular.${ext}`, { type }), `Saved ${base}-Regular.${ext}`);

    const shareCard = async () => {
      const c = h('canvas');
      c.width = 1200;
      c.height = 630;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, 1200, 630);
      g.addColorStop(0, '#ff70a6');
      g.addColorStop(0.6, '#7b6cd9');
      g.addColorStop(1, '#43aa8b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1200, 630);
      ctx.fillStyle = '#fffdf8';
      ctx.beginPath();
      ctx.roundRect(50, 50, 1100, 530, 36);
      ctx.fill();
      ctx.fillStyle = '#23203a';
      ctx.textAlign = 'center';
      ctx.font = `150px ${stack}`;
      ctx.fillText('ខ្ញុំស្រឡាញ់ខ្មែរ', 600, 310);
      ctx.font = '600 44px -apple-system, system-ui, sans-serif';
      ctx.fillText(font.report.family, 600, 460);
      ctx.font = '28px -apple-system, system-ui, sans-serif';
      ctx.fillStyle = '#6f6a8a';
      ctx.fillText('Handwritten with Khmer Letter Pad', 600, 510);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
      if (blob) saveFile(new File([blob], `${base}-card.png`, { type: 'image/png' }), 'Card saved');
    };

    result.replaceChildren(
      ...[
      issues.length
        ? h(
            'section',
            { class: 'panel warn' },
            h('h2', {}, 'Worth a second look'),
            h(
              'ul',
              {},
              issues.map((i) =>
                h('li', {}, h('a', { href: `#/draw/${i.def.id}`, lang: 'km' }, i.def.label), ` (${i.def.name}) ${i.problem}`),
              ),
            ),
          )
        : null,
      h(
        'section',
        { class: 'panel' },
        h('h2', {}, `Try ${font.report.family}`),
        h('p', { class: 'hint' }, `${font.report.drawnGlyphs} of your glyphs, ${font.report.glyphCount} glyphs in all. Type anything:`),
        tester,
        h('label', { class: 'size-row' }, h('span', {}, 'Size'), sizeInput),
        h('h3', {}, 'Test words'),
        h('p', { class: 'hint' }, 'Your font on the left, the system font on the right. A ◌ means something went wrong.'),
        words,
      ),
      h(
        'section',
        { class: 'panel' },
        h('h2', {}, 'Download'),
        h(
          'div',
          { class: 'download-row' },
          h('button', { class: 'btn primary', onclick: () => download(font.ttf, 'ttf', 'font/ttf') }, '⬇ TTF (to install)'),
          h('button', { class: 'btn', onclick: () => download(font.woff2, 'woff2', 'font/woff2') }, '⬇ WOFF2 (for websites)'),
          h('button', { class: 'btn', onclick: shareCard }, '🖼 Share card'),
        ),
        h(
          'p',
          { class: 'hint' },
          'On a Mac or Windows PC, open the TTF and choose Install. iPad and iPhone don’t install fonts easily, so send the file to a computer, or use the tester above.',
        ),
      ),
      ].filter((el): el is HTMLElement => !!el),
    );
  };

  updateLicence();
  root.replaceChildren(
    h(
      'div',
      { class: 'grid-view' },
      h(
        'header',
        { class: 'topbar' },
        h('a', { class: 'btn ghost', href: '#/' }, '‹ Letters'),
        h('h1', {}, 'Export font'),
        h('span', { style: { width: '80px' } }),
      ),
      h(
        'main',
        { class: 'grid-main export-main' },
        readyPanel,
        h(
          'section',
          { class: 'panel' },
          h('h2', {}, 'Your font'),
          h('label', { class: 'field' }, h('span', {}, 'Font name'), nameInput),
          h('label', { class: 'field' }, h('span', {}, 'Designer'), designerInput),
          h('label', { class: 'check-field' }, latinInput, h('span', {}, 'Include Latin letters (A–Z, 0–9, punctuation)')),
          h('label', { class: 'field' }, h('span', {}, 'Licence'), licenceSelect),
          licenceNote,
          buildBtn,
          progress,
          buildStatus,
        ),
        result,
      ),
    ),
  );

  return () => {
    alive = false;
    if (loadedFace) document.fonts.delete(loadedFace);
  };
}
