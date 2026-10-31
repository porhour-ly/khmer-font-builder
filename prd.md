# PRD: Khmer Letter Pad

**Owner:** Porhour · **Status:** Draft · **Type:** Side project (vibe-coded, for fun)

## 1. Overview
A web app, used mainly on iPad and iPhone, where you draw the Khmer alphabet by hand with fun brushes (watercolor, acrylic, emoji stamps, custom brushes) and end up with a real, installable Khmer font made from your own handwriting.

## 2. Problem and opportunity
- Handwriting-to-font tools (Calligraphr, TypedHand, FontCraft and others) map one drawn shape to one character. Khmer can't work that way: consonants take subscript forms via coeng (U+17D2), vowels are placed around the base letter, and some vowels are typed after a consonant but displayed before it.
- A font that ignores this renders Khmer text incorrectly. Making a correct Khmer font by hand is hard because it needs OpenType shaping rules.
- I found no handwriting-to-font tool aimed at Khmer. This was a web search, not an exhaustive market study, so it is a hypothesis.
- Khmer fonts are well supplied by free fonts (Noto Sans Khmer, KhmerOS), so there is little evidence anyone would pay. That's fine: this is a fun project, not a business.

## 3. Goals
1. Drawing Khmer letters on a tablet is genuinely fun (brushes, celebrations, progress).
2. The Khmer-specific part works: subscripts and vowels compose correctly from the user's own drawings.
3. Export a real font that installs and renders valid Khmer text correctly.

## 4. Non-goals
- Selling fonts, accounts, social features, or a marketplace.
- Professional-grade type design (kerning pairs, multiple weights, hinting).
- Supporting other scripts.
- Old Khmer or Pali-only letters beyond the common set in stage 2.

## 5. User
Me first. Possibly later: friends, designers, or anyone who wants a personal Khmer handwriting font.

## 6. Product principles
- Fun first: a playable result in the first minutes.
- Strokes are data: every drawing is stored as vector strokes, so later stages never need redrawing.
- Brushes are cosmetic; the font uses the stroke path.
- Work offline, with no backend until stage 3 needs one.

## 7. Scope by stage

### Stage 1: Draw and play
**FR-1.1** Mobile-first web app (iPad/iPhone Safari, Apple Pencil, finger, mouse). Pointer Events, pressure, no scroll or zoom while drawing, retina-sharp canvas. Installable PWA.
**FR-1.2** Letter grid of the 33 consonants (ក ខ គ ឃ ង ច ឆ ជ ឈ ញ ដ ឋ ឌ ឍ ណ ត ថ ទ ធ ន ប ផ ព ភ ម យ រ ល វ ស ហ ឡ អ) with thumbnails and progress ("12/33").
**FR-1.3** Drawing pad: ghost reference letter (toggle), guide lines (baseline, x-height, ascender, descender), undo/redo/clear, previous/next letter, save with a small celebration, a bigger one at 33/33.
**FR-1.4** Paint brushes: pen, marker, calligraphy, pencil, watercolor, acrylic, oil, spray, chalk, crayon, neon, rainbow.
**FR-1.5** Stamp brushes: heart, cat, butterfly, star, flower, sparkle (emoji rendered to stamp images), with spacing, size jitter, rotation mode, scatter and opacity settings.
**FR-1.6** Custom brushes: create a stamp brush from an emoji, an uploaded PNG/SVG with transparency, or a tiny hand-drawn stamp. Live preview, adjustable settings, named, saved, editable, deletable, included in export.
**FR-1.7** Live preview strip: typed text rendered with the user's letters, falling back to a system Khmer font.
**FR-1.8** Storage: strokes (points, pressure, time), brush id, size, colour, random seed (deterministic redraw). IndexedDB persistence, JSON export/import. A "font-ready" view per letter renders the path as solid black with a round pen.

### Stage 2: Complete the alphabet and compose
**FR-2.1** New glyph categories with progress tracking: subscript consonants (32, one for every consonant except ឡ; most are auto-drafted per FR-2.3, while visually distinct ones such as ្រ, ្ញ and ្ត must be drawn by hand), dependent vowels (ា ិ ី ឹ ឺ ុ ូ ួ ើ ឿ ៀ េ ែ ៃ ោ ៅ), signs (ំ ះ ៉ ៊ ់ ៌ ៍ ័ and ។ ៗ), independent vowels (ឥ ឦ ឧ ឩ ឪ ឫ ឬ ឭ ឮ ឯ ឰ ឱ ឲ ឳ), digits (០–៩). Use Unicode U+1780–17FF as reference for anything missing.
**FR-2.2** Pad behavior: subscripts drawn in a "subscript zone" below a ghost base letter; vowels and signs drawn in position relative to a ghost base letter; toggle for a system-font reference rendering.
**FR-2.3** Auto-draft subscripts from drawn consonants (about 65–75% scale, below the baseline), clearly marked as drafts until the user redraws them.
**FR-2.4** Mini Khmer layout engine (standalone, documented module): parses syllables (base, up to two coeng+consonant subscripts, vowels, signs), places glyphs, handles prebase vowels (េ ែ ៃ) and the split vowels ើ ឿ ៀ ោ ៅ (each has a េ-like left part drawn before the base and a second part above or after it), the coeng-ro case, and ញ with a subscript. Outputs a list of glyph ids with x/y offsets.
**FR-2.5** Preview shows "your letters" and "system font" side by side. Built-in sample words include ក្មេង, ស្រី and ខ្ញុំ.
**FR-2.6** Adjustment tools: drag marks and subscripts to nudge (saved as per-glyph offsets); per-glyph left and right side bearing guides.
**FR-2.7** Migration of stage 1 data without loss. NOTES.md listing the layout rules implemented and the cases not yet handled.

### Stage 3: Export a real font
**FR-3.1 Glyph outlines.** Convert each glyph's font-ready strokes into clean closed outlines (union of strokes, overlap removed, smoothed Bézier curves). MVP approach: rasterize the font-ready view at high resolution and trace it (potrace-style). Upgrade path: stroke the vector path directly.
**FR-3.2 Font build.** Generate TTF (and OTF/WOFF2 if cheap) with Python fontTools and feaLib. Include basic Latin (A–Z, a–z, 0–9, common punctuation) borrowed from an open-licensed (SIL OFL) font and scaled to match, so mixed Khmer/English text works. Also include `.notdef`, space, ZWSP/ZWJ/ZWNJ, dotted circle U+25CC (shapers insert it for invalid sequences), and digits. Set sensible vertical metrics so stacked subscripts and tall marks don't clip.
**FR-3.3 Khmer shaping tables.** Generate the OpenType lookups from the data collected in stage 2. The expected set is:
- Pre-processing: ccmp (glyph composition and decomposition) and locl (language-specific forms).
- Substitution: cfar (forms after the coeng-ro), pref (coeng-ro prebase form), blwf (below-base subscript forms), abvf and pstf as needed, pres, abvs, blws, psts and clig for contextual alternates (for example ញ when followed by a subscript, and taller descender versions of subscripts under other subscripts).
- Positioning: mark-to-base anchors for above and below vowels and signs (abvm, blwm), plus dist, using the offsets saved in stage 2.
Verify the exact feature list and ordering against Microsoft's "Developing OpenType Fonts for Khmer Script" spec. Vowel reordering is done by the shaping engine (HarfBuzz, Uniscribe), not by the font.
**FR-3.4 Verification in the app.** In-browser type tester using the exported font as a web font, plus a test-word suite. Warn about missing glyphs, tiny or broken shapes, and glyphs with open contours.
**FR-3.5 Delivery.** Download TTF/WOFF2, name the font, a small share card. Default licence text offered (for example SIL OFL), with the user choosing.
**FR-3.6 Build runtime.** One-button build: tapping "Download font" sends a bundle (glyph outlines plus layout data) to a Python serverless function on Vercel, which runs the fontTools build and returns the TTF/WOFF2. No technical steps for the user. Drawing stays fully offline; only the download needs an internet connection. The same build code also runs as a local script for development and testing.

## 8. Success criteria
- Stage 1: all 33 consonants drawn on an iPad in under 30 minutes, appearing in the preview.
- Stage 2: ក្មេង, ស្រី and ខ្ញុំ render correctly in the mini layout engine, compared against the system font.
- Stage 3: the exported font installs on macOS or Windows and renders the same three words correctly in Chrome and in one native app, with no dotted circles for valid text.

## 9. Risks and open questions
- **Shaping complexity:** the highest risk. Mitigation: stage 2 builds and tests the rules in JS first.
- **Installing fonts on iOS/iPadOS** is awkward. The web-font tester may be the main way to see the font on a tablet; real installs may happen on a computer.
- **Handwriting quality:** pressure-based strokes may produce rough outlines. Tune smoothing, and offer a cleanup step.
- **Safari storage** can be evicted, so use JSON export as backup and encourage adding the app to the home screen.
- **Emoji stamps** use the platform's emoji renderer. They're cosmetic and never enter the font.
- **Latin and punctuation:** decided. The font includes basic Latin borrowed from an open-licensed font (see FR-3.2). Drawing your own Latin letters is an idea for later.
- **Build location:** decided. The font builds online in a Vercel serverless function (see FR-3.6). Check early that fontTools fits within Vercel's function size and time limits on the free tier.

## 10. Roadmap
1. Stage 1: Draw and play
2. Stage 2: Complete and compose
3. Stage 3: Export a real font
4. Ideas for later: alternate versions of letters, gallery and sharing, kerning, more weights from one drawing set
