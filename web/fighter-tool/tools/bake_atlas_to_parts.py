"""Transfer a textured GLB's baked albedo onto a semantically-split GLB.

Hitem3D exports the same sculpt twice: once merged with UVs + an 8K atlas, once
split into named parts carrying only a flat segmentation tint. Neither is usable
alone. This walks every vertex of the split mesh to its nearest vertex on the
textured mesh and takes that vertex's atlas colour, producing one multipart GLB
that has both the anatomy and the paint.

The two meshes are independently tessellated but describe the same surface, so
nearest-vertex is sub-millimetre accurate; the script asserts that rather than
assuming it.

    python tools/bake_atlas_to_parts.py <textured.glb> <parts.glb> <out.glb>
"""
import io
import json
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import glb_io

Image.MAX_IMAGE_PIXELS = None

# Vertices further than this from the textured surface (as a fraction of figure
# height) get flagged; a clean pair sits three orders of magnitude below it.
MATCH_TOLERANCE = 0.01


def srgb_to_linear(c):
    c = c.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def base_colour_image(path):
    gj, bn = glb_io.read(path)
    mat = gj['materials'][0]['pbrMetallicRoughness']
    tex = gj['textures'][mat['baseColorTexture']['index']]
    img = gj['images'][tex['source']]
    bv = gj['bufferViews'][img['bufferView']]
    off = bv.get('byteOffset', 0)
    return np.asarray(Image.open(io.BytesIO(bn[off:off + bv['byteLength']])).convert('RGB'))


class Grid:
    """Uniform spatial hash for nearest-vertex queries."""

    def __init__(self, P, cell):
        self.P, self.h = P, np.float32(cell)
        self.lo = P.min(0) - cell
        self.dims = np.ceil((P.max(0) + cell - self.lo) / cell).astype(np.int64)
        f = self._flat(self._cell(P))
        self.order = np.argsort(f, kind='stable')
        self.keys, self.start, self.count = np.unique(f[self.order],
                                                      return_index=True, return_counts=True)

    def _cell(self, P):
        return np.floor((P - self.lo) / self.h).astype(np.int64)

    def _flat(self, c):
        return (c[:, 0] * self.dims[1] + c[:, 1]) * self.dims[2] + c[:, 2]

    def nearest(self, Q, ring=1, cap=32):
        cq = self._cell(Q)
        best = np.full(len(Q), np.inf, np.float32)
        idx = np.zeros(len(Q), np.int64)
        ar = np.arange(cap)
        rng = range(-ring, ring + 1)
        for di in rng:
            for dj in rng:
                for dk in rng:
                    cc = cq + np.array([di, dj, dk])
                    ok = np.all((cc >= 0) & (cc < self.dims), axis=1)
                    fq = np.where(ok, self._flat(cc), -1)
                    pos = np.clip(np.searchsorted(self.keys, fq), 0, len(self.keys) - 1)
                    hit = ok & (self.keys[pos] == fq)
                    st, cn = self.start[pos], np.minimum(self.count[pos], cap)
                    cand = st[:, None] + ar[None, :]
                    mask = hit[:, None] & (ar[None, :] < cn[:, None])
                    vi = self.order[np.where(mask, cand, 0)]
                    d = np.where(mask, ((self.P[vi] - Q[:, None, :]) ** 2).sum(-1), np.inf)
                    k = d.argmin(1)
                    dm = d[np.arange(len(Q)), k]
                    take = dm < best
                    best = np.where(take, dm, best)
                    idx = np.where(take, vi[np.arange(len(Q)), k], idx)
        return idx, np.sqrt(best)


def main(tex_glb, parts_glb, out_glb):
    print(f'reading textured mesh  {tex_glb}')
    tex_parts = glb_io.parts(tex_glb)
    src = max(tex_parts, key=lambda p: len(p['V']))
    atlas = base_colour_image(tex_glb)
    H, W, _ = atlas.shape
    print(f'  {len(src["V"]):,} verts, atlas {W}x{H}')

    # glTF UV origin is top-left: sample straight, no v-flip.
    u = np.clip((src['UV'][:, 0] * (W - 1)).astype(np.int32), 0, W - 1)
    v = np.clip((src['UV'][:, 1] * (H - 1)).astype(np.int32), 0, H - 1)
    src_rgb = atlas[v, u]

    print(f'reading part mesh      {parts_glb}')
    dst = glb_io.parts(parts_glb)
    height = max(p['V'][:, 1].max() for p in dst) - min(p['V'][:, 1].min() for p in dst)
    print(f'  {len(dst)} parts: ' + ', '.join(f'{p["name"]}({len(p["V"]):,})' for p in dst))

    # Splitting the sculpt into parts capped each cut, so a part carries interior
    # surface the merged textured mesh has no counterpart for -- measured up to
    # 341 mm inside the torso. Those vertices are never visible, so they take the
    # nearest exterior colour; what matters is that the search always terminates.
    # A per-vertex brute-force fallback is O(unmatched x |src|) and does not
    # finish at this size -- escalate grid coarseness instead.
    grids = [(Grid(src['V'], 0.002), 1, 32),
             (Grid(src['V'], 0.02), 1, 256),
             (Grid(src['V'], 0.08), 2, 1024)]
    report = []
    for p in dst:
        idx = np.zeros(len(p['V']), np.int64)
        dist = np.full(len(p['V']), np.inf, np.float32)
        for grid, ring, cap in grids:
            far = ~np.isfinite(dist)
            if not far.any():
                break
            i2, d2 = grid.nearest(p['V'][far], ring=ring, cap=cap)
            idx[far], dist[far] = i2, d2
        unmatched = int((~np.isfinite(dist)).sum())
        if unmatched:
            raise SystemExit(f'{p["name"]}: {unmatched} vertices found no source colour')
        rel = dist / height
        interior = int((rel * 1900 > 5.0).sum())
        p['C'] = srgb_to_linear(src_rgb[idx])
        p['UV'] = None
        report.append({'part': p['name'], 'verts': int(len(p['V'])),
                       'medianMm': round(float(np.median(rel)) * 1900, 3),
                       'p99Mm': round(float(np.percentile(rel, 99)) * 1900, 3),
                       'interiorVerts': interior,
                       'interiorPct': round(interior / len(p['V']) * 100, 2)})
        r = report[-1]
        print(f'  {r["part"]:<10} median {r["medianMm"]:>6.2f} mm   '
              f'p99 {r["p99Mm"]:>7.2f} mm   interior {r["interiorPct"]:>5.2f}%')

    glb_io.write(out_glb, dst)
    tris = sum(len(p['I']) // 3 for p in dst)
    print(f'wrote {out_glb}  ({len(dst)} parts, {tris:,} tris)')
    json.dump({'kind': 'atlas-bake-report', 'source': tex_glb, 'target': parts_glb,
               'out': out_glb, 'scaleReferenceHeightM': 1.9, 'parts': report},
              open(out_glb.rsplit('.', 1)[0] + '-bake.json', 'w'), indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:4])
