import {
  DEFAULT_STAMP_PARAMS,
  getBrush,
  imageToSquareCanvas,
  isStampBrush,
  loadImage,
  registerCustomBrush,
  unregisterCustomBrush,
} from './brushes';
import { bumpBrushVersion } from './brushVersion';
import { fitCanvas, renderStrokes } from './render';
import { store } from './store';
import { confirmDialog, h, showDialog, toast } from './ui';
import type { BrushSource, CustomBrush, Point, RotationMode, StampParams, Stroke } from './types';

// ---------- sample stroke ----------

function samplePoints(heightUnits: number): Point[] {
  const pts: Point[] = [];
  for (let x = 110; x <= 890; x += 5) {
    const t = (x - 110) / 780;
    pts.push([x, heightUnits / 2 + heightUnits * 0.22 * Math.sin(t * Math.PI * 2.4), 0.35 + 0.45 * Math.sin(t * Math.PI), t * 600]);
  }
  return pts;
}

/** Draws a wavy sample stroke with a brush, used for brush chips and previews. */
export function renderBrushSample(
  canvas: HTMLCanvasElement,
  brushId: string,
  cssW: number,
  cssH: number,
  color: string,
  params: StampParams,
  size?: number,
): void {
  const dpr = fitCanvas(canvas, cssW, cssH);
  const scale = (cssW * dpr) / 1000;
  const brush = getBrush(brushId);
  const stamp = isStampBrush(brushId);
  const sampleSize = size != null ? size * 2.2 : stamp ? 190 : Math.min(Math.max(brush.defaultSize * 2.4, 60), 170);
  const stroke: Stroke = {
    points: samplePoints((1000 * cssH) / cssW),
    brushId,
    size: sampleSize,
    color,
    seed: 7,
    params: stamp ? params : undefined,
  };
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  renderStrokes(ctx, [stroke], { scale, dx: 0, dy: 0 });
}

// ---------- shared stamp settings controls ----------

function slider(label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void, format = (v: number) => String(v)) {
  const out = h('output', {}, format(value));
  const input = h('input', {
    type: 'range',
    min,
    max,
    step,
    value,
    oninput: () => {
      out.textContent = format(Number(input.value));
      onInput(Number(input.value));
    },
  });
  return h('label', { class: 'field slider-field' }, h('span', {}, label), input, out);
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function paramControls(params: StampParams, size: number, onChange: (p: StampParams, size: number) => void): HTMLElement {
  let p = { ...params };
  let s = size;
  const emit = () => onChange(p, s);
  const rotation = h(
    'select',
    {
      onchange: () => {
        p = { ...p, rotation: rotation.value as RotationMode };
        emit();
      },
    },
    h('option', { value: 'random' }, 'Random'),
    h('option', { value: 'follow' }, 'Follow the stroke'),
    h('option', { value: 'none' }, 'Upright'),
  );
  rotation.value = p.rotation;
  return h(
    'div',
    { class: 'param-controls' },
    slider('Size', 10, 220, 1, s, (v) => ((s = v), emit())),
    slider('Spacing', 0.2, 3, 0.05, p.spacing, (v) => ((p = { ...p, spacing: v }), emit()), pct),
    slider('Size jitter', 0, 1, 0.05, p.sizeJitter, (v) => ((p = { ...p, sizeJitter: v }), emit()), pct),
    slider('Scatter', 0, 1.5, 0.05, p.scatter, (v) => ((p = { ...p, scatter: v }), emit()), pct),
    slider('Opacity', 0.1, 1, 0.05, p.opacity, (v) => ((p = { ...p, opacity: v }), emit()), pct),
    h('label', { class: 'field' }, h('span', {}, 'Rotation'), rotation),
  );
}

// ---------- built-in stamp settings ----------

export async function openStampSettings(brushId: string): Promise<void> {
  const brush = getBrush(brushId);
  const preview = h('canvas', { class: 'editor-preview' });
  let params = store.settings.stampParams[brushId] ?? DEFAULT_STAMP_PARAMS;
  let size = store.settings.sizes[brushId] ?? brush.defaultSize;
  const draw = () => renderBrushSample(preview, brushId, 300, 120, store.settings.color, params, size);

  const controlsHost = h('div');
  const mountControls = () =>
    controlsHost.replaceChildren(
      paramControls(params, size, (p, s) => {
        params = p;
        size = s;
        store.updateSettings({
          stampParams: { ...store.settings.stampParams, [brushId]: p },
          sizes: { ...store.settings.sizes, [brushId]: s },
        });
        draw();
      }),
    );
  mountControls();

  const dialog = h(
    'dialog',
    { class: 'dialog' },
    h(
      'form',
      { method: 'dialog' },
      h('h2', {}, `${brush.name} stamp`),
      preview,
      controlsHost,
      h(
        'div',
        { class: 'dialog-actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn',
            onclick: () => {
              params = { ...DEFAULT_STAMP_PARAMS };
              size = brush.defaultSize;
              store.updateSettings({
                stampParams: { ...store.settings.stampParams, [brushId]: params },
                sizes: { ...store.settings.sizes, [brushId]: size },
              });
              mountControls();
              draw();
            },
          },
          'Reset',
        ),
        h('button', { value: 'done', class: 'btn primary' }, 'Done'),
      ),
    ),
  );
  requestAnimationFrame(draw);
  await showDialog(dialog);
}

// ---------- custom brush editor ----------

const EMOJI_IDEAS = ['🌈', '🍀', '🐟', '🌙', '🔥', '🍓', '💎', '🐝', '🌵', '🎈', '🍩', '🐼'];
const PREVIEW_ID = '__preview__';

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * Create or edit a custom stamp brush.
 * Resolves to the saved brush, 'deleted', or null if cancelled.
 */
export async function openCustomBrushEditor(existing?: CustomBrush): Promise<CustomBrush | 'deleted' | null> {
  let source: BrushSource = existing?.source ?? { type: 'emoji', emoji: '🌈' };
  let params: StampParams = existing?.params ?? { ...DEFAULT_STAMP_PARAMS };
  let size = existing?.defaultSize ?? 70;
  let result: CustomBrush | 'deleted' | null = null;
  let drawnUrl = source.type === 'drawn' ? source.dataUrl : '';
  let imageUrl = source.type === 'image' ? source.dataUrl : '';
  let emoji = source.type === 'emoji' ? source.emoji : '🌈';

  const preview = h('canvas', { class: 'editor-preview' });
  const nameInput = h('input', { type: 'text', value: existing?.name ?? '', placeholder: 'e.g. Rainbow trail', maxLength: 24 });

  let previewToken = 0;
  const refreshPreview = async () => {
    const token = ++previewToken;
    const tmp: CustomBrush = { id: PREVIEW_ID, name: 'preview', source, params, defaultSize: size, createdAt: 0, updatedAt: 0 };
    await registerCustomBrush(tmp);
    if (token === previewToken) renderBrushSample(preview, PREVIEW_ID, 300, 120, '#000', params, size);
  };

  // Emoji panel
  const emojiInput = h('input', {
    type: 'text',
    value: emoji,
    class: 'emoji-input',
    'aria-label': 'Emoji',
    oninput: () => {
      emoji = [...emojiInput.value.trim()].slice(0, 8).join('');
      if (emoji) setSource({ type: 'emoji', emoji });
    },
  });
  const emojiPanel = h(
    'div',
    { class: 'source-panel' },
    h('label', { class: 'field' }, h('span', {}, 'Type or pick an emoji'), emojiInput),
    h(
      'div',
      { class: 'emoji-ideas' },
      EMOJI_IDEAS.map((e) =>
        h('button', { type: 'button', class: 'emoji-idea', onclick: () => ((emojiInput.value = e), (emoji = e), setSource({ type: 'emoji', emoji: e })) }, e),
      ),
    ),
  );

  // Image panel
  const imageThumb = h('img', { class: 'image-thumb', alt: '' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/svg+xml,image/webp,image/gif',
    onchange: async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      try {
        const img = await loadImage(await readFileAsDataUrl(file));
        imageUrl = imageToSquareCanvas(img, 256).toDataURL('image/png');
        imageThumb.src = imageUrl;
        setSource({ type: 'image', dataUrl: imageUrl });
      } catch {
        toast("Couldn't read that image. Try a PNG or SVG.");
      }
    },
  });
  if (imageUrl) imageThumb.src = imageUrl;
  const imagePanel = h(
    'div',
    { class: 'source-panel' },
    h('p', { class: 'hint' }, 'A PNG or SVG with a transparent background works best.'),
    h('label', { class: 'btn file-btn' }, 'Choose image…', fileInput),
    imageThumb,
  );

  // Draw panel
  const mini = h('canvas', { class: 'mini-pad' });
  const MINI = 200;
  const drawPanel = h(
    'div',
    { class: 'source-panel' },
    h('p', { class: 'hint' }, 'Draw a tiny stamp. It uses your current colour.'),
    mini,
    h(
      'button',
      {
        type: 'button',
        class: 'btn small',
        onclick: () => {
          mini.getContext('2d')!.clearRect(0, 0, mini.width, mini.height);
          drawnUrl = '';
        },
      },
      'Clear',
    ),
  );
  const setupMini = () => {
    const dpr = fitCanvas(mini, MINI, MINI);
    const ctx = mini.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (drawnUrl) loadImage(drawnUrl).then((img) => ctx.drawImage(img, 0, 0, MINI, MINI));
    let last: [number, number] | null = null;
    const pos = (e: PointerEvent): [number, number] => {
      const r = mini.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    mini.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      mini.setPointerCapture(e.pointerId);
      last = pos(e);
      ctx.fillStyle = store.settings.color;
      ctx.beginPath();
      ctx.arc(last[0], last[1], 5, 0, Math.PI * 2);
      ctx.fill();
    });
    mini.addEventListener('pointermove', (e) => {
      if (!last) return;
      const p = pos(e);
      ctx.strokeStyle = store.settings.color;
      ctx.lineWidth = e.pointerType === 'pen' && e.pressure > 0 ? 4 + e.pressure * 10 : 10;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      last = p;
    });
    const up = () => {
      if (!last) return;
      last = null;
      drawnUrl = mini.toDataURL('image/png');
      setSource({ type: 'drawn', dataUrl: drawnUrl });
    };
    mini.addEventListener('pointerup', up);
    mini.addEventListener('pointercancel', up);
    mini.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
    mini.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  };

  const panels = { emoji: emojiPanel, image: imagePanel, drawn: drawPanel };
  const tabs = h('div', { class: 'segmented', role: 'tablist' });
  const showTab = (type: BrushSource['type']) => {
    for (const [k, panel] of Object.entries(panels)) panel.hidden = k !== type;
    for (const b of tabs.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.type === type));
    if (type === 'emoji' && emoji) setSource({ type: 'emoji', emoji });
    if (type === 'image' && imageUrl) setSource({ type: 'image', dataUrl: imageUrl });
    if (type === 'drawn' && drawnUrl) setSource({ type: 'drawn', dataUrl: drawnUrl });
    currentTab = type;
  };
  let currentTab: BrushSource['type'] = source.type;
  for (const [type, label] of [['emoji', 'Emoji'], ['image', 'Image'], ['drawn', 'Draw']] as const) {
    tabs.append(h('button', { type: 'button', role: 'tab', 'data-type': type, onclick: () => showTab(type) }, label));
  }

  const setSource = (s: BrushSource) => {
    source = s;
    refreshPreview();
  };

  const controls = paramControls(params, size, (p, s) => {
    params = p;
    size = s;
    refreshPreview();
  });

  const save = async () => {
    const name = nameInput.value.trim() || 'My brush';
    const valid =
      (currentTab === 'emoji' && emoji) || (currentTab === 'image' && imageUrl) || (currentTab === 'drawn' && drawnUrl);
    if (!valid) {
      toast(currentTab === 'image' ? 'Choose an image first' : currentTab === 'drawn' ? 'Draw your stamp first' : 'Pick an emoji first');
      return;
    }
    const finalSource: BrushSource =
      currentTab === 'emoji'
        ? { type: 'emoji', emoji }
        : currentTab === 'image'
          ? { type: 'image', dataUrl: imageUrl }
          : { type: 'drawn', dataUrl: drawnUrl };
    const now = Date.now();
    const brush: CustomBrush = {
      id: existing?.id ?? `custom-${now.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
      name,
      source: finalSource,
      params,
      defaultSize: size,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await registerCustomBrush(brush);
    await store.saveBrush(brush);
    store.updateSettings({ sizes: { ...store.settings.sizes, [brush.id]: size } });
    bumpBrushVersion();
    result = brush;
    dialog.close('saved');
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirmDialog(
      `Delete “${existing.name}”? Letters drawn with it will show as plain pen strokes.`,
      'Delete',
      true,
    );
    if (!ok) return;
    unregisterCustomBrush(existing.id);
    await store.deleteBrush(existing.id);
    bumpBrushVersion();
    result = 'deleted';
    dialog.close('deleted');
  };

  const dialog = h(
    'dialog',
    { class: 'dialog wide' },
    h(
      'form',
      { method: 'dialog', onsubmit: (e: SubmitEvent) => e.submitter?.getAttribute('value') === 'save' && (e.preventDefault(), save()) },
      h('h2', {}, existing ? 'Edit brush' : 'New brush'),
      h(
        'div',
        { class: 'editor-grid' },
        h(
          'div',
          {},
          h('label', { class: 'field' }, h('span', {}, 'Name'), nameInput),
          tabs,
          emojiPanel,
          imagePanel,
          drawPanel,
        ),
        h('div', {}, h('div', { class: 'preview-label' }, 'Preview'), preview, controls),
      ),
      h(
        'div',
        { class: 'dialog-actions' },
        existing ? h('button', { type: 'button', class: 'btn danger', onclick: remove }, 'Delete') : null,
        h('span', { class: 'spacer' }),
        h('button', { value: 'cancel', class: 'btn' }, 'Cancel'),
        h('button', { value: 'save', class: 'btn primary' }, 'Save brush'),
      ),
    ),
  );

  showTab(source.type);
  const closed = showDialog(dialog);
  setupMini();
  refreshPreview();
  await closed;
  unregisterCustomBrush(PREVIEW_ID);
  return result;
}
