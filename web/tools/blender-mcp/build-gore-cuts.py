"""Run inside Blender through execute_blender_code; units use Y as cut outward."""
import bpy, math, json, os, uuid
from mathutils import Vector

BASE = os.environ.get('BFI_WEB_DIR')
if not BASE:
    raise RuntimeError('Set BFI_WEB_DIR to the web project directory before running this MCP payload')
scene = bpy.data.scenes['Gore cut surfaces MCP']
bpy.context.window.scene = scene
for obj in list(scene.objects):
    bpy.data.objects.remove(obj,do_unlink=True)
library = bpy.data.collections.new('Export - normalized cut anatomy')
scene.collection.children.link(library)
V, F, C = [], [], []

def reset():
    V.clear(); F.clear(); C.clear()

def vert(p, c):
    V.append(p); C.append((*c, 1)); return len(V)-1

def noise(t, r=0):
    return math.sin(t*5.0+r*3.7)*.045 + math.sin(t*11.0-r*8)*.018

def compartment(x,z,kind):
    groups = [(-.48,.08,.72),(.42,.23,.88),(.04,-.43,.84),(-.25,.56,.64),(.47,-.45,.58),(-.57,-.48,.56),(.1,.05,.55)]
    if kind=='legCut': groups=[(-.48,.28,.88),(.42,.37,.96),(-.4,-.44,.85),(.48,-.38,.82),(.02,-.04,.66)]
    values=sorted((((x-cx)**2+(z-cz)**2)/size**2,i) for i,(cx,cz,size) in enumerate(groups))
    fascia=max(0,1-(values[1][0]-values[0][0])/.075)
    return values[0][0],values[0][1],fascia

def flesh(r, t,kind):
    # Linear colours: burgundy muscle, thin pale fascia and irregular fat,
    # rather than painting the entire cut bright, uniformly saturated red.
    x,z=math.cos(t)*r,math.sin(t)*r
    distance,group,fascia=compartment(x,z,kind)
    fibre = .5+.5*math.sin(x*147+math.sin(z*63)*1.3)*math.sin(z*139+math.sin(x*61))
    lobes = .5+.5*math.sin(group*2.7)
    clot = .68+.32*(.5+.5*math.sin(t*13+r*21)*math.sin(t*5-r*8))
    meat = ((.052+.034*fibre+.012*lobes)*clot, (.004+.007*fibre)*clot, (.009+.009*fibre)*clot)
    fascia *= max(0,min(1,(.92-r)*10))*.68
    meat = tuple(meat[i]*(1-fascia)+(.16,.10,.065)[i]*fascia for i in range(3))
    if r > .945:
        mix = min(1,(r-.945)/.04)*(.5+.4*math.sin(t*9+math.sin(t*4))**2)
        return tuple(meat[i]*(1-mix)+(.22,.13,.055)[i]*mix for i in range(3))
    return meat

def cut_surface(kind):
    reset(); n=128; rings=32
    center=vert((0,-.16 if kind=='torsoCut' else -.025,0),flesh(0,0,kind)); top=[]
    for k in range(1,rings+1):
        r=k/rings; ring=[]
        for j in range(n):
            t=j*math.tau/n; edge=1+noise(t)
            x,z=math.cos(t)*r,math.sin(t)*r
            distance,group,groove=compartment(x,z,kind)
            y=-.035+.038*math.sin(r*math.pi)-.028*groove
            y+=.006*math.sin(x*147+math.sin(z*63))*math.sin(z*139)
            y+=.012*math.sin(group*2.7)*math.sin(r*math.pi)
            if kind=='torsoCut': y-=.18*max(0,1-r/.67)**2
            ring.append(vert((x*edge,y,z*edge),flesh(r,t,kind)))
        top.append(ring)
    for j in range(n): F.append((center,top[0][(j+1)%n],top[0][j]))
    for a,b in zip(top,top[1:]):
        for j in range(n): q=(j+1)%n; F.append((a[j],a[q],b[q],b[j]))
    previous=top[-1]
    for k in range(1,6):
        y=-k*.07; radius=1-k*.13; ring=[]
        for j in range(n):
            t=j*math.tau/n; r=radius*(1+noise(t))
            ring.append(vert((math.cos(t)*r,y,math.sin(t)*r),(.032,.003,.006)))
        for j in range(n): q=(j+1)%n; F.append((previous[j],previous[q],ring[q],ring[j]))
        previous=ring
    bottom=vert((0,-.38,0),(.024,.002,.005))
    for j in range(n): F.append((bottom,previous[j],previous[(j+1)%n]))
    # Muscle compartments are part of one cross-section; fascia follows their
    # irregular boundaries instead of putting separate blobs on a flat disc.
    if kind=='torsoCut':
        for i in range(3):
            path=[(.36*math.cos(t),.065+.045*math.sin(t*2+i),-.14+i*.16+.15*math.sin(t)) for t in [j*math.tau/48 for j in range(49)]]
            tube(path,.046,(.14,.047,.037))
    return mesh(kind)

def ellipsoid(center, scale, color, seed=0):
    rows=[]; n=32
    for k in range(13):
        p=math.pi*k/12; row=[]
        for j in range(n):
            t=j*math.tau/n; fibre=.88+.12*math.sin(t*9+p*5+seed)
            row.append(vert((center[0]+scale[0]*math.sin(p)*math.cos(t),center[1]+scale[1]*math.cos(p),center[2]+scale[2]*math.sin(p)*math.sin(t)),tuple(v*fibre for v in color)))
        rows.append(row)
    for a,b in zip(rows,rows[1:]):
        for j in range(n): q=(j+1)%n; F.append((a[j],a[q],b[q],b[j]))

def tube(points,radius,color):
    rows=[]
    for i,p in enumerate(points):
        tangent=Vector(points[min(i+1,len(points)-1)])-Vector(points[max(0,i-1)])
        tangent.normalize(); side=tangent.cross(Vector((0,1,0))).normalized(); up=tangent.cross(side).normalized()
        row=[]
        for j in range(10):
            t=j*math.tau/10; q=Vector(p)+(side*math.cos(t)+up*math.sin(t))*radius
            row.append(vert(tuple(q),color))
        rows.append(row)
    for a,b in zip(rows,rows[1:]):
        for j in range(10): q=(j+1)%10; F.append((a[j],a[q],b[q],b[j]))

def bone(name):
    reset(); n=32; rows=[]
    # Ivory cortical ring surrounds a recessed red marrow core; no solid spike.
    for r,y in [(.18,-.48),(.23,-.2),(.22,.15),(.13,.15),(.12,.025)]:
        row=[]
        for j in range(n):
            t=j*math.tau/n; y2=y+(.05*math.sin(t*5)+.023*math.sin(t*11) if y>.1 else 0)
            c=(.60,.48,.32) if r>.15 else (.22,.048,.035)
            row.append(vert((math.cos(t)*r,y2,math.sin(t)*r),c))
        rows.append(row)
    for a,b in zip(rows,rows[1:]):
        for j in range(n): q=(j+1)%n; F.append((a[j],b[j],b[q],a[q]))
    center=vert((0,.025,0),(.13,.012,.018))
    for j in range(n): F.append((center,rows[-1][(j+1)%n],rows[-1][j]))
    return mesh(name)

def mesh(name):
    data=bpy.data.meshes.new(name+' anatomy'); data.from_pydata(V,[],F); data.update()
    colors=data.color_attributes.new(name='Anatomy',type='FLOAT_COLOR',domain='POINT')
    for i,c in enumerate(C): colors.data[i].color=c
    for poly in data.polygons: poly.use_smooth=True
    obj=bpy.data.objects.new(name,data); library.objects.link(obj)
    mat=bpy.data.materials.get('Cut anatomy - wet tissue')
    if not mat:
        mat=bpy.data.materials.new('Cut anatomy - wet tissue'); mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Roughness'].default_value=.32
        bsdf.inputs['Subsurface Weight'].default_value=.045
        attr=mat.node_tree.nodes.new('ShaderNodeVertexColor'); attr.layer_name='Anatomy'
        mat.node_tree.links.new(attr.outputs['Color'],bsdf.inputs['Base Color'])
    data.materials.append(mat)
    return obj

objects=[cut_surface(name) for name in ['armCut','legCut','torsoCut']]+[bone('cutBone')]

# Export the exact Blender vertices into the game's existing ObjectLoader pack pipeline.
geometries=[]; nodes=[]; material_id=str(uuid.uuid4())
for obj in objects:
    data=obj.data; data.calc_loop_triangles(); gid=str(uuid.uuid4())
    geometries.append({'uuid':gid,'type':'BufferGeometry','data':{
        'attributes':{
            'position':{'itemSize':3,'type':'Float32Array','array':[round(v,6) for p in data.vertices for v in p.co]},
            'normal':{'itemSize':3,'type':'Float32Array','array':[round(v,5) for p in data.vertices for v in p.normal]},
            'color':{'itemSize':3,'type':'Float32Array','array':[round(v,5) for p in data.color_attributes['Anatomy'].data for v in p.color[:3]]}},
        'index':{'type':'Uint16Array','array':[v for tri in data.loop_triangles for v in tri.vertices]}}})
    nodes.append({'uuid':str(uuid.uuid4()),'type':'Mesh','name':obj.name,'geometry':gid,'material':material_id,'matrix':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]})
payload={'metadata':{'version':4.6,'type':'Object','generator':'Blender MCP cut anatomy'},'geometries':geometries,
    'materials':[{'uuid':material_id,'type':'MeshStandardMaterial','color':16777215,'vertexColors':True,'roughness':.32,'metalness':0,'side':2}],
    'object':{'uuid':str(uuid.uuid4()),'type':'Group','name':'cutAnatomy','children':nodes}}
output=os.path.join(BASE,'game','public','gore','cut-surfaces.json')
with open(output,'w') as f: json.dump(payload,f,separators=(',',':'))

review=bpy.data.collections.new('Review - arm leg torso'); scene.collection.children.link(review)
for i,obj in enumerate(objects[:3]):
    copy=obj.copy(); copy.data=obj.data; review.objects.link(copy); copy.name='Review '+obj.name
    copy.scale=(.23,.23,.23); copy.location=((i-1)*.62,0,0)
    b=objects[-1].copy(); review.objects.link(b); b.scale=(.23,.23,.23); b.location=copy.location+Vector((.025,0,-.04))
for obj in objects: obj.hide_render=True; obj.hide_set(True)
camera_data=bpy.data.cameras.new('Gore detail camera'); camera=bpy.data.objects.new('Gore detail camera',camera_data); scene.collection.objects.link(camera)
camera.location=(1.1,1.5,1.4); direction=Vector((0,0,0))-camera.location; camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler(); camera_data.type='ORTHO'; camera_data.ortho_scale=2.05; scene.camera=camera
for name,loc,power,size in [('Tissue key',(-1,2,2),180,3),('Tissue rim',(1,1,-1),100,2)]:
    light=bpy.data.lights.new(name,'AREA'); light.energy=power; light.shape='DISK'; light.size=size
    obj=bpy.data.objects.new(name,light); scene.collection.objects.link(obj); obj.location=loc; obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
scene.world=bpy.data.worlds.new('Gore neutral studio'); scene.world.use_nodes=True; scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.025,.03,.04,1)
scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.render.resolution_x=1400; scene.render.resolution_y=750; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.render.filepath=os.path.join(BASE,'artifacts','gore-2026-10-10','blender-cut-surfaces.png')
scene.view_settings.view_transform='AgX'; scene.view_settings.exposure=-.65
outdir=os.path.join(BASE,'fighters','Gib','blender'); os.makedirs(outdir,exist_ok=True)
bpy.data.libraries.write(os.path.join(outdir,'gore-cut-surfaces.blend'),{scene},fake_user=True)
print(json.dumps({'export':output,'objects':[{ 'name':o.name,'vertices':len(o.data.vertices),'triangles':len(o.data.loop_triangles)} for o in objects]}))
