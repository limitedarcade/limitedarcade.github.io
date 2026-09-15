"""Color Bible loaders and BGR555 helpers."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
BIBLE_DIR = ROOT / "docs" / "color-bible"
ROWS_DIR = BIBLE_DIR / "rows"
SWATCH_DIR = BIBLE_DIR / "swatches"
MASTER_PATH = BIBLE_DIR / "master.palette.json"


def snes5_to_8(v: int) -> int:
    """Expand 0-31 channel to 0-255 preview (SNES-style bit replication)."""
    v = max(0, min(31, int(v)))
    return (v << 3) | (v >> 2)


def pack_bgr555(r: int, g: int, b: int) -> int:
    return ((b & 31) << 10) | ((g & 31) << 5) | (r & 31)


def unpack_bgr555(word: int) -> tuple[int, int, int]:
    return word & 31, (word >> 5) & 31, (word >> 10) & 31


def rgb8_to_snes5(r8: int, g8: int, b8: int) -> tuple[int, int, int]:
    return round(r8 / 255 * 31), round(g8 / 255 * 31), round(b8 / 255 * 31)


def color_hex(r: int, g: int, b: int) -> str:
    return f"#{snes5_to_8(r):02X}{snes5_to_8(g):02X}{snes5_to_8(b):02X}"


def load_row(row_id: str | Path) -> dict:
    path = Path(row_id)
    if not path.suffix:
        path = ROWS_DIR / f"{row_id}.json"
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if len(data.get("colors", [])) != 16:
        raise ValueError(f"{path} must contain exactly 16 colors")
    return data


def iter_rows() -> Iterable[dict]:
    for path in sorted(ROWS_DIR.glob("*.json")):
        yield load_row(path)


def row_rgb8(row: dict) -> list[tuple[int, int, int]]:
    out = []
    for c in row["colors"]:
        out.append((snes5_to_8(c["r"]), snes5_to_8(c["g"]), snes5_to_8(c["b"])))
    return out


def build_master() -> dict:
    colors = {}
    rows_index = {}
    for row in iter_rows():
        rows_index[row["id"]] = {
            "usage": row.get("usage"),
            "description": row.get("description", ""),
            "bgr555": [pack_bgr555(c["r"], c["g"], c["b"]) for c in row["colors"]],
            "names": [c["name"] for c in row["colors"]],
        }
        for c in row["colors"]:
            colors[c["name"]] = {
                "r": c["r"],
                "g": c["g"],
                "b": c["b"],
                "hex": c.get("hex") or color_hex(c["r"], c["g"], c["b"]),
                "bgr555": pack_bgr555(c["r"], c["g"], c["b"]),
                "row": row["id"],
            }
    return {
        "format": "emberveil-color-bible-master-v1",
        "note": "r/g/b are SNES 0-31. hex is 8-bit preview only.",
        "rows": rows_index,
        "colors": colors,
    }


def write_master() -> Path:
    master = build_master()
    MASTER_PATH.write_text(json.dumps(master, indent=2) + "\n", encoding="utf-8")
    return MASTER_PATH
