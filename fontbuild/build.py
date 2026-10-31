"""Builds a Khmer TrueType font from the app's export bundle.

The app sends traced outlines and layout data (see src/export/bundle.ts). This
turns them into a TTF and WOFF2 whose OpenType tables follow the same rules as
the mini layout engine in src/layout/khmer.ts:

* Subscripts:      coeng + consonant ligates in blwf (and pstf, for Uniscribe's
                   "type 3" subscripts); coeng + ro ligates in pref.
* Split vowels:    the shaper puts U+17C1 before the base itself, so each split
                   vowel's own glyph holds only its second part.
* Above and below: zero-width marks positioned with mark-to-base (abvm, blwm)
                   and stacked with mark-to-mark (mkmk).
* Joined pairs:    a consonant and ា ោ ៅ drawn as one shape replace the two
                   glyphs in psts, and only when the user has drawn that pair.
* ាំ:              one vowel, so ំ attaches to ា: by mark-to-mark on a separate
                   ា, and through a second anchor on a joined pair.
* Left and right:  spacing glyphs. Right parts are marked in GDEF so a following
                   above mark attaches to the real base, not to the vowel.

Coordinates in the bundle are y-down in a 1000-unit em; fonts are y-up from the
baseline, so y_font = BASELINE - y.
"""

import os
import re
from io import BytesIO

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

UPM = 1000
BASELINE = 680
DEFAULT_BEARING = 40
STACK_GAP = 20
# Where mark outlines sit relative to the pen when a renderer ignores anchors.
MARK_REST_X = -220
LATIN_X_HEIGHT = 350
COENG = 0x17D2
LATIN_FONT = os.path.join(os.path.dirname(__file__), "latin", "PatrickHand-Regular.woff")
OFL_URL = "https://openfontlicense.org"
# Uniscribe's "type 3" subscripts, which it forms with pstf rather than blwf.
TYPE3_SUBSCRIPTS = {0x1783, 0x1788, 0x178D, 0x1794, 0x1799, 0x179E, 0x179F, 0x17A1}
MAX_GLYPHS = 400
MAX_CURVES = 20000


class BundleError(ValueError):
    """The bundle can't be built; the message is safe to show the user."""


def glyph_name(gid):
    """Font glyph name for an app glyph id: u1780 → uni1780, sub-u1780 → sub.uni1780."""
    pair = re.fullmatch(r"lig-u([0-9a-f]{4,5})-u([0-9a-f]{4,5})", gid)
    if pair:
        return f"uni{pair.group(1).upper()}_uni{pair.group(2).upper()}"
    m = re.fullmatch(r"(sub-)?u([0-9a-f]{4,5})(\.alt)?", gid)
    if not m:
        raise BundleError(f"Unknown glyph id: {gid}")
    name = "uni" + m.group(2).upper()
    if m.group(1):
        name = "sub." + name
    return name + (m.group(3) or "")


def center(box):
    return (box["left"] + box["right"]) / 2


class Placed:
    """A bundle glyph with its font-space shift, advance and glyph name."""

    def __init__(self, data, default_ref):
        self.data = data
        self.id = data["id"]
        self.name = glyph_name(self.id)
        self.kind = data["kind"]
        self.box = data["box"]
        # Joined pairs: marks and subscripts centre on the consonant part.
        self.anchor_box = data.get("anchorBox") or self.box
        self.ref = data.get("ref") or default_ref
        off = data.get("offset") or {}
        self.off_x = off.get("x", 0)
        self.off_y = off.get("y", 0)
        box, ref = self.box, self.ref
        if self.kind == "base":
            self.lsb = data.get("lsb", DEFAULT_BEARING)
            self.rsb = data.get("rsb", DEFAULT_BEARING)
            self.dx = self.lsb - box["left"]
            self.advance = round(box["right"] - box["left"] + self.lsb + self.rsb)
            self.off_x = self.off_y = 0
        elif self.kind == "left":
            self.dx = DEFAULT_BEARING - box["left"]
            self.advance = max(0, round(ref["left"] - box["left"]))
        elif self.kind == "right":
            self.dx = -ref["right"] - DEFAULT_BEARING
            self.advance = max(0, round(box["right"] - ref["right"]))
        else:  # above, below
            self.dx = MARK_REST_X - center(ref)
            self.advance = 0

    def fx(self, x):
        return round(x + self.dx)

    def fy(self, y):
        return round(BASELINE - y)

    def tt_glyph(self):
        pen = TTGlyphPen(None)
        cu = Cu2QuPen(pen, max_err=0.8, reverse_direction=False)
        ox, oy = self.off_x, self.off_y
        for c in self.data["contours"]:
            sx, sy = c["start"]
            cu.moveTo((self.fx(sx + ox), self.fy(sy + oy)))
            for x1, y1, x2, y2, x, y in c["curves"]:
                cu.curveTo(
                    (self.fx(x1 + ox), self.fy(y1 + oy)),
                    (self.fx(x2 + ox), self.fy(y2 + oy)),
                    (self.fx(x + ox), self.fy(y + oy)),
                )
            cu.closePath()
        return pen.glyph()

    # Anchors. A mark's anchor is on its reference base, so attaching it to a
    # real base's anchor reproduces its drawn relationship to the reference.
    def mark_anchor(self):
        y = self.ref["top"] if self.kind == "above" else self.ref["bottom"]
        return self.fx(center(self.ref)), self.fy(y)

    def stack_mark_anchor(self):
        """Point on this mark that meets the mark it stacks on."""
        y = self.box["bottom"] if self.kind == "above" else self.box["top"]
        return self.fx(center(self.ref)), self.fy(y + self.off_y)

    def stack_base_anchor(self):
        """Point on this mark where the next mark stacks."""
        if self.kind == "above":
            y = self.box["top"] + self.off_y - STACK_GAP
        else:
            y = self.box["bottom"] + self.off_y + STACK_GAP
        return self.fx(center(self.ref)), self.fy(y)

    def base_anchor(self, kind, ref):
        box = self.anchor_box
        if kind == "above":
            y = min(box["top"], ref["top"])
        else:
            y = max(box["bottom"], ref["bottom"])
        return self.fx(center(box)), self.fy(y)


def validate(bundle):
    glyphs = bundle.get("glyphs")
    if not isinstance(glyphs, list) or not glyphs:
        raise BundleError("There are no drawn glyphs to build a font from.")
    if len(glyphs) > MAX_GLYPHS:
        raise BundleError("Too many glyphs.")
    if not isinstance(bundle.get("ref"), dict):
        raise BundleError("The export is missing its reference letter.")
    total = 0
    for g in glyphs:
        if g.get("kind") not in ("base", "above", "below", "left", "right"):
            raise BundleError(f"Unknown glyph kind in {g.get('id')}.")
        glyph_name(str(g.get("id")))
        for c in g.get("contours", []):
            total += len(c["curves"])
    if total > MAX_CURVES:
        raise BundleError("These drawings are too detailed to build.")


def safe_family(name):
    name = re.sub(r"[^\w \-]", "", str(name or ""), flags=re.UNICODE).strip()[:40]
    return name or "My Khmer Handwriting"


def postscript_name(family):
    ascii_name = re.sub(r"[^A-Za-z0-9]", "", family)
    return (ascii_name or "KhmerLetterPad")[:29] + "-Regular"


def dotted_circle():
    """U+25CC: shapers put marks with no base on this."""
    pen = TTGlyphPen(None)
    cu = Cu2QuPen(pen, max_err=0.8, reverse_direction=False)
    import math

    cx, cy, ring, r, n = 250, 175, 170, 22, 12
    k = r * 0.5523
    for i in range(n):
        a = 2 * math.pi * i / n
        x, y = cx + ring * math.cos(a), cy + ring * math.sin(a)
        cu.moveTo((x - r, y))
        cu.curveTo((x - r, y + k), (x - k, y + r), (x, y + r))
        cu.curveTo((x + k, y + r), (x + r, y + k), (x + r, y))
        cu.curveTo((x + r, y - k), (x + k, y - r), (x, y - r))
        cu.curveTo((x - k, y - r), (x - r, y - k), (x - r, y))
        cu.closePath()
    return pen.glyph(), 500


def notdef():
    pen = TTGlyphPen(None)
    pen.moveTo((60, 0))
    pen.lineTo((60, 700))
    pen.lineTo((440, 700))
    pen.lineTo((440, 0))
    pen.closePath()
    pen.moveTo((110, 50))
    pen.lineTo((390, 50))
    pen.lineTo((390, 650))
    pen.lineTo((110, 650))
    pen.closePath()
    return pen.glyph(), 500


def empty_glyph():
    return TTGlyphPen(None).glyph()


def latin_glyphs(taken):
    """Basic Latin borrowed from Patrick Hand (SIL OFL), scaled to sit with the Khmer."""
    font = TTFont(LATIN_FONT)
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    scale = LATIN_X_HEIGHT / font["OS/2"].sxHeight
    out = {}
    mapping = {}
    for cp, src in sorted(cmap.items()):
        if cp <= 0x20 or cp in (0xA0, 0xAD) or cp > 0x17F or cp in taken:
            continue
        rec = DecomposingRecordingPen(glyph_set)
        glyph_set[src].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(TransformPen(pen, (scale, 0, 0, scale, 0, 0)))
        name = f"lat.uni{cp:04X}"
        out[name] = (pen.glyph(), round(font["hmtx"][src][0] * scale))
        mapping[cp] = name
    return out, mapping


def build_features(placed, ref, has_alt):
    """Writes the OpenType feature file."""
    by_kind = {k: [p for p in placed if p.kind == k] for k in ("base", "above", "below", "left", "right")}
    drawn = {p.name for p in placed}
    # A subscript needs its consonant in the font: the rule is written in terms of it.
    subs = [p for p in placed if p.id.startswith("sub-") and "uni" + p.id[len("sub-u"):].upper() in drawn]
    fea = ["languagesystem DFLT dflt;", "languagesystem khmr dflt;", "languagesystem khmr KHM;", ""]

    def consonant(p):
        return "uni" + p.id[len("sub-u"):].upper()

    pref = [p for p in subs if p.kind == "left"]
    blwf = [p for p in subs if p.kind == "below"]
    pstf = [p for p in blwf if int(p.id[len("sub-u"):], 16) in TYPE3_SUBSCRIPTS]

    def ligature_feature(tag, items):
        if items:
            fea.append(f"feature {tag} {{")
            fea.extend(f"  sub uni17D2 {consonant(p)} by {p.name};" for p in items)
            fea.append(f"}} {tag};")

    ligature_feature("pref", pref)
    ligature_feature("blwf", blwf)
    ligature_feature("pstf", pstf)

    if has_alt and blwf:
        names = " ".join(p.name for p in blwf)
        fea.append("feature pres {")
        fea.append(f"  sub uni1789' [{names}] by uni1789.alt;")
        fea.append("} pres;")

    # Joined consonant + vowel pairs. Subscripts may sit between the two, so the
    # lookup skips every mark except these vowels. psts runs after the subscripts form.
    pairs = []
    for p in placed:
        m = re.fullmatch(r"lig-u([0-9a-f]+)-u([0-9a-f]+)", p.id)
        if m:
            parts = "uni" + m.group(1).upper(), "uni" + m.group(2).upper()
            if parts[0] in drawn and parts[1] in drawn:
                pairs.append((parts, p.name))
    if pairs:
        vowels = sorted({parts[1] for parts, _ in pairs})
        fea.append("feature psts {")
        fea.append("  lookup joined_vowels {")
        fea.append(f"    lookupflag UseMarkFilteringSet [{' '.join(vowels)}];")
        fea.extend(f"    sub {parts[0]} {parts[1]} by {name};" for parts, name in pairs)
        fea.append("  } joined_vowels;")
        fea.append("} psts;")

    # Positioning.
    bases = by_kind["base"] + by_kind["left"]
    circle = "uni25CC"
    for kind, cls, tag in (("above", "@ABOVE", "abvm"), ("below", "@BELOW", "blwm")):
        marks = by_kind[kind]
        if not marks:
            continue
        fea.extend(f"markClass {p.name} <anchor {p.mark_anchor()[0]} {p.mark_anchor()[1]}> {cls};" for p in marks)
        fea.append(f"feature {tag} {{")
        for b in bases:
            x, y = b.base_anchor(kind, ref)
            fea.append(f"  pos base {b.name} <anchor {x} {y}> mark {cls};")
        y = 400 if kind == "above" else -50
        fea.append(f"  pos base {circle} <anchor 250 {y}> mark {cls};")
        fea.append(f"}} {tag};")

    # ាំ is one vowel: ំ sits on ា rather than on the consonant.
    nikahit = next((p for p in by_kind["above"] if p.id == "u17c6"), None)
    aa = next((p for p in placed if p.id == "u17b6"), None)
    aa_pairs = [p for p in placed if p.id.startswith("lig-") and p.id.endswith("-u17b6")]
    on_aa = []
    if nikahit:
        x, y = nikahit.mark_anchor()
        fea.append(f"markClass {nikahit.name} <anchor {x} {y}> @ON_AA;")
    if nikahit and aa_pairs:
        fea.append("feature abvm {")
        fea.append("  lookup nikahit_on_joined_aa {")
        for p in aa_pairs:
            x = p.fx((p.anchor_box["right"] + p.box["right"]) / 2)
            fea.append(f"    pos base {p.name} <anchor {x} {p.fy(min(p.box['top'], ref['top']))}> mark @ON_AA;")
        fea.append("  } nikahit_on_joined_aa;")
        fea.append("} abvm;")
    if nikahit and aa:
        x = aa.fx(center(aa.box))
        on_aa.append(f"  pos mark {aa.name} <anchor {x} {aa.fy(min(aa.box['top'], ref['top']))}> mark @ON_AA;")

    stacks = []
    for kind, cls in (("above", "@STACK_ABOVE"), ("below", "@STACK_BELOW")):
        marks = by_kind[kind]
        if len(marks) < 2:
            continue
        fea.extend(f"markClass {p.name} <anchor {p.stack_mark_anchor()[0]} {p.stack_mark_anchor()[1]}> {cls};" for p in marks)
        for m in marks:
            x, y = m.stack_base_anchor()
            stacks.append(f"  pos mark {m.name} <anchor {x} {y}> mark {cls};")
    if stacks or on_aa:
        fea.append("feature mkmk {")
        if stacks:
            fea.append("  lookup stack_marks {")
            fea.extend("  " + line for line in stacks)
            fea.append("  } stack_marks;")
        if on_aa:
            fea.append("  lookup nikahit_on_aa {")
            fea.extend("  " + line for line in on_aa)
            fea.append("  } nikahit_on_aa;")
        fea.append("} mkmk;")

    # GDEF: right parts count as marks so above marks skip over them to the base.
    base_names = [p.name for p in bases] + [circle]
    mark_names = [p.name for p in by_kind["above"] + by_kind["below"] + by_kind["right"]] + ["uni17D2"]
    fea.append("table GDEF {")
    fea.append(f"  GlyphClassDef [{' '.join(base_names)}], , [{' '.join(mark_names)}], ;")
    fea.append("} GDEF;")
    return "\n".join(fea) + "\n"


def build_font(bundle):
    """Returns {'ttf': bytes, 'woff2': bytes, 'report': {...}}."""
    validate(bundle)
    ref = bundle["ref"]
    include_latin = bool(bundle.get("includeLatin", True))
    family = safe_family(bundle.get("name"))
    designer = str(bundle.get("designer") or "")[:80]
    licence = bundle.get("licence") or "ofl"
    if include_latin:
        licence = "ofl"  # Patrick Hand's licence requires this for derived fonts.
    year = str(bundle.get("year") or "")[:4]

    placed = [Placed(g, ref) for g in bundle["glyphs"] if g.get("contours")]
    names = {p.name for p in placed}
    has_alt = "uni1789.alt" in names

    glyphs = {}
    advances = {}

    def add(name, glyph, advance):
        glyphs[name] = glyph
        advances[name] = advance

    g, adv = notdef()
    add(".notdef", g, adv)
    add("space", empty_glyph(), 280)
    for name in ("uni200B", "uni200C", "uni200D", "uni17D2"):
        add(name, empty_glyph(), 0)
    g, adv = dotted_circle()
    add("uni25CC", g, adv)

    cmap = {0x20: "space", 0xA0: "space", 0x200B: "uni200B", 0x200C: "uni200C", 0x200D: "uni200D", COENG: "uni17D2", 0x25CC: "uni25CC"}
    for p in placed:
        add(p.name, p.tt_glyph(), p.advance)
        m = re.fullmatch(r"u([0-9a-f]+)", p.id)
        if m:
            cmap[int(m.group(1), 16)] = p.name

    if include_latin:
        latin, latin_map = latin_glyphs(set(cmap))
        for name, (g, adv) in latin.items():
            add(name, g, adv)
        cmap.update(latin_map)

    fb = FontBuilder(UPM, isTTF=True)
    order = list(glyphs)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    glyf = fb.font["glyf"]
    metrics = {n: (advances[n], getattr(glyf[n], "xMin", 0) or 0) for n in order}
    fb.setupHorizontalMetrics(metrics)

    # Vertical metrics: room for the tallest glyph plus a stacked mark, so nothing clips.
    y_max = max((getattr(glyf[n], "yMax", 0) or 0) for n in order)
    y_min = min((getattr(glyf[n], "yMin", 0) or 0) for n in order)
    tallest_above = max((p.box["bottom"] - p.box["top"] for p in placed if p.kind == "above"), default=0)
    tallest_below = max((p.box["bottom"] - p.box["top"] for p in placed if p.kind == "below"), default=0)
    ascent = max(900, round(y_max + tallest_above * 0.6))
    descent = max(300, round(-y_min + tallest_below + STACK_GAP))

    fb.setupHorizontalHeader(ascent=ascent, descent=-descent, lineGap=0)
    copyright_text = f"Copyright {year} {designer}".strip() if designer else f"Copyright {year}".strip()
    if include_latin:
        copyright_text += ". Latin glyphs from Patrick Hand, Copyright (c) 2010-2012 Patrick Wagesreiter."
    names_table = {
        "copyright": copyright_text,
        "familyName": family,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{family} Regular {year}".strip(),
        "fullName": f"{family} Regular",
        "psName": postscript_name(family),
        "version": "Version 1.000",
    }
    if designer:
        names_table["designer"] = designer
    if licence == "ofl":
        names_table["licenseDescription"] = "This Font Software is licensed under the SIL Open Font License, Version 1.1."
        names_table["licenseInfoURL"] = OFL_URL
    else:
        names_table["licenseDescription"] = f"All rights reserved by {designer or 'the designer'}."
    fb.setupNameTable(names_table)

    fb.setupOS2(
        version=4,
        sTypoAscender=ascent,
        sTypoDescender=-descent,
        sTypoLineGap=0,
        usWinAscent=ascent,
        usWinDescent=descent,
        sxHeight=BASELINE - 330,
        sCapHeight=500,
        fsType=0,
        fsSelection=0x40 | 0x80,  # Regular, use typo metrics
        achVendID="KLPD",
    )
    fb.setupPost(keepGlyphNames=True)
    fb.addOpenTypeFeatures(build_features(placed, ref, has_alt))

    ttf = BytesIO()
    fb.font.save(ttf)
    ttf_bytes = ttf.getvalue()

    font = TTFont(BytesIO(ttf_bytes))
    font.flavor = "woff2"
    woff2 = BytesIO()
    font.save(woff2)

    return {
        "ttf": ttf_bytes,
        "woff2": woff2.getvalue(),
        "report": {
            "family": family,
            "fileBase": re.sub(r"[^A-Za-z0-9]+", "", family) or "KhmerFont",
            "glyphCount": len(order),
            "drawnGlyphs": len(placed),
            "licence": licence,
            "ascent": ascent,
            "descent": descent,
        },
    }
