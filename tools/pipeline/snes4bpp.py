#!/usr/bin/env python3
"""Encode 8x8 palette-index grids into SNES 4bpp planar tile data.

A 4bpp tile is 32 bytes and is NOT stored as one plane after another. The
first 16 bytes interleave bitplanes 0 and 1 row by row, then the second 16
bytes interleave bitplanes 2 and 3 the same way:

    byte  0 = row 0, plane 0      byte 16 = row 0, plane 2
    byte  1 = row 0, plane 1      byte 17 = row 0, plane 3
    byte  2 = row 1, plane 0      byte 18 = row 1, plane 2
    ...                           ...

Getting that order wrong does not fail loudly -- it draws a recognisable but
wrong tile, usually the right shape in the wrong colours -- so it is written
once, here, and every UI tile goes through it.

Grids are given as 8 strings of 8 characters, one hex digit per pixel, where
the digit is the palette index (0 = transparent). '.' is accepted as a more
readable spelling of 0.
"""

TILE = 8
TILE_BYTES = 32


def encode_tile(rows):
    """8 strings of 8 hex digits ('.' == 0) -> 32 bytes of SNES 4bpp planar."""
    if len(rows) != TILE:
        raise ValueError("a tile needs %d rows, got %d" % (TILE, len(rows)))

    pixels = []
    for y, row in enumerate(rows):
        if len(row) != TILE:
            raise ValueError("row %d is %d wide, want %d: %r" % (y, len(row), TILE, row))
        out = []
        for ch in row:
            value = 0 if ch == "." else int(ch, 16)
            if not 0 <= value <= 15:
                raise ValueError("pixel %r out of range in %r" % (ch, row))
            out.append(value)
        pixels.append(out)

    data = bytearray(TILE_BYTES)
    for y in range(TILE):
        for plane in range(4):
            bits = 0
            for x in range(TILE):
                if pixels[y][x] >> plane & 1:
                    bits |= 0x80 >> x
            # planes 0,1 live in bytes 0..15; planes 2,3 in bytes 16..31
            data[(plane >> 1) * 16 + y * 2 + (plane & 1)] = bits
    return bytes(data)


def encode_tiles(grids):
    """Concatenate encode_tile over an iterable of grids."""
    out = bytearray()
    for grid in grids:
        out += encode_tile(grid)
    return bytes(out)


def c_array(data, indent="    ", per_line=8):
    """Format bytes as C initialiser rows, 8 bytes to a line."""
    lines = []
    for start in range(0, len(data), per_line):
        chunk = data[start:start + per_line]
        lines.append(indent + ", ".join("0x%02X" % b for b in chunk) + ",")
    return "\n".join(lines)
