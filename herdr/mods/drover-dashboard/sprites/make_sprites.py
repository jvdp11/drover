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


def sprites():
    """v1 sprites the mod still uses (grass tufts, flower, alert bubble, zzz)."""
    out = {}
    out["grass-1"] = (GRASS["1"], PALETTE)
    out["grass-2"] = (GRASS["2"], PALETTE)
    out["flower"] = (FLOWER, PALETTE)
    out["bubble-alert"] = (BUBBLE, PALETTE)
    out["zzz"] = (ZZZ, PALETTE)
    return out


# ===================================================================== v2 ===
# Pasture art v2. Same rules as v1: ASCII pixel maps ('.' = transparent) with
# a small palette per sprite group. Characters are drawn from parts, then an
# outline pass puts a 1px darker outline of each material around the shape.
# Big scenery (trees, pond, hills, barn) is built from simple masks with the
# same palettes and a deterministic hash for texture, so reruns are identical.

FAMILIES = ["anthropic", "openai", "cursor", "github", "google", "other"]

# family colour: light, mid, shade, outline. Used for wool and drover hat/scarf.
FAMILY = {
    "anthropic": ("#f7c196", "#e58c56", "#bc632f", "#6b3115"),
    "openai": ("#8ce3cc", "#3fb896", "#227f68", "#0d463a"),
    "cursor": ("#b1c2e8", "#7489c9", "#4c5c9a", "#232c56"),
    "github": ("#d8bff7", "#a885e0", "#7651b6", "#382266"),
    "google": ("#f4ea92", "#d6c94a", "#a0952a", "#545012"),
    "other": ("#fefcf6", "#ebe4d6", "#c4baa6", "#6f665a"),
}

LEAF = {"G": "#a8d873", "g": "#74b44c", "j": "#4e8a37", "J": "#2b5324"}
LEAF_OUT = {"G": "J", "g": "J", "j": "J"}


def fam_cols(fam):
    W, w, v, V = FAMILY[fam]
    return {"W": W, "w": w, "v": v, "V": V}


FAM_OUT = {"W": "V", "w": "V", "v": "V"}


def canvas(w, h):
    return [["."] * w for _ in range(h)]


def stamp(g, rows, x, y):
    for j, r in enumerate(rows):
        for i, c in enumerate(r):
            if c != "." and 0 <= y + j < len(g) and 0 <= x + i < len(g[0]):
                g[y + j][x + i] = c


def mirror(g):
    return [list(reversed(r)) for r in g]


def outline(g, omap):
    """Give every shape a 1px outline in the darker tone of its material."""
    h, w = len(g), len(g[0])
    out = [r[:] for r in g]
    for y in range(h):
        for x in range(w):
            if g[y][x] != ".":
                continue
            for dx, dy in ((0, 1), (0, -1), (-1, 0), (1, 0)):
                xx, yy = x + dx, y + dy
                if 0 <= xx < w and 0 <= yy < h and g[yy][xx] in omap:
                    out[y][x] = omap[g[yy][xx]]
                    break
    return out


def noise(x, y, seed=0):
    n = (x * 374761393 + y * 668265263 + seed * 1442695041) & 0xFFFFFFFF
    n = ((n ^ (n >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0


def ellipse(cx, cy, rx, ry):
    s = set()
    for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
        for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
            if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                s.add((x, y))
    return s


def clip(mask, x0, y0, x1, y1):
    return {(x, y) for (x, y) in mask if x0 <= x <= x1 and y0 <= y <= y1}


def blobs_paint(g, blobs, light, mid, dark, clipbox, speck=0.0, seed=0):
    """Paint a clumpy union of ellipses lit from the top left."""
    mask = set()
    for b in blobs:
        mask |= ellipse(*b)
    mask = clip(mask, *clipbox)
    for (x, y) in sorted(mask):
        px, py = x + 0.5, y + 0.5
        lit = core = False
        for cx, cy, rx, ry in blobs:
            if ((px - (cx - rx * 0.25)) / (rx * 0.55)) ** 2 + \
               ((py - (cy - ry * 0.32)) / (ry * 0.5)) ** 2 <= 1:
                lit = True
            if ((px - cx) / (rx * 0.92)) ** 2 + ((py - (cy - ry * 0.22)) / (ry * 0.86)) ** 2 <= 1:
                core = True
        c = light if lit else (mid if core else dark)
        n = noise(x, y, seed)
        if speck and c == mid and n < speck:
            c = light
        elif speck and c == mid and n > 1 - speck:
            c = dark
        g[y][x] = c
    return mask


def line(g, x0, y0, x1, y1, c):
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        g[y0][x0] = c
        if x0 == x1 and y0 == y1:
            return
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


# ------------------------------------------------------------------ sheep --
SHEEP_PAL = dict(LEAF, F="#463a43", f="#30272e", K="#18121a", e="#fbf6ea", E="#9a8b95",
                 P="#f09aa2", b="#9fd3f5", B="#3f78ad")
SHEEP_OUT = dict(FAM_OUT, F="K", f="K", e="K", E="K", P="K", b="B", **LEAF_OUT)

SH_BODY = [
    "...WW.WWW.WW...",
    ".WWWWWWWWWWWWW.",
    "WWWWWWWWWWWWWWW",
    "WWWwWWWWWwWWWWw",
    "wWWwwWWWwwWWWww",
    "wwwwwwWwwwwwWww",
    "vwwWwwwwwWwwwwv",
    "vvwwwvvwwwwvwvv",
    ".vvvvvvvvvvvvv.",
    "..vv.vvvvv.vv..",
]
SH_HEAD = [
    "..WWW...",
    ".WWWWWW.",
    "ffWWFFFF",
    ".fFFFFFF",
    "..FFFeFF",
    "..FPFFFF",
    "...FFFFF",
    "....fff.",
]
SH_HEAD_UP = [   # alert: ear up, wide eye
    "..fF....",
    "..fP....",
    "..WWW...",
    ".WWWWWW.",
    ".WWWFFFF",
    "..FFFFFF",
    "..FFeeFF",
    "..FPeFFF",
    "...FFFFF",
    "....fff.",
]
SH_HEAD_DOWN = [  # grazing: head to the ground
    "WWW.....",
    "WWWFF...",
    "fWFFFF..",
    "ffFFFFF.",
    ".FFFeFF.",
    ".FFPFFFF",
    "..FFFFFF",
    "...FFFF.",
    "....ff..",
]
SH_HEAD_SLEEP = [
    "..WWW...",
    ".WWWWWW.",
    "fffWFFFF",
    "..fFFFFF",
    "..FEEFFF",
    "..FPFFFF",
    "...FFFF.",
]
TUFT1 = [".G..G", ".Gg.G", "gGjGg"]
TUFT2 = ["....G", "..g.G", "gGjGg"]
DROP = [".b", "bb"]

# per frame: leg (dx, lift) for back-far, back-near, front-far, front-near; bob
SH_WALK = [
    ([(1, 0), (-1, 0), (-1, 0), (1, 0)], 0),
    ([(0, 0), (0, 1), (0, 1), (0, 0)], -1),
    ([(-1, 0), (1, 0), (1, 0), (-1, 0)], 0),
    ([(0, 1), (0, 0), (0, 0), (0, 1)], -1),
]
SH_LEGX = [(4, "f"), (7, "F"), (12, "f"), (15, "F")]


def sheep_legs(g, top, legs):
    for (x, c), (dx, lift) in zip(SH_LEGX, legs):
        bottom = 22 - lift
        for y in range(top, bottom + 1):
            xx = x + (dx if y >= bottom - 1 else 0)
            ch = "K" if y == bottom else c
            g[y][xx] = g[y][xx + 1] = ch


def sheep2(pose, frame=0):
    g = canvas(24, 24)
    stand = [(0, 0)] * 4
    if pose == "walk":
        legs, bob = SH_WALK[frame]
        sheep_legs(g, 17 + bob, legs)
        stamp(g, SH_BODY, 3, 9 + bob)
        g[11 + bob][2] = g[12 + bob][2] = "w"
        stamp(g, SH_HEAD, 15, 5 + bob)
    elif pose in ("graze1", "graze2"):
        sheep_legs(g, 17, stand)
        stamp(g, SH_BODY, 3, 9)
        g[11][2] = g[12][2] = "w"
        if pose == "graze1":
            stamp(g, SH_HEAD_DOWN, 15, 12)
            stamp(g, TUFT1, 18, 20)
        else:
            stamp(g, SH_HEAD_DOWN, 15, 13)
            stamp(g, TUFT2, 18, 20)
    elif pose in ("sit", "sleep"):
        stamp(g, SH_BODY, 3, 13)
        g[15][2] = g[16][2] = "w"
        if pose == "sit":
            stamp(g, ["FFK"], 16, 22)
            stamp(g, SH_HEAD, 15, 9)
        else:
            stamp(g, SH_HEAD_SLEEP, 15, 15)
    elif pose == "alert":
        sheep_legs(g, 17, stand)
        stamp(g, SH_BODY, 3, 9)
        g[11][2] = g[12][2] = "w"
        stamp(g, ["WWW", "WWW"], 15, 9)
        stamp(g, SH_HEAD_UP, 15, 1)
    elif pose == "stuck":
        stamp(g, SH_BODY, 3, 9)
        g[11][2] = g[12][2] = "w"
        stamp(g, SH_HEAD_UP, 15, 1)
        stamp(g, ["WWW", "WWW"], 15, 9)
        stamp(g, DROP, 21, 2)
        sheep_mask = {(x, y) for y in range(24) for x in range(24) if g[y][x] != "."}
        mask = blobs_paint(g, [(5, 19, 5, 4.5), (12, 17.5, 5.5, 5), (19, 19, 4.5, 4.5)],
                           "G", "g", "j", (1, 1, 22, 22), speck=0.12, seed=3)
        for (x, y) in mask:   # dark edge where the bush meets the sheep
            if (x, y - 1) in sheep_mask and (x, y - 1) not in mask:
                g[y][x] = "J"
        g[16][9] = g[18][15] = "P"   # two little flowers
    return outline(g, SHEEP_OUT)


LAMB_BODY = [
    ".WW.WW.W.",
    "WWWWWWWWW",
    "WWWwWWWww",
    "wwwwwwwww",
    "vwwvwwwvv",
    ".vvvvvvv.",
]
LAMB_HEAD = [
    ".WWW..",
    "fWWFFF",
    ".FFFFF",
    ".FFeFF",
    ".FPFFF",
    "..FFF.",
]


def lamb(frame):
    g = canvas(16, 16)
    legs = [(3, -1, "f"), (5, 1, "F"), (8, 1, "f"), (10, -1, "F")] if frame == 0 else \
           [(3, 1, "f"), (5, -1, "F"), (8, -1, "f"), (10, 1, "F")]
    for x, dx, c in legs:
        g[12][x] = c
        g[13][x + (dx if dx > 0 else 0)] = c
        g[14][x + dx] = "K"
    stamp(g, LAMB_BODY, 2, 7)
    g[8][1] = "w"
    stamp(g, LAMB_HEAD, 9, 4 - frame)
    return outline(g, SHEEP_OUT)


# ----------------------------------------------------------------- drover --
DROVER_PAL = {
    "S": "#f5cba4", "s": "#d99b72", "x": "#7a4631", "X": "#2a1c16", "P": "#ec9585",
    "H": "#6e4529", "h": "#4b2d18",
    "C": "#9b7149", "c": "#74512f", "q": "#3c2816", "Y": "#f2c94c",
    "U": "#f3e8cf", "u": "#cfc09f", "i": "#9a7b5c",
    "B": "#5b6b8e", "b": "#44516f", "n": "#222a3e",
    "K": "#674129", "k": "#462b1a", "z": "#22140b",
    "T": "#cf9658", "t": "#94602f",
}
DROVER_OUT = dict(FAM_OUT, S="x", s="x", P="x", X="x", H="x", h="x", C="q", c="q",
                  Y="q", U="q", u="q", i="q", B="n", b="n", K="z", k="z", T="q", t="q")

DR_HEAD = [
    "......wwww....",
    ".....wWWWWw...",
    ".....wWWWWWw..",
    ".....vvvvvvv..",
    "...vwwwwwwwwww",
    "....hHSSSSSS..",
    "....hHSSSXSS..",
    "....hsSSSSSSS.",
    ".....hSSPSSs..",
    "......sSSs....",
]


def dr_head(kind):
    rows = [list(r) for r in DR_HEAD]
    if kind == "down":          # reading: eye lowered
        rows[6][9] = "S"
        rows[7][9] = "X"
    elif kind == "up":          # thinking: eye up under the brim
        rows[6][9] = "S"
        rows[5][9] = "X"
        rows[5][10] = "S"
    elif kind == "closed":      # dozing
        rows[6][9] = "S"
        rows[7][8] = rows[7][9] = "x"
    elif kind == "whistle":
        rows[8][11] = "P"
        rows[8][12] = "x"
    return ["".join(r) for r in rows]


DR_TORSO = [
    "...wWWWw..",
    "..vwWWWWv.",
    ".CCvCCUUCC",
    "CCCvCCUUCC",
    "CCCwCCUUCC",
    "cCCvCCUUCc",
    "cCCCCCUuCc",
    "cCCCCCuuCc",
    ".qqqqqqYq.",
    ".cCCCCCCc.",
]
DR_TORSO_FLAP = [   # scarf tail blown back (walking / idle2)
    "...wWWWw..",
    "..vwWWWWv.",
    "vwvCCCUUCC",
    "vCCCCCUUCC",
    "CCCCCCUUCC",
    "cCCCCCUUCc",
    "cCCCCCUuCc",
    "cCCCCCuuCc",
    ".qqqqqqYq.",
    ".cCCCCCCc.",
]
ARM_HOLD = [
    "cCC.....",
    ".cCC....",
    "..cCC...",
    "...cCSSS",
    ".....SSS",
]
ARM_BACK = ["cc", "cc", "cc", "ss"]
ARM_THINK = [
    ".xss.",
    ".sSsx",
    "...CC",
    "...CC",
    "cC.CC",
    "cCCCC",
    ".cCCc",
]
ARM_WHISTLE = [
    "..sx.",
    "..ss.",
    "..CC.",
    "...CC",
    "cC.CC",
    "cCCCC",
    ".cCCc",
]
ARM_LEAN = [
    "cCCCCSS",
    ".cCCCSS",
]
SCROLL = [
    "t.....t",
    "TUUUUUT",
    "TUiiiUT",
    "TUUUUUT",
    "TUiiUUT",
    "TUUUUuT",
    "t.....t",
]


def dr_leg(g, x, top, dx, lift, near):
    tr, bt = ("B", "K") if near else ("b", "k")
    bottom = 30 - lift
    n = bottom - top
    for i, y in enumerate(range(top, bottom + 1)):
        t = min(1.0, max(0, i - 2) / max(1, n - 3))
        off = int(round(dx * t))
        if y == bottom:
            stamp(g, [bt * 4], x + off, y)
        elif y == bottom - 1:
            stamp(g, [bt * 3], x + off, y)
        else:
            stamp(g, [tr * 3], x + off, y)


def crook(g, x, top, bottom=30):
    for y in range(top + 1, bottom + 1):
        g[y][x] = "T"
    g[top][x + 1] = g[top][x + 2] = "T"
    g[top + 1][x + 3] = g[top + 2][x + 3] = "T"
    g[top + 3][x + 2] = "t"


DR_WALK = [  # (far dx, far lift), (near dx, near lift), bob, crook dx, back arm
    ((-2, 0), (2, 0), 0, 1, True),
    ((0, 0), (0, 1), -1, 0, False),
    ((2, 0), (-2, 0), 0, -1, False),
    ((0, 1), (0, 0), -1, 0, True),
]


def drover2(pose, frame=0):
    g = canvas(24, 32)
    if pose == "walk":
        far, near, bob, cdx, back = DR_WALK[frame]
        if back:
            stamp(g, ARM_BACK, 6, 14 + bob)
        dr_leg(g, 9, 21 + bob, far[0], far[1], False)
        dr_leg(g, 12, 21 + bob, near[0], near[1], True)
        stamp(g, DR_TORSO_FLAP, 7, 11 + bob)
        stamp(g, dr_head("normal"), 4, 1 + bob)
        crook(g, 19 + cdx, 2 + bob)
        stamp(g, ARM_HOLD, 13 + cdx, 13 + bob)
    elif pose in ("idle", "read", "think", "whistle"):
        dy = 1 if (pose == "idle" and frame == 1) else 0
        dr_leg(g, 9, 21, 0, 0, False)
        dr_leg(g, 12, 21, 1, 0, True)
        stamp(g, DR_TORSO_FLAP if dy else DR_TORSO, 7, 11 + dy)
        head = {"idle": "normal", "read": "down", "think": "up", "whistle": "whistle"}[pose]
        stamp(g, dr_head(head), 4, 1 + dy)
        if pose == "idle":
            crook(g, 19, 2)
            stamp(g, ARM_HOLD, 13, 13 + dy)
        elif pose == "read":
            stamp(g, ["cC", "cCC", ".cCCC"], 13, 13)
            stamp(g, SCROLL, 14, 12)
            stamp(g, ["SS", "SS"], 13, 15)
            stamp(g, ["SS", "SS"], 20, 15)
        elif pose == "think":
            stamp(g, ARM_THINK, 12, 9)
        else:
            stamp(g, ARM_WHISTLE, 13, 8)
    elif pose in ("lean", "doze"):
        dz = 1 if pose == "doze" else 0
        dr_leg(g, 9, 21, 1, 0, False)
        dr_leg(g, 12, 21, -3, 0, True)
        stamp(g, DR_TORSO, 8, 11 + dz)
        stamp(g, dr_head("closed" if dz else "normal"), 5 + dz, 2 + dz)
        line(g, 21, 30, 18, 10, "T")
        g[9][18] = g[9][19] = g[9][20] = "T"
        g[10][21] = g[11][21] = "T"
        g[12][20] = "t"
        stamp(g, ARM_LEAN, 13, 13 + dz)
    return outline(g, DROVER_OUT)


# -------------------------------------------------------------------- dog --
DOG_PAL = {"D": "#35303d", "d": "#56505f", "Z": "#f8f4ec", "z": "#d4ccbe",
           "N": "#141117", "k": "#27232d", "P": "#f2879a", "R": "#d8493f", "O": "#121016",
           "A": "#c98a4b"}
DOG_OUT = {"D": "O", "d": "O", "k": "O", "Z": "O", "z": "O", "P": "O", "R": "O", "A": "O"}

DOG_HEAD = [
    "..DD......",
    ".DDDd.....",
    ".DdDDD....",
    "DDDDAND...",
    "DDDDDDZZZN",
    ".DDDDZZZZZ",
    "..RRZZZZ..",
]
DOG_HEAD_BARK = [
    "..DD......",
    ".DDDd.....",
    ".DdDDD....",
    "DDDDANDZZN",
    "DDDDDDZZZ.",
    ".DDDDZ.P..",
    "..RRZZZZ..",
]
DOG_HEAD_HAPPY = [
    "..DD......",
    ".DDDd.....",
    ".DdDDD....",
    "DDDDAND...",
    "DDDDDDZZZN",
    ".DDDDZZZZZ",
    "..RRZZPP..",
    "......P...",
]
DOG_HEAD_RUN = [  # ears flat back
    "DD........",
    ".DDDd.....",
    ".DdDDD....",
    "DDDDAND...",
    "DDDDDDZZZN",
    ".DDDDZZPZZ",
    "..RRZ.P...",
]
DOG_BODY = [
    "..DDDDDDDDD..",
    ".DDDDDDDDDDDZ",
    "DDDDDDDDDDDZZ",
    "DDDDDDDDDDZZZ",
    ".DDDDDDDDDZZZ",
    ".DDD....DDZZ.",
]
DOG_TAIL = {
    "up": ["Z...", "DD..", "DD..", ".DD.", "..DD", "...D"],
    "wag": ["...Z", "..DD", "..DD", "..DD", "..DD", "...D"],
    "back": ["Z....", "DDD..", ".DDDD", "...DD"],
}
DOG_SIT = [
    "......DD......",
    ".....DDDd.....",
    ".....DdDDD....",
    "....DDDDAND...",
    "....DDDDDDZZZN",
    ".....DDDDZZZZZ",
    ".....DRRZZZZ..",
    "....DDDDZZZ...",
    "...DDDDDZZZ...",
    "..DDDDDDZZZ...",
    ".DDDDDDDZZZ...",
    ".DDDDDDDZZZ...",
    "DDDDDDDDZ.Z...",
    "DDDDDDDDZ.Z...",
    "DDDDDZZDZ.ZZ..",
]
DOG_SIT_TAIL = ["ZDDDDD"]


def dog_leg(g, x0, y0, x1, y1, near):
    c = "D" if near else "k"
    line(g, x0, y0, x1, y1, c)
    line(g, x0 + 1, y0, x1 + 1, y1, c)
    g[y1][x1] = g[y1][x1 + 1] = "Z"


DOG_RUN = [
    # legs (hip x, foot x, foot y) for back-far, back-near, front-far, front-near; body dy
    ([(4, 1, 13), (6, 3, 14), (13, 17, 13), (14, 19, 14)], 0),
    ([(4, 4, 15), (6, 7, 15), (13, 12, 15), (14, 15, 15)], -1),
    ([(4, 8, 15), (6, 10, 15), (13, 10, 14), (14, 12, 15)], 0),
    ([(4, 3, 15), (6, 5, 14), (13, 14, 15), (14, 17, 14)], -1),
]


def dog2(pose, frame=0):
    g = canvas(24, 18)
    if pose == "sit":
        stamp(g, DOG_SIT_TAIL, 2, 16)
        stamp(g, DOG_SIT, 5, 2)
        return outline(g, DOG_OUT)
    if pose == "run":
        legs, dy = DOG_RUN[frame]
        top = 11 + dy
        for i in (0, 2):
            hx, fx, fy = legs[i]
            dog_leg(g, hx, top, fx, fy, False)
        stamp(g, DOG_TAIL["back"], 0, 6 + dy)
        stamp(g, DOG_BODY, 3, 7 + dy)
        for i in (1, 3):
            hx, fx, fy = legs[i]
            dog_leg(g, hx, top, fx, fy, True)
        stamp(g, DOG_HEAD_RUN, 13, 3 + dy)
        return outline(g, DOG_OUT)
    # standing poses: bark, wag1, wag2
    for x, near in ((4, False), (6, True), (12, False), (14, True)):
        dog_leg(g, x, 12, x, 15, near)
    stamp(g, DOG_TAIL["up" if pose == "bark" or frame == 0 else "wag"], 0, 2)
    stamp(g, DOG_BODY, 3, 7)
    if pose == "bark":
        stamp(g, DOG_HEAD_BARK, 13, 1)
    else:
        stamp(g, DOG_HEAD_HAPPY, 13, 2)
    return outline(g, DOG_OUT)


# -------------------------------------------------------------------- owl --
OWL_PAL = {"O": "#a5733f", "o": "#7a4f2a", "M": "#ecd5a6", "m": "#c9a873",
           "Y": "#ffd24a", "K": "#1d1410", "y": "#e69a2e", "T": "#7a5233",
           "q": "#3a2415", "Q": "#3a2a1c", "t": "#5a3a22"}
OWL_OUT = {"O": "q", "o": "q", "M": "q", "m": "q", "Y": "q", "y": "q", "T": "Q", "t": "Q"}
OWL_BODY = [
    ".oo....oo.",
    ".oOOOOOOo.",
    "OMMMOOMMMO",
    "MYYYMMYYYM",
    "MYKYMMYKYM",
    "OMMMyyMMMO",
    "OOmMMyMmOO",
    "OmMmMMmMmO",
    ".OMmMMmMO.",
    "..OOOOOO..",
]
OWL_FLY_BODY = [
    ".o....o.",
    "oOOOOOOo",
    "OYYOOYYO",
    "OYKMMKYO",
    "OMMyyMMO",
    "OmMyMMmO",
    ".OmMMmO.",
    "..OOOO..",
]
OWL_WINGS = [
    ["o............o", "Oo..........oO", "oOo........oOo", ".oOO......OOo.", "..oO......Oo.."],
    ["oOOO......OOOo", "ooOO......OOoo", ".o..........o."],
    ["..OO......OO..", ".oOO......OOo.", ".oO........Oo.", "oo..........oo"],
    [".oOO......OOo.", "oOOO......OOOo", "o............o"],
]


def owl(pose, frame=0):
    g = canvas(16, 16)
    if pose == "perch":
        stamp(g, OWL_BODY, 3, 2)
        stamp(g, ["..y..y.."], 4, 12)
        stamp(g, ["TTTTTTTTTTTTT", ".t.........t."], 1, 13)
        return outline(g, OWL_OUT)
    dy = [0, 1, 2, 1][frame]
    wy = [1, 5, 5, 4][frame]
    stamp(g, OWL_WINGS[frame], 1, wy + dy)
    stamp(g, OWL_FLY_BODY, 4, 3 + dy)
    stamp(g, ["y..y"], 6, 11 + dy)
    return outline(g, OWL_OUT)


# ---------------------------------------------------------------- scenery --
DIRT = {"L": "#e6c48f", "M": "#cfa166", "m": "#ac7d49", "e": "#8a5f35",
        "p": "#d9d4c8", "r": "#8f8a80"}
WOOD = {"L": "#e8c189", "M": "#c79257", "m": "#96663a", "q": "#5a3a1f",
        "I": "#6c6c78", "i": "#3e3e48"}
WOOD_OUT = {"L": "q", "M": "q", "m": "q", "I": "i"}


def path_tile(kind):
    g = canvas(16, 16)
    mask = set()
    for y in range(16):
        for x in range(16):
            if kind == "h":
                inside = 4 <= y <= 11
            elif kind == "v":
                inside = 4 <= x <= 11
            else:
                # an L: half a straight tile from the north or south edge meets
                # half of one from the east or west edge, so turns join cleanly
                vert = 4 <= x <= 11 and (y <= 11 if kind[0] == "n" else y >= 4)
                horz = 4 <= y <= 11 and (x >= 4 if kind[1] == "e" else x <= 11)
                inside = vert or horz
            if inside:
                mask.add((x, y))
    seed = {"h": 1, "v": 2, "ne": 3, "nw": 4, "se": 5, "sw": 6}[kind]
    for (x, y) in mask:
        edge = any((xx, yy) not in mask and 0 <= xx < 16 and 0 <= yy < 16
                   for xx, yy in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
        n = noise(x, y, seed)
        g[y][x] = "e" if edge else ("L" if n < 0.18 else ("m" if n > 0.86 else "M"))
    # a couple of pebbles
    for i in range(2):
        px, py = sorted(mask)[int(noise(i, seed, 9) * len(mask))]
        if (px + 1, py) in mask and (px, py + 1) in mask and g[py][px] != "e" \
                and g[py][px + 1] != "e":
            g[py][px] = "p"
            g[py][px + 1] = "p"
            if g[py + 1][px] != "e":
                g[py + 1][px] = "r"
    return g


def fence_post(g, x, top, bottom=15):
    for y in range(top, bottom + 1):
        g[y][x] = "L"
        g[y][x + 1] = g[y][x + 2] = "M"
        g[y][x + 3] = "m"
    g[top - 1][x + 1] = g[top - 1][x + 2] = "M"


def fence2(kind):
    g = canvas(16, 16)
    if kind == "h":
        for y0 in (6, 10):
            for x in range(16):
                g[y0][x] = "L"
                g[y0 + 1][x] = "m"
        fence_post(g, 6, 3)
    elif kind == "v":
        for y in range(16):
            g[y][6] = "L"
            g[y][7] = g[y][8] = "M"
            g[y][9] = "m"
        stamp(g, ["MLLMMm", "LMMMMm", "MMMMmm", ".mmmm."], 5, 6)
    else:
        fence_post(g, 6, 3)
        g[8][9] = "I"
    return outline(g, WOOD_OUT)


# Signposts: a plank board (one wide plank with darker grain and nails) on one post,
# or a wide single-plank board on two posts. The dashboard draws the label text
# on the board, inside rows 2..10 (2..21 for the wide one), x 2..w-3.
SIGN_WIDTHS = (32, 48, 64)


def sign_post(g, x, top, bottom):
    for y in range(top, bottom + 1):
        g[y][x] = "L"
        g[y][x + 1] = g[y][x + 2] = "M"
        g[y][x + 3] = "m"


def sign_board(g, x0, x1, planks, seed):
    """Planks stacked from row 2, each `n` rows tall, a dark seam between them."""
    y = 2
    for i, n in enumerate(planks):
        for yy in range(y, y + n):
            for x in range(x0, x1 + 1):
                g[yy][x] = "M" if yy == y + n - 1 else "L"
        # grain: short darker streaks along the plank, staggered per row
        for yy in range(y, y + n - 1):
            x = x0 + 2 + int(noise(i, yy, seed) * 6)
            while x < x1 - 3:
                ln = 2 + int(noise(x, yy, seed + 1) * 4)
                for k in range(ln):
                    if x + k < x1 - 1:
                        g[yy][x + k] = "m" if noise(x + k, yy, seed + 2) > 0.8 else "M"
                x += ln + 5 + int(noise(x, yy, seed + 3) * 9)
        # nails near both ends, in the middle row of the plank
        ny = y + (n - 1) // 2
        g[ny][x0 + 1] = g[ny][x1 - 1] = "I"
        y += n
        if i < len(planks) - 1:
            for x in range(x0, x1 + 1):
                g[y][x] = "q"
            y += 1


def sign(w):
    g = canvas(w, 18)
    c = w // 2 - 2
    sign_post(g, c, 1, 16)
    sign_board(g, 1, w - 2, (9,), w)
    return outline(g, WOOD_OUT)


def sign_wide():
    g = canvas(96, 32)
    for x in (10, 82):
        sign_post(g, x, 1, 30)
    sign_board(g, 1, 94, (20,), 96)
    return outline(g, WOOD_OUT)


def gate2(is_open):
    g = canvas(16, 16)
    for x in (0, 13):
        for y in range(2, 16):
            g[y][x] = "L"
            g[y][x + 1] = "M"
            g[y][x + 2] = "m"
        g[1][x + 1] = "M"
    if is_open:
        for y in range(3, 15):
            g[y][3] = "L"
            g[y][4] = "m"
        for y in (5, 9, 13):
            g[y][5] = "M"
            g[y + 1][5] = "m"
        g[4][3] = g[5][3] = "I"
    else:
        for y in (4, 8, 12):
            for x in range(3, 13):
                g[y][x] = "L"
                g[y + 1][x] = "m"
        line(g, 3, 13, 12, 5, "M")
        g[7][11] = g[8][11] = "I"
        g[7][12] = "I"
    return outline(g, WOOD_OUT)


TREE_PAL = dict(LEAF, B="#a8784a", b="#7d5634", Q="#3f2a19", R="#e2574c", r="#ffb3a6")
TREE_OUT = dict(LEAF_OUT, B="Q", b="Q", R="J")


def tree():
    g = canvas(32, 40)
    for y in range(22, 38):        # trunk with root flare
        w = 3 if y < 34 else (4 if y < 36 else 5)
        for x in range(15 - w, 17 + w):
            g[y][x] = "B" if x < 14 else "b"
    for y in (26, 30):
        g[y][15] = "b"
    g[29][13] = "b"
    blobs_paint(g, [(16, 12, 11, 9.5), (8.5, 17, 7, 6), (23.5, 17, 7, 6), (16, 6.5, 7.5, 5.5),
                    (16, 20, 8, 5)], "G", "g", "j", (1, 1, 30, 26), speck=0.1, seed=7)
    for x, y in ((10, 11), (21, 9), (24, 18), (13, 19), (18, 15)):
        g[y][x] = g[y][x + 1] = g[y + 1][x] = g[y + 1][x + 1] = "R"
        g[y][x] = "r"
    return outline(g, TREE_OUT)


BUSH_PAL = dict(LEAF, R="#f19bb8", r="#fde2ea")
BUSH_OUT = dict(LEAF_OUT, R="J")


def bush():
    g = canvas(16, 12)
    blobs_paint(g, [(4.5, 7.5, 3.8, 3.6), (8, 6, 4.8, 4.8), (11.5, 7.5, 3.8, 3.6)],
                "G", "g", "j", (1, 1, 14, 10), speck=0.12, seed=11)
    for x, y in ((5, 4), (10, 6), (7, 8)):
        g[y][x] = "R"
    g[4][6] = "r"
    return outline(g, BUSH_OUT)


POND_PAL = dict(LEAF, A="#c8e9f2", a="#86c8e0", W="#5aa6cf", w="#3d80ac", M="#d8bb85",
                m="#a98a58", Q="#5b4a2c", R="#f6a7c1", T="#8a5a2e")
POND_OUT = dict(LEAF_OUT, A="w", a="w", W="w", M="Q", m="Q", R="J", T="J")


def pond():
    g = canvas(48, 24)
    outer = ellipse(24, 13.5, 22.5, 9.5)
    inner = ellipse(24, 13.5, 20.5, 7.8)
    for (x, y) in outer:
        if (x, y) in inner:
            top = (x, y - 1) not in inner or (x, y - 2) not in inner
            g[y][x] = "W" if top else "a"
        else:
            g[y][x] = "M" if y >= 13 or noise(x, y, 4) < 0.5 else "m"
    for x0, y0, n in ((12, 12, 6), (27, 15, 8), (19, 18, 4), (33, 11, 3)):  # glints
        for x in range(x0, x0 + n):
            g[y0][x] = "A"
    stamp(g, [".gggg.", "gGGgGg", "gGGGgj", ".jjjj."], 30, 16)    # lily pad
    g[16][32] = "R"
    for x, h in ((5, 9), (7, 12), (9, 8), (40, 10), (42, 13)):     # reeds
        for y in range(16 - h, 16):
            g[y][x] = "g"
        g[16 - h][x] = g[17 - h][x] = "T"
    return outline(g, POND_OUT)


STONE = {"A": "#d7d4cc", "a": "#aaa59c", "s": "#7f7a72", "Q": "#4b4843",
         "G": LEAF["G"], "g": LEAF["g"]}
STONE_OUT = {"A": "Q", "a": "Q", "s": "Q", "g": "Q", "G": "Q"}


def rock():
    g = canvas(12, 8)
    blobs_paint(g, [(6, 4.6, 4.8, 2.9), (4.5, 4, 3, 2.6)], "A", "a", "s", (1, 1, 10, 6),
                speck=0.08, seed=5)
    g[2][4] = g[2][5] = "g"
    g[2][6] = "G"
    return outline(g, STONE_OUT)


HILL_PAL = {"A": "#b6d9a4", "a": "#99c48b", "s": "#82ad78", "Q": "#5f8a5c",
            "G": "#8fc768", "g": "#73ad51", "j": "#5b9341", "J": "#3e6d2e"}


def hills():
    import math
    W, H = 256, 40
    g = canvas(W, H)
    tau = 2 * math.pi
    back = [int(round(13 + 5 * math.sin(tau * x / W * 2 + 0.6) + 3 * math.sin(tau * x / W * 5 + 1.3)))
            for x in range(W)]
    front = [int(round(25 + 4 * math.sin(tau * x / W * 3 + 2.1) + 2 * math.sin(tau * x / W * 7 + 0.4)))
             for x in range(W)]
    for x in range(W):
        for y in range(back[x], H):
            d = y - back[x]
            g[y][x] = "Q" if d == 0 else ("A" if d < 3 else ("a" if noise(x, y, 21) > 0.08 else "s"))
        for y in range(front[x], H):
            d = y - front[x]
            g[y][x] = "J" if d == 0 else ("G" if d < 3 else ("g" if noise(x, y, 22) > 0.1 else "j"))
    trees = canvas(W, H)
    for x0 in (20, 71, 133, 190, 232):     # far trees on the back hill
        t = back[x0 + 2]
        for (x, y) in ellipse(x0 + 2.5, t - 1.5, 2.5, 2.5):
            trees[y][x] = "s"
        trees[t + 1][x0 + 2] = "s"
    trees = outline(trees, {"s": "Q"})
    for y in range(H):
        for x in range(W):
            if trees[y][x] != "." and g[y][x] in ".AaQ":
                g[y][x] = trees[y][x]
    return g


BARN_PAL = {
    "R": "#cf5446", "r": "#ad3f36", "d": "#82302c", "Q": "#4a1b1c",
    "W": "#f6f0e3", "w": "#d9cdb6", "S": "#7a5a4d", "s": "#5d4238", "t": "#3e2a24",
    "N": "#2f3548", "n": "#454d68", "i": "#3a2418", "I": "#5a3a24",
    "H": "#f0cf75", "h": "#c9a148", "G": LEAF["g"], "g": LEAF["j"], "Y": "#ffe08a",
    "y": "#f5b94e", "o": "#c97a2a",
}
BARN_OUT = {"R": "Q", "r": "Q", "d": "Q", "W": "Q", "w": "Q", "S": "t", "s": "t",
            "H": "Q", "h": "Q", "N": "Q"}
# barn2-window-lit goes on top of barn2-closed / barn2-open at x=28, y=14
# (top left of the 8x8 overlay, in sprite pixels from the barn's top left).
BARN_WINDOW = (28, 14)


def barn_hw(y):
    """Half width of the gable wall at row y (gambrel roof shape)."""
    if y >= 22:
        return 26
    if y >= 12:
        return 18 + (y - 12) * 8 / 10
    return 4 + (y - 4) * 14 / 8


def barn2(is_open):
    g = canvas(64, 56)
    cx = 32
    for y in range(4, 54):
        hw = barn_hw(y)
        x0, x1 = int(round(cx - hw)), int(round(cx + hw)) - 1
        for x in range(x0, x1 + 1):
            plank = (x - 6) % 4 == 3
            g[y][x] = "r" if plank else "R"
            if y >= 50:
                g[y][x] = "r" if not plank else "d"
    # roof: shingle band hugging the gable
    for y in range(2, 25):
        hw = barn_hw(y) if y >= 4 else 0
        for x in range(64):
            inside = y >= 4 and cx - hw <= x + 0.5 <= cx + hw
            for k in (1, 2, 3):
                hk = barn_hw(y + k) if 4 <= y + k < 54 else -1
                if not inside and hk >= 0 and cx - hk - 1 <= x + 0.5 <= cx + hk + 1:
                    g[y][x] = "S" if (x + y) % 3 else "s"
                    break
    for y in range(4, 25):           # white trim under the roof edge
        hw = barn_hw(y)
        for x in (int(round(cx - hw)), int(round(cx + hw)) - 1):
            g[y][x] = "W"
    for x in range(6, 58):           # trim at eave and corners
        g[22][x] = "W"
        g[23][x] = "w"
    for y in range(22, 54):
        g[y][6] = g[y][57] = "W"
    # hayloft window (lit overlay goes here)
    wx, wy = BARN_WINDOW
    stamp(g, ["WWWWWWWW", "WNNWWNNW", "WNnWWNnW", "WWWWWWWW",
              "WNNWWNNW", "WNnWWNnW", "WNNWWNNW", "WWWWWWWW"], wx, wy)
    g[wy - 2][wx + 3] = g[wy - 2][wx + 4] = "I"     # hoist beam
    g[wy - 1][wx + 4] = "I"
    # main doors
    stamp(g, ["W" * 28], 18, 29)
    for y in range(30, 54):
        g[y][18] = g[y][45] = "W"
        g[y][31] = g[y][32] = "W"
    if is_open:
        for y in range(30, 54):
            for x in range(19, 45):
                g[y][x] = "i" if y < 50 or noise(x, y, 8) > 0.4 else "I"
        stamp(g, ["hHHHHHHh", "HhHHhHHH", "HHHHHHhH", "hHHhHHHh"], 21, 46)   # hay inside
        stamp(g, ["hHHHHh", "HHhHHH", "HHHHhH"], 36, 47)
        for side, x0 in ((0, 12), (1, 46)):           # doors swung outward
            for y in range(30, 54):
                for x in range(x0, x0 + 6):
                    edge = y in (30, 53) or x in (x0, x0 + 5)
                    g[y][x] = "W" if edge else "d"
            for i in range(22):
                k = i * 3 // 21
                g[31 + i][x0 + 1 + (k if side == 0 else 3 - k)] = "w"
            for x in range(x0, x0 + 6):
                g[41][x] = "w"
    else:
        for x0 in (19, 33):
            for y in range(30, 54):
                for x in range(x0, x0 + 12):
                    if g[y][x] != "W":
                        g[y][x] = "r" if (x - x0) % 4 == 3 else "R"
            for i in range(24):
                g[30 + i][x0 + i * 11 // 23] = "W"
                g[30 + i][x0 + 11 - i * 11 // 23] = "W"
            stamp(g, ["W" * 12], x0, 41)
        g[41][30] = g[42][30] = g[41][33] = g[42][33] = "N"
    for x in range(2, 62):           # grass fringe at the foot
        g[54][x] = "G" if noise(x, 54, 3) > 0.3 else "g"
        if noise(x, 53, 3) > 0.75 and g[53][x] == ".":
            g[53][x] = "G"
    return outline(g, BARN_OUT)


def barn_window_lit():
    return to_grid(["WWWWWWWW", "WYYWWYyW", "WYyWWyyW", "WWWWWWWW",
                    "WYyWWyoW", "WyyWWyoW", "WyoWWooW", "WWWWWWWW"])


HAY_PAL = {"H": "#f3d47a", "h": "#d8af4c", "k": "#b08a33", "Q": "#6b511d", "t": "#8a4b2a"}
HAY_OUT = {"H": "Q", "h": "Q", "k": "Q", "t": "Q"}


def hay():
    return outline(to_grid([
        "............",
        ".HHHHHHHHHh.",
        ".HhHHtHHhHt.",
        ".kkkktkkkkt.",
        ".hHhHtHhHkt.",
        ".HhHhthHhHt.",
        ".hHhHtHhHkt.",
        ".kHhktkhHkt.",
        ".kkkktkkkkt.",
        "............",
    ]), HAY_OUT)


SMOKE_PAL = {"A": "#f2f2f2", "a": "#cfd3d8", "Q": "#9aa0a8"}
SMOKE_OUT = {"A": "Q", "a": "Q"}
SMOKE = [
    ["........", "........", "........", "...AA...", "..AAaa..", "...aa...",
     "........", "....A...", "...Aaa..", "....a...", "....A...", "........"],
    ["........", "..AA....", ".AAAa...", ".AAaa...", "..aa....", "........",
     "....AA..", "...AAa..", "....a...", "...A....", "...a....", "........"],
    [".AAA....", "AAAAa...", "AAAaa...", ".aaa....", "........", "...AAA..",
     "..AAAa..", "...aa...", "........", "....Aa..", "....a...", "........"],
]

# ---------------------------------------------------------------------- sky --
SKY_PAL = {"Y": "#fff0a8", "y": "#ffd45e", "o": "#f7a940", "O": "#c76f22",
           "M": "#fbf3d5", "m": "#e1d6a8", "k": "#b9ab7c", "K": "#7a704f",
           "C": "#ffffff", "c": "#e6eef7", "u": "#c3d2e4", "U": "#93a6c0",
           "D": "#a9b1c2", "d": "#8a93a8", "e": "#6c7489", "E": "#434a5c",
           "b": "#9cccf2", "B": "#5e98d0",
           "1": "#f08a8a", "2": "#f6b26b", "3": "#f7de74", "4": "#9ed28a",
           "5": "#8ab8e6", "6": "#b49be0"}
SKY_OUT = {"Y": "O", "y": "O", "o": "O", "M": "K", "m": "K", "k": "K",
           "C": "U", "c": "U", "u": "U", "D": "E", "d": "E", "e": "E"}


def sun():
    g = canvas(16, 16)
    blobs_paint(g, [(8, 8, 4.6, 4.6)], "Y", "y", "o", (0, 0, 15, 15))
    for x, y in ((8, 1), (7, 1), (8, 14), (7, 14), (1, 7), (1, 8), (14, 7), (14, 8),
                 (3, 3), (12, 3), (3, 12), (12, 12)):
        g[y][x] = "y"
    return outline(g, SKY_OUT)


def moon():
    g = canvas(16, 16)
    disc = ellipse(8, 8, 6.5, 6.5)
    bite = ellipse(11.4, 7.2, 5.4, 5.4)
    for (x, y) in sorted(disc - bite):
        if x > 10 and y > 9:   # trim the thin lower tip
            continue
        lit = (x - 1, y) not in disc or (x, y - 1) not in disc
        g[y][x] = "M" if lit else "m"
    for x, y in ((4, 9), (6, 12), (5, 6)):
        if g[y][x] != ".":
            g[y][x] = "k"
    return outline(g, SKY_OUT)


def star():
    return to_grid([".m..", "mCm.", ".m..", "...."])


def cloud(dark):
    g = canvas(16, 16)
    cols = ("D", "d", "e") if dark else ("C", "c", "u")
    blobs_paint(g, [(5, 10, 3.8, 2.8), (8.5, 7.5, 4.2, 4), (12, 9.5, 3.2, 3), (8.5, 10.8, 6.5, 2.2)],
                cols[0], cols[1], cols[2], (1, 1, 14, 13))
    return outline(g, SKY_OUT)


def rain(frame):
    g = canvas(16, 16)
    for x0, y0 in ((2, 1), (10, 4), (6, 9), (13, 12), (1, 13)):
        y0 = (y0 + frame * 8) % 16
        for k in range(3):
            g[(y0 + k) % 16][(x0 - k // 2) % 16] = "b" if k else "B"
    return g


def rainbow():
    g = canvas(64, 32)
    for y in range(32):
        for x in range(64):
            d = ((x + 0.5 - 32) ** 2 + (y + 0.5 - 32) ** 2) ** 0.5
            band = int((30.5 - d) // 2)
            if 0 <= band < 6:
                g[y][x] = "123456"[band]
    return g


# ----------------------------------------------------------------------- fx --
FX_PAL = {"R": "#ee5a6f", "r": "#ffb3bf", "q": "#8c2338",
          "Y": "#ffe27a", "W": "#ffffff", "o": "#f2a93b",
          "n": "#3b2f4a", "N": "#6a5a80",
          "1": "#ee5a6f", "2": "#ffd04a", "3": "#5ec7a8", "4": "#7aa2e8", "5": "#c28be8"}
HEART = [".qq..qq.", "qrRqqRRq", "qRRRRRRq", "qRRRRRRq", ".qRRRRq.", "..qRRq..",
         "...qq...", "........"]
CONFETTI = [
    ["1.....3.", "1..2....", "......5.", ".4......", "....3...", "2.....1.", "...5..1.", "........"],
    ["...2....", "3.....4.", "3...1...", "......2.", ".5......", "...4..3.", "1.......", "1....5.."],
]
SPARKLE = [
    ["........", "........", "...Y....", "..YWY...", "...Y....", "........", "........", "........"],
    ["...Y....", "...Y....", "..YWY...", "YYWWWYY.", "..YWY...", "...Y....", "...Y....", "........"],
]
NOTE = ["...nnnn.", "...nNNn.", "...n..n.", "...n..n.", ".nnn.nnn", "nNNnnNNn",
        "nNnn.nnn", ".nn....."]


def sprites_v2():
    out = {}

    def add(name, grid, pal, mirrored=False):
        out[name] = (grid, pal)
        if mirrored:
            out[name + "-l"] = (mirror(grid), pal)

    for fam in FAMILIES:
        pal = dict(SHEEP_PAL, **fam_cols(fam))
        for i in range(4):
            add("sheep2-%s-walk%d" % (fam, i + 1), sheep2("walk", i), pal, True)
        for pose in ("graze1", "graze2", "sit", "sleep", "alert", "stuck"):
            add("sheep2-%s-%s" % (fam, pose), sheep2(pose), pal, True)
    lpal = dict(SHEEP_PAL, **fam_cols("other"))
    for i in range(2):
        add("sheep2-lamb-walk%d" % (i + 1), lamb(i), lpal, True)
    for fam in FAMILIES:
        pal = dict(DROVER_PAL, **fam_cols(fam))
        for i in range(2):
            add("drover2-%s-idle%d" % (fam, i + 1), drover2("idle", i), pal, True)
        for i in range(4):
            add("drover2-%s-walk%d" % (fam, i + 1), drover2("walk", i), pal, True)
        for pose in ("read", "think", "lean", "doze", "whistle"):
            add("drover2-%s-%s" % (fam, pose), drover2(pose), pal, True)
    add("dog2-sit", dog2("sit"), DOG_PAL, True)
    for i in range(4):
        add("dog2-run%d" % (i + 1), dog2("run", i), DOG_PAL, True)
    add("dog2-bark", dog2("bark"), DOG_PAL, True)
    add("dog2-wag1", dog2("wag", 0), DOG_PAL, True)
    add("dog2-wag2", dog2("wag", 1), DOG_PAL, True)
    for i in range(4):
        add("owl-fly%d" % (i + 1), owl("fly", i), OWL_PAL, True)
    add("owl-perch", owl("perch"), OWL_PAL, True)
    for k in ("h", "v", "ne", "nw", "se", "sw"):
        add("path-" + k, path_tile(k), DIRT)
    add("fence2-h", fence2("h"), WOOD)
    add("fence2-v", fence2("v"), WOOD)
    add("fence2-post", fence2("post"), WOOD)
    for w in SIGN_WIDTHS:
        add("sign-%d" % w, sign(w), WOOD)
    add("sign-wide", sign_wide(), WOOD)
    add("gate2-open", gate2(True), WOOD)
    add("gate2-closed", gate2(False), WOOD)
    add("tree", tree(), TREE_PAL)
    add("bush", bush(), BUSH_PAL)
    add("pond", pond(), POND_PAL)
    add("rock", rock(), STONE)
    add("hills", hills(), HILL_PAL)
    add("barn2-closed", barn2(False), BARN_PAL)
    add("barn2-open", barn2(True), BARN_PAL)
    add("barn2-window-lit", barn_window_lit(), BARN_PAL)
    add("hay", hay(), HAY_PAL)
    for i, art in enumerate(SMOKE):
        add("smoke%d" % (i + 1), outline(to_grid(art), SMOKE_OUT), SMOKE_PAL)
    add("sun", sun(), SKY_PAL)
    add("moon", moon(), SKY_PAL)
    add("star", star(), SKY_PAL)
    add("cloud", cloud(False), SKY_PAL)
    add("cloud-dark", cloud(True), SKY_PAL)
    add("rain1", rain(0), SKY_PAL)
    add("rain2", rain(1), SKY_PAL)
    add("rainbow", rainbow(), SKY_PAL)
    add("heart", to_grid(HEART), FX_PAL)
    add("confetti1", to_grid(CONFETTI[0]), FX_PAL)
    add("confetti2", to_grid(CONFETTI[1]), FX_PAL)
    add("sparkle1", to_grid(SPARKLE[0]), FX_PAL)
    add("sparkle2", to_grid(SPARKLE[1]), FX_PAL)
    add("note", to_grid(NOTE), FX_PAL)
    return out


SIZES = {"sheep2-": (24, 24), "sheep2-lamb": (16, 16), "drover2-": (24, 32), "dog2-": (24, 18),
         "owl-": (16, 16), "path-": (16, 16), "fence2-": (16, 16), "gate2-": (16, 16),
         "tree": (32, 40), "bush": (16, 12), "pond": (48, 24), "rock": (12, 8),
         "hills": (256, 40), "barn2-window": (8, 8), "barn2-": (64, 56), "hay": (12, 10),
         "sign-32": (32, 18), "sign-48": (48, 18), "sign-64": (64, 18), "sign-wide": (96, 32),
         "smoke": (8, 12), "sun": (16, 16), "moon": (16, 16), "star": (4, 4),
         "cloud": (16, 16), "rain": (16, 16), "rainbow": (64, 32), "heart": (8, 8),
         "confetti": (8, 8), "sparkle": (8, 8), "note": (8, 8)}


def check_size(name, grid):
    best = max((k for k in SIZES if name.startswith(k)), key=len)
    assert (len(grid[0]), len(grid)) == SIZES[best], (name, len(grid[0]), len(grid))


def preview_groups(v1, v2):
    """(title, names, background class) for the preview page."""
    groups = []
    for fam in FAMILIES:
        groups.append(("Sheep: " + fam, [n for n in v2 if n.startswith("sheep2-%s-" % fam)], "grass"))
    groups.append(("Lamb", [n for n in v2 if n.startswith("sheep2-lamb")], "grass"))
    for fam in FAMILIES:
        groups.append(("Drover: " + fam, [n for n in v2 if n.startswith("drover2-%s-" % fam)], "grass"))
    groups.append(("Dog", [n for n in v2 if n.startswith("dog2-")], "grass"))
    groups.append(("Owl", [n for n in v2 if n.startswith("owl-")], "grass"))
    scen = ("path-", "fence2-", "gate2-", "sign-", "tree", "bush", "pond", "rock", "barn2", "hay", "smoke")
    groups.append(("Scenery", [n for n in v2 if n.startswith(scen)], "grass"))
    groups.append(("Hills", ["hills"], "sky"))
    groups.append(("Sky", [n for n in v2 if n.startswith(("sun", "moon", "star", "cloud", "rain"))], "sky"))
    groups.append(("FX", [n for n in v2 if n.startswith(("heart", "confetti", "sparkle", "note"))]
                   + ["bubble-alert", "zzz"], "grass"))
    groups.append(("v1 (still used: grass, flower)", [n for n in v1 if n not in ("bubble-alert", "zzz")], "grass"))
    return groups


def preview_anims():
    anims = []
    for fam in FAMILIES:
        anims.append(("sheep2-%s walk" % fam, ["sheep2-%s-walk%d" % (fam, i) for i in range(1, 5)], 600, True))
    anims.append(("lamb walk", ["sheep2-lamb-walk1", "sheep2-lamb-walk2"], 300, True))
    for fam in FAMILIES:
        anims.append(("drover2-%s walk" % fam, ["drover2-%s-walk%d" % (fam, i) for i in range(1, 5)], 700, True))
    anims.append(("drover2 idle", ["drover2-anthropic-idle1", "drover2-anthropic-idle2"], 1200, False))
    anims.append(("dog2 run", ["dog2-run%d" % i for i in range(1, 5)], 400, True))
    anims.append(("dog2 wag", ["dog2-wag1", "dog2-wag2"], 300, False))
    anims.append(("owl fly", ["owl-fly%d" % i for i in range(1, 5)], 500, True))
    anims.append(("sheep2 graze", ["sheep2-google-graze1", "sheep2-google-graze2"], 800, False))
    anims.append(("smoke", ["smoke1", "smoke2", "smoke3"], 900, False))
    anims.append(("rain", ["rain1", "rain2"], 300, False))
    anims.append(("confetti", ["confetti1", "confetti2"], 300, False))
    anims.append(("sparkle", ["sparkle1", "sparkle2"], 400, False))
    return anims


def write_preview(allsp, v1names, v2names):
    def dims(name):
        art = allsp[name][0]
        grid = art if isinstance(art[0], list) else to_grid(art)
        return len(grid[0]), len(grid)

    css = [
        "body{background:#7cbf56;font:12px monospace;color:#1f2a16;margin:16px}",
        "h2{font-size:13px;margin:18px 0 6px}",
        ".g{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}",
        "figure{margin:0}figcaption{font-size:10px}",
        ".s{padding:4px;display:inline-block}.grass .s{background:#7cbf56}",
        ".sky .s{background:#9fd8f2}",
        "img,.a{image-rendering:pixelated;display:block}",
        ".a{background-size:100% 100%}",
        ".lane{position:relative;width:420px;background:#86c65e}",
        ".lane .a{position:relative;animation-iteration-count:infinite}",
        "@keyframes walk{from{left:0}to{left:calc(100% - var(--w))}}",
        "#night{position:fixed;inset:0;background:rgba(24,34,92,.5);pointer-events:none;display:none}",
        "body.night #night{display:block}",
        "body.night{color:#dde4ff}",
    ]
    body = ['<p>4x pixelated. <a href="#day" onclick="location.hash=\'day\';location.reload()">day</a> / '
            '<a href="#night" onclick="location.hash=\'night\';location.reload()">night</a> '
            '(night = translucent blue overlay, as in the mod)</p>', "<h2>Animated</h2>",
            '<div class="g">']
    for idx, (title, frames, ms, moving) in enumerate(preview_anims()):
        w, h = dims(frames[0])
        n = len(frames)
        kf = "".join("%g%%{background-image:url(%s.svg)}" % (100.0 * i / n, f)
                     for i, f in enumerate(frames))
        css.append("@keyframes a%d{%s}" % (idx, kf))
        anim = "a%d %dms steps(1) infinite" % (idx, ms)
        style = "width:%dpx;height:%dpx;--w:%dpx;background-image:url(%s.svg);animation:%s" % (
            (w + 2) * 4, (h + 2) * 4, (w + 2) * 4, frames[0], anim)
        if moving:
            style += ",walk %dms linear infinite alternate" % (ms * 8)
        body.append('<figure><div class="lane"><div class="a" style="%s"></div></div>'
                    '<figcaption>%s</figcaption></figure>' % (style, title))
    body.append("</div>")
    for title, names, bg in preview_groups(v1names, v2names):
        body.append('<h2>%s</h2><div class="g %s">' % (title, bg))
        for name in names:
            w, h = dims(name)
            body.append('<figure><div class="s"><img src="%s.svg" width="%d" height="%d"></div>'
                        '<figcaption>%s <small>%dx%d</small></figcaption></figure>'
                        % (name, (w + 2) * 4, (h + 2) * 4, name, w, h))
        body.append("</div>")
    page = ('<!doctype html>\n<meta charset="utf-8"><title>Pasture sprites</title>\n'
            "<style>" + "\n".join(css) + "</style>\n"
            "<body>\n" + "\n".join(body) + '\n<div id="night"></div>\n'
            "<script>if(location.hash=='#night')document.body.classList.add('night')</script>\n")
    with open(os.path.join(HERE, "preview.html"), "w", newline="\n") as f:
        f.write(page)


def main():
    v1 = sprites()
    v2 = sprites_v2()
    assert not set(v1) & set(v2)
    for name, (grid, _) in v2.items():
        check_size(name, grid)
    allsp = dict(v1, **v2)
    for name, (art, cols) in allsp.items():
        grid = art if isinstance(art[0], list) else to_grid(art)
        w = len(grid[0])
        assert all(len(r) == w for r in grid), name
        with open(os.path.join(HERE, name + ".svg"), "w", newline="\n") as f:
            f.write(svg(grid, cols))
    write_preview(allsp, list(v1), list(v2))


if __name__ == "__main__":
    main()
