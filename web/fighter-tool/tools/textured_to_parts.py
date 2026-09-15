"""Turn one textured GLB into the six named painted parts the rest of the
pipeline expects.

Hitem3D's two-file export is still the more accurate cut — the generator's own
part planes. This path exists so a single atlas mesh (or a six-part mesh that
already carries UVs) can enter the same bake → decimate → rig → encode chain.

    python tools/textured_to_parts.py <in.glb> <out.glb>
"""
from __future__ import annotations

import io
import json
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import glb_io

Image.MAX_IMAGE_PIXELS = None

PART_NAMES = ['Head', 'Torso', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg']


def srgb_to_linear(c):
    c = c.astype(np.float32) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(np.float32)


def quat_mat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ], dtype=np.float64)


def local_matrix(node):
    T = np.eye(4, dtype=np.float64)
    if 'matrix' in node:
        return np.array(node['matrix'], dtype=np.float64).reshape(4, 4, order='F')
    t = node.get('translation', [0, 0, 0])
    s = node.get('scale', [1, 1, 1])
    T[0, 0], T[1, 1], T[2, 2] = s
    T[0, 3], T[1, 3], T[2, 3] = t
    if 'rotation' in node:
        R = quat_mat(node['rotation'])
        S = np.diag(list(s))
        T[:3, :3] = R @ S
        T[0, 3], T[1, 3], T[2, 3] = t
    return T


def world_matrices(gj):
    nodes = gj.get('nodes') or []
    n = len(nodes)
    children = [[] for _ in range(n)]
    parent = [-1] * n
    for i, node in enumerate(nodes):
        for c in node.get('children') or []:
            children[i].append(c)
            parent[c] = i
    local = [local_matrix(node) for node in nodes]
    world = [np.eye(4) for _ in range(n)]

    def visit(i, parent_m):
        world[i] = parent_m @ local[i]
        for c in children[i]:
            visit(c, world[i])

    for i, p in enumerate(parent):
        if p < 0:
            visit(i, np.eye(4))
    return world


def load_image(gj, bn, image_index):
    img = gj['images'][image_index]
    bv = gj['bufferViews'][img['bufferView']]
    off = bv.get('byteOffset', 0)
    return np.asarray(Image.open(io.BytesIO(bn[off:off + bv['byteLength']])).convert('RGB'))


def mesh_albedo(gj, bn, mesh, cache):
    prim = mesh['primitives'][0]
    mat_i = prim.get('material')
    if mat_i is None:
        return None
    mat = gj['materials'][mat_i]
    pbr = mat.get('pbrMetallicRoughness') or {}
    tex = pbr.get('baseColorTexture')
    if not tex:
        return None
    tex_i = gj['textures'][tex['index']]['source']
    if tex_i not in cache:
        cache[tex_i] = load_image(gj, bn, tex_i)
    return cache[tex_i]


def sample_atlas(uv, atlas):
    h, w, _ = atlas.shape
    u = np.mod(uv[:, 0], 1.0)
    v = np.mod(uv[:, 1], 1.0)
    ui = np.clip((u * (w - 1)).astype(np.int32), 0, w - 1)
    vi = np.clip((v * (h - 1)).astype(np.int32), 0, h - 1)
    return srgb_to_linear(atlas[vi, ui])


def as_rgb(C):
    if C is None:
        return None
    C = np.asarray(C)
    if C.ndim == 1:
        return None
    if C.shape[1] >= 3:
        rgb = C[:, :3].astype(np.float32)
        if rgb.max() > 1.5:
            rgb = srgb_to_linear((rgb * (255.0 / rgb.max())).clip(0, 255))
        return rgb
    return None


def gather_mesh(path):
    gj, bn = glb_io.read(path)
    worlds = world_matrices(gj)
    cache = {}
    chunks = []
    for i, node in enumerate(gj.get('nodes') or []):
        if 'mesh' not in node:
            continue
        mesh = gj['meshes'][node['mesh']]
        prim = mesh['primitives'][0]
        at = prim['attributes']
        V = glb_io.accessor(gj, bn, at['POSITION']).astype(np.float32)
        if V.ndim == 1:
            V = V.reshape(-1, 3)
        M = worlds[i]
        Vh = np.c_[V, np.ones((len(V), 1), np.float32)]
        V = (Vh @ M.T)[:, :3].astype(np.float32)
        N = None
        if 'NORMAL' in at:
            N = glb_io.accessor(gj, bn, at['NORMAL']).astype(np.float32)
            if N.ndim == 1:
                N = N.reshape(-1, 3)
            N = (N @ M[:3, :3].T).astype(np.float32)
        UV = None
        if 'TEXCOORD_0' in at:
            UV = glb_io.accessor(gj, bn, at['TEXCOORD_0']).astype(np.float32)
            if UV.ndim == 1:
                UV = UV.reshape(-1, 2)
        C = as_rgb(glb_io.accessor(gj, bn, at['COLOR_0']) if 'COLOR_0' in at else None)
        atlas = mesh_albedo(gj, bn, mesh, cache)
        if atlas is not None and UV is not None:
            C = sample_atlas(UV, atlas)
        I = glb_io.accessor(gj, bn, prim['indices']).astype(np.uint32).reshape(-1)
        name = node.get('name') or mesh.get('name') or f'mesh{node["mesh"]}'
        chunks.append({'name': name, 'V': V, 'N': N, 'C': C, 'I': I})
    if not chunks:
        raise SystemExit(f'{path} has no mesh nodes')
    return chunks, gj


def merge(chunks):
    Vs, Ns, Cs, Is = [], [], [], []
    off = 0
    for ch in chunks:
        Vs.append(ch['V'])
        if ch['N'] is not None:
            Ns.append(ch['N'])
        if ch['C'] is not None:
            Cs.append(ch['C'])
        Is.append(ch['I'] + off)
        off += len(ch['V'])
    V = np.concatenate(Vs, axis=0)
    N = np.concatenate(Ns, axis=0) if len(Ns) == len(chunks) else None
    C = np.concatenate(Cs, axis=0) if len(Cs) == len(chunks) else None
    I = np.concatenate(Is, axis=0)
    return V, N, C, I


def y_bins(V, n=56):
    y = V[:, 1]
    lo, hi = float(y.min()), float(y.max())
    H = max(hi - lo, 1e-6)
    mid = float(np.median(V[:, 0]))
    span = float(np.max(np.abs(V[:, 0] - mid)))
    out = []
    for i in range(n):
        a = lo + i * H / n
        b = lo + (i + 1) * H / n
        m = (y >= a) & (y < b) if i < n - 1 else (y >= a)
        if not np.any(m):
            out.append({'empty': True, 'frac': (i + 0.5) / n, 'y': (a + b) / 2})
            continue
        ax = np.abs(V[m, 0] - mid)
        inner = ax <= 0.22 * span
        inner_w = float(ax[inner].max() * 2) if np.any(inner) else 0.0
        out.append({
            'empty': False,
            'frac': (i + 0.5) / n,
            'y': (a + b) / 2,
            'maxAbsX': float(ax.max()),
            'p90AbsX': float(np.percentile(ax, 90)),
            'innerWidth': inner_w,
            'width': float(V[m, 0].max() - V[m, 0].min()),
        })
    return out, lo, hi, H, mid


def find_cuts(bins, lo, hi, H):
    filled = [b for b in bins if not b.get('empty')]
    span = max((b['maxAbsX'] for b in filled), default=0.25 * H)
    head_x = max(0.06 * H, 0.22 * span)

    # Caricatures in this pipeline are ~4.2 heads; the Hitem3D Head cut sits
    # near 76% of height. Search a window around that for the inner-column
    # minimum so a slightly longer neck still lands on the actual pinch.
    target = lo + 0.76 * H
    col = [b for b in filled if abs(b['y'] - target) <= 0.07 * H and b.get('innerWidth', 0) > 0]
    if col:
        neck = min(col, key=lambda b: b['innerWidth'])
        neck_y = neck['y']
        neck_how = f'inner-column pinch near 76% (width {neck["innerWidth"]:.4f})'
    else:
        neck_y = target
        neck_how = '76% of height'

    # T-pose arms are the slices whose |x| reaches most of the span.
    arm_bins = [b for b in filled if b['maxAbsX'] > 0.70 * span and 0.35 < b['frac'] < 0.90]
    if arm_bins:
        shoulder_bottom = min(b['y'] for b in arm_bins)
        shoulder_how = 'lowest wide-span slice'
    else:
        shoulder_bottom = lo + 0.62 * H
        shoulder_how = 'fallback 62% of height'

    # Squatting caricatures put the hip near half-height; a two-leg gap does
    # not exist on overlapping thighs.
    hip_y = lo + 0.50 * H
    hip_how = '50% of height'
    if hip_y >= neck_y:
        hip_y = lo + 0.42 * H
        hip_how = 'clamped below neck'

    arm_cut = float(np.clip(0.24 * span, 0.10 * H, 0.28 * H))
    arm_how = f'0.24 × half-span {span:.4f}'
    return {
        'neck_y': float(neck_y), 'neck_how': neck_how,
        'hip_y': float(hip_y), 'hip_how': hip_how,
        'shoulder_bottom': float(shoulder_bottom), 'shoulder_how': shoulder_how,
        'arm_cut': arm_cut, 'arm_how': arm_how,
        'mid_x': None, 'span': span, 'head_x': head_x,
    }


def classify(V, cuts):
    x = V[:, 0]
    y = V[:, 1]
    mid = cuts['mid_x']
    hi = float(y.max())
    lab = np.empty(len(V), dtype=object)
    lab[:] = 'Torso'
    low = y <= cuts['hip_y']
    lab[low & (x >= mid)] = 'LeftLeg'
    lab[low & (x < mid)] = 'RightLeg'
    lab[y >= cuts['neck_y']] = 'Head'
    arm_y = (y >= cuts['shoulder_bottom']) & (y < hi)
    lab[arm_y & (x > mid + cuts['arm_cut'])] = 'LeftArm'
    lab[arm_y & (x < mid - cuts['arm_cut'])] = 'RightArm'
    lab[y >= cuts['neck_y'] + 0.40 * (hi - cuts['neck_y'] + 1e-6)] = 'Head'
    return lab


def build_parts(V, N, C, I, lab):
    tris = I.reshape(-1, 3)
    la, lb, lc = lab[tris[:, 0]], lab[tris[:, 1]], lab[tris[:, 2]]
    parts = []
    for name in PART_NAMES:
        keep = tris[(la == name) | (lb == name) | (lc == name)]
        if len(keep) == 0:
            raise SystemExit(f'split produced no triangles for {name} — this mesh is not a T-pose humanoid the heuristic can cut. Use the two-file Hitem3D export.')
        used, inv = np.unique(keep.ravel(), return_inverse=True)
        rec = {
            'name': name,
            'V': np.ascontiguousarray(V[used], np.float32),
            'I': inv.astype(np.uint32),
        }
        if N is not None:
            rec['N'] = np.ascontiguousarray(N[used], np.float32)
        if C is not None:
            rec['C'] = np.ascontiguousarray(C[used], np.float32)
        parts.append(rec)
    return parts


def already_named(chunks):
    names = {c['name'] for c in chunks}
    return all(n in names for n in PART_NAMES)


def main(in_glb, out_glb):
    print(f'reading {in_glb}')
    chunks, _gj = gather_mesh(in_glb)
    print(f'  {len(chunks)} mesh node(s): ' + ', '.join(f'{c["name"]}({len(c["V"]):,})' for c in chunks[:12]))

    if already_named(chunks):
        by = {c['name']: c for c in chunks}
        parts = []
        for name in PART_NAMES:
            p = by[name]
            if p['C'] is None:
                raise SystemExit(f'{name} has no vertex colour and could not sample an atlas')
            parts.append({k: p[k] for k in ('name', 'V', 'I') if k in p} | {
                'N': p['N'], 'C': p['C'],
            })
        glb_io.write(out_glb, parts)
        report = {
            'kind': 'textured-to-parts',
            'route': 'named-parts',
            'source': in_glb,
            'out': out_glb,
            'parts': [{'part': p['name'], 'verts': int(len(p['V'])), 'tris': int(len(p['I']) // 3)} for p in parts],
        }
        json.dump(report, open(out_glb.rsplit('.', 1)[0] + '-bake.json', 'w'), indent=1)
        print(f'wrote {out_glb} (already named parts, atlas sampled)')
        return report

    V, N, C, I = merge(chunks)
    if C is None:
        raise SystemExit('No atlas UVs and no COLOR_0 — cannot paint a solo textured GLB.')
    print(f'  merged {len(V):,} verts, {len(I) // 3:,} tris')

    bins, lo, hi, H, mid_x = y_bins(V)
    cuts = find_cuts(bins, lo, hi, H)
    cuts['mid_x'] = mid_x
    lab = classify(V, cuts)
    counts = {n: int((lab == n).sum()) for n in PART_NAMES}
    print(f'  neck y={cuts["neck_y"]:.4f} ({cuts["neck_how"]})')
    print(f'  hip  y={cuts["hip_y"]:.4f} ({cuts["hip_how"]})')
    print(f'  arms y≥{cuts["shoulder_bottom"]:.4f} ({cuts["shoulder_how"]}) ±{cuts["arm_cut"]:.4f} ({cuts["arm_how"]})')
    print('  verts ' + ' '.join(f'{n}={counts[n]:,}' for n in PART_NAMES))
    empty = [n for n, c in counts.items() if c < max(50, len(V) * 0.002)]
    if empty:
        raise SystemExit(f'split left {", ".join(empty)} nearly empty. Need a T-pose humanoid, or the two-file Hitem3D export.')

    parts = build_parts(V, N, C, I, lab)
    glb_io.write(out_glb, parts)
    report = {
        'kind': 'textured-to-parts',
        'route': 'split-textured',
        'source': in_glb,
        'out': out_glb,
        'height': H,
        'cuts': {
            'neckY': cuts['neck_y'], 'neckHow': cuts['neck_how'],
            'hipY': cuts['hip_y'], 'hipHow': cuts['hip_how'],
            'shoulderBottom': cuts['shoulder_bottom'], 'shoulderHow': cuts['shoulder_how'],
            'midX': mid_x, 'armCut': cuts['arm_cut'], 'armHow': cuts['arm_how'],
        },
        'parts': [{'part': p['name'], 'verts': int(len(p['V'])), 'tris': int(len(p['I']) // 3),
                   'medianMm': 0.0, 'interiorPct': 0.0} for p in parts],
    }
    json.dump(report, open(out_glb.rsplit('.', 1)[0] + '-bake.json', 'w'), indent=1)
    print(f'wrote {out_glb}')
    return report


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit('usage: textured_to_parts.py <in.glb> <out.glb>')
    main(sys.argv[1], sys.argv[2])
