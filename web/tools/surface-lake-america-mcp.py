
"""Lake America surface / axe recipe. Execute inside Blender MCP only.
Open the first-pass master before replaying. Runtime surface preservation,
lighting, grading and readiness changes live in the accompanying game source.
This recipe authors the editable master and self-contained source GLB.
"""
import bpy, math, json, random
import numpy as np
from pathlib import Path
from mathutils import Vector
SURFACE_VERSION='2026-10-09-mcp-pbr-v2'

def pbr_material(key,name,color,roughness,metallic=0):
    mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=(*color,1)
    p=mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Roughness'].default_value=roughness;p.inputs['Metallic'].default_value=metallic
    vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Color'
    mat.node_tree.links.new(vc.outputs['Color'],p.inputs['Base Color'])
    M[key]=(mat,color)
    return mat

def swept_oval(group,key,sections,sides=16):
    verts=[];faces=[]
    for x,y,rx,rz in sections:
        for j in range(sides):
            a=j*math.tau/sides
            verts.append((x+math.cos(a)*rx,y,math.sin(a)*rz))
    for i in range(len(sections)-1):
        for j in range(sides):
            a=i*sides+j;b=i*sides+(j+1)%sides
            faces.append((a,b,b+sides,a+sides))
    faces.extend([tuple(reversed(range(sides))),tuple((len(sections)-1)*sides+j for j in range(sides))])
    batch(group,key).add(verts,faces)

def rebuild_axe():
    root=bpy.data.objects['lake-america-axe']
    for obj in list(root.children):
        if obj.type=='MESH':bpy.data.objects.remove(obj,do_unlink=True)
    pbr_material('haft','Hickory · oiled rescue axe haft',(.33,.165,.062),.48)
    pbr_material('toolsteel','Tool steel · hand forged axe head',(.14,.17,.19),.35,.92)
    pbr_material('toolbit','Tool steel · honed cutting bevel',(.61,.65,.69),.16,.96)
    pbr_material('toolpaint','Tool enamel · rescue red',(.38,.017,.021),.3,.12)
    pbr_material('toolrubber','Tool grip · vulcanized rubber',(.013,.017,.02),.77)
    offset=-.17;g='lake-america-axe detail rebuilt'
    outline=[(-.24,-.17),(-.17,-.14),(-.07,-.185),(.03,-.17),(.16,-.2),(.31,-.12),
             (.425,-.145),(.455,-.24),(.45,-.34),(.415,-.43),(.29,-.42),(.16,-.32),
             (.025,-.30),(-.08,-.27),(-.235,-.205)]
    profile(g,'toolsteel',[(x+offset,y) for x,y in outline],0,.105)
    edge=[(.425,-.145),(.455,-.24),(.45,-.34),(.415,-.43),(.37,-.414),
          (.403,-.33),(.408,-.245),(.38,-.163)]
    profile(g,'toolbit',[(x+offset,y) for x,y in edge],0,.109)
    face=[(.1,-.21),(.27,-.15),(.37,-.165),(.397,-.24),(.39,-.33),(.36,-.395),
          (.29,-.39),(.15,-.295),(.08,-.285)]
    for z in [-.0555,.0555]:
        profile(g,'toolpaint',[(x+offset,y) for x,y in face],z,.005)
        box(g,'cream',offset+.285,-.263,z*1.08,.057,.016,.003)
        box(g,'cream',offset+.285,-.263,z*1.08,.016,.064,.003)
        ellipsoid(g,'toolbit',offset+.015,-.245,z*1.08,.014,.014,.003,10,3)
    # A continuous oval hickory haft with a gentle ergonomic bend.
    sections=[(offset+.015,-.325,.036,.024),(offset+.02,-.21,.032,.023),
              (offset+.035,-.07,.028,.021),(offset+.02,.12,.029,.022),
              (offset-.025,.32,.035,.026),(offset-.05,.48,.041,.029),
              (offset-.03,.635,.045,.032)]
    swept_oval(g,'haft',sections)
    swept_oval(g,'toolsteel',[(offset+.015,-.325,.052,.056),(offset+.02,-.19,.048,.053)],16)
    swept_oval(g,'toolrubber',[(offset-.01,.265,.035,.028),(offset-.025,.32,.038,.03),
                              (offset-.05,.48,.044,.033),(offset-.03,.635,.048,.036)],20)
    for y,cx,rx,rz in [(.275,offset-.013,.038,.03),(.626,offset-.031,.049,.037)]:
        swept_oval(g,'toolpaint',[(cx,y-.008,rx,rz),(cx,y+.008,rx,rz)],20)
    for i in range(10):
        y=.31+i*.029
        t=(y-.32)/.315;cx=offset-.025-.028*math.sin(max(0,t)*math.pi)
        rx=.04+.007*max(0,t);rz=.031+.005*max(0,t)
        for j in range(16):
            a=j*math.tau/16;b=(j+1)*math.tau/16
            beam(g,'toolrubber',(cx+rx*math.cos(a),y,rz*math.sin(a)),
                 (cx+rx*math.cos(b),y+.003,rz*math.sin(b)),.0018,4,.83)
    ring(g,'toolbit',offset-.031,.596,.038,.011,.0025,14,5)
    ellipsoid(g,'toolrubber',offset-.031,.596,.039,.0075,.0075,.001,8,3)
    # Short safety lanyard hangs naturally from the butt.
    last=(offset-.031,.596,.041)
    for i in range(1,17):
        a=i*math.tau/16
        nxt=(offset-.09+.059*math.cos(a),.53+.066*math.sin(a),.04)
        beam(g,'toolpaint',last,nxt,.004,6);last=nxt
    made=flush()
    for obj in made:
        if any(k in obj.name for k in ['_toolsteel','_toolbit','_toolpaint']):
            bevel(obj,.0025 if '_toolbit' in obj.name else .0035,2)
        elif any(k in obj.name for k in ['_haft','_toolrubber']):
            smooth_object(obj)
    manifest_path=ROOT/'game/public/stages/lake-america-3d/manifest.json'
    manifest=json.loads(manifest_path.read_text())
    manifest['axe']['bladeCenterLocal']=[.17,-.29,0]
    manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    FEATURES.append('Rebuilt rescue axe: curved oval hickory haft, forged socket and pick, honed curved edge, enamel face, rubber grip and safety lanyard')
    return {'meshes':len(made),'triangles':tri_count()}

SURFACE_MAPS={}
SURFACE_CONFIG={
 'wood':(.55,.19,.0017), 'bark':(.82,.14,.003),
 'granite':(.79,.16,.0016), 'snow':(.93,.065,.001),
 'forged':(.38,.16,.001), 'brushed':(.22,.10,.00065),
 'enamel':(.34,.14,.001), 'rubber':(.79,.12,.0012),
 'canvas':(.86,.10,.0011), 'ice':(.36,.22,.001),
 'fur':(.91,.07,.002), 'glass':(.22,.08,.0005),
}

def surface_field(kind,size=512):
    rr=np.random.default_rng(7319+sum(map(ord,kind)))
    v,u=np.mgrid[0:size,0:size].astype(np.float32)/size*math.tau
    fx=np.fft.rfftfreq(size)*size;fy=np.fft.fftfreq(size)*size
    frequency=fy[:,None]**2+fx[None,:]**2
    white=np.fft.rfft2(rr.normal(0,1,(size,size)))
    def noise(scale):
        out=np.fft.irfft2(white*np.exp(-frequency/(2*scale*scale)),s=(size,size)).astype(np.float32)
        return (out-out.mean())/max(.001,float(out.std()))
    macro=noise(5);fine=noise(80)
    if kind=='wood':
        warp=.45*np.sin(v*2)+.2*np.sin(v*5+u*2)
        field=np.sin(u*31+warp)+.2*np.sin(u*91+warp*2)+.07*fine
        roughnoise=.62*macro+.38*field
    elif kind=='bark':
        ridges=np.abs(np.sin(u*17+np.sin(v*2)*.65))**.3
        field=ridges*1.4+.12*noise(30);roughnoise=.5*macro+.7*(1-ridges)
    elif kind=='granite':
        field=noise(30)*.38+fine*.28;roughnoise=.65*macro+.35*fine
    elif kind=='forged':
        field=noise(23)*.3+fine*.12;roughnoise=.65*macro+.35*fine
    elif kind=='brushed':
        field=.25*np.sin(u*121+np.sin(v*3)*.18)+fine*.025
        roughnoise=.5*macro+.3*np.sin(u*93)+.2*fine
    elif kind=='rubber':
        field=np.sin((u+v)*41)*np.sin((u-v)*41)*.25+fine*.04
        roughnoise=macro*.6+fine*.4
    elif kind=='canvas':
        field=np.sin(u*101)*.2+np.sin(v*101)*.2+fine*.03
        roughnoise=.6*macro+.4*field
    elif kind=='fur':
        field=np.sin(u*101+np.sin(v*3)*.5)*.09+fine*.04
        roughnoise=macro*.6+fine*.4
    elif kind=='ice':
        field=noise(35)*.08+fine*.035
        roughnoise=macro*.6+noise(18)*.2
    else:
        field=noise(60)*.08+fine*.1;roughnoise=macro*.65+fine*.35
    field=field.astype(np.float32)
    mean,spread,amplitude=SURFACE_CONFIG[kind]
    dx=(np.roll(field,-1,axis=1)-np.roll(field,1,axis=1))*.5*size*amplitude
    dy=(np.roll(field,-1,axis=0)-np.roll(field,1,axis=0))*.5*size*amplitude
    n=np.stack([-dx,-dy,np.ones_like(dx)],axis=-1);n/=np.linalg.norm(n,axis=-1,keepdims=True)
    normal=np.ones((size,size,4),np.float32);normal[:,:,:3]=n*.5+.5
    rough=np.ones((size,size,4),np.float32)
    value=np.clip(mean+np.tanh(roughnoise*.65)*spread,.07,.995);rough[:,:,:3]=value[:,:,None]
    return normal,rough

def bake_surface_maps():
    folder=ROOT/'stages/lake_america/blender/textures'
    folder.mkdir(parents=True,exist_ok=True)
    for kind in SURFACE_CONFIG:
        data=surface_field(kind,1024 if kind in ['wood','forged','brushed'] else 512)
        images=[]
        for suffix,pixels in zip(['normal','roughness'],data):
            size=pixels.shape[0]
            name='Lake America · '+kind+' '+suffix
            image=bpy.data.images.get(name) or bpy.data.images.new(name,width=size,height=size,alpha=False,float_buffer=False)
            image.colorspace_settings.name='Non-Color'
            image.pixels.foreach_set(pixels.ravel());image.update()
            image.filepath_raw=str(folder/(kind+'_'+suffix+'.png'));image.file_format='PNG'
            image.save();image.pack()
            images.append(image)
        SURFACE_MAPS[kind]=images
    return {'families':len(SURFACE_MAPS),'images':len(SURFACE_MAPS)*2}

def surface_family(mat):
    name=mat.name
    if name.startswith(('Lantern','PREVIEW')):return None
    if name.startswith('Hickory'):return ('wood',.45,2.6)
    if name.startswith('Tool steel · honed'):return ('brushed',.28,3.)
    if name.startswith('Tool steel'):return ('forged',.38,3.)
    if name.startswith('Tool grip'):return ('rubber',.68,2.4)
    if name.startswith('Tool enamel'):return ('enamel',.45,2.5)
    if name.startswith('Slate'):return ('ice',.26,.75)
    if name.startswith(('Granite','Architecture')):return ('granite',.45,1.3)
    if name.startswith('Snow'):return ('snow',.32,1.7)
    if name.startswith('Ice'):return ('ice',.45,1.8)
    if name.startswith('Pine'):return ('fur',.3,1.7)
    if name.startswith('Bark'):return ('bark',.4,1.7)
    if name.startswith('City · lake') or name.startswith('Windows'):return ('glass',.1,1.3)
    if name.startswith('City'):return ('granite',.15,.8)
    if name.startswith('Cedar'):return ('wood',.35,1.8)
    if name.startswith('Rope'):return ('canvas',.65,2.8)
    if name.startswith('Axe · forged'):return ('forged',.6,3.)
    if name.startswith('Axe · polished'):return ('brushed',.2,3.)
    if name.startswith('Axe · black'):return ('rubber',.65,2.)
    if name.startswith('Flagpole'):return ('brushed',.42,2.6)
    if name.startswith(('Festival','Goose','Moose')):return ('fur',.3,2.)
    return ('enamel',.4,1.8)

def assign_surface_maps():
    meshes=[o for o in bpy.context.scene.objects if o.type=='MESH'
            and not any(c.name.startswith(('90','91','92','93')) for c in o.users_collection)]
    mats={m for o in meshes for m in o.data.materials if m}
    for mat in mats:
        family=surface_family(mat)
        if not family:continue
        kind,strength,scale=family
        normal_image,rough_image=SURFACE_MAPS[kind]
        nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF')
        for node in list(nodes):
            if node.bl_idname in {'ShaderNodeUVMap','ShaderNodeNormalMap','ShaderNodeSeparateColor'} or (node.bl_idname=='ShaderNodeTexImage' and node.image and node.image.name.startswith('Lake America · ')):nodes.remove(node)
        uv=nodes.new('ShaderNodeUVMap');uv.uv_map='UVMap';uv.label='Surface detail in meters'
        normal=nodes.new('ShaderNodeTexImage');normal.image=normal_image;normal.label='Tangent-space surface normal'
        rough=nodes.new('ShaderNodeTexImage');rough.image=rough_image;rough.label='Surface roughness variation'
        convert=nodes.new('ShaderNodeNormalMap');convert.space='TANGENT';convert.uv_map='UVMap'
        convert.inputs['Strength'].default_value=strength
        separate=nodes.new('ShaderNodeSeparateColor');separate.mode='RGB'
        links.new(uv.outputs['UV'],normal.inputs['Vector']);links.new(uv.outputs['UV'],rough.inputs['Vector'])
        links.new(normal.outputs['Color'],convert.inputs['Color']);links.new(convert.outputs['Normal'],p.inputs['Normal'])
        links.new(rough.outputs['Color'],separate.inputs[0]);links.new(separate.outputs['Green'],p.inputs['Roughness'])
        mat['surface_family']=kind;mat['normal_strength']=strength;mat['uv_scale']=scale
    mapped=0
    for obj in meshes:
        mesh=obj.data
        if not mesh.materials:continue
        mat=mesh.materials[0];family=surface_family(mat)
        if not family:continue
        kind,strength,scale=family
        uv=mesh.uv_layers.get('UVMap') or mesh.uv_layers.new(name='UVMap')
        axe_haft=mat.name.startswith('Hickory')
        for poly in mesh.polygons:
            axis=max(range(3),key=lambda i:abs(poly.normal[i]))
            for i in poly.loop_indices:
                v=mesh.vertices[mesh.loops[i].vertex_index].co
                if axis==2:pair=(v.x,-v.y)
                elif axis==1:pair=(v.x,v.z)
                else:pair=(-v.y,v.z)
                if kind=='wood' and not axe_haft:pair=pair[::-1]
                uv.data[i].uv=(pair[0]*scale,pair[1]*scale)
        mapped+=1
    FEATURES.append('24 authored seamless normal/roughness maps across wood, bark, granite, snow, forged/brushed steel, enamel, rubber, canvas, ice, fur and glass; packed into the editable master and GLB')
    return {'mappedMeshes':mapped,'mappedMaterials':sum(bool(surface_family(m)) for m in mats)}

def light_source_review():
    s=bpy.context.scene
    sun=next(o for o in s.objects if o.type=='LIGHT' and o.data.type=='SUN')
    sun.location=coord((-16,11,9))
    sun.rotation_euler=(Vector(coord((0,0,-4)))-sun.location).to_track_quat('-Z','Y').to_euler()
    sun.data.energy=3.35;sun.data.color=(1,.79,.57);sun.data.angle=.07
    bg=s.world.node_tree.nodes.get('Background');bg.inputs['Strength'].default_value=.12
    c=next(c for c in bpy.data.collections if c.name=='91 Preview lighting')
    for name,pos,target,color,power,size in [
        ('MCP Cool sky fill',(10,8,2),(0,1,-6),(.57,.75,1),450,12),
        ('MCP Shore rim',(14,7,-21),(0,1,-5),(.5,.74,1),850,9)]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.color=color;data.shape='DISK';data.size=size
        obj=bpy.data.objects.new(name,data);c.objects.link(obj);obj.location=coord(pos)
        obj.rotation_euler=(Vector(coord(target))-obj.location).to_track_quat('-Z','Y').to_euler()
    s.view_settings.exposure=-.15
    FEATURES.append('Directional warm key, restrained cool fill and shore rim, stronger contact shadows, deeper blue ice and less washed-out skyline haze')

def bootstrap_surface_pass():
    """Bind shared authoring helpers to a first-pass master without rebuilding it."""
    global ROOT, VERSION, FEATURES, M, batches, collections
    import ast, bmesh, shutil
    from datetime import datetime
    globals().update(ast=ast,bmesh=bmesh,shutil=shutil,datetime=datetime)
    ROOT=Path(__file__).resolve().parents[1]
    VERSION='2026-10-09-mcp-rich-v1'
    FEATURES=[];M={};batches={};collections={}
    scene=bpy.context.scene
    if scene.get('lake_surface_finish')==SURFACE_VERSION:
        raise RuntimeError('Surface pass already applied. Open the pre-surface backup to re-author.')
    if scene.get('lake_mcp_finish')!=VERSION:
        raise RuntimeError('Open the Lake America first-pass master before applying the surface pass.')
    source=(ROOT/'tools/polish-lake-america-mcp.py').read_text(encoding='utf-8')
    tree=ast.parse(source)
    setup=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='setup')
    prefix_node=next(n for n in setup.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='prefixes' for t in n.targets))
    for key,prefix in ast.literal_eval(prefix_node.value).items():
        mat=next(m for m in bpy.data.materials if m.name.startswith(prefix))
        M[key]=(mat,tuple(mat.diffuse_color[:3]))
    names={'collection','flush','bevel','tri_count','smooth_object','export_runtime'}
    defs=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=defs,type_ignores=[]),'Lake America finish helpers','exec'),globals())
    tree=ast.parse((ROOT/'tools/build-lake-america.py').read_text(encoding='utf-8'))
    names={'coord','Batch','batch','box','beam','profile','ring','lathe','ellipsoid'}
    defs=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
    exec(compile(ast.Module(body=defs,type_ignores=[]),'Lake America geometry helpers','exec'),globals())
    backup=ROOT/'artifacts/lake-america'/('before-surface-pass-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    for relative in ['stages/lake_america/blender/lake-america.blend',
                     'game/public/stages/lake-america-3d/lake-america.glb',
                     'game/public/stages/lake-america-3d/manifest.json']:
        target=backup/relative;target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(ROOT/relative,target)
    scene['surface_pass_backup']=str(backup)
    random.seed(100926)

def export_surface_runtime():
    result=export_runtime()
    path=ROOT/'game/public/stages/lake-america-3d/manifest.json'
    manifest=json.loads(path.read_text(encoding='utf-8'))
    manifest['surfacePass']={
        'version':SURFACE_VERSION,
        'method':'Native Blender MCP; authored tangent normal and roughness maps, rebuilt axe, runtime lighting and grade',
        'recipe':'web/tools/surface-lake-america-mcp.py',
        'backup':'web/'+Path(str(bpy.context.scene['surface_pass_backup'])).relative_to(ROOT).as_posix(),
        'families':list(SURFACE_CONFIG),
        'images':24,
        'keyPosition':[-16,11,9],
        'keyIntensity':3.35,
        'hemisphereIntensity':.6,
        'fillIntensity':.55,
        'rimIntensity':.85,
    }
    path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    return result

def save_surface_master():
    scene=bpy.context.scene
    scene['lake_surface_finish']=SURFACE_VERSION
    scene['surface_recipe']='Execute web/tools/surface-lake-america-mcp.py inside Blender MCP on the pre-surface backup. Do not apply twice.'
    scene['surface_features']=json.dumps(FEATURES)
    scene.render.engine='BLENDER_EEVEE'
    scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-.15
    scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.camera=next(o for o in scene.objects if o.type=='CAMERA' and o.name=='CAM Combat')
    for image in bpy.data.images:
        if image.name.startswith('Lake America · ') and not image.packed_file:image.pack()
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'stages/lake_america/blender/lake-america.blend'))

def main_surface_pass():
    bootstrap_surface_pass()
    rebuild_axe()
    bake_surface_maps()
    assign_surface_maps()
    light_source_review()
    result=export_surface_runtime()
    save_surface_master()
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    main_surface_pass()
