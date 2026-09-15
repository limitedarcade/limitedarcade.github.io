"""Minimal glTF-binary reader/writer. No dependencies beyond numpy.

Only what the fighter pipeline needs: single-primitive meshes, one node per
part, float/int attributes, optional embedded JPEG textures.
"""
import json
import struct

import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16,
      5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def read(path):
    """-> (gltf_json, bin_chunk)."""
    b = open(path, 'rb').read()
    if b[:4] != b'glTF':
        raise ValueError(f'not a GLB: {path}')
    off, chunks = 12, []
    while off < len(b):
        ln, ty = struct.unpack_from('<II', b, off)
        off += 8
        chunks.append((ty, b[off:off + ln]))
        off += ln
    gj = json.loads(chunks[0][1].decode('utf-8'))
    return gj, chunks[1][1]


def accessor(gj, bn, idx):
    a = gj['accessors'][idx]
    bv = gj['bufferViews'][a['bufferView']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = NC[a['type']]
    arr = np.frombuffer(bn, dtype=CT[a['componentType']], count=a['count'] * n, offset=off)
    return arr.reshape(-1, n) if n > 1 else arr


def parts(path):
    """-> [{name, V, N, UV, C, I}] one entry per node that has a mesh."""
    gj, bn = read(path)
    by_mesh = {n['mesh']: n.get('name') or f'mesh{n["mesh"]}'
               for n in gj['nodes'] if n.get('mesh') is not None}
    out = []
    for mi, m in enumerate(gj['meshes']):
        pr = m['primitives'][0]
        at = pr['attributes']
        out.append({
            'name': by_mesh.get(mi, f'mesh{mi}'),
            'V': accessor(gj, bn, at['POSITION']).astype(np.float32),
            'N': accessor(gj, bn, at['NORMAL']).astype(np.float32) if 'NORMAL' in at else None,
            'UV': accessor(gj, bn, at['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in at else None,
            'C': accessor(gj, bn, at['COLOR_0']) if 'COLOR_0' in at else None,
            'I': accessor(gj, bn, pr['indices']).astype(np.uint32),
        })
    return out


def write(path, parts_in):
    """parts_in: [{name, V, I, N?, C?}]  C is float32 linear RGB."""
    gj = {'asset': {'version': '2.0', 'generator': 'fightere/tools/glb_io.py'},
          'scene': 0, 'scenes': [{'nodes': [0]}],
          'nodes': [], 'meshes': [], 'materials': [],
          'accessors': [], 'bufferViews': []}
    blob = bytearray()
    kids = []

    def push(arr, target):
        while len(blob) % 4:
            blob.append(0)
        off = len(blob)
        blob.extend(arr.tobytes())
        gj['bufferViews'].append({'buffer': 0, 'byteOffset': off,
                                  'byteLength': arr.nbytes, 'target': target})
        return len(gj['bufferViews']) - 1

    def acc(arr, ctype, atype, target, minmax=False):
        bv = push(arr, target)
        a = {'bufferView': bv, 'componentType': ctype, 'count': len(arr), 'type': atype}
        if atype != 'SCALAR':
            a['normalized'] = ctype in (5121, 5123) 
        if minmax:
            a['min'] = arr.min(0).tolist()
            a['max'] = arr.max(0).tolist()
        gj['accessors'].append(a)
        return len(gj['accessors']) - 1

    for p in parts_in:
        at = {'POSITION': acc(np.ascontiguousarray(p['V'], np.float32), 5126, 'VEC3', 34962, True)}
        if p.get('N') is not None:
            at['NORMAL'] = acc(np.ascontiguousarray(p['N'], np.float32), 5126, 'VEC3', 34962)
        if p.get('C') is not None:
            at['COLOR_0'] = acc(np.ascontiguousarray(p['C'], np.float32), 5126, 'VEC3', 34962)
        ia = acc(np.ascontiguousarray(p['I'], np.uint32), 5125, 'SCALAR', 34963)
        mi = len(gj['meshes'])
        gj['materials'].append({'name': f'{p["name"]}_mat',
                                'pbrMetallicRoughness': {'baseColorFactor': [1, 1, 1, 1],
                                                         'metallicFactor': 0.0,
                                                         'roughnessFactor': 0.62}})
        gj['meshes'].append({'name': p['name'],
                             'primitives': [{'attributes': at, 'indices': ia,
                                             'material': mi, 'mode': 4}]})
        gj['nodes'].append({'name': p['name'], 'mesh': mi})
        kids.append(len(gj['nodes']) - 1)

    gj['nodes'].insert(0, {'name': 'world', 'children': [i + 1 for i in range(len(kids))]})
    gj['scenes'] = [{'nodes': [0]}]
    gj['buffers'] = [{'byteLength': len(blob)}]

    js = json.dumps(gj, separators=(',', ':')).encode('utf-8')
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(blob) % 4:
        blob.append(0)
    total = 12 + 8 + len(js) + 8 + len(blob)
    with open(path, 'wb') as f:
        f.write(b'glTF' + struct.pack('<II', 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A) + js)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))
    return total
