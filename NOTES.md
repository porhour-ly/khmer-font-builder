# Layout notes

How the mini Khmer layout engine ([src/layout/khmer.ts](src/layout/khmer.ts)) places your glyphs, and what it doesn't handle yet. [fontbuild/build.py](fontbuild/build.py) turns the same rules into OpenType tables for the exported font.

## The model

- Every glyph is drawn in a 1000-unit em (y grows downward). Guides: ascender 140, x-height 330, baseline 680, descender 900.
- **Base glyphs** (consonants, independent vowels, digits, ។ ៗ) stand alone. Each has a left and right side bearing (default 40), set in Spacing mode on the pad.
- **Dependent glyphs** (vowels, signs, subscripts) are drawn in position around a reference ក. The glyph remembers the ink box of the ក it was drawn against (`ref`). That's your own ក if you've drawn it, otherwise the system font's.
- At layout time a dependent glyph keeps the same relationship to the real base as it had to the reference ក:

  | Kind | Glyphs | Follows the base's |
  | --- | --- | --- |
  | above | ិ ី ឹ ឺ ើ ំ ៉ ៊ ់ ៌ ៍ ័ | centre |
  | below | ុ ូ ួ, all subscripts except ្រ | centre |
  | left | េ ែ ៃ, ្រ (coeng-ro) | left edge |
  | right | ា ះ, right parts of ោ ៅ ៀ ឿ | right edge |

  In OpenType terms, above and below glyphs become mark-to-base anchors (`abvm`, `blwm`), while left and right glyphs become spacing glyphs reordered by the shaper.
- A manual nudge (Move mode) is added after placement.

## Rules implemented

1. **Syllable parsing:** a base, then up to two coeng + consonant subscripts, then vowels and signs in typed order. ZWJ and ZWNJ are ignored.
2. **Prebase vowels** េ ែ ៃ go before the base. The cluster widens to the left to make room.
3. **Split vowels** ើ ឿ ៀ ោ ៅ are drawn as េ before the base plus the vowel's own glyph after it or above it. The left part always reuses your េ, as HarfBuzz decomposes these vowels the same way. Their pads show your េ in place, so you only draw the second part.
4. **Coeng-ro (្រ)** is a left part attached to the base's left edge. A prebase vowel chains further left of it (ក្រេ shows េ, then ្រ, then ក).
5. **Below stacking:** a second subscript, or a below vowel after a subscript, is pushed down under the previous one (ខ្ញុំ puts ុ under ្ញ).
6. **Above stacking:** several above marks are pushed up so they don't overlap.
7. **Taller or deeper bases:** if a base reaches higher than the reference ក, above marks move up by the difference. If it reaches lower (ញ's tail), below marks move down.
8. **ញ with a subscript:** if you draw the optional "ញ before a subscript" glyph (`u1789.alt`), it replaces ញ whenever a subscript follows. Otherwise the subscript is lowered under ញ's tail (rule 7).
9. **Fallback:** a syllable that needs any glyph you haven't drawn is shown whole in the system font, in grey. A mark without a base gets a dotted circle (◌), as shapers do.
10. **Auto-drafted subscripts:** a subscript you haven't drawn is a 65% copy of its consonant, placed under the baseline and marked "draft". ្ត is drafted from ដ, which it resembles. ្រ has no draft.

## How the rules become a font (Stage 3)

Checked against Microsoft's "Developing OpenType Fonts for Khmer Script", then by shaping real words in HarfBuzz (`npm run test:font`) and Apple's CoreText.

- **Outlines:** the font view is rasterized at 1 pixel per unit, traced with marching squares and fitted with cubic curves in the browser ([src/export/trace.ts](src/export/trace.ts)), then converted to TrueType curves on the server. Overlaps disappear in the raster.
- **Scripts:** `DFLT` and `khmr`, with `dflt` and `KHM ` language systems.
- **`pref`:** coeng + ro becomes ្រ. The shaper moves it before the base.
- **`blwf`:** coeng + consonant becomes the subscript. The eight "type 3" subscripts (ឃ ឈ ឍ ប យ ឞ ស ឡ) are also in `pstf`, because Uniscribe forms those with `pstf`.
- **`pres`:** swaps in the ញ alternate before a subscript, when drawn.
- **`abvm`, `blwm`:** mark-to-base anchors for above and below glyphs, including on the dotted circle.
- **`mkmk`:** stacks marks. Unlike the engine, it always stacks rather than only when marks collide.
- **`dist`:** not used. Stage 2 nudges are built into the outlines.
- **GDEF:** above, below and right glyphs are marks, so ំ after ា attaches to the consonant. Right parts keep their advance.
- **Split vowels:** the shaper inserts U+17C1 itself, so ោ's glyph holds only its right part.
- **Metrics:** ascender and descender are computed from the tallest glyphs plus room for one stacked mark, so nothing clips. Line gap is 0.
- **Differences from the preview:** spacing of left and right parts assumes the default side bearing of 40, so a heavily adjusted base can sit a little differently next to them.
- **Subscripts need their consonant:** the substitution rule names the consonant, so a subscript is left out until the consonant is drawn. The Export screen warns about this.
- **Latin:** Patrick Hand (SIL OFL), scaled so its x-height is 350. Including it means the exported font must also be under the OFL.

## Not handled yet

- **Register shifters below:** ៉ and ៊ are always placed above. The spec moves them below the base, in a ុ-like form, when an above vowel follows (e.g. ស៊ី), unless a ZWNJ is between them.
- **Type 3 subscripts with an arm:** the spec's eight "type 3" subscripts have a right-hand arm that adds width. Here they're treated like other below marks, so they take no extra space.
- **Subscripts of independent vowels** (coeng + ឧ etc.) aren't drawable.
- **Taller subscripts under subscripts:** fonts often use a longer-descender form of a subscript when it sits under another. We only shift it down.
- **Contextual forms:** ligatures such as ា joining certain consonants, and alternate vowel shapes next to particular letters, aren't implemented.
- **Robat (៌) and other rare signs** are placed like any above mark. ៎ ៏ ៑ ៝ ៈ are recognised but have no pads (not in the PRD list).
- **Coeng-ro with a below vowel:** ក្រុ may overlap, because ្រ's tail and ុ aren't stacked against each other.
- **Kerning** between syllables: spacing comes only from side bearings.
- **Line breaking** wraps between syllables anywhere, without Khmer word boundaries.
- **Independent vowels with subscripts** (rare) use the same rules as consonants, untested.
