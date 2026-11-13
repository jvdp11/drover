#!/usr/bin/env python3
"""Generate the pasture pixel-art sprites (stdlib only, deterministic).

Run from anywhere:  python3 make_sprites.py
Writes one SVG per sprite plus preview.html next to this script.
Each sprite is an ASCII pixel map; '.' is transparent, every other
character is looked up in PALETTE (or a per-family override).
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))

PALETTE = {
    # sheep face/legs, eyes
    "F": "#3b2f35", "L": "#2b2228", "E": "#f4efe6", "X": "#1d171b", "P": "#d98a8a",
    # drover
    "H": "#a9743c", "h": "#7e5328", "S": "#f0c196", "R": "#c8453b", "r": "#9c322b",
    "B": "#3f6aa8", "b": "#2d4f85", "K": "#2b2228", "T": "#8a5a2b", "t": "#5f3d1c",
    # dog
    "k": "#26232b", "W": "#f6f2ea", "w": "#cfc8bb", "N": "#111015", "Q": "#e58f9a",
    # world
    "G": "#5e9e43", "g": "#7cbb55", "d": "#447f33",
    "O": "#c0392b", "o": "#8f2a20", "Y": "#f2c94c", "y": "#d9a21f",
    "D": "#5a3a22", "d2": "#3e2815", "M": "#d8b07a", "m": "#a67e4a",
    "C": "#ffffff", "c": "#d6e4f2", "u": "#a9c2dc", "V": "#7aa7d9",
    "I": "#e87aa6", "i": "#b84d7c", "Z": "#6c8fd1", "A": "#8f8f96", "a": "#5d5d66",
}

# wool light / wool shade per family
WOOL = {
    "anthropic": ("#f0b27a", "#c97b3f"),
    "openai": ("#3fbf9a", "#1f7f66"),
    "cursor": ("#6d8ccc", "#3f5a94"),
    "github": ("#b79fe3", "#7f62c0"),
    "other": ("#f4efe6", "#cfc6b6"),
}

SHEEP = {
    "walk1": [
        "....wWWWWWw.....",
        "...wWWWWWWWw.FF.",
        "..wWWWWWWWWwFFFF",
        "..WWWWWWWWWwFEFF",
        "..WWWWWWWWWw.FFP",
        "..wWWWWWWWWw.FF.",
        "...wwWWWWWww..F.",
        "....wwwwwww.....",
        "....L.L...L.L...",
        "....L.L...L.L...",
    ],
    "walk2": [
        "....wWWWWWw.....",
        "...wWWWWWWWw.FF.",
        "..wWWWWWWWWwFFFF",
        "..WWWWWWWWWwFEFF",
        "..WWWWWWWWWw.FFP",
        "..wWWWWWWWWw.FF.",
        "...wwWWWWWww..F.",
        "....wwwwwww.....",
        "...L.L...L.L....",
        "...L.L...L.L....",
    ],
    "sit": [
        "....wWWWWWw.....",
        "...wWWWWWWWw.FF.",
        "..wWWWWWWWWwFFFF",
        "..WWWWWWWWWwFEFF",
        "..WWWWWWWWWw.FFP",
        "..WWWWWWWWWWw.FF",
        "..wWWWWWWWWWw.F.",
        "...wwwwwwwwww...",
        "...LL......LL...",
    ],
    "sleep": [
        "...wWWWWWWw.....",
        "..wWWWWWWWWw....",
        ".wWWWWWWWWWWw.FF",
        ".WWWWWWWWWWWwFFF",
        ".WWWWWWWWWWWFXXP",
        ".wWWWWWWWWWwwFFF",
        "..wwwwwwwwwww.F.",
        "...LL.....LL....",
    ],
    "graze": [
        "....wWWWWWw.....",
        "...wWWWWWWWw....",
        "..wWWWWWWWWw....",
        "..WWWWWWWWWwF...",
        "..WWWWWWWWWwFF..",
        "..wWWWWWWWWwFFF.",
        "...wwWWWWWwwFEFF",
        "....wwwwwww.FFFF",
        "....L.L...L.LFPg",
        "....L.L...L.Lg.g",
    ],
    "alert": [
        "............F.F.",
        "............FFFF",
        "............FEFF",
        "............FFFP",
        "...........FFF..",
        "....wWWWWWwFF...",
        "...wWWWWWWWwF...",
        "..wWWWWWWWWw....",
        "..WWWWWWWWWw....",
        "..wWWWWWWWWw....",
        "...wwWWWWWww....",
        "....wwwwwww.....",
        "....L.L...L.L...",
        "....L.L...L.L...",
    ],
}

DROVER_BODY = [
    ".....HHHHH......",
    "....HHHHHHH.....",
    "...hhhhhhhhh....",
    ".....SSSSS......",
    ".....SKSKS......",
    ".....SSPSS......",
    "......SSS.......",
    "....RRRRRRR.....",
    "...SRrRRRrRS....",
    "...SRRRrRRRS....",
    "....BBBBBBB.....",
    "....BBBBBBB.....",
    "....BBBBBBB.....",
    "....BBb.bBB.....",
    "....BB...BB.....",
    "....BB...BB.....",
    "....BB...BB.....",
    "...KKK...KKK....",
    "...KKK...KKK....",
]

DOG = {
    "1": [
        "..........K..K..",
        ".........KKKKKK.",
        "...KKKKKK.KWWKKN",
        "..KKKKKKKKKWWKKN",
        ".KKKKKKKKKKKWWKK",
        ".KKKKKKKKKKKKKQ.",
        "..WWKKKKWWKWW...",
        "..WW..WW.WW.....",
        "..WW..WW.WW.....",
    ],
    "2": [
        "..........K..K..",
        ".........KKKKKK.",
        "K..KKKKKK.KWWKKN",
        "KKKKKKKKKKKWWKKN",
        ".KKKKKKKKKKKWWKK",
        ".KKKKKKKKKKKKKQ.",
        "..WWKKKKWWKWW...",
        ".WW...WW..WW....",
        ".WW...WW..WW....",
    ],
}

GRASS = {
    "1": [
        "........",
        "........",
        "........",
        "..g...g.",
        "..g.g.g.",
        ".gGgGgG.",
        ".GGGdGG.",
        "..dGGd..",
    ],
    "2": [
        "........",
        "........",
        "...g....",
        ".g.g..g.",
        ".g.gg.g.",
        ".gGgGGg.",
        "..GGdGG.",
        "...dGd..",
    ],
}

FLOWER = [
    "........",
    "..I.I...",
    "..IYI...",
    "..iIi...",
    "...G....",
    "..gG....",
    "...Gg...",
    "...G....",
]

SUN = [
    ".......Y........",
    ".......Y........",
    "..Y....Y....Y...",
    "...Y.yYYYy.Y....",
    "....yYYYYYy.....",
    "...yYYYYYYYy....",
    "YYyYYYYYYYYyYY..",
    "...yYYYYYYYy....",
    "....yYYYYYy.....",
    "...Y.yYYYy.Y....",
    "..Y....Y....Y...",
    ".......Y........",
    ".......Y........",
    "................",
    "................",
    "................",
]

CLOUD = [
    "................",
    "................",
    "................",
    "......CCC.......",
    "....CCCCCCC.....",
    "...CCCCCCCCCC...",
    "..CCCCCCCCCCCC..",
    ".CCCCCCCCCCCCCC.",
    ".cCCCCCCCCCCCCc.",
    "..ucccccccccccu.",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
]

BUBBLE = [
    ".OOOOOO.",
    "OOOCCOOO",
    "OOOCCOOO",
    "OOOCCOOO",
    "OOOOOOOO",
    "OOOCCOOO",
    ".OOOOOo.",
    "...OOo..",
]

ZZZ = [
    "........",
    ".ZZZZ...",
    "....Z...",
    "...Z.ZZZ",
    "..ZZ..Z.",
    "......Z.",
    ".....ZZZ",
    "........",
]


def blank(w, h):
    return [["."] * w for _ in range(h)]


def rect(g, x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            g[yy][xx] = c


def pad(rows, w, h, bottom=0):
    """Pad ASCII rows to w x h, anchored at the bottom (minus `bottom`)."""
    for r in rows:
        assert len(r) == w, (len(r), w, r)
    assert len(rows) <= h
    top = h - len(rows) - bottom
    return ["." * w] * top + list(rows) + ["." * w] * bottom


def to_grid(rows):
    return [list(r) for r in rows]


def svg(grid, colors):
    h, w = len(grid), len(grid[0])
    # A 1px transparent margin keeps the renderer's edge sampling from drawing
    # faint lines around the sprite; the dashboard offsets it back by one pixel.
    out = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
           'viewBox="-1 -1 %d %d" shape-rendering="crispEdges">' % (w + 2, h + 2, w + 2, h + 2)]
    for y, row in enumerate(grid):
        x = 0
        while x < w:
            c = row[x]
            if c == ".":
                x += 1
                continue
            x2 = x
            while x2 < w and row[x2] == c:
                x2 += 1
            out.append('<rect x="%d" y="%d" width="%d" height="1" fill="%s"/>'
                       % (x, y, x2 - x, colors[c]))
            x = x2
    out.append("</svg>")
    return "\n".join(out) + "\n"


def drover(frame):
    rows = pad(DROVER_BODY, 16, 24)
    if frame == 2:  # sway: head and shoulders one pixel right
        for i in range(3, 14):
            rows[i] = "." + rows[i][:-1]
    g = to_grid(rows)
    for y in range(5, 24):  # crook staff
        g[y][14] = "T"
    g[3][13] = g[3][14] = "T"
    g[4][12] = "T"
    g[4][14] = "t"
    g[12][13] = "S"
    return g


def barn():
    g = blank(48, 40)
    rect(g, 4, 14, 40, 26, "O")           # walls
    for x in range(4, 44, 4):             # planks
        rect(g, x, 14, 1, 26, "o")
    # roof: stepped gable
    for i in range(14):
        rect(g, 2 + i, 14 - i, 44 - 2 * i, 1, "D" if i % 2 == 0 else "d2")
    rect(g, 0, 14, 48, 2, "d2")           # eave
    rect(g, 22, 3, 4, 2, "d2")
    rect(g, 19, 18, 10, 4, "C")           # hayloft hatch
    rect(g, 20, 19, 8, 2, "M")
    rect(g, 23, 18, 2, 4, "C")
    rect(g, 14, 24, 20, 16, "C")          # door frame
    rect(g, 15, 25, 18, 15, "o")
    rect(g, 15, 25, 9, 15, "O")
    rect(g, 24, 25, 9, 15, "O")
    for i in range(9):                    # X braces
        g[25 + i * 15 // 9][15 + i] = "C"
        g[39 - i * 14 // 9][15 + i] = "C"
        g[25 + i * 15 // 9][32 - i] = "C"
        g[39 - i * 14 // 9][32 - i] = "C"
    rect(g, 23, 31, 2, 3, "Y")            # handles
    rect(g, 0, 38, 48, 2, "d")            # grass fringe
    return g


def fence():
    g = blank(16, 16)
    rect(g, 0, 6, 16, 2, "M")
    rect(g, 0, 7, 16, 1, "m")
    rect(g, 0, 11, 16, 2, "M")
    rect(g, 0, 12, 16, 1, "m")
    rect(g, 6, 3, 4, 13, "M")
    rect(g, 9, 3, 1, 13, "m")
    rect(g, 7, 2, 2, 1, "M")
    return g


def gate(is_open):
    g = blank(16, 16)
    for x in (0, 14):
        rect(g, x, 3, 2, 13, "D")
        rect(g, x, 2, 2, 1, "M")
    if is_open:
        # panel swung back against the left post, seen edge-on
        rect(g, 2, 5, 3, 2, "M")
        rect(g, 2, 10, 3, 2, "M")
        rect(g, 4, 4, 1, 10, "m")
    else:
        for y in (5, 9, 13):
            rect(g, 2, y, 12, 2, "M")
            rect(g, 2, y + 1, 12, 1, "m")
        for i in range(10):
            g[13 - i][3 + i] = "D"
        rect(g, 12, 7, 2, 2, "Y")
    return g


def sprites():
    out = {}
    for fam, (light, shade) in WOOL.items():
        cols = dict(PALETTE, W=light, w=shade)
        for name, art in SHEEP.items():
            rows = pad(art, 16, 16)
            out["sheep-%s-%s" % (fam, name)] = (rows, cols)
            # mirrored copy facing left, for sheep walking the other way
            out["sheep-%s-%s-l" % (fam, name)] = ([r[::-1] for r in rows], cols)
    for f in "12":
        out["drover-" + f] = (drover(int(f)), PALETTE)
        out["dog-" + f] = (pad(DOG[f], 16, 12), PALETTE)
    out["barn"] = (barn(), PALETTE)
    out["fence"] = (fence(), PALETTE)
    out["gate-open"] = (gate(True), PALETTE)
    out["gate-closed"] = (gate(False), PALETTE)
    out["grass-1"] = (GRASS["1"], PALETTE)
    out["grass-2"] = (GRASS["2"], PALETTE)
    out["flower"] = (FLOWER, PALETTE)
    out["sun"] = (SUN, PALETTE)
    out["cloud"] = (CLOUD, PALETTE)
    out["bubble-alert"] = (BUBBLE, PALETTE)
    out["zzz"] = (ZZZ, PALETTE)
    return out


def main():
    allsp = sprites()
    for name, (art, cols) in allsp.items():
        grid = art if isinstance(art[0], list) else to_grid(art)
        w = len(grid[0])
        assert all(len(r) == w for r in grid), name
        with open(os.path.join(HERE, name + ".svg"), "w", newline="\n") as f:
            f.write(svg(grid, cols))
    cells = []
    for name, (art, _) in allsp.items():
        grid = art if isinstance(art[0], list) else to_grid(art)
        w, h = len(grid[0]), len(grid)
        cells.append(
            '<figure><div class="s"><img src="%s.svg" width="%d" height="%d"></div>'
            '<figcaption>%s <small>%dx%d</small></figcaption></figure>'
            % (name, w * 4, h * 4, name, w, h))
    page = (
        '<!doctype html>\n<meta charset="utf-8"><title>Pasture sprites</title>\n'
        '<style>body{background:#5e9e43;font:12px monospace;color:#fff;margin:16px}'
        '.g{display:flex;flex-wrap:wrap;gap:14px}figure{margin:0}'
        '.s{background:#8fd0f0;padding:6px;display:inline-block}'
        'img{image-rendering:pixelated;display:block}small{opacity:.7}</style>\n'
        '<div class="g">\n' + "\n".join(cells) + "\n</div>\n")
    with open(os.path.join(HERE, "preview.html"), "w", newline="\n") as f:
        f.write(page)


if __name__ == "__main__":
    main()
