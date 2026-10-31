type Child = Node | string | null | undefined | false;

/** Tiny DOM helper: h('button', { class: 'x', onclick }, 'Label'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, any> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c);
  }
  return el;
}

let toastTimer: number | undefined;

export function toast(message: string, ms = 2200): void {
  let el = document.querySelector<HTMLDivElement>('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), ms);
}

/** Opens a native <dialog> and resolves when it closes. */
export function showDialog(dialog: HTMLDialogElement): Promise<string> {
  document.body.append(dialog);
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        resolve(dialog.returnValue);
        dialog.remove();
      },
      { once: true },
    );
  });
}

export function confirmDialog(message: string, okLabel = 'OK', danger = false): Promise<boolean> {
  const dialog = h(
    'dialog',
    { class: 'dialog small' },
    h(
      'form',
      { method: 'dialog' },
      h('p', {}, message),
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { value: 'cancel', class: 'btn' }, 'Cancel'),
        h('button', { value: 'ok', class: danger ? 'btn danger' : 'btn primary' }, okLabel),
      ),
    ),
  );
  return showDialog(dialog).then((v) => v === 'ok');
}

/** Saves a file: the share sheet on iPad and iPhone ("Save to Files"), a download elsewhere. */
export async function saveFile(file: File, doneMessage?: string): Promise<void> {
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  if (doneMessage) toast(doneMessage);
}
