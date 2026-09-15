import bpy, math
from pathlib import Path
root = Path(r'./web')
scene = bpy.data.scenes.new('Lake Ontario tribute sign')
bpy.context.window.scene = scene
wood = bpy.data.materials.new('Warm cut cedar'); wood.diffuse_color = (.43,.23,.085,1)
wood.use_nodes = True
wood.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.43,.23,.085,1)
wood.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .85
iron = bpy.data.materials.new('Aged iron bolts'); iron.diffuse_color = (.055,.045,.035,1)
objects = []
def box(name, scale, position):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj=bpy.context.object; obj.name=name; obj.dimensions=scale
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    obj.data.materials.append(wood)
    bevel=obj.modifiers.new('Worn timber edges','BEVEL'); bevel.width=.012; bevel.segments=3
    bpy.context.view_layer.objects.active=obj; bpy.ops.object.modifier_apply(modifier=bevel.name)
    objects.append(obj)
box('Solid cedar signpost',(.13,.15,1.28),(0,0,.64))
box('Upper sign plank',(1.55,.15,.31),(0,0,1.125))
box('Lower sign plank',(1.55,.15,.31),(0,0,.8))
box('Flat post cap',(.24,.22,.04),(0,0,1.26))
for x in [-.65,.65]:
    for z in [.76,1.17]:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=8,radius=.021,location=(x,-.081,z))
        obj=bpy.context.object; obj.name='Iron carriage bolt'; obj.scale.y=.38
        obj.data.materials.append(iron); objects.append(obj)
bpy.ops.object.select_all(action='DESELECT')
for obj in objects: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(root/'game/public/props/beaver/signpost.glb'),export_format='GLB',use_selection=True,use_active_scene=True,export_animations=False)
print('SIGN_READY',len(objects))
