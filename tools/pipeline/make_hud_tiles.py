#!/usr/bin/env python3
"""Build the entire HUD tileset: rom/res/hud_font.bmp + rom/src/hud_tiles.h.

Everything BG2 ever draws comes out of this one image, converted by a single
gfx4snes call in tools/wsl_build_rom.sh and loaded by one bgInitTileSet():

    tile   0 ..  95   text font, transparent, 1px drop shadow
    tile  96 .. 191   the same glyphs on an opaque plate (the chyron)
    tile 192 .. 343   display type, 16x16, four tiles each
    tile 344 .. 383   display digits on the plate (the round clock)
    tile 384 .. 401   approval bar segments
    tile 402 .. 406   plate, pips

One image rather than a font plus a separate .incbin blob, because a
`superfree` section lands in whatever bank the linker likes and dmaCopyVram
takes a near pointer -- loading a blob would mean going through the far-DMA
path that streams fighter frames. A single tileset sidesteps that completely.

The build must pass gfx4snes -R (no tile reduction). This set contains genuine
duplicates -- blank quadrants of display glyphs, the plated space and the
solid plate -- and a dedupe would silently renumber every tile after the first
collision, pointing every #define below at the wrong art.

----------------------------------------------------------------------------
The palette convention
----------------------------------------------------------------------------
Every tile is drawn against ONE set of palette indices, and all seven UI
palettes in ui.h agree on what they mean:

    0  transparent
    1  primary light   text, top half of display type, bar highlight
    2  ink             outlines and shadows, identical in every palette
    3  primary dark    bottom half of display type, bar body
    4  flash           the chip trail, emphasis
    5  panel dark      plate fill, empty bar slot
    6  panel mid
    7  panel lit       plate top bevel

So one tile renders in Trump orange, Carney teal, gold, green, yellow or red
purely by changing the palette number in the tilemap entry. Nothing is drawn
twice in different colours.

    python tools/pipeline/make_hud_tiles.py
"""

from pathlib import Path

from PIL import Image

from make_hud_font import GLYPHS
from snes4bpp import encode_tile

ROOT = Path(__file__).resolve().parents[2]
OUT_BMP = ROOT / "rom" / "res" / "hud_font.bmp"
OUT_H = ROOT / "rom" / "src" / "hud_tiles.h"

TILE = 8
FONT_TILES = 96

CLEAR = "."
LIGHT = "1"
INK = "2"
DARK = "3"
FLASH = "4"
PANEL = "5"
PANEL_MID = "6"
PANEL_LIT = "7"

# Adding a character here costs 4 tiles and nothing else.
BIG_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!"

BAR_LEVELS = 9  # 0..8 pixels of fill in an 8-wide segment

# The BMP palette is only ever read for its indices -- ui.h supplies the real
# colours at runtime -- but the entries must be distinct or a converter is
# free to merge them.
BMP_PALETTE = [
    (255, 0, 255),    # 0 transparent
    (255, 255, 255),  # 1 light
    (16, 16, 24),     # 2 ink
    (128, 128, 128),  # 3 dark
    (255, 255, 198),  # 4 flash
    (49, 49, 82),     # 5 panel dark
    (82, 82, 132),    # 6 panel mid
    (132, 132, 181),  # 7 panel lit
]


def shadowed_glyph(rows):
    """Body text: the glyph in `light` with a 1px ink shadow down-right.

    Without it, white text sits directly on the pale sky and ice of the Lake
    America stage and the strokes disappear. A full outline needs a clear
    pixel all round and these letterforms are 7x7 in an 8x8 cell, so there is
    no room for one; the offset shadow fits because column 7 is always empty.
    """
    cell = [[CLEAR] * TILE for _ in range(TILE)]
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "#" and y + 1 < TILE and x + 1 < TILE:
                cell[y + 1][x + 1] = INK
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "#":
                cell[y][x] = LIGHT
    return ["".join(r) for r in cell]


def plated_glyph(rows):
    """The same glyph over a solid plate, so HUD text sits on the chyron."""
    cell = [[PANEL] * TILE for _ in range(TILE)]
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "#" and y + 1 < TILE and x + 1 < TILE:
                cell[y + 1][x + 1] = INK
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "#":
                cell[y][x] = LIGHT
    return ["".join(r) for r in cell]


def big_glyph(rows, background=CLEAR):
    """16x16: the 7x7 glyph doubled to 14x14, inset by 1, outlined in ink.

    7 x 2 = 14, plus one pixel of outline each side, is exactly 16 -- which is
    why the display font is a scale of the text font rather than a second
    hand-drawn alphabet. The top half of every stroke is the palette's light
    colour and the bottom half its dark one, so the type carries the same
    metallic gradient in gold, orange or teal without being redrawn.

    `background` is transparent for banners, which float over the stage, and
    the panel colour for the round clock, which sits inside the chyron -- a
    transparent clock would show sky through the counters of its own digits
    and read as a hole in the plate.
    """
    size = 16
    cell = [[background] * size for _ in range(size)]

    for y in range(7):
        for x in range(7):
            if rows[y][x] != "#":
                continue
            for dy in range(2):
                for dx in range(2):
                    py = 1 + y * 2 + dy
                    px = 1 + x * 2 + dx
                    cell[py][px] = LIGHT if py < 8 else DARK

    filled = {(y, x) for y in range(size) for x in range(size)
              if cell[y][x] in (LIGHT, DARK)}
    for y in range(size):
        for x in range(size):
            if cell[y][x] != background:
                continue
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if (y + dy, x + dx) in filled:
                        cell[y][x] = INK
                        break
                else:
                    continue
                break

    rows16 = ["".join(r) for r in cell]
    # Quadrant order must match ui_big_text(): TL, TR, BL, BR.
    return [
        [rows16[y][0:8] for y in range(0, 8)],
        [rows16[y][8:16] for y in range(0, 8)],
        [rows16[y][0:8] for y in range(8, 16)],
        [rows16[y][8:16] for y in range(8, 16)],
    ]


def bar_tile(level, ghost):
    """One 8px slice of the approval bar with `level` of 8 pixels filled.

    The bar is 12 tiles of 8 pixels = 96 px against 96 HP, so it is exactly
    one pixel per hit point and nothing rounds anywhere.

    The unfilled part is either the empty slot colour or the flash colour --
    that second variant is the chip trail, the approval a fighter has lost but
    not yet visibly conceded. Player 2's bar is these same tiles with the
    tilemap's hflip bit set, so it drains inward from the right without a
    mirrored copy of any of them.
    """
    back = FLASH if ghost else PANEL
    rows = []
    for y in range(TILE):
        if y == 0 or y == TILE - 1:
            rows.append(INK * TILE)
            continue
        body = LIGHT if y <= 2 else DARK
        rows.append("".join(body if x < level else back for x in range(TILE)))
    return rows


def build():
    tiles = []
    names = {}

    def add(name, grids):
        names[name] = len(tiles)
        tiles.extend(grids)

    add("UI_T_FONT", [shadowed_glyph(GLYPHS[chr(32 + i)])
                      for i in range(FONT_TILES)])
    add("UI_T_PLATED", [plated_glyph(GLYPHS[chr(32 + i)])
                        for i in range(FONT_TILES)])

    big = []
    for ch in BIG_CHARS:
        big.extend(big_glyph(GLYPHS[ch]))
    add("UI_T_BIG", big)

    plated_digits = []
    for ch in "0123456789":
        plated_digits.extend(big_glyph(GLYPHS[ch], background=PANEL))
    add("UI_T_BIGP", plated_digits)

    bars = []
    for ghost in (0, 1):
        for level in range(BAR_LEVELS):
            bars.append(bar_tile(level, ghost))
    add("UI_T_BAR", bars)

    add("UI_T_PLATE", [[PANEL * TILE] * TILE])
    add("UI_T_PLATE_TOP", [[PANEL_LIT * TILE] + [PANEL * TILE] * 7])
    add("UI_T_PLATE_BOT", [[PANEL * TILE] * 7 + [INK * TILE]])
    add("UI_T_PIP_ON", [[
        "...22...", "..2112..", ".211112.", "21111112",
        "21111112", ".211112.", "..2112..", "...22...",
    ]])
    add("UI_T_PIP_OFF", [[
        "...22...", "..2..2..", ".2....2.", "2......2",
        "2......2", ".2....2.", "..2..2..", "...22...",
    ]])

    # gfx4snes pads the output to a whole 16-tile name-table row, so pad here
    # too. Without this the build's size assertion compares 407 tiles against
    # a 416-tile .pic and fails on a difference that is only padding.
    while len(tiles) % 16:
        tiles.append([CLEAR * TILE] * TILE)

    # ---- image ----------------------------------------------------------
    image = Image.new("P", (len(tiles) * TILE, TILE), 0)
    flat = []
    for entry in BMP_PALETTE:
        flat.extend(entry)
    flat.extend([0, 0, 0] * (256 - len(BMP_PALETTE)))
    image.putpalette(flat)

    pixels = image.load()
    for index, grid in enumerate(tiles):
        for y in range(TILE):
            for x in range(TILE):
                ch = grid[y][x]
                pixels[index * TILE + x, y] = 0 if ch == "." else int(ch, 16)

    OUT_BMP.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT_BMP)

    # Encode once as well, purely to assert the tiles are legal 4bpp and to
    # report the real VRAM cost.
    nbytes = len(b"".join(encode_tile(g) for g in tiles))

    # ---- header ---------------------------------------------------------
    lines = [
        "/* AUTO-GENERATED by tools/pipeline/make_hud_tiles.py -- do not edit */",
        "#ifndef BATTLEFI_HUD_TILES_H",
        "#define BATTLEFI_HUD_TILES_H",
        "",
        "/* Tile numbers into BG2's tileset (res/hud_font.bmp). */",
        "",
        "#define UI_TILE_COUNT %d" % len(tiles),
        "#define UI_TILES_BYTES %d" % nbytes,
        "#define UI_BIG_CHARS %d" % len(BIG_CHARS),
        "#define UI_BAR_LEVELS %d" % BAR_LEVELS,
        "#define UI_BAR_TILES 12",
        "",
    ]
    for name in ("UI_T_FONT", "UI_T_PLATED", "UI_T_BIG", "UI_T_BIGP",
                 "UI_T_BAR", "UI_T_PLATE", "UI_T_PLATE_TOP",
                 "UI_T_PLATE_BOT", "UI_T_PIP_ON", "UI_T_PIP_OFF"):
        lines.append("#define %-18s %d" % (name, names[name]))
    lines += [
        "",
        "/* Chip-trail segments follow the solid ones. */",
        "#define UI_T_BAR_GHOST (UI_T_BAR + UI_BAR_LEVELS)",
        "",
        "#endif",
        "",
    ]
    OUT_H.write_text("\n".join(lines), encoding="utf-8")

    print("wrote %s (%d tiles, %dx%d)" % (OUT_BMP, len(tiles),
                                          image.width, image.height))
    print("wrote %s" % OUT_H)
    print("tileset: %d bytes = %d VRAM words, 0x4000..0x%04X"
          % (nbytes, nbytes // 2, 0x4000 + nbytes // 2))


if __name__ == "__main__":
    build()
