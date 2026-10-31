"""Shapes real Khmer words with HarfBuzz against a font built from a test bundle.

Run with: .venv/bin/python tests/font/test_font.py
"""
import os
import sys
from io import BytesIO

import uharfbuzz as hb

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from fontTools.ttLib import TTFont
from fontbuild.build import build_font, BundleError, glyph_name

REF = {"left": 300, "right": 700, "top": 330, "bottom": 680}


def rect(box):
    l, r, t, b = box["left"], box["right"], box["top"], box["bottom"]
    def line(x0, y0, x1, y1):
        return [x0 + (x1 - x0) / 3, y0 + (y1 - y0) / 3, x0 + 2 * (x1 - x0) / 3, y0 + 2 * (y1 - y0) / 3, x1, y1]
    return [{"start": [l, t], "curves": [line(l, t, r, t), line(r, t, r, b), line(r, b, l, b), line(l, b, l, t)]}]


def glyph(gid, kind, box, **extra):
    return {"id": gid, "kind": kind, "box": box, "ref": REF, "contours": rect(box), **extra}


def base(gid, **over):
    return glyph(gid, "base", {**REF, **over})


SUB = {"left": 380, "right": 620, "top": 700, "bottom": 880}
ABOVE = {"left": 420, "right": 600, "top": 200, "bottom": 310}
BELOW = {"left": 450, "right": 560, "top": 700, "bottom": 780}
E = {"left": 160, "right": 270, "top": 300, "bottom": 690}
RO = {"left": 200, "right": 560, "top": 700, "bottom": 860}
AA = {"left": 720, "right": 820, "top": 330, "bottom": 680}
AM = {"left": 470, "right": 540, "top": 230, "bottom": 300}

GLYPHS = [
    base("u1780"), base("u1781"), base("u1784"), base("u179f"), base("u1798"), base("u179a"), base("u1787"), base("u1794"),
    base("u1789", bottom=760),
    glyph("sub-u1798", "below", SUB), glyph("sub-u1789", "below", SUB), glyph("sub-u1787", "below", SUB),
    glyph("sub-u1794", "below", SUB), glyph("sub-u179a", "left", RO),
    glyph("u17c1", "left", E), glyph("u17b8", "above", ABOVE), glyph("u17b7", "above", ABOVE),
    glyph("u17bb", "below", BELOW), glyph("u17c6", "above", AM), glyph("u17b6", "right", AA),
    glyph("u17c4", "right", AA), glyph("u17be", "above", ABOVE), glyph("u17c7", "right", AA),
    glyph("u17cb", "above", AM),
]
BUNDLE = {"name": "Test Hand", "designer": "Tester", "year": 2026, "ref": REF, "includeLatin": True, "glyphs": GLYPHS}


def shape(font, text, order):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, {})
    pen_x = 0
    out = []
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        out.append({"name": order[info.codepoint], "x": pen_x + pos.x_offset, "y": pos.y_offset, "adv": pos.x_advance})
        pen_x += pos.x_advance
    return out


def box_of(g, ttf):
    gl = ttf["glyf"][ttf.getGlyphName(ttf.getGlyphID(g["name"]))]
    return dict(left=g["x"] + gl.xMin, right=g["x"] + gl.xMax, top=g["y"] + gl.yMax, bottom=g["y"] + gl.yMin)


def main():
    result = build_font(BUNDLE)
    ttf_bytes = result["ttf"]
    ttf = TTFont(BytesIO(ttf_bytes))
    ttf_named = ttf
    blob = hb.Blob(ttf_bytes)
    font = hb.Font(hb.Face(blob))
    order = ttf.getGlyphOrder()

    print("built:", result["report"], len(ttf_bytes), "bytes ttf", len(result["woff2"]), "bytes woff2")

    def names(text):
        return [g["name"] for g in shape(font, text, order)]

    def boxes(text):
        return {g["name"]: box_of(g, ttf_named) for g in shape(font, text, order)}

    # ក្មេង: េ moved before ក, ្ម under it.
    assert names("ក្មេង") == ["uni17C1", "uni1780", "sub.uni1798", "uni1784"], names("ក្មេង")
    b = boxes("ក្មេង")
    assert b["uni17C1"]["right"] <= b["uni1780"]["left"], b
    assert b["sub.uni1798"]["top"] <= b["uni1780"]["bottom"], b
    assert abs((b["sub.uni1798"]["left"] + b["sub.uni1798"]["right"]) / 2 - (b["uni1780"]["left"] + b["uni1780"]["right"]) / 2) <= 1, b
    assert b["uni1784"]["left"] > b["uni1780"]["right"], b

    # ស្រី: ្រ before the base, ី above it.
    assert names("ស្រី") == ["sub.uni179A", "uni179F", "uni17B8"], names("ស្រី")
    b = boxes("ស្រី")
    assert b["uni17B8"]["bottom"] >= b["uni179F"]["top"], b
    assert b["sub.uni179A"]["left"] < b["uni179F"]["left"], b

    # ខ្ញុំ: ្ញ under ខ, ុ under ្ញ, ំ above.
    assert names("ខ្ញុំ") == ["uni1781", "sub.uni1789", "uni17BB", "uni17C6"], names("ខ្ញុំ")
    b = boxes("ខ្ញុំ")
    assert b["uni17BB"]["top"] <= b["sub.uni1789"]["bottom"] - 19, b
    assert b["uni17C6"]["bottom"] >= b["uni1781"]["top"], b

    # Split vowels.
    assert names("កោ") == ["uni17C1", "uni1780", "uni17C4"], names("កោ")
    b = boxes("កោ")
    assert b["uni17C1"]["right"] <= b["uni1780"]["left"] and b["uni17C4"]["left"] >= b["uni1780"]["right"], b
    assert names("កើ") == ["uni17C1", "uni1780", "uni17BE"], names("កើ")

    # េ goes before ្រ.
    assert names("ក្រេ") == ["uni17C1", "sub.uni179A", "uni1780"], names("ក្រេ")

    # A type 3 subscript still forms.
    assert names("ក្ប") == ["uni1780", "sub.uni1794"], names("ក្ប")

    # ាំ is one vowel: ំ sits on top of ា, not on the consonant.
    b = boxes("កាំ")
    assert names("កាំ") == ["uni1780", "uni17B6", "uni17C6"], names("កាំ")
    aa_center = (b["uni17B6"]["left"] + b["uni17B6"]["right"]) / 2
    assert abs((b["uni17C6"]["left"] + b["uni17C6"]["right"]) / 2 - (aa_center + 5)) <= 1, b
    assert b["uni17C6"]["bottom"] >= b["uni17B6"]["top"], b
    # Without ា, ំ stays over the consonant.
    b = boxes("កំ")
    assert abs((b["uni17C6"]["left"] + b["uni17C6"]["right"]) / 2 - ((b["uni1780"]["left"] + b["uni1780"]["right"]) / 2 + 5)) <= 1, b

    # Two above marks stack.
    b = boxes("កិ់")
    assert b["uni17CB"]["bottom"] >= b["uni17B7"]["top"] + 19, b

    # ញ lowers its subscript under the tail.
    b = boxes("ញ្ជ")
    assert b["sub.uni1787"]["top"] <= b["uni1789"]["bottom"], b

    # Valid text has no dotted circles; a mark with no base does.
    for word in ("ក្មេង", "ស្រី", "ខ្ញុំ", "កោះ", "ស្រក"):
        assert "uni25CC" not in names(word), word
    assert "uni25CC" in names("ិ"), names("ិ")

    # Joined consonant + vowel pairs.
    PAIR = {"left": 300, "right": 820, "top": 330, "bottom": 680}
    pairs = [
        {**glyph(gid, "base", PAIR), "anchorBox": REF, "ref": None}
        for gid in ("lig-u1780-u17b6", "lig-u1780-u17c4", "lig-u1781-u17b6")
    ]
    r4 = build_font({**BUNDLE, "glyphs": GLYPHS + pairs})
    t4 = TTFont(BytesIO(r4["ttf"]))
    order4 = t4.getGlyphOrder()
    f4 = hb.Font(hb.Face(hb.Blob(r4["ttf"])))
    n4 = lambda text: [g["name"] for g in shape(f4, text, order4)]
    assert n4("កា") == ["uni1780_uni17B6"], n4("កា")
    assert n4("កោ") == ["uni17C1", "uni1780_uni17C4"], n4("កោ")
    assert n4("ឯកា") != [] and "uni1780_uni17B6" in n4("កាំ"), n4("កាំ")
    # Not drawn: falls back to the two separate glyphs.
    assert n4("ងា") == ["uni1784", "uni17B6"], n4("ងា")
    # A subscript between them: the pair still forms and the subscript centres on the consonant.
    got = shape(f4, "ក្មា", order4)
    assert [g["name"] for g in got] == ["uni1780_uni17B6", "sub.uni1798"], got
    box4 = box_of(got[0], t4), box_of(got[1], t4)
    consonant_center = box4[0]["left"] + 200
    assert abs((box4[1]["left"] + box4[1]["right"]) / 2 - consonant_center) <= 1, box4
    # ំ on a joined pair sits on the ា part (this ំ is drawn 5 units right of centre).
    got = shape(f4, "កាំ", order4)
    box5 = box_of(got[0], t4), box_of(got[1], t4)
    aa_part = (box5[0]["left"] + 400 + box5[0]["right"]) / 2
    assert abs((box5[1]["left"] + box5[1]["right"]) / 2 - (aa_part + 5)) <= 1, box5
    # Other above marks on a pair still centre on the consonant part.
    got = shape(f4, "កិ", order4)
    assert got[0]["name"] == "uni1780", got
    for word in ("កា", "កោ", "ក្មា", "ខា"):
        assert "uni25CC" not in n4(word), word

    # Latin and mixed text.
    assert names("Ab") == ["lat.uni0041", "lat.uni0062"], names("Ab")
    assert ".notdef" not in names("Hello ក")

    # With the ញ alternate: it replaces ញ before a subscript only.
    alt = {**BUNDLE, "glyphs": GLYPHS + [base("u1789.alt")]}
    r2 = build_font(alt)
    order2 = TTFont(BytesIO(r2["ttf"])).getGlyphOrder()
    f2 = hb.Font(hb.Face(hb.Blob(r2["ttf"])))
    assert [g["name"] for g in shape(f2, "ញ្ជ", order2)] == ["uni1789.alt", "sub.uni1787"]
    assert [g["name"] for g in shape(f2, "ញ", order2)] == ["uni1789"]

    # Khmer-only font has no Latin.
    r3 = build_font({**BUNDLE, "includeLatin": False, "licence": "reserved"})
    t3 = TTFont(BytesIO(r3["ttf"]))
    assert 0x41 not in t3.getBestCmap() and r3["report"]["licence"] == "reserved"

    try:
        build_font({"glyphs": []})
        raise SystemExit("empty bundle should fail")
    except BundleError:
        pass

    assert ttf["OS/2"].fsType == 0
    print("all font tests passed")


if __name__ == "__main__":
    main()
