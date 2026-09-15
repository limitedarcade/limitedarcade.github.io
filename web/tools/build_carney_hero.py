"""Reproducible texture-preserving Blender -> GLB pilot. No rig regeneration.

Run with Blender --background --python tools/build_carney_hero.py.
The old rigged asset remains untouched. Export carries the original 32 clips.
"""
import bpy, math, json, time
from pathlib import Path
from mathutils import Vector

root = Path(__file__).resolve().parents[1]
out = root / 'game/public/fighters/carney'
source_path = root / 'fighters/carney/carney_Stylized Cel-Shaded Businessman 3D Model_allparts_20260904_123033.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(out/'carney-rigged.glb'))
rig_objects = set(bpy.context.scene.objects)
parts = [o for o in rig_objects if o.type=='MESH' and o.name in ['Head','Torso','LeftArm','RightArm','LeftLeg','RightLeg']]
armature = next(o for o in rig_objects if o.type=='ARMATURE')
armature.data.pose_position = 'REST'
bpy.ops.import_scene.gltf(filepath=str(source_path))
sources = [o for o in bpy.context.scene.objects if o not in rig_objects and o.type=='MESH']
if len(sources)!=1: raise RuntimeError('Expected one textured source')
source = sources[0]
# Match bounds first; silently painting a different sculpt is unacceptable.
def bounds(objects):
    points=[o.matrix_world @ Vector(v) for o in objects for v in o.bound_box]
    return [[min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]]
bpy.context.view_layer.update()
a,b=bounds(parts),bounds(sources)
error=max(abs(a[k][i]-b[k][i]) for k in range(2) for i in range(3))
print('BOUND_ERROR', error, flush=True)
if error>.015: raise RuntimeError('Texture source does not match rigged sculpt bounds')

scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=1
scene.cycles.use_denoising=False
scene.render.bake.use_selected_to_active=True
scene.render.bake.cage_extrusion=.008
scene.render.bake.max_ray_distance=.02
scene.render.bake.margin=12
# Convert source to emission for an unlit albedo transfer.
for material in source.data.materials:
    nodes=material.node_tree.nodes
    principled=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    base=principled.inputs['Base Color']
    emission=nodes.new('ShaderNodeEmission')
    if base.is_linked: material.node_tree.links.new(base.links[0].from_socket,emission.inputs['Color'])
    else: emission.inputs['Color'].default_value=base.default_value
    output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL')
    material.node_tree.links.new(emission.outputs[0],output.inputs['Surface'])

for part in parts:
    started=time.time()
    bpy.ops.object.select_all(action='DESELECT')
    part.select_set(True); bpy.context.view_layer.objects.active=part
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(70), island_margin=.015)
    bpy.ops.object.mode_set(mode='OBJECT')
    size=2048 if part.name in ['Head','Torso'] else 1024
    image=bpy.data.images.new('Carney_'+part.name+'_Albedo',width=size,height=size,alpha=False)
    image.colorspace_settings.name='sRGB'
    material=bpy.data.materials.new('Hero_'+part.name); material.use_nodes=True
    nodes=material.node_tree.nodes; shader=nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value=.75 if part.name=='Head' else .88
    shader.inputs['Metallic'].default_value=0
    texture=nodes.new('ShaderNodeTexImage'); texture.image=image; nodes.active=texture
    material.node_tree.links.new(texture.outputs['Color'],shader.inputs['Base Color'])
    part.data.materials.clear();part.data.materials.append(material)
    # Disable armature while transferring rest-surface color.
    for mod in part.modifiers:
        if mod.type=='ARMATURE': mod.show_render=False; mod.show_viewport=False
    source.select_set(True)
    bpy.ops.object.bake(type='EMIT')
    image.pack()
    for mod in part.modifiers:
        if mod.type=='ARMATURE': mod.show_render=True; mod.show_viewport=True
    # Textures are now the color source; don't multiply them by old vertex colors.
    for attr in list(part.data.color_attributes): part.data.color_attributes.remove(attr)
    print('BAKED',part.name,round(time.time()-started,1),flush=True)

for obj in list(bpy.context.scene.objects):
    if obj not in rig_objects: bpy.data.objects.remove(obj,do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
for obj in parts+[armature]: obj.select_set(True)
bpy.context.view_layer.objects.active=armature
armature.data.pose_position='POSE'
scene.frame_set(0)
# The importer's bone display helper is not a fighter asset.
blend=root/'fighters/carney/carney-hero.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
bpy.ops.export_scene.gltf(filepath=str(out/'carney-hero.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_skins=True,export_morph=True,
    export_yup=True,export_materials='EXPORT')
report={'source':source_path.name,'base':'carney-rigged.glb','boundsMaxError':error,
    'parts':len(parts),'bones':len(armature.data.bones),'actions':len(bpy.data.actions),
    'outputBytes':(out/'carney-hero.glb').stat().st_size,
    'limitations':['Original rig and facial geometry retained; no new facial controls.','Texture bake requires close-up visual review.']}
(out/'hero-build.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('HERO_BUILD',json.dumps(report),flush=True)
