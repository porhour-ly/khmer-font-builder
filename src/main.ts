import './style.css';
import { store } from './store';
import { initStampImages, registerCustomBrush } from './brushes';
import { calibrateKhmerFont } from './khmerFont';
import { mountGrid } from './grid';
import { mountPad } from './pad';
import { mountExport } from './export/exportScreen';
import { GLYPH_BY_ID } from './glyphs';

const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;

function route(): void {
  // Close any dialog left open on the previous screen.
  for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) d.close();
  unmount?.();
  const m = location.hash.match(/^#\/draw\/([\w.-]+)/);
  if (location.hash.startsWith('#/export')) unmount = mountExport(root);
  else unmount = m && GLYPH_BY_ID.has(m[1]) ? mountPad(root, m[1]) : mountGrid(root);
}

async function start(): Promise<void> {
  initStampImages();
  await store.load();
  await Promise.all([...store.brushes.values()].map(registerCustomBrush));
  await calibrateKhmerFont();
  window.addEventListener('hashchange', route);
  route();
}

// iOS Safari: block pinch-zoom gestures on the page.
document.addEventListener('gesturestart', (e) => e.preventDefault());

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

start().catch((e) => {
  console.error(e);
  root.textContent = 'Something went wrong while starting. Try reloading the page.';
});
