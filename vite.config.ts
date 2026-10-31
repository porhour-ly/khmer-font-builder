import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Emits sw.js with the list of built files baked in, so the app works
// offline right after the first visit.
function serviceWorker(): Plugin {
  return {
    name: 'klp-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const publicFiles = ['manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];
      const precache = ['./', ...[...files, ...publicFiles].map((f) => `./${f}`)];
      const version = createHash('sha1').update(precache.join('|')).digest('hex').slice(0, 10);
      const template = readFileSync('src/sw.js', 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('__PRECACHE__', JSON.stringify(precache))
          .replace('__VERSION__', version),
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
  server: {
    // During development the font build runs locally: npm run dev:api
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  test: {
    environment: 'node',
  },
} as any);
