"""Lake America finishing recipe. Execute inside Blender through MCP only.

Load the existing master first. The pass preserves named gameplay pivots, adds
real modeled detail and baked vertex colors, and keeps the production triangle
limit. A completed master is guarded against accidentally applying it twice.
"""
import ast
import bpy
import bmesh
import json
import math
import random
import shutil
from datetime import datetime
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
VERSION = '2026-10-09-mcp-rich-v1'
FEATURES = []
batches = {}
collections = {}
M = {}

def collection(name):
    if name not in collections:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        c['lake_mcp_finish'] = VERSION
        collections[name] = c
    return collections[name]

def setup():
    if bpy.context.scene.get('lake_mcp_finish') == VERSION:
        raise RuntimeError('This finishing pass is already applied; open the backup to re-author it')
    prefixes = {
        'slate':'Slate', 'rock':'Granite', 'snow':'Snow', 'ice':'Ice · compressed',
        'pine':'Pine', 'bark':'Bark', 'city':'City · limestone', 'glass':'City · lake',
        'trim':'Architecture', 'window':'Windows', 'metal':'Flagpole', 'cedar':'Cedar · weathered',
        'endgrain':'Cedar · fresh', 'red':'Rescue', 'cream':'Lettering', 'navy':'Station',
        'rope':'Rope', 'blade':'Axe · forged', 'edge':'Axe · polished', 'grip':'Axe · black',
        'crack':'Ice · submerged', 'lamp':'Lantern', 'charcoal':'Festival', 'goose':'Goose',
        'moose':'Moose', 'orange':'Safety', 'syrup':'Syrup',
    }
    for key,prefix in prefixes.items():
        mat = next(m for m in bpy.data.materials if m.name.startswith(prefix))
        M[key] = (mat, tuple(mat.diffuse_color[:3]))
    names={'coord','Batch','batch','box','beam','profile','ring','lathe','ellipsoid'}
    parsed=ast.parse((ROOT/'tools/build-lake-america.py').read_text(encoding='utf-8'))
    definitions=[n for n in parsed.body if isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names]
    exec(compile(ast.Module(body=definitions,type_ignores=[]),'lake geometry helpers','exec'),globals())
    random.seed(100926)
    # Cool metals and clear enamel should catch the same warm light as the snow.
    for key,rough,metal in [('red',.29,.15),('navy',.34,.17),('metal',.24,.78),
                            ('blade',.18,.86),('edge',.11,.9),('glass',.17,.48),
                            ('ice',.22,.1),('syrup',.19,.12)]:
        p=M[key][0].node_tree.nodes.get('Principled BSDF')
        p.inputs['Roughness'].default_value=rough
        p.inputs['Metallic'].default_value=metal
    FEATURES.append('Cohesive enamel, glass and brushed-metal material response')

def flush():
    made=[]
    for b in list(batches.values()):
        obj=b.finish()
        obj['lake_mcp_finish']=VERSION
        if b.group.startswith('lake-america-axe detail'):
            obj.parent=bpy.data.objects['lake-america-axe']
        elif b.group.startswith('lake-america-ring detail'):
            obj.parent=bpy.data.objects['lake-america-rescue-ring']
        if any(part in b.group for part in ['Goose','Moose']):
            for p in obj.data.polygons: p.use_smooth=True
        bm=bmesh.new(); bm.from_mesh(obj.data)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(obj.data); bm.free()
        made.append(obj)
    batches.clear()
    return made

def bevel(obj,width=.015,segments=2):
    bpy.context.view_layer.objects.active=obj
    mod=obj.modifiers.new('Crafted edge highlights','BEVEL')
    mod.width=width; mod.segments=segments
    mod.limit_method='ANGLE'; mod.angle_limit=.55
    bpy.ops.object.modifier_apply(modifier=mod.name)

def tri_count():
    return sum(len(p.vertices)-2 for o in bpy.context.scene.objects
               if o.type=='MESH' and not any(c.name.startswith(('90','91','92','93')) for c in o.users_collection)
               for p in o.data.polygons)

def smooth_object(obj):
    for p in obj.data.polygons: p.use_smooth=True

def preserve_and_open():
    expected=ROOT/'stages/lake_america/blender/lake-america.blend'
    if Path(bpy.data.filepath)!=expected and not Path(bpy.data.filepath).is_relative_to(ROOT/'artifacts/lake-america'):
        raise RuntimeError('Open the Lake America master before running this recipe')
    if not bpy.context.scene.get('graphics_backup'):
        backup=ROOT/'artifacts/lake-america'/('before-big-mcp-pass-'+datetime.now().strftime('%Y%m%d-%H%M%S'))
        backup.mkdir(parents=True,exist_ok=False)
        for p in [expected,ROOT/'game/public/stages/lake-america-3d/lake-america.glb',
                  ROOT/'game/public/stages/lake-america-3d/manifest.json']:
            shutil.copy2(p,backup/p.name)
        bpy.context.scene['graphics_backup']=str(backup)

def surfaces_and_edges():
    changed=0
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH' or any(c.name.startswith(('90','91','92','93')) for c in obj.users_collection):
            continue
        mesh=obj.data
        attr=mesh.color_attributes.get('Color')
        if attr and attr.domain=='POINT':
            mat=mesh.materials[0].name if mesh.materials else ''
            for v,datum in zip(mesh.vertices,attr.data):
                p=obj.matrix_world@v.co
                x,y,z=p
                old=tuple(datum.color)
                low=math.sin(x*1.43+y*.67+z*2.29)
                fine=math.sin(x*19.1+y*11.7+z*31.2)
                fac=1.
                tint=(1.,1.,1.)
                if mat.startswith('Snow'):
                    fac=.92+.075*math.sin(x*.8+y*.63)+.04*low
                    tint=(.94+.06*max(0,low),.985,1.02)
                elif mat.startswith('Pine'):
                    fac=.85+.22*low+.1*fine
                    tint=(.88,1.12,1.03)
                elif mat.startswith(('Granite','Bark')):
                    fac=.88+.16*low+.07*fine
                    tint=(.96,.995,1.04)
                elif mat.startswith('Cedar'):
                    fac=.91+.14*low+.045*fine
                    tint=(1.08,1.02,.96)
                elif mat.startswith('City'):
                    fac=.9+.22*math.sin(x*.8+y*.7)+.05*fine
                elif mat.startswith('Windows'):
                    warm=math.sin(math.floor(x*2.1)*7.3+math.floor(z*1.9)*11.7)>0.28
                    tint=(2.4,1.7,.75) if warm else (.82,1.12,1.38)
                    fac=.74+.2*low
                elif mat.startswith('Ice'):
                    fac=.96+.15*low
                    tint=(.85,1.03,1.12)
                elif mat.startswith(('Rescue','Station','Festival','Moose','Goose')):
                    fac=.91+.13*low+.025*fine
                datum.color=tuple(min(1,max(0,old[i]*fac*tint[i])) for i in range(3))+(old[3],)
            changed+=1
        # Faraway forest topology can be spent on props visible at fighting distance.
        if obj.name.startswith('03 Headland') and '_snow' in obj.name:
            bpy.context.view_layer.objects.active=obj
            mod=obj.modifiers.new('Distant snow silhouette optimization','DECIMATE')
            mod.ratio=.78
            bpy.ops.object.modifier_apply(modifier=mod.name)
        if obj.name.startswith(('07 Cedar rescue station','08 Lake America trail sign','10 Maple Zamboni parade','13 Working waterfront')):
            key=obj.name.split('_')[-1].split('.')[0]
            if key in ('cedar','navy','red','metal','cream','glass') and len(mesh.vertices)<1200:
                bevel(obj,.009 if key=='metal' else .018,1)
        if obj.name.startswith('lake-america-axe_') and any(s in obj.name for s in ('blade','edge','cedar','grip')):
            bevel(obj,.004,2)
        if obj.name.startswith('lake-america-rescue-ring_'):
            if '_cream' in obj.name: bevel(obj,.009,2)
            else: smooth_object(obj)
        if obj.name.startswith('lake-america-floe-') and obj.type=='MESH':
            bevel(obj,.018,1)
        if obj.name.startswith(('02 Moose lifeguard_moose','07 Goose safety committee_goose',
                                '07 Goose safety committee_cream','10 Maple Zamboni parade_snow')):
            bpy.context.view_layer.objects.active=obj
            mod=obj.modifiers.new('Rounded character volumes','SUBSURF')
            mod.levels=1
            bpy.ops.object.modifier_apply(modifier=mod.name)
            smooth_object(obj)
    FEATURES.extend(['Baked color variation across terrain, trees, skyline and props',
                     'Two-tone winter woodland, warm occupied city windows and cyan pressure ice',
                     'Beveled joinery, metalwork, pickups and rounded wildlife silhouettes'])
    print('SURFACES='+json.dumps({'meshes_finished':changed,'triangles':tri_count()}))

def optimize_facades():
    before=tri_count()
    for obj in bpy.context.scene.objects:
        if not obj.name.startswith('04 Toronto skyline_') or obj.type!='MESH':
            continue
        axis=1 if '_glass' in obj.name else 0 if '_window' in obj.name else None
        if axis is None: continue
        bm=bmesh.new();bm.from_mesh(obj.data);bm.normal_update()
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if abs(f.normal[axis])<.9],context='FACES_ONLY')
        wire=[e for e in bm.edges if not e.link_faces]
        if wire:bmesh.ops.delete(bm,geom=wire,context='EDGES')
        loose=[v for v in bm.verts if not v.link_faces]
        if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
        bm.to_mesh(obj.data);bm.free();obj.data.update()
    print('FACADE_OPTIMIZATION='+json.dumps({'saved_triangles':before-tri_count(),'triangles':tri_count()}))

def wildlife():
    g='02 MCP Moose lifeguard details'
    mx,my,mz=-11.45,.02,-10.15
    # Palmated antlers, muzzle nostrils, fuzzy cheeks and real binocular lenses.
    for side in [-1,1]:
        palm=[(.34,2.38),(.48,2.49),(.62,2.72),(.71,2.89),(.78,2.76),
              (.94,2.84),(.92,2.68),(1.08,2.67),(.96,2.49),(.71,2.43),(.48,2.35)]
        profile(g,'endgrain',[(mx+side*x,my+y) for x,y in palm],mz-.015,.075,1.1)
        ellipsoid(g,'charcoal',mx+side*.145,my+1.58,mz+.645,.055,.038,.022,10,5)
        for j in range(4):
            profile(g,'moose',[(mx+side*(.34+j*.04),my+1.83-j*.08),
                              (mx+side*(.51+j*.015),my+1.70-j*.075),
                              (mx+side*(.38+j*.025),my+1.64-j*.065)],mz+.15,.1,1.1)
        beam(g,'glass',(mx+side*.13,my+1.77,mz+.699),(mx+side*.13,my+1.77,mz+.718),.072,20)
        ellipsoid(g,'cream',mx+side*.13-.024,my+1.799,mz+.72,.014,.018,.005,8,4)
        beam(g,'metal',(mx+side*.21,my+1.29,mz+.44),(mx,my+.99,mz+.48),.007,6)
    ellipsoid(g,'metal',mx,my+.98,mz+.49,.075,.035,.025,12,5)
    lathe(g,'navy',mx,my+2.11,mz-.005,[(0,.39),(.13,.41),(.29,.3),(.35,.08)],18)
    lathe(g,'cream',mx,my+2.1,mz-.005,[(0,.43),(.08,.43),(.105,.4)],18)
    ellipsoid(g,'red',mx,my+2.48,mz-.005,.11,.11,.11,12,6)
    for j in range(10):
        a=j*math.tau/10
        beam(g,'metal',(mx+math.cos(a)*.404,my+2.12,mz+math.sin(a)*.404),
             (mx+math.cos(a)*.404,my+2.17,mz+math.sin(a)*.404),.004,4)
    for side in [-1,1]:
        for j in range(5):
            ellipsoid(g,'cream',mx+side*.49,my+.4+j*.14,mz+.439,.014,.018,.006,6,3,.8)
    g='07 MCP Goose featherwork'
    x,y,z,s=8.8,3.82,-13.8,1.02
    for side in [-1,1]:
        for j in range(6):
            reach=1.02+j*.09
            yy=.62+j*.045 if side<0 else .49+j*.045
            profile(g,'charcoal',[(x+side*.78*s,y+.64*s),
                    (x+side*reach*s,y+(yy-.06)*s),
                    (x+side*(reach+.22)*s,y+(yy+.06)*s),
                    (x+side*(reach+.13)*s,y+(yy+.19)*s),
                    (x+side*.81*s,y+.83*s)],z+.098*s,.035,.9+j*.035)
        ellipsoid(g,'cream',x+side*.11*s,y+1.43*s,z+.267*s,.021,.025,.007,8,4)
    # Folded wing feathers, reflective vests and tiny checklist boards for the deputies.
    for x,y,z,s in [(5.85,.05,-10.25,.55),(11.9,.05,-11.35,.62)]:
        for side in [-1,1]:
            profile(g,'orange',[(x+side*.06*s,y+.27*s),(x+side*.37*s,y+.38*s),
                    (x+side*.33*s,y+.76*s),(x+side*.12*s,y+.85*s)],z+.315*s,.025*s)
            box(g,'cream',x+side*.23*s,y+.55*s,z+.344*s,.27*s,.06*s,.012*s)
            for j in range(4):
                beam(g,'charcoal',(x+side*.21*s,y+(.67-j*.045)*s,z+.21*s),
                     (x+side*(.53-j*.04)*s,y+(.48-j*.035)*s,z+.24*s),.011*s,5)
        box(g,'navy',x+.39*s,y+.42*s,z+.39*s,.27*s,.35*s,.035*s)
        box(g,'metal',x+.39*s,y+.59*s,z+.416*s,.09*s,.035*s,.015*s)
        for j in range(3):
            box(g,'cream',x+.39*s,y+(.49-j*.075)*s,z+.413*s,.17*s,.013*s,.005*s)
        ellipsoid(g,'cream',x-.07*s,y+1.46*s,z+.269*s,.018*s,.021*s,.006*s,8,4)
    made=flush()
    FEATURES.extend(['Palmated moose antlers, knitted toque, coat stitches and glazed binoculars',
                     'Layered goose flight feathers, bright safety vests and miniature checklists'])
    print('WILDLIFE='+json.dumps({'detail_meshes':len(made),'triangles':tri_count()}))

def architecture_and_waterfront():
    g='07 MCP Rescue hut craft';sx,sz=8.8,-13.8
    # Riveted trim, layered roof snow, log-end rings and working hardware.
    for side in [-1,1]:
        for yy in [.4,.95,1.55,2.15,2.55]:
            beam(g,'metal',(sx+side*1.61,yy,sz+1.32),(sx+side*1.61,yy,sz+1.355),.024,10)
        beam(g,'metal',(sx+side*1.78,2.67,sz+1.6),(sx+side*.12,3.61,sz+1.6),.012,6)
    for dx in [-1.8,-1.3,-.7,0,.65,1.25,1.75]:
        ellipsoid(g,'snow',sx+dx,3.77-abs(dx)*.53,sz+1.4,.24,.055,.16,12,5)
    for row in range(3):
        for col in range(5-row):
            x=sx-1.65+col*.2+row*.1;y=.24+row*.17
            for rad in [.035,.063]:
                ring(g,'bark',x,y,sz+2.071,rad,.0035,14,4)
            beam(g,'bark',(x-.065,y+.035,sz+2.074),(x+.035,y-.015,sz+2.074),.003,4)
    # A little frosted side window gains depth from its projecting cedar surround.
    box(g,'lamp',sx-1.655,1.45,sz-.1,.024,.76,.94)
    for dz in [-.59,-.1,.39]:
        box(g,'cedar',sx-1.68,1.45,sz+dz,.075,.9,.065)
    for yy in [1.03,1.45,1.87]:
        box(g,'cedar',sx-1.68,yy,sz-.1,.075,.065,1.06)
    box(g,'snow',sx-1.695,1.92,sz-.1,.14,.055,1.13)
    # A practical shovel and rack beside the firewood.
    beam(g,'cedar',(sx-1.94,.33,sz+.85),(sx-2.22,1.56,sz+.91),.027,9)
    profile(g,'metal',[(sx-2.11,.08),(sx-1.66,.08),(sx-1.69,.39),(sx-2.04,.44)],sz+.87,.05)
    ring(g,'red',sx-2.22,1.64,sz+.91,.095,.02,18,6)
    # Deep grooves around exposed board ends and dark nail heads.
    for i in range(0,42,2):
        z=sz-1.5-i*.225
        for dx in [-1.02,1.02]:
            lathe(g,'metal',sx+dx,.129,z,[(0,.018),(.006,.018)],8)
    for x,z in [(-2.6,-9.7),(1.3,-9.7)]:
        for dx in [-.63,.63]:
            for yy in [.73,.89]:
                beam(g,'metal',(x+dx,yy,z-.274),(x+dx,yy,z-.252),.017,8)
    for x,z in [(-8.2,-9.3),(-3.8,-11.6),(3.6,-11.6),(7.1,-9.3)]:
        for side in [-1,1]:
            beam(g,'metal',(x+side*.12,2.64,z+.12),(x-side*.12,2.94,z+.12),.009,5)
        lathe(g,'metal',x,3.18,z,[(0,.04),(.11,.0)],9)
    made=flush()
    for obj in made:
        if obj.name.startswith('07 MCP Rescue hut craft_snow'):
            for v in obj.data.vertices:
                dx=min([-1.8,-1.3,-.7,0,.65,1.25,1.75],key=lambda d:abs(v.co.x-sx-d))
                v.co.z-=.537*(abs(v.co.x-sx)-abs(dx))
    FEATURES.extend(['Rescue hut rivets, side glazing, snow pillows, log rings and rescue shovel',
                     'Dock nail heads, bench fixings and detailed lantern cages'])
    print('WATERFRONT='+json.dumps({'detail_meshes':len(made),'triangles':tri_count()}))

def vehicles():
    g='10 MCP Zamboni engineering';zx,zy,zz=.65,.04,-13.55
    # Louvered body, polished bumpers, wheel bolts, bright headlamps and tread.
    for side in [-1,1]:
        box(g,'metal',zx+side*1.58,zy+.36,zz, .09,.15,1.55)
        for dz in [-.76,.76]:
            for j in range(6):
                box(g,'charcoal',zx-.99+j*.14,zy+.99,zz+dz,.07,.15,.018)
            for x in [zx-1.05,zx+.95]:
                for i in range(12):
                    a=i*math.tau/12
                    box(g,'grip',x+math.cos(a)*.318,zy+.29+math.sin(a)*.318,zz+dz,.055,.045,.06)
                for i in range(5):
                    a=i*math.tau/5
                    beam(g,'metal',(x+math.cos(a)*.08,zy+.29+math.sin(a)*.08,zz+dz*.985),
                         (x+math.cos(a)*.08,zy+.29+math.sin(a)*.08,zz+dz*1.12),.018,6)
        box(g,'lamp',zx+side*1.31,zy+.71,zz+.77,.19,.16,.04)
        box(g,'metal',zx+side*1.31,zy+.71,zz+.75,.24,.21,.035)
    for side in [-1,1]:
        box(g,'cream',zx+.92+side*.44,zy+1.25,zz+.66,.04,.94,.04)
    box(g,'cream',zx+.92,zy+1.25,zz+.67,.045,.94,.035)
    box(g,'cream',zx+.92,zy+.82,zz+.67,.94,.045,.035)
    box(g,'cream',zx+.92,zy+1.69,zz+.67,.94,.045,.035)
    ring(g,'charcoal',zx+.91,zy+1.21,zz+.7,.16,.019,20,6)
    for dx,dy in [(-.12,-.07),(.12,-.07),(0,.13)]:
        beam(g,'metal',(zx+.91,zy+1.21,zz+.701),(zx+.91+dx,zy+1.21+dy,zz+.701),.009,6)
    lathe(g,'red',zx+.9,zy+1.76,zz+.22,[(0,.245),(.1,.245)],18)
    profile(g,'red',[(zx+.72,zy+1.79),(zx+.89,zy+1.77),(zx+.74,zy+1.23),(zx+.58,zy+1.29)],zz+.49,.045)
    for yy in [1.35,1.51,1.67]:
        ellipsoid(g,'charcoal',zx+.9,zy+yy,zz+.49,.025,.025,.013,8,4)
    lathe(g,'red',zx+.9,zy+2.26,zz+.22,[(0,.205),(.055,.205)],14)
    for side in [-1,1]:
        beam(g,'bark',(zx+.9+side*.22,zy+1.52,zz+.28),(zx+.9+side*.43,zy+1.47,zz+.47),.018,7)
        ellipsoid(g,'red',zx+.9+side*.43,zy+1.47,zz+.47,.075,.065,.06,10,5)
    # A proper, extruded maple badge replaces the placeholder's visual emphasis.
    leaf=[(0,-.23),(.035,-.13),(.08,-.16),(.07,-.055),(.15,-.1),(.14,-.035),
          (.21,-.05),(.17,.03),(.19,.06),(.09,.12),(.095,.16),(.015,.15),
          (.015,.23),(-.015,.23),(-.015,.15),(-.095,.16),(-.09,.12),(-.19,.06),
          (-.17,.03),(-.21,-.05),(-.14,-.035),(-.15,-.1),(-.07,-.055),(-.08,-.16),(-.035,-.13)]
    profile(g,'red',[(zx-.56-x,zy+.88-y) for x,y in leaf],zz+.79,.018)
    # Syrup tank seams, cap and a guarded amber beacon.
    for yy in [1.0,1.48]:
        lathe(g,'metal',zx-1.03,zy+yy,zz,[(0,.385),(.028,.385)],16)
    lathe(g,'metal',zx-1.03,zy+1.65,zz,[(0,.12),(.045,.12)],12)
    for side in [-1,1]:
        beam(g,'metal',(zx-.05+side*.095,zy+1.88,zz),(zx-.05+side*.07,zy+2.12,zz),.009,5)
    # The distant winter ferry gets railings, a mast rig and working decks.
    g='11 MCP Ferry fittings';fx,fz=18,-67
    for side in [-1,1]:
        z=fz+side*.87
        beam(g,'cream',(fx-2.65,.98,z),(fx+2.65,.98,z),.02,6)
        for i in range(12):
            x=fx-2.65+i*5.3/11
            beam(g,'metal',(x,.87,z),(x,.99,z),.012,5)
        ring(g,'red',fx-1.7,.6,z,.16,.035,20,6)
    beam(g,'rope',(fx+.6,2.15,fz),(fx-2.1,.94,fz),.012,5)
    beam(g,'rope',(fx+.6,2.15,fz),(fx+2.6,.94,fz),.012,5)
    box(g,'lamp',fx+.65,1.26,fz+.722,1.9,.21,.018)
    for dx in [-.65,0,.65]:box(g,'navy',fx+.65+dx,1.26,fz+.74,.035,.24,.025)
    box(g,'red',fx,-.07,fz+.963,6.1,.07,.018)
    flush()
    FEATURES.extend(['Zamboni tire treads, louvers, bolts, bumpers, cab frames, steering wheel and maple badge',
                     'Snowman scarf, mittens and hat band; banded syrup tank and guarded beacon',
                     'Ferry deck rails, rigging, life rings, navigation stripe and warm wheelhouse'])
    print('VEHICLES='+json.dumps({'triangles':tri_count()}))

def pickups_and_games():
    g='lake-america-axe detail forged fittings'
    # Riveted socket, scored steel, and chamfered haft; all geometry is pickup-local.
    for z in [-.069,.069]:
        for x,y in [(.017,.365),(-.24,.309)]:
            ellipsoid(g,'edge',x,y,z,.018,.018,.007,8,3)
        beam(g,'blade',(-.28,.296,z),(-.08,.329,z),.004,5,.6)
        beam(g,'edge',(.32,.274,z),(.404,.318,z),.003,5,1.1)
    for i in range(5):
        y=-.13+i*.075
        beam(g,'endgrain',(-.026,y,.041),(.021,y+.018,.041),.003,5,.72)
    # End-grain circles sit on the independent stump, never on the thrown axe.
    for r in [.06,.105,.16,.215]:
        for i in range(24):
            a=2*math.pi*i/24; b=2*math.pi*(i+1)/24
            beam('06 MCP Stump growth rings','bark',(-5+r*math.cos(a),.465,-.65+r*math.sin(a)),
                 (-5+r*math.cos(b),.465,-.65+r*math.sin(b)),.003,4,.8)
    g='lake-america-ring detail stitched canvas'
    for a in [0,math.pi/2,math.pi,math.pi*1.5]:
        for da in [-.15,-.075,0,.075,.15]:
            t=a+da
            beam(g,'navy',(.285*math.cos(t),.285*math.sin(t),.087),
                 (.35*math.cos(t),.35*math.sin(t),.087),.0027,4,.9)
        x=.405*math.cos(a); y=.405*math.sin(a)
        ring(g,'metal',x,y,.006,.023,.006,10,4)
    g='08 MCP Curling craft'
    for x,z,key in [(1.65,-8.1,'red'),(4.65,-8,'navy'),(2.25,-9.75,'red'),(5.25,-9.6,'navy')]:
        # Raised bent-tube handles and polished running bands.
        for dx in [-.15,.15]:
            beam(g,key,(x+dx,.24,z),(x+dx,.36,z),.028,8)
        beam(g,key,(x-.15,.36,z),(x+.15,.36,z),.028,10)
        lathe(g,'metal',x,.055,z,[(0,.272),(.018,.292),(.035,.292)],20,.85)
        for dx in [-.15,.15]:
            lathe(g,'metal',x+dx,.235,z,[(0,.048),(.016,.048)],8)
    for x,y,z in [(2.15,.82,-9.48),(4.25,.78,-7.72)]:
        for i in range(11):
            beam(g,'rope',(x-.16+i*.032,y-.01,z+.04),(x-.15+i*.032,y+.13,z+.04),.006,5,.76+(i%3)*.1)
        beam(g,'metal',(x-.18,y-.03,z+.055),(x+.18,y-.03,z+.055),.012,6)
    # Trail sign is model-local under its existing scaled gameplay root.
    root=bpy.data.objects['lake-america-trail-sign']
    made=flush()
    g='09 MCP Trail sign ironwork'
    for x in [-2.28,2.28]:
        for y in [1.65,2.55]:
            ellipsoid(g,'metal',x,y,.177,.025,.025,.012,8,3)
    beam(g,'metal',(-2.4,1.57,.17),(2.4,1.57,.17),.015,6)
    beam(g,'metal',(-2.4,2.64,.17),(2.4,2.64,.17),.015,6)
    for x in [-2.4,2.4]:
        beam(g,'metal',(x,1.57,.17),(x,2.64,.17),.015,6)
    # Small maple-leaf crest above the bilingual nameplate.
    pts=[(-.16,2.58),(-.08,2.61),(-.12,2.7),(-.045,2.68),(0,2.81),(.045,2.68),(.12,2.7),(.08,2.61),(.16,2.58),(.025,2.54),(.025,2.49),(-.025,2.49),(-.025,2.54)]
    profile(g,'red',pts,.17,.022)
    for o in flush():
        o.parent=root
    FEATURES.extend(['Riveted and scored axe, stump growth rings, stitched rescue ring and metal grommets',
                     'Raised curling handles, polished running bands, broom bristles and ironwork trail sign'])
    return {'triangles':tri_count()}

def landscape_finish():
    # Delicate ice veins only outside the playable corridor.
    g='01 MCP Peripheral ice veins'
    rr=random.Random(1038)
    for side in [-1,1]:
        for j in range(11):
            x=side*rr.uniform(9.3,18.2); z=rr.uniform(-8,6.5)
            last=(x,.001,z)
            for k in range(rr.randint(2,5)):
                nxt=(last[0]+side*rr.uniform(.14,.5),.001,last[2]+rr.uniform(-.4,.6))
                # Flat triangulated ribbons avoid protruding collision geometry.
                dx=nxt[0]-last[0]; dz=nxt[2]-last[2]; le=math.hypot(dx,dz); w=.008
                batch(g,'ice').add([(last[0]-dz/le*w,.001,last[2]+dx/le*w),
                                   (last[0]+dz/le*w,.001,last[2]-dx/le*w),
                                   (nxt[0],.001,nxt[2])],[(0,1,2)],.82)
                last=nxt
    # Individual snow pillows break up the tiered silhouette of the near pines.
    g='03 MCP Pine branch snow'
    for side in [-1,1]:
        for x,z,h in [(10.8,-10.2,4.8),(13,-12,6.1),(15,-10.8,5.4),(11.7,-15,3.8),(16,-7,6.5)]:
            x*=side
            for tier in [0,1,2]:
                y=h*(.3+tier*.19); r=h*(.21-tier*.04)
                for j in range(3):
                    a=j*math.tau/3+tier*.71
                    xx=x+math.cos(a)*r*.68; zz=z+math.sin(a)*r*.68
                    ellipsoid(g,'snow',xx,y,zz,r*.36,.075+r*.025,r*.22,8,3,.9+j*.07)
                    beam(g,'bark',(x,y-.12,z),(xx,y-.18,zz),.026,6,.72)
    # Knitted ribs and a contrasting cuff on the distant landmark's toque.
    g='05 MCP Landmark knitwear'
    lathe(g,'cream',-24,26.92,-182,[(0,.451),(.1,.49),(.2,.53)],20,.9)
    for i in range(16):
        a=math.tau*i/16
        beam(g,'red',(-24+.54*math.cos(a),27.2,-182+.54*math.sin(a)),
             (-24+.28*math.cos(a),27.61,-182+.28*math.sin(a)),.025,5,.73)
    # Frost and scored fracture lines remain local to the animated floe pivots.
    flush()
    for idx in range(1,25):
        root=bpy.data.objects.get('lake-america-floe-'+str(idx))
        if not root: continue
        children=[o for o in root.children if o.type=='MESH']
        if not children: continue
        coords=[v.co for o in children for v in o.data.vertices]
        max_y=max(v.z for v in coords)
        xs=[v.x for v in coords]; ys=[v.y for v in coords]
        rad=min(max(xs)-min(xs),max(ys)-min(ys))*.28
        g='12 MCP Floe '+str(idx)+' frost'
        # Coords are game local, and children's existing origins are zero.
        for j in range(2):
            a=.8+idx*1.31+j*1.8
            beam(g,'ice',(0,max_y+.001,0),(rad*math.cos(a),max_y+.001,rad*math.sin(a)),.006,4,1.1)
        for o in flush(): o.parent=root
    FEATURES.extend(['Sculpted snow pillows and branchwork across the near pine groves',
                     'Fine peripheral ice veins, local floe fractures and ribbed landmark knitwear'])
    return {'triangles':tri_count()}


def sculpt_near_pines():
    # Read the existing individual trunks to retain every tree's authored placement.
    trunk=next(o for o in bpy.context.scene.objects if o.name.startswith('02 Near shore_bark'))
    mesh=trunk.data
    adjacency={v.index:set() for v in mesh.vertices}
    for edge in mesh.edges:
        a,b=edge.vertices;adjacency[a].add(b);adjacency[b].add(a)
    remaining=set(adjacency);trees=[]
    while remaining:
        seed=next(iter(remaining));stack=[seed];component=set()
        while stack:
            i=stack.pop()
            if i in component:continue
            component.add(i);stack.extend(adjacency[i]-component)
        remaining-=component
        points=[trunk.matrix_world@mesh.vertices[i].co for i in component]
        trees.append(((min(p.x for p in points)+max(p.x for p in points))/2,
                      -(min(p.y for p in points)+max(p.y for p in points))/2,
                      max(p.z for p in points)/.87))
    for obj in list(bpy.context.scene.objects):
        if obj.name.startswith(('02 Near shore_pine','03 MCP Pine branch snow')):
            bpy.data.objects.remove(obj,do_unlink=True)
    snow=next(o for o in bpy.context.scene.objects if o.name.startswith('02 Near shore_snow'))
    bm=bmesh.new();bm.from_mesh(snow.data)
    seen=set();remove=[]
    for vertex in bm.verts:
        if vertex in seen:continue
        stack=[vertex];component=set()
        while stack:
            v=stack.pop()
            if v in component:continue
            component.add(v);stack.extend(e.other_vert(v) for e in v.link_edges)
        seen|=component
        if len(component)<=5:remove.extend(component)
    bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(snow.data);bm.free()
    g='02 MCP Sculpted evergreen boughs';rr=random.Random(11882)
    for ti,(x,z,h) in enumerate(trees):
        for tier in range(6):
            f=tier/6;level=h*(.18+f*.7);radius=h*.23*(1-f*.93)
            for branch in range(7):
                a=branch*math.tau/7+tier*.74+rr.uniform(-.16,.16)
                reach=radius*rr.uniform(.8,1.12);w=reach*.3
                ux,uz=math.cos(a),math.sin(a);vx,vz=-uz,ux
                def p(r,side,dy):return (x+ux*r+vx*side,level+dy,z+uz*r+vz*side)
                verts=[p(.07,0,h*.055),p(reach,0,-h*.035),
                       p(reach*.64,w,-h*.008),p(reach*.64,-w,-h*.008),
                       p(reach*.46,0,h*.025),p(.06,0,-h*.037)]
                batch(g,'pine').add(verts,[(0,4,2),(0,3,4),(4,1,2),(4,3,1),
                                         (5,2,1),(5,1,3),(0,2,5),(0,5,3)],rr.uniform(.7,1.22))
                # Rounded upper snow ridge with drooping outer lobes, rather than tall flat triangles.
                verts=[p(.08,0,h*.057),p(reach*.42,0,h*.076),p(reach*.9,0,-h*.006),
                       p(reach*.28,w*.81,h*.036),p(reach*.68,w*.78,h*.006),
                       p(reach*.28,-w*.81,h*.036),p(reach*.68,-w*.78,h*.006),
                       p(.08,0,h*.026),p(reach*.9,0,-h*.018)]
                faces=[(0,3,1),(0,1,5),(1,3,4),(1,4,2),(1,2,6),(1,6,5),
                       (0,7,3),(0,5,7),(3,7,8,4),(4,8,2),(2,8,6),(6,8,7,5),
                       (7,5,6,8,4,3)]
                batch(g,'snow').add(verts,faces,rr.uniform(.86,1.04))
        lathe(g,'pine',x,h*.78,z,[(0,h*.065),(h*.225,.003)],7,.8)
        ellipsoid(g,'snow',x,h*.96,z,h*.026,h*.055,h*.026,6,3,.94)
    flush()
    FEATURES.append('Thirty near pines rebuilt with rounded drooping snow boughs and varied dark needle undersides')
    return {'trees':len(trees),'triangles':tri_count()}


def character_staging():
    # Bring the lifeguard out from behind the evergreen grove so the character reads in combat.
    for o in bpy.context.scene.objects:
        if o.type=='MESH' and o.name.startswith(('02 Moose lifeguard','02 MCP Moose lifeguard')):
            o.location=coord((2.5,0,2))
            if o.name.startswith('02 Moose lifeguard_endgrain'):
                bpy.context.view_layer.objects.active=o
                mod=o.modifiers.new('Soft sculpted muzzle','SUBSURF');mod.levels=1
                bpy.ops.object.modifier_apply(modifier=mod.name);smooth_object(o)
            elif o.name.startswith('02 Moose lifeguard_red'):
                bevel(o,.018,2)
        if o.type=='MESH' and o.name.startswith('10 Maple Zamboni parade_glass'):
            attr=o.data.color_attributes.get('Color')
            if attr:
                for datum in attr.data:
                    old=tuple(datum.color)
                    datum.color=(max(old[0],.045),max(old[1],.125),max(old[2],.17),1)
    FEATURES.append('Moose lifeguard staged visibly in front of the grove, with rounded muzzle and finished rescue vest')
    return {'triangles':tri_count()}

def export_runtime():
    import struct
    scene=bpy.context.scene
    out=ROOT/'game/public/stages/lake-america-3d'
    candidate=ROOT/'artifacts/lake-america/lake-america-mcp-candidate.glb'
    proxies=[]; renamed=[]
    selected=[o for o in scene.objects if o.select_get()]
    active=bpy.context.view_layer.objects.active
    try:
        temporary=collection('93 MCP Temporary text export')
        for label in [o for o in scene.objects if o.type=='FONT']:
            bounds=[Vector(point) for point in label.bound_box]
            x0=min(p.x for p in bounds); x1=max(p.x for p in bounds)
            y0=min(p.y for p in bounds); y1=max(p.y for p in bounds); z=max(p.z for p in bounds)
            original=label.name; renamed.append((label,original))
            label.name=original+' EDITOR FONT'
            mesh=bpy.data.meshes.new(original+' runtime proxy')
            mesh.from_pydata([(x0,y0,z),(x1,y0,z),(x1,y1,z),(x0,y1,z)],[],[(0,1,2,3)])
            uv=mesh.uv_layers.new(name='UVMap')
            for i,pair in enumerate([(0,0),(1,0),(1,1),(0,1)]):uv.data[i].uv=pair
            if label.data.materials: mesh.materials.append(label.data.materials[0])
            proxy=bpy.data.objects.new(original,mesh); temporary.objects.link(proxy)
            world=label.matrix_world.copy(); proxy.parent=label.parent; proxy.matrix_world=world
            proxies.append(proxy)
        assets=[o for o in scene.objects if o.type in {'MESH','EMPTY'}
                and not any(c.name.startswith(('90','91','92','93')) for c in o.users_collection)]
        bpy.ops.object.select_all(action='DESELECT')
        for o in assets+proxies: o.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(candidate),export_format='GLB',use_selection=True,use_active_scene=True,
            export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
        raw=candidate.read_bytes()
        size=struct.unpack_from('<I',raw,12)[0]
        gltf=json.loads(raw[20:20+size])
        prims=[p for m in gltf.get('meshes',[]) for p in m['primitives']]
        count=lambda p:gltf['accessors'][p['indices']]['count'] if 'indices' in p else gltf['accessors'][p['attributes']['POSITION']]['count']
        triangles=sum(count(p)//3 for p in prims)
        assert 10000<triangles<=240000,triangles
        assert not gltf.get('cameras')
        assert all(not r.get('uri') or r['uri'].startswith('data:') for r in gltf.get('images',[])+gltf.get('buffers',[]))
        names={n.get('name') for n in gltf['nodes']}
        assert {'lake-america-axe','lake-america-rescue-ring','lake-america-trail-sign'}<=names
        manifest=json.loads((out/'manifest.json').read_text())
        manifest.update(objects=len(gltf['nodes']),meshObjects=len(prims),
                        vertices=sum(gltf['accessors'][p['attributes']['POSITION']]['count'] for p in prims),
                        triangles=triangles)
        manifest['features']=list(dict.fromkeys(manifest['features']+FEATURES))
        manifest['mcpFinish']={'version':VERSION,'recipe':'web/tools/polish-lake-america-mcp.py',
                               'backup':'web/'+Path(str(scene['graphics_backup'])).relative_to(ROOT).as_posix(),
                               'method':'Native Blender MCP; modeled detail, baked vertex color, stable gameplay pivots'}
        candidate.replace(out/'lake-america.glb')
        (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
        return {k:manifest[k] for k in ['objects','meshObjects','vertices','triangles']}
    finally:
        for proxy in proxies:
            mesh=proxy.data; bpy.data.objects.remove(proxy,do_unlink=True)
            if mesh.users==0:bpy.data.meshes.remove(mesh)
        for label,name in renamed:label.name=name
        bpy.ops.object.select_all(action='DESELECT')
        for o in selected:
            if o.name in scene.objects:o.select_set(True)
        if active and active.name in scene.objects:bpy.context.view_layer.objects.active=active

def save_master():
    scene=bpy.context.scene
    scene['lake_mcp_finish']=VERSION
    scene['finish_recipe']='Execute web/tools/polish-lake-america-mcp.py inside Blender MCP on the pre-pass backup. Do not apply the finishing pass twice.'
    scene['finish_features']=json.dumps(FEATURES)
    # A usable preview setup in the editable master; the runtime supplies its own sky.
    scene.render.engine='BLENDER_EEVEE'
    scene.view_settings.exposure=.05
    scene.render.resolution_x=1600;scene.render.resolution_y=900
    scene.camera=next(o for o in scene.objects if o.type=='CAMERA' and 'Combat' in o.name)
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'stages/lake_america/blender/lake-america.blend'))

def main():
    preserve_and_open()
    setup()
    surfaces_and_edges()
    optimize_facades()
    wildlife()
    architecture_and_waterfront()
    vehicles()
    pickups_and_games()
    landscape_finish()
    sculpt_near_pines()
    character_staging()
    stats=export_runtime()
    save_master()
    print(json.dumps(stats,indent=2))

if __name__=='__main__':
    main()
