"""Lake America finish: execute in the open Blender master through MCP only.

Load once, call prepare(), bake_range(start, stop) in small chunks, then
refine_surfaces() and export_pass(). No topology, pivots, UVs, or gameplay edits.
The source and runtime backups live beside the matched browser comparisons.
"""
import ast
import bpy
import json
import math
import shutil
import time
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts/lake-america/shine-2026-10-12'
VERSION = '2026-10-12-mcp-shine-v1'
REPORT = {'version': VERSION, 'meshes': [], 'surfaces': []}
ASSETS = []
TARGETS = []
BVH = None


def assets():
    return [o for o in bpy.context.scene.objects if o.type == 'MESH'
            and not any(c.name.startswith(('90', '91', '92', '93')) for c in o.users_collection)]


def prepare():
    global ASSETS, TARGETS, BVH
    assert Path(bpy.data.filepath) in {
        ROOT / 'stages/lake_america/blender/lake-america.blend',
        OUT / 'before/lake-america.blend',
    }, 'Open the Lake America master or this pass\'s before backup'
    assert bpy.context.scene.get('lake_shine_finish') != VERSION, 'Pass already applied'
    OUT.mkdir(parents=True, exist_ok=True)
    backup = OUT / 'before'
    backup.mkdir(exist_ok=True)
    for rel in ['stages/lake_america/blender/lake-america.blend',
                'game/public/stages/lake-america-3d/lake-america.glb',
                'game/public/stages/lake-america-3d/manifest.json']:
        source = ROOT / rel
        if not (backup / source.name).exists():
            shutil.copy2(source, backup / source.name)
    ASSETS = assets()
    REPORT['beforeTriangles'] = sum(len(p.vertices) - 2 for o in ASSETS for p in o.data.polygons)
    REPORT['beforeMeshes'] = len(ASSETS)
    verts, faces = [], []
    for o in ASSETS:
        # The distant skyline does not contribute to nearby contact shading.
        world = [o.matrix_world @ v.co for v in o.data.vertices]
        if not world or min(abs(v.y) for v in world) > 65:
            continue
        offset = len(verts)
        verts.extend(world)
        faces.extend(tuple(i + offset for i in p.vertices) for p in o.data.polygons)
        color = o.data.color_attributes.get('Color')
        if color and o.data.materials and not o.data.materials[0].name.startswith(('Slate', 'Lantern')):
            TARGETS.append(o)
    BVH = BVHTree.FromPolygons(verts, faces, all_triangles=False, epsilon=0)
    REPORT['rayCount'] = 0
    print(json.dumps({'targets': len(TARGETS), 'bvhVertices': len(verts), 'triangles': REPORT['beforeTriangles']}))


# Cosine-weighted, deterministic hemisphere; 12 rays per existing color sample.
DIRECTIONS = []
for sample in range(12):
    radius = math.sqrt((sample + .5) / 12)
    angle = sample * 2.399963229728653
    DIRECTIONS.append(Vector((radius * math.cos(angle), radius * math.sin(angle), math.sqrt(1 - radius * radius))))


def bake_range(start, stop):
    begin = time.perf_counter()
    for obj in TARGETS[start:stop]:
        assert obj.get('lake_shine_baked') != VERSION, obj.name + ' already baked'
        mesh = obj.data
        attr = mesh.color_attributes['Color']
        mat = mesh.materials[0].name
        transform = obj.matrix_world
        normal_transform = transform.to_3x3().inverted().transposed()
        samples = {}
        # Fine contact rays do not paint distant, broad shadows into the mesh.
        reach = .62 if mat.startswith(('Snow', 'Pine', 'Granite', 'Bark')) else .36
        for vertex in mesh.vertices:
            point = transform @ vertex.co
            normal = (normal_transform @ vertex.normal).normalized()
            if normal.length_squared < .5:
                continue
            tangent = normal.cross(Vector((0, 0, 1)))
            if tangent.length_squared < .001:
                tangent = normal.cross(Vector((0, 1, 0)))
            tangent.normalize()
            bitangent = normal.cross(tangent)
            origin = point + normal * .012
            occlusion = 0
            for d in DIRECTIONS:
                direction = tangent * d.x + bitangent * d.y + normal * d.z
                hit, _, _, distance = BVH.ray_cast(origin, direction, reach)
                if hit is not None:
                    occlusion += .35 + .65 * (1 - distance / reach)
            ao = occlusion / len(DIRECTIONS)
            samples[vertex.index] = (point, normal, ao)
        total_ao = 0
        for i, datum in enumerate(attr.data):
            vi = i if attr.domain == 'POINT' else mesh.loops[i].vertex_index
            if vi not in samples:
                continue
            point, normal, ao = samples[vi]
            old = tuple(datum.color)
            factor = 1 - ao * .43
            tint = [1., 1., 1.]
            # Painted winter bounce gives depth even at the normal fight camera.
            if mat.startswith('Snow'):
                upward = max(0, normal.z)
                tint = [.78 + upward * .22, .9 + upward * .10, 1.025]
                factor = 1 - ao * .36
            elif mat.startswith('Pine'):
                tint = [.82, 1.07, 1.06]
                factor *= .92
            elif mat.startswith('Granite'):
                tint = [.89, .99, 1.07]
            elif mat.startswith('Cedar'):
                tint = [1.13, 1.035, .88]
            elif mat.startswith('Bark'):
                tint = [1.02, .96, .88]
            elif mat.startswith('Ice'):
                tint = [.82, 1.05, 1.13]
            elif mat.startswith('Liberty bronze'):
                # Patina collects in recesses; exposed bronze stays warm.
                wave = math.sin(point.x * 8 + point.z * 12) * math.sin(point.y * 11 - point.z * 3)
                patina = min(.55, ao * .7 + max(0, wave - .2) * .25)
                tint = [1.13 - patina * 1.1, .98 + patina * .22, .85 + patina * .7]
            elif mat.startswith(('Rescue', 'Station', 'Tool enamel')):
                # Retain the red/navy palette while giving exposed faces clean enamel.
                lift = max(0, normal.z) * .08
                tint = [1.06 + lift, 1.01 + lift, .96 + lift]
            elif mat.startswith(('Flagpole', 'Tool steel')):
                tint = [.96, 1.025, 1.07]
                factor = 1 - ao * .30
            datum.color = tuple(min(1., max(0., old[c] * factor * tint[c])) for c in range(3)) + (old[3],)
            total_ao += ao
        obj['lake_shine_baked'] = VERSION
        REPORT['rayCount'] += len(samples) * len(DIRECTIONS)
        REPORT['meshes'].append({'name': obj.name, 'samples': len(samples),
                                'meanOcclusion': round(total_ao / max(1, len(attr.data)), 4)})
    print(json.dumps({'range': [start, stop], 'completed': len(REPORT['meshes']),
                      'total': len(TARGETS), 'seconds': round(time.perf_counter() - begin, 2)}))


def refine_surfaces():
    import numpy as np
    REPORT['surfaces'] = []
    # Re-author the packed roughness maps, preserving their dimensions and count.
    # They are linear data; the green channel is the glTF roughness channel.
    for family, center, contrast, low, high in [
        ('enamel', .24, 1.1, .14, .43), ('brushed', .24, 1.05, .14, .42),
        ('forged', .48, 1.12, .32, .67), ('ice', .26, 1.1, .13, .46),
        ('wood', .57, .9, .39, .78), ('snow', .91, .75, .79, 1.)]:
        image = bpy.data.images.get('Lake America · ' + family + ' roughness')
        if image is None:
            continue
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        rgba = pixels.reshape((-1, 4))
        channel = rgba[:, 1]
        revised = np.clip(center + (channel - float(channel.mean())) * contrast, low, high)
        rgba[:, :3] = revised[:, None]
        image.pixels.foreach_set(pixels)
        image.update()
        image.pack()
        REPORT['surfaces'].append({'family': family, 'meanRoughness': float(revised.mean()), 'size': list(image.size)})
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        p = mat.node_tree.nodes.get('Principled BSDF')
        if not p:
            continue
        if mat.name.startswith('Liberty bronze'):
            # The bell used the coarse rock roughness map, making bronze look chalky.
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image and node.image.name.endswith('granite roughness'):
                    node.image = bpy.data.images['Lake America · forged roughness']
            p.inputs['Metallic'].default_value = .78
            for node in mat.node_tree.nodes:
                if node.type == 'NORMAL_MAP':
                    node.inputs['Strength'].default_value = .18
        if mat.name.startswith(('Rescue', 'Station', 'Tool enamel')):
            p.inputs['Metallic'].default_value = .12
            for node in mat.node_tree.nodes:
                if node.type == 'NORMAL_MAP':
                    node.inputs['Strength'].default_value = .19
        if mat.name.startswith('Snow'):
            for node in mat.node_tree.nodes:
                if node.type == 'NORMAL_MAP':
                    node.inputs['Strength'].default_value = .23
    REPORT['afterTriangles'] = sum(len(p.vertices) - 2 for o in assets() for p in o.data.polygons)
    assert REPORT['afterTriangles'] == REPORT['beforeTriangles'], 'No added runtime triangles'
    assert len(REPORT['meshes']) == len(TARGETS), 'Bake every target before export'
    (OUT / 'authoring.json').write_text(json.dumps(REPORT, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'bakedMeshes': len(REPORT['meshes']), 'rays': REPORT['rayCount'],
                      'triangles': REPORT['afterTriangles'], 'surfaces': REPORT['surfaces']}))


def export_pass():
    # Reuse the proven exporter, including the four named text proxies.
    recipe = ROOT / 'tools/polish-lake-america-mcp.py'
    tree = ast.parse(recipe.read_text(encoding='utf8'))
    definitions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'collection', 'export_runtime'}]
    env = {'bpy': bpy, 'json': json, 'Vector': Vector, 'Path': Path,
           'ROOT': ROOT, 'VERSION': '2026-10-09-mcp-rich-v1', 'FEATURES': [], 'collections': {}}
    exec(compile(ast.Module(body=definitions, type_ignores=[]), str(recipe), 'exec'), env)
    result = env['export_runtime']()
    path = ROOT / 'game/public/stages/lake-america-3d/manifest.json'
    manifest = json.loads(path.read_text(encoding='utf8'))
    original_manifest = json.loads((OUT / 'before/manifest.json').read_text(encoding='utf8'))
    manifest['mcpFinish'] = original_manifest['mcpFinish']
    assert manifest['triangles'] == original_manifest['triangles']
    assert manifest['meshObjects'] == original_manifest['meshObjects']
    manifest['shinePass'] = {
        'version': VERSION, 'recipe': 'web/tools/shine-lake-america-mcp.py',
        'backup': 'web/artifacts/lake-america/shine-2026-10-12/before',
        'method': 'Native Blender MCP; ray-traced vertex contact shading and packed PBR refinement',
        'bakedMeshes': len(REPORT['meshes']), 'rays': REPORT['rayCount'],
        'addedTriangles': 0, 'addedMaterials': 0, 'addedImages': 0,
    }
    manifest['features'] = list(dict.fromkeys(manifest['features'] + [
        'Baked soft contact shading in snow folds, timber joinery and prop recesses',
        'Cool winter bounce, amber cedar, cyan shoreline ice and deeper evergreen needles',
        'Polished enamel, brushed metal and warm bronze with patinated recesses',
    ]))
    path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    scene = bpy.context.scene
    scene['lake_shine_finish'] = VERSION
    scene['shine_recipe'] = 'Execute web/tools/shine-lake-america-mcp.py through Blender MCP on the before backup.'
    scene['last_authoring_pass'] = 'Native Blender MCP: baked contact shading, winter bounce and polished PBR surfaces; zero added triangles'
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'stages/lake_america/blender/lake-america.blend'))
    print(json.dumps(result))
