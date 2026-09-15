"""Prepare the supplied beaver for the Carney ending; source is never modified.
Run: blender --background --python tools/build-beaver.py
"""
import bpy, math, json
from pathlib import Path
from mathutils import Vector, Quaternion

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'game/public/props/beaver'
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW = ROOT / 'artifacts/beaver'
PREVIEW.mkdir(parents=True, exist_ok=True)
scene = bpy.data.scenes.new('Carney beaver workshop')
bpy.context.window.scene = scene
original_images = set(bpy.data.images)
bpy.ops.import_scene.gltf(filepath=str(ROOT / 'medium_beaver_standing_realistic.glb'))
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.join()
beaver = bpy.context.object
beaver.name = 'Beaver'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=.00001)
bpy.ops.object.mode_set(mode='OBJECT')
mod = beaver.modifiers.new('Runtime mesh', 'DECIMATE')
mod.ratio = .035
bpy.ops.object.modifier_apply(modifier=mod.name)
for uv in list(beaver.data.uv_layers)[1:]: beaver.data.uv_layers.remove(uv)
verts = beaver.data.vertices
lo = Vector([min(v.co[i] for v in verts) for i in range(3)])
hi = Vector([max(v.co[i] for v in verts) for i in range(3)])
print('SOURCE_BOUNDS', list(lo), list(hi), flush=True)
scale = .6 / (hi.z - lo.z)
center = (lo + hi) * .5
for v in verts: v.co = (v.co - Vector((center.x, center.y, lo.z))) * scale
for material in beaver.data.materials:
    if not material or not material.use_nodes: continue
    shader = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if shader:
        shader.inputs['Metallic'].default_value = 0
        for socket in ['Metallic', 'Roughness']:
            for link in list(shader.inputs[socket].links): material.node_tree.links.remove(link)
        shader.inputs['Roughness'].default_value = .86
for img in set(bpy.data.images) - original_images:
    if img.size[0] > 1024 or img.size[1] > 1024:
        factor = 1024 / max(img.size)
        img.scale(round(img.size[0] * factor), round(img.size[1] * factor))
for poly in beaver.data.polygons: poly.use_smooth = True
bpy.ops.object.armature_add()
rig = bpy.context.object
rig.name = 'BeaverRig'
bpy.ops.object.mode_set(mode='EDIT')
rig.data.edit_bones.remove(rig.data.edit_bones[0])
bone_spec = [
    ('root', (0,0,0), (0,0,.12), None),
    ('pelvis', (-.13,0,.23), (-.05,0,.32), 'root'),
    ('chest', (-.05,0,.32), (.16,0,.37), 'pelvis'),
    ('head', (.16,0,.37), (.37,0,.34), 'chest'),
    ('tail', (-.27,0,.16), (-.53,0,.09), 'pelvis'),
]
for side, sign in [('L',1),('R',-1)]:
    bone_spec += [
        ('arm'+side, (.14,sign*.145,.30), (.15,sign*.18,.13), 'chest'),
        ('paw'+side, (.15,sign*.18,.13), (.26,sign*.18,.055), 'arm'+side),
        ('leg'+side, (-.18,sign*.15,.25), (-.18,sign*.20,.105), 'pelvis'),
        ('foot'+side, (-.18,sign*.20,.105), (-.055,sign*.20,.035), 'leg'+side),
    ]
for name, start, end, parent in bone_spec:
    bone = rig.data.edit_bones.new(name)
    bone.head, bone.tail = start, end
    if parent: bone.parent = rig.data.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT')
beaver.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for v in beaver.data.vertices:
    weights = sorted([(g.weight,g.group) for g in v.groups], reverse=True)
    if not weights: raise RuntimeError(f'Unweighted beaver vertex {v.index}')
    for _, group in weights[4:]: beaver.vertex_groups[group].remove([v.index])
    total = sum(weight for weight,_ in weights[:4])
    for weight,group in weights[:4]: beaver.vertex_groups[group].add([v.index],weight/total,'REPLACE')
rig.rotation_euler.z = -math.pi / 2
scene.render.fps = 30
def key_pose(frame, stride=0, raised=0, insert=True):
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = (1,0,0,0)
        bone.location = (0,0,0)
    def rotate(name, angle, axis=(0,1,0)):
        bone = rig.pose.bones[name]
        local_axis = bone.bone.matrix_local.to_quaternion().inverted() @ Vector(axis)
        bone.rotation_quaternion = Quaternion(local_axis, angle)
    rotate('chest', -.55 * raised)
    rotate('head', .28 * raised)
    rotate('tail', .06 * stride, (0,0,1))
    for side, phase in [('L',1),('R',-1)]:
        rotate('leg'+side, .17 * stride * phase)
        rotate('foot'+side, -.1 * stride * phase)
        rotate('arm'+side, -.55 * raised - .19 * stride * phase * (1-raised*.8))
        rotate('paw'+side, .4 * raised)
    if insert:
        for bone in rig.pose.bones:
            bone.keyframe_insert(data_path='rotation_quaternion',frame=frame)
            bone.keyframe_insert(data_path='location',frame=frame)
for clip, raised in [('beaverWalk',0),('beaverCarry',1),('beaverIdle',.75)]:
    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.new(clip)
    for frame in range(1,32,3):
        key_pose(frame, math.sin((frame-1)/30*math.tau) * (0 if clip=='beaverIdle' else 1), raised)
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip,1,rig.animation_data.action)
    rig.animation_data.action = None
for track in rig.animation_data.nla_tracks: track.mute = True
key_pose(1,insert=False)
rig.animation_data.action = None
bpy.ops.object.select_all(action='DESELECT')
beaver.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
for track in rig.animation_data.nla_tracks: track.mute = False
bpy.ops.export_scene.gltf(filepath=str(OUT / 'beaver.glb'), use_selection=True, use_active_scene=True, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS')
for track in rig.animation_data.nla_tracks: track.mute = True
key_pose(1,0,1,insert=False)
(OUT / 'CREDITS.txt').write_text('Medium Beaver Standing Realistic by Pigcraft\nhttps://sketchfab.com/3d-models/medium-beaver-standing-realistic-f8c13f8d81cf42789a9172b1f09c68ad\nSource metadata: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/\nAdapted: mesh simplification, texture resizing, material adjustment and animation rig.\n', encoding='utf-8')
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 16
scene.render.resolution_x = 640
scene.render.resolution_y = 640
scene.render.resolution_percentage = 100
scene.world = bpy.data.worlds.new('Studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (.22,.27,.34,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = .6
bpy.ops.object.light_add(type='AREA', location=(1,-2,3))
bpy.context.object.data.energy = 180
bpy.context.object.data.shape = 'DISK'
bpy.context.object.data.size = 3
bpy.ops.object.camera_add()
cam = bpy.context.object
scene.camera = cam
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 1.15
for name, position in [('carry-front',(1,-2,1.1)), ('carry-back',(-1,2,1.1))]:
    cam.location = position
    cam.rotation_euler = (Vector((0,0,.28)) - cam.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath = str(PREVIEW / f'{name}.png')
    bpy.ops.render.render(write_still=True)
# Keep the original stage workspace intact and save only this authored scene.
bpy.data.libraries.write(str(PREVIEW / 'beaver-workshop.blend'), {scene}, fake_user=True)
print('BEAVER_READY', len(beaver.data.polygons), (OUT/'beaver.glb').stat().st_size, flush=True)
