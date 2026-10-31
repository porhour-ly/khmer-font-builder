# Khmer Letter Pad

Draw the Khmer alphabet with fun brushes and turn it into your own font. See [prd.md](prd.md) for the plan.

**Status:** All three stages are built: draw and play, complete the alphabet and compose, and export a real font. See [NOTES.md](NOTES.md) for the Khmer layout rules.

## Run it

```bash
npm install
npm run dev
```

Then open the address it prints. To try it on an iPad or iPhone on the same Wi-Fi, use the "Network" address.

Building fonts needs the Python builder too. Set it up once:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

Then run it next to the app:

```bash
npm run dev:api
```

Other commands:

- `npm test`: runs the unit tests
- `npm run test:font`: builds a test font and shapes Khmer words with HarfBuzz
- `npm run build`: makes the production version in `dist/`, which works offline and can be added to the home screen

## How it's organised

| File | What it does |
| --- | --- |
| `src/letters.ts` | The 33 consonants |
| `src/metrics.ts` | The 1000 × 1000 design space and guide lines |
| `src/brushes.ts` | All brushes (12 paint, 6 stamps, custom stamps) |
| `src/render.ts` | Draws saved strokes: identical every time, thanks to a per-stroke random seed |
| `src/pad.ts` | The drawing screen |
| `src/grid.ts` | The letter grid, progress, backup and restore |
| `src/preview.ts` | The live preview strip |
| `src/brushEditor.ts` | Stamp settings and the custom brush editor |
| `src/store.ts`, `src/db.ts` | Saving to the browser (IndexedDB) |
| `src/backup.ts` | JSON backup format, with a schema version for later upgrades |
| `src/sw.js` | Offline support (service worker template) |
| `src/layout/khmer.ts` | The mini Khmer layout engine |
| `src/export/` | Tracing drawings into outlines, the Export screen |
| `fontbuild/build.py` | Builds the TTF and WOFF2 with fontTools |
| `api/build.py` | The online build endpoint (a Vercel serverless function) |

Strokes are stored as data (points, pressure, time, brush, size, colour, seed), so later stages never need anything redrawn. The "Font view" toggle shows what the font will be made from: each stroke's path drawn as a solid black round pen.
