
"""Satirical Lake America props. Execute stages through native Blender MCP.
Open a saved surface-pass master first; the guard prevents double application.
"""
import ast, bpy, bmesh, json, math, random, shutil, subprocess
import numpy as np
from datetime import datetime
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
VERSION='2026-10-09-mcp-rich-v1'
PROP_VERSION='2026-10-09-mcp-satire-v3'
FEATURES=[];M={};batches={};collections={}

def bind_helpers():
    source=(ROOT/'tools/polish-lake-america-mcp.py').read_text(encoding='utf-8')
    tree=ast.parse(source)
    setup=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='setup')
    item=next(n for n in setup.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='prefixes' for t in n.targets))
    for key,prefix in ast.literal_eval(item.value).items():
        mat=next(m for m in bpy.data.materials if m.name.startswith(prefix))
        M[key]=(mat,tuple(mat.diffuse_color[:3]))
    names={'collection','flush','bevel','tri_count','smooth_object','export_runtime'}
    defs=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names]
    exec(compile(ast.Module(body=defs,type_ignores=[]),'Lake America finish helpers','exec'),globals())
    tree=ast.parse((ROOT/'tools/build-lake-america.py').read_text(encoding='utf-8'))
    names={'coord','Batch','batch','box','beam','profile','ring','lathe','ellipsoid'}
    defs=[n for n in tree.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
    exec(compile(ast.Module(body=defs,type_ignores=[]),'Lake America geometry helpers','exec'),globals())

def prop_root(name,position,yaw=0):
    root=bpy.data.objects.new(name,None);collection('08 MCP Satirical park props').objects.link(root)
    root.location=coord(position);root.rotation_euler.z=yaw
    return root

def parent_parts(root,parts):
    for obj in parts:
        obj.parent=root;obj['lake_satire_prop']=root.name

def model_material(key,name,color,metallic,normal='enamel',roughness=None,strength=.35):
    mat=bpy.data.materials.new(name);mat.use_nodes=True;mat.diffuse_color=(*color,1)
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF')
    p.inputs['Metallic'].default_value=metallic;p.inputs['Roughness'].default_value=.7
    vc=nodes.new('ShaderNodeVertexColor');vc.layer_name='Color';links.new(vc.outputs['Color'],p.inputs['Base Color'])
    M[key]=(mat,color)
    add_surface_maps(mat,normal,roughness or normal,strength)
    return mat

def add_surface_maps(mat,normal,roughness,strength):
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF')
    normal_tex=nodes.new('ShaderNodeTexImage');normal_tex.image=bpy.data.images['Lake America · '+normal+' normal']
    rough_tex=nodes.new('ShaderNodeTexImage');rough_tex.image=bpy.data.images['Lake America · '+roughness+' roughness']
    convert=nodes.new('ShaderNodeNormalMap');convert.inputs['Strength'].default_value=strength;convert.uv_map='UVMap'
    split=nodes.new('ShaderNodeSeparateColor');split.mode='RGB'
    links.new(normal_tex.outputs['Color'],convert.inputs['Color']);links.new(convert.outputs['Normal'],p.inputs['Normal'])
    links.new(rough_tex.outputs['Color'],split.inputs[0]);links.new(split.outputs['Green'],p.inputs['Roughness'])

def cube_uv(obj,scale=1.8):
    uv=obj.data.uv_layers.get('UVMap') or obj.data.uv_layers.new(name='UVMap')
    for poly in obj.data.polygons:
        axis=max(range(3),key=lambda i:abs(poly.normal[i]))
        for i in poly.loop_indices:
            v=obj.data.vertices[obj.data.loops[i].vertex_index].co
            pair=(v.x,-v.y) if axis==2 else (v.x,v.z) if axis==1 else (-v.y,v.z)
            uv.data[i].uv=(pair[0]*scale,pair[1]*scale)

def finish_parts(root,bevel_width=0):
    parts=flush()
    for obj in parts:
        if bevel_width:bevel(obj,bevel_width,1)
        cube_uv(obj)
    parent_parts(root,parts)
    return parts

def face_material(name,image,normal='enamel',roughness=None,strength=.25,emission=0):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    nodes=mat.node_tree.nodes;links=mat.node_tree.links;p=nodes.get('Principled BSDF')
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;links.new(tex.outputs['Color'],p.inputs['Base Color'])
    p.inputs['Metallic'].default_value=.06
    if emission:
        links.new(tex.outputs['Color'],p.inputs['Emission Color']);p.inputs['Emission Strength'].default_value=emission
    add_surface_maps(mat,normal,roughness or normal,strength)
    return mat

def textured_face(root,name,position,width,height,material):
    x,y,z=position
    mesh=bpy.data.meshes.new(name)
    mesh.from_pydata([coord((x-width/2,y-height/2,z)),coord((x+width/2,y-height/2,z)),
                     coord((x+width/2,y+height/2,z)),coord((x-width/2,y+height/2,z))],[],[(0,1,2,3)])
    mesh.materials.append(material);uv=mesh.uv_layers.new(name='UVMap')
    for i,pair in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=pair
    obj=bpy.data.objects.new(name,mesh);collection('08 MCP Satirical park props').objects.link(obj);obj.parent=root
    obj['lake_satire_prop']=root.name
    return obj

def bake_graphics(only=None):
    folder=ROOT/'stages/lake_america/blender/textures';folder.mkdir(parents=True,exist_ok=True)
    # Aged printing and a large segmented boot tread, matching the old prop sheet.
    rng=random.Random(418)
    wrinkles=''.join(f'<path d="M {rng.randrange(70,950)} 0 Q {rng.randrange(150,850)} 750 {rng.randrange(70,950)} 1536" stroke="#72542b" stroke-width="{rng.uniform(.6,2.2):.2f}" opacity=".12" fill="none"/>' for _ in range(36))
    body=''
    for row in range(42):
        yy=370+row*24
        if 670<yy<810:continue
        words=['the people','rights','shall','and','liberty','of','to','the','peaceably','be','secure','person','assembly','law']
        line=' '.join(rng.choice(words) for _ in range(rng.randint(16,23)))
        body+=f'<text x="115" y="{yy}" font-family="Georgia,serif" font-size="15" fill="#554224" opacity=".76">{line}</text>'
    paper=f'''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1536" viewBox="0 0 1024 1536">
    <defs><radialGradient id="paper"><stop stop-color="#ead5a0"/><stop offset=".67" stop-color="#d9bb7d"/><stop offset="1" stop-color="#926b3f"/></radialGradient>
    <path id="bootSole" d="M-85-277C-137-263-161-228-159-176C-158-108-140-48-116 14C-95 68-78 100-67 127L47 119C37 86 34 62 47 30C69-21 110-71 129-124C152-190 138-242 96-267C49-295-27-296-85-277Z M-65 165Q-83 217-73 282Q-14 316 66 287Q83 228 57 160Z"/>
    <mask id="treadCuts" maskUnits="userSpaceOnUse" x="-170" y="-310" width="340" height="660">
      <rect x="-170" y="-310" width="340" height="660" fill="white"/>
      <g fill="none" stroke="black" stroke-width="14" stroke-linejoin="round">
        <path d="M-145-226Q-15-269 127-223M-154-168Q-20-197 139-166"/>
        <path d="M-149-112L-71-101-5-113 72-101 130-119M-129-53L-69-43-6-55 60-43 100-57M-106 6L-58 13-5 3 59 15M-83 64L-40 73 36 58"/>
        <path d="M-38-246L-38-203M42-245L42-204M-89-193L-83-118M9-191L9-119M83-184L80-114M-36-107L-31-55M39-103L30-51M-67-45L-55 11M0-45L0 10M-31 18L-20 68"/>
        <path d="M-75 206L73 203M-80 252L78 249M-23 171V205M24 207V250M-27 254V299"/>
      </g>
      <g fill="black" opacity=".45"><circle cx="-112" cy="-207" r="5"/><circle cx="58" cy="-137" r="7"/><circle cx="-70" cy="-12" r="6"/><circle cx="-3" cy="277" r="5"/><ellipse cx="44" cy="185" rx="8" ry="4"/></g>
    </mask></defs>
    <rect width="1024" height="1536" fill="url(#paper)"/>
    <g fill="#6a4928" opacity=".15"><ellipse cx="90" cy="930" rx="110" ry="390"/><ellipse cx="950" cy="340" rx="145" ry="290"/><ellipse cx="420" cy="1490" rx="310" ry="88"/></g>
    {wrinkles}<rect x="85" y="113" width="854" height="1266" rx="8" fill="none" stroke="#70512e" stroke-width="2" opacity=".38"/>
    <text x="512" y="232" text-anchor="middle" font-family="Georgia,serif" font-size="96" font-weight="bold" fill="#3c2b17">Bill of Rights</text>
    <text x="512" y="292" text-anchor="middle" font-family="Georgia,serif" font-size="28" font-style="italic" fill="#6b4c28">We the People</text>
    <path d="M140 325H884" stroke="#74542d" stroke-width="2"/>{body}
    <g transform="translate(580 805) rotate(-17) scale(1.43)">
      <use href="#bootSole" fill="#44301e" opacity=".22" transform="translate(3 4)"/>
      <use href="#bootSole" fill="#3a291b" opacity=".28"/>
      <use href="#bootSole" fill="#312419" opacity=".78" mask="url(#treadCuts)"/>
      <use href="#bootSole" fill="none" stroke="#39271b" stroke-width="5" opacity=".44"/>
      <g fill="#4d3420" opacity=".37">
        <ellipse cx="-117" cy="-232" rx="9" ry="17"/><ellipse cx="124" cy="-173" rx="8" ry="12"/>
        <ellipse cx="101" cy="282" rx="7" ry="14"/><ellipse cx="-101" cy="223" rx="6" ry="11"/>
        <circle cx="-122" cy="185" r="5"/><circle cx="129" cy="-94" r="4"/>
      </g>
    </g>
    <g stroke="#f0dcaa" stroke-width="1" opacity=".36"><path d="M80 525L940 550"/><path d="M450 70L570 1440"/><path d="M100 1160L910 1112"/></g>
    <text x="512" y="1424" text-anchor="middle" font-family="Georgia,serif" font-size="27" fill="#5e4125" opacity=".65">HANDLE WITH CARE</text></svg>'''
    machine='''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1664" viewBox="0 0 1024 1664">
    <defs><linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#122e37"/><stop offset=".5" stop-color="#294b53"/><stop offset="1" stop-color="#10212d"/></linearGradient></defs>
    <rect width="1024" height="1664" fill="#ece4c8"/><rect x="18" y="18" width="988" height="1628" rx="20" fill="none" stroke="#b49c65" stroke-width="12"/>
    <rect x="42" y="40" width="940" height="214" rx="12" fill="#a52929"/>
    <text x="512" y="156" text-anchor="middle" fill="#fff0c9" font-family="Arial,sans-serif" font-size="125" font-weight="900" letter-spacing="5">FREEDOM</text>
    <text x="512" y="218" text-anchor="middle" fill="#ead6aa" font-family="Arial,sans-serif" font-size="28" letter-spacing="7">PAY MORE. GET LESS.</text>
    <rect x="65" y="282" width="894" height="997" rx="12" fill="url(#glass)" stroke="#746748" stroke-width="12"/>
    <path d="M120 320H305L605 1235H420Z" fill="#a8d3dc" opacity=".06"/>
    <g font-family="Arial,sans-serif" text-anchor="middle">
    <text x="512" y="388" fill="#f3e5bc" font-weight="bold" font-size="58">FREE SPEECH</text>
    <text x="512" y="452" fill="#abbfc4" font-size="41">ONE WORD</text>
    <text x="512" y="548" fill="#f7c17b" font-weight="bold" font-size="91">$499.99</text>
    <path d="M110 596H914" stroke="#83918a" stroke-width="9"/>
    <text x="512" y="690" fill="#f3e5bc" font-weight="bold" font-size="58">PRIVACY</text>
    <text x="512" y="754" fill="#abbfc4" font-size="41">0.1 SECOND</text>
    <text x="512" y="850" fill="#f7c17b" font-weight="bold" font-size="91">$999.99</text>
    <path d="M110 898H914" stroke="#83918a" stroke-width="9"/>
    <text x="512" y="992" fill="#f3e5bc" font-weight="bold" font-size="58">DUE PROCESS</text>
    <text x="512" y="1056" fill="#abbfc4" font-size="41">TRAVEL SIZE</text>
    <text x="512" y="1152" fill="#f7c17b" font-weight="bold" font-size="91">$9,999.99</text>
    </g><rect x="176" y="1310" width="672" height="156" rx="12" fill="#5b171a" stroke="#b95b43" stroke-width="4"/>
    <text x="512" y="1420" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="108" fill="#ffb28a">SOLD OUT</text>
    <text x="512" y="1540" text-anchor="middle" font-family="Arial,sans-serif" font-size="39" font-weight="bold" fill="#6c4a32">NO REFUNDS. OBVIOUSLY.</text>
    <text x="512" y="1597" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" fill="#886f50" letter-spacing="3">AMERICAN DREAM / POCKET EDITION</text></svg>'''
    bell='''<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="384"><rect width="1024" height="384" rx="16" fill="#19333d"/><rect x="15" y="15" width="994" height="354" rx="10" fill="none" stroke="#bba06b" stroke-width="7"/>
    <text x="512" y="145" text-anchor="middle" font-family="Georgia,serif" font-size="102" font-weight="bold" fill="#f5e8bb">LIBERTY</text>
    <text x="512" y="270" text-anchor="middle" font-family="Arial,sans-serif" font-size="79" font-weight="bold" fill="#e6a179">OUT OF ORDER</text></svg>'''
    designs={'rights-scroll':paper,'freedom-machine':machine,'liberty-plaque':bell}
    design_file=folder/'satire-designs.json';design_file.write_text(json.dumps(designs),encoding='utf-8')
    script="import sharp from 'sharp';import fs from 'node:fs';const f=process.argv[1],d=JSON.parse(fs.readFileSync(f+'/satire-designs.json','utf8'));for(const [n,s] of Object.entries(d))if(!process.argv[2]||n===process.argv[2])await sharp(Buffer.from(s)).png().toFile(f+'/'+n+'_albedo.png');"
    result=subprocess.run([r'C:\Program Files\nodejs\node.exe','--input-type=module','--eval',script,str(folder),only or ''],cwd=ROOT,capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr
    images={}
    for name in designs:
        if only and name!=only:continue
        p=folder/(name+'_albedo.png')
        image=bpy.data.images.load(str(p),check_existing=False);image.name='Lake America · '+name+' albedo';image.colorspace_settings.name='sRGB';image.pack();images[name]=image
    if only:return images
    # Fine paper creases with matte, mottled roughness. Not embossed fabric.
    n=1024;v,u=np.mgrid[0:n,0:n].astype(np.float32)/n
    height=.00014*(np.sin(u*107+np.sin(v*9)*3)+np.sin(v*211+u*3)*.4)
    for center,slope in [(.26,.11),(.61,-.08),(.77,.17)]:
        height+=.00055*np.exp(-((u-center-v*slope)/.014)**2)
    height+=.00023*np.sin(v*math.tau*5+np.sin(u*math.tau*2))
    dy,dx=np.gradient(height);nx=-dx*n;ny=-dy*n;nz=np.ones_like(nx);length=np.sqrt(nx*nx+ny*ny+nz*nz)
    rgba=np.ones((n,n,4),np.float32);rgba[:,:,:3]=np.stack((nx/length,ny/length,nz/length),axis=-1)*.5+.5
    rough=np.ones_like(rgba);rough[:,:,:3]=np.clip(.87+.06*np.sin(u*19+v*37)+.03*np.sin(u*131-v*93),.72,.98)[:,:,None]
    for suffix,data in [('normal',rgba),('roughness',rough)]:
        image=bpy.data.images.new('Lake America · parchment '+suffix,width=n,height=n,alpha=False)
        image.colorspace_settings.name='Non-Color';image.pixels.foreach_set(data.ravel());image.update()
        image.filepath_raw=str(folder/('parchment_'+suffix+'.png'));image.file_format='PNG';image.save();image.pack()
    return images

def maple_axe():
    root=bpy.data.objects['lake-america-axe']
    old=[o for o in root.children if o.type=='MESH' and o.name.endswith('_cream')]
    for obj in old:bpy.data.objects.remove(obj,do_unlink=True)
    outline=[(0,.095),(.016,.058),(.033,.068),(.03,.024),(.064,.044),(.061,.016),(.09,.022),(.073,-.012),(.083,-.026),(.038,-.053),(.041,-.070),(.006,-.065),(.006,-.099),(-.006,-.099),(-.006,-.065),(-.041,-.070),(-.038,-.053),(-.083,-.026),(-.073,-.012),(-.09,.022),(-.061,.016),(-.064,.044),(-.03,.024),(-.033,.068),(-.016,.058)]
    for z in [-.0605,.0605]:
        profile('lake-america-axe detail maple badge','cream',[(.115+x*.46,-.263+y*.46) for x,y in outline],z,.002)
    parts=flush()
    for obj in parts:cube_uv(obj,2.5)
    FEATURES.append('The axe rescue cross is replaced by a small ivory maple leaf')
    return parts

def build_scroll(images):
    root=prop_root('lake-america-bill-of-rights',(-2.35,.055,-3.5),.08)
    mat=face_material('Parchment · trampled Bill of Rights',images['rights-scroll'],'parchment',strength=.5)
    mat.use_backface_culling=False
    nx,ny=16,24;verts=[];faces=[];rng=random.Random(477)
    left=[];right=[]
    for j in range(ny+1):
        left.append(-.76+rng.uniform(-.028,.028)+(0.07 if j in [2,8,17,22] else 0))
        right.append(.76+rng.uniform(-.028,.028)-(0.06 if j in [4,11,19,23] else 0))
    for j in range(ny+1):
        v=j/ny
        for i in range(nx+1):
            u=i/nx;x=left[j]*(1-u)+right[j]*u
            y=v*1.95
            if j in [0,ny]:y+=rng.uniform(-.047,.047)-(.065 if i in [3,11,14] else 0)
            z=-v*.16+.027*math.sin(u*11+v*3)+.016*math.sin(u*4-v*13)
            if v>.92:
                a=(v-.92)/.08*math.pi*.65;y=.92*1.95+math.sin(a)*.09;z+=.075*(1-math.cos(a))
            elif v<.09:
                a=(.09-v)/.09*math.pi*.75;y=.09*1.95-math.sin(a)*.11;z+=.10*(1-math.cos(a))
            verts.append(coord((x,y,z)))
    for j in range(ny):
        for i in range(nx):
            if (i,j) in {(0,3),(15,18),(1,22)}:continue
            a=j*(nx+1)+i;faces.append((a,a+1,a+nx+2,a+nx+1))
    mesh=bpy.data.meshes.new('Curled, torn parchment');mesh.from_pydata(verts,[],faces);mesh.materials.append(mat)
    uv=mesh.uv_layers.new(name='UVMap')
    for poly in mesh.polygons:
        poly.use_smooth=True
        for k in poly.loop_indices:
            idx=mesh.loops[k].vertex_index;uv.data[k].uv=(idx%(nx+1)/nx,idx//(nx+1)/ny)
    obj=bpy.data.objects.new('08 MCP Bill of Rights · curled parchment',mesh);collection('08 MCP Satirical park props').objects.link(obj);obj.parent=root
    bpy.context.view_layer.objects.active=obj
    mod=obj.modifiers.new('Paper edge thickness','SOLIDIFY');mod.thickness=.004
    bpy.ops.object.modifier_apply(modifier=mod.name)
    g='08 MCP Bill of Rights · frost and stones'
    for side in [-1,1]:
        beam(g,'metal',(side*.56,.02,-.31),(side*.56,.83,-.24),.012,6)
        ellipsoid(g,'rock',side*.61,.06,-.1,.14,.075,.11,8,4)
    for x in [-.73,.73]:
        beam(g,'ice',(x,1.86,.01),(x-.012,1.73,.035),.016,5)
    parent_parts(root,flush())
    for o in root.children:
        if o.type=='MESH' and o!=obj:cube_uv(o,1.7)
    root['prop_description']='Tattered, curled Bill of Rights, visibly trampled by a muddy boot'
    FEATURES.append('A curled and tattered Bill of Rights scroll with a large dirty boot tread, fine paper normals and frosted edges')
    return root

def build_bell(images):
    root=prop_root('lake-america-liberty-bell',(3.55,.02,-4.65),-.1)
    model_material('bronze','Liberty bronze · weathered and split',(.28,.18,.075),.76,'forged','granite',.35)
    rings=[(0,.53),(.055,.53),(.105,.49),(.18,.43),(.3,.35),(.45,.29),(.62,.245),(.76,.215),(.84,.15),(.90,.08)]
    sides=24;stride=sides+1;count=len(rings);verts=[];colors=[];faces=[]
    for inside in [False,True]:
        for i,(h,r) in enumerate(rings):
            rr=max(.035,r-(.035 if inside else 0))
            gap=.06*(1-min(1,h/.7));shift=.028*math.sin(i*2.6)*(1-min(1,h/.7))
            for j in range(stride):
                a=math.pi/2+shift+gap/2+j/sides*(math.tau-gap)
                x=rr*math.cos(a);z=rr*math.sin(a)
                verts.append(coord((x,.60+h,z)))
                patina=max(0,math.sin(a*7+h*23)*math.sin(a*3-h*13))*.65
                bronze=np.array([.28,.18,.075]);green=np.array([.06,.19,.155])
                c=bronze*(1-patina)+green*patina
                if inside:c*=.42
                elif h<.1:c*=1.16
                colors.append((*c,1))
    layer=count*stride
    for inside in [0,1]:
        off=inside*layer
        for i in range(count-1):
            for j in range(sides):
                a=off+i*stride+j
                face=(a,a+stride,a+stride+1,a+1)
                faces.append(face[::-1] if inside else face)
    for i in [0,count-1]:
        for j in range(sides):
            a=i*stride+j;faces.append((a,a+1,a+1+layer,a+layer))
    for j in [0,sides]:
        for i in range(count-1):
            a=i*stride+j;faces.append((a,a+stride,a+stride+layer,a+layer))
    mesh=bpy.data.meshes.new('Liberty Bell · open shell and split rim');mesh.from_pydata(verts,[],faces);mesh.materials.append(M['bronze'][0])
    attr=mesh.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for poly in mesh.polygons:
        poly.use_smooth=True
        for k in poly.loop_indices:attr.data[k].color=colors[mesh.loops[k].vertex_index]
    obj=bpy.data.objects.new('08 MCP Liberty Bell · cracked bronze shell',mesh);collection('08 MCP Satirical park props').objects.link(obj);obj.parent=root;cube_uv(obj,2.6)
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    g='08 MCP Liberty Bell · yoke and base'
    for side in [-1,1]:
        box(g,'cedar',side*.65,.85,-.08,.16,1.63,.24,.8)
        box(g,'cedar',side*.65,.10,0,.37,.16,.55,.87)
        beam(g,'metal',(side*.56,1.58,.13),(side*.74,1.58,.13),.043,10)
        box(g,'metal',side*.65,1.57,.05,.2,.19,.29,.85)
    box(g,'cedar',0,1.61,-.03,1.51,.19,.29)
    box(g,'cedar',0,.22,.03,1.53,.35,.24,.75)
    beam(g,'metal',(0,1.58,-.02),(0,1.35,-.02),.055,12)
    beam(g,'bronze',(0,1.37,0),(0,.55,0),.025,8,.6)
    ellipsoid(g,'bronze',0,.57,0,.072,.09,.072,10,5,.65)
    parts=finish_parts(root)
    for part in parts:
        if '_cedar' in part.name:bevel(part,.008,1);cube_uv(part)
    for side in [-1,1]:
        ellipsoid('08 MCP Liberty Bell · settled snow','snow',side*.65,.19,-.08,.24,.05,.25,8,3)
    parent_parts(root,flush())
    for o in root.children:
        if o.type=='MESH' and not o.data.uv_layers:cube_uv(o)
    label=face_material('Liberty · enamel out-of-order plaque',images['liberty-plaque'],emission=.04)
    textured_face(root,'08 MCP Liberty Bell · out-of-order plaque',(0,.245,.169),1.39,.38,label)
    root['prop_description']='A split bronze Liberty Bell on a weathered yoke, labelled LIBERTY / OUT OF ORDER'
    FEATURES.append('A physically split, patinated bronze Liberty Bell on a timber yoke with an OUT OF ORDER plaque')
    return root

def build_machine(images):
    root=prop_root('lake-america-freedom-machine',(-7.25,.025,-5.55),.12)
    g='08 MCP Freedom machine · enamel cabinet'
    box(g,'navy',0,1.13,0,1.37,2.18,.72)
    shell=finish_parts(root,.027)
    g='08 MCP Freedom machine · door and hardware'
    box(g,'cream',-.625,1.15,.397,.065,1.96,.055,.9)
    box(g,'cream',.625,1.15,.397,.065,1.96,.055,.9)
    box(g,'cream',0,2.145,.397,1.31,.065,.055,.9)
    box(g,'cream',0,.155,.397,1.31,.065,.055,.9)
    box(g,'metal',.75,.94,.23,.18,.74,.26,.7)
    box(g,'grip',.75,1.17,.365,.105,.016,.012)
    for yy in [1.04,.88,.72]:
        beam(g,'red',(.75,yy,.36),(.75,yy,.397),.045,10)
        beam(g,'cream',(.75,yy,.398),(.75,yy,.401),.017,8)
    box(g,'grip',0,.115,.39,.81,.11,.025)
    box(g,'metal',0,.061,.455,.89,.014,.14,.7)
    for side in [-1,1]:
        for z in [-.23,.23]:
            box(g,'grip',side*.51,.045,z,.16,.09,.16)
        for yy in [.35,1.83]:
            beam(g,'metal',(side*.63,yy,.425),(side*.63,yy,.432),.012,8)
    finish_parts(root,.004)
    front=face_material('Freedom machine · absurd prices and empty shelves',images['freedom-machine'],emission=.1)
    textured_face(root,'08 MCP Freedom machine · price display',(0,1.15,.427),1.18,1.9175,front)
    for x,z in [(-.48,-.14),(.4,-.16)]:
        ellipsoid('08 MCP Freedom machine · accumulated snow','snow',x,2.24,z,.34,.075,.3,8,3)
    parent_parts(root,flush())
    for o in root.children:
        if o.type=='MESH' and not o.data.uv_layers:cube_uv(o)
    root['prop_description']='Freedom vending machine: exorbitant prices, microscopic portions, permanently SOLD OUT'
    root['price_labels']=json.dumps(['Free speech / one word / $499.99','Privacy / 0.1 second / $999.99','Due process / travel size / $9,999.99'])
    FEATURES.append('A sold-out Freedom vending machine: one word of speech $499.99, 0.1 second of privacy $999.99, travel-size due process $9,999.99; no refunds')
    return root

def export_props():
    result=export_runtime()
    path=ROOT/'game/public/stages/lake-america-3d/manifest.json'
    manifest=json.loads(path.read_text(encoding='utf-8'))
    manifest['satireProps']={
        'version':PROP_VERSION,'recipe':'web/tools/props-lake-america-mcp.py',
        'backup':'web/'+Path(str(bpy.context.scene['satire_props_backup'])).relative_to(ROOT).as_posix(),
        'axeEmblem':'ivory maple leaf',
        'props':[
            {'node':'lake-america-bill-of-rights','position':[-2.35,.055,-3.5],'description':'Tattered, curled parchment with a large muddy boot tread'},
            {'node':'lake-america-liberty-bell','position':[3.55,.02,-4.65],'description':'Split bronze bell with LIBERTY / OUT OF ORDER plaque'},
            {'node':'lake-america-freedom-machine','position':[-7.25,.025,-5.55],'description':'Sold-out Freedom vending machine; pay more, get less',
             'prices':['Free speech / one word / $499.99','Privacy / 0.1 second / $999.99','Due process / travel size / $9,999.99']}
        ],
        'surfaceImagesAdded':5,
        'reference':'Original local lake_america_props.jpg, interpreted as 3D park props'
    }
    path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    return result

def save_props_master():
    scene=bpy.context.scene
    scene['lake_satire_finish']=PROP_VERSION
    scene['satire_recipe']='Execute web/tools/props-lake-america-mcp.py through Blender MCP on the pre-satire backup. Do not apply twice.'
    scene['satire_features']=json.dumps(list(dict.fromkeys(FEATURES)))
    scene['last_authoring_pass']='Live Blender MCP: maple axe emblem, boot-stamped Bill of Rights, split Liberty Bell and sold-out overpriced Freedom machine'
    scene.render.engine='BLENDER_EEVEE';scene.view_settings.exposure=-.15
    scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
    scene.camera=bpy.data.objects['CAM Combat']
    scene.render.filepath=str(ROOT/'stages/lake_america/blender/lake-america-combat.png')
    for image in bpy.data.images:
        if image.name.startswith('Lake America · ') and not image.packed_file:image.pack()
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'stages/lake_america/blender/lake-america.blend'))

def main_props():
    scene=bpy.context.scene
    if scene.get('lake_satire_finish')==PROP_VERSION:
        raise RuntimeError('Props already applied. Open the pre-satire backup before replaying.')
    if scene.get('lake_surface_finish')!='2026-10-09-mcp-pbr-v2':
        raise RuntimeError('Open the saved Lake America surface-pass master first.')
    backup=ROOT/'artifacts/lake-america'/('before-satire-props-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
    for file in ['stages/lake_america/blender/lake-america.blend','game/public/stages/lake-america-3d/lake-america.glb','game/public/stages/lake-america-3d/manifest.json']:
        target=backup/file;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/file,target)
    scene['satire_props_backup']=str(backup)
    bind_helpers()
    images=bake_graphics()
    maple_axe();build_scroll(images);build_bell(images);build_machine(images)
    result=export_props();save_props_master()
    print(json.dumps(result,indent=2))

if __name__=='__main__':
    main_props()
