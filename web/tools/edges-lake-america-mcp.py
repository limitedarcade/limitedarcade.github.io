"""Lake America edge cleanup, authored through native Blender MCP.
Open the pre-edge-cleanup master before replaying. Keeps gameplay pivots,
flat fighting floor, texture coordinates, and the intentional axe/bell/paper detail.
"""
import bpy, bmesh, math, json, ast
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
EDGE_VERSION='2026-10-10-mcp-edges-v4'
REPORT={'version':EDGE_VERSION,'terrain':[],'bevels':[],'shading':[]}
ORIGINALS={}

def assets():
    return [o for o in bpy.context.scene.objects if o.type=='MESH'
        and not any(c.name.startswith(('90','91','92','93')) for c in o.users_collection)]

def triangles(obj):
    return sum(len(p.vertices)-2 for p in obj.data.polygons)

def total():
    return sum(triangles(o) for o in assets())

def remember(obj):
    if obj.name not in ORIGINALS:
        ORIGINALS[obj.name]=obj.data.copy()

def apply(obj,mod):
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=mod.name)

def components(mesh):
    links=[[] for _ in mesh.vertices]
    for e in mesh.edges:
        a,b=e.vertices;links[a].append(b);links[b].append(a)
    seen=set();groups=[]
    for v in mesh.vertices:
        if v.index in seen:continue
        stack=[v.index];group=[]
        while stack:
            i=stack.pop()
            if i in seen:continue
            seen.add(i);group.append(i);stack.extend(j for j in links[i] if j not in seen)
        low=Vector(tuple(min(mesh.vertices[i].co[k] for i in group) for k in range(3)))
        high=Vector(tuple(max(mesh.vertices[i].co[k] for i in group) for k in range(3)))
        groups.append((group,low,high))
    return groups

def round_form(obj,ratio):
    remember(obj);before=triangles(obj)
    old=components(obj.data)
    if ratio<1:
        mod=obj.modifiers.new('Edge cleanup - economical control cage','DECIMATE')
        mod.ratio=ratio;mod.use_collapse_triangulate=True;apply(obj,mod)
    mod=obj.modifiers.new('Edge cleanup - rounded silhouette','SUBSURF')
    mod.levels=1;mod.render_levels=1;apply(obj,mod)
    new=components(obj.data)
    # Round individual forms in place: no shrinking rocks away from their snow caps.
    if len(old)==len(new):
        available=set(range(len(old)))
        for ids,lo,hi in new:
            center=(lo+hi)*.5
            best=min(available,key=lambda i:(((old[i][1]+old[i][2])*.5)-center).length_squared)
            available.remove(best);_,a,b=old[best]
            for i in ids:
                co=obj.data.vertices[i].co
                for k in range(3):
                    co[k]=a[k]+(co[k]-lo[k])*(b[k]-a[k])/(hi[k]-lo[k]) if hi[k]-lo[k]>1e-8 else (a[k]+b[k])*.5
    obj.data.update()
    REPORT['terrain'].append({'name':obj.name,'before':before,'after':triangles(obj),'components':[len(old),len(new)],'kind':'rounded silhouette'})

def fit_snow_caps():
    from mathutils.bvhtree import BVHTree
    rock=bpy.data.objects['02 Near shore_rock.003']
    snow=bpy.data.objects['02 Near shore_snow.003']
    rock.data.calc_loop_triangles()
    tree=BVHTree.FromPolygons([v.co for v in rock.data.vertices],
        [tuple(t.vertices) for t in rock.data.loop_triangles],all_triangles=True)
    changed=0
    for ids,lo,hi in components(snow.data):
        mid=(lo.z+hi.z)*.5
        for i in ids:
            co=snow.data.vertices[i].co
            hit,normal,index,distance=tree.ray_cast(Vector((co.x,co.y,20)),Vector((0,0,-1)),40)
            if hit is not None:
                floor=hit.z+(.055 if co.z>=mid else .012)
                if co.z<floor:co.z=floor;changed+=1
    # Settle the rounded boulders below their original snow envelope.
    for ids,lo,hi in components(rock.data):
        for i in ids:
            co=rock.data.vertices[i].co;co.z=lo.z+(co.z-lo.z)*.83
    snow.data.update();rock.data.update()
    REPORT['snowCapFit']={'fittedVertices':changed,'rockHeightRatio':.83}

def terrain():
    if bpy.context.scene.get('lake_edge_finish')==EDGE_VERSION:
        raise RuntimeError('Edge pass already applied. Open the pre-edge backup first.')
    REPORT['beforeTriangles']=total()
    # Distant forest retains every tree and all positions, with fewer hidden facets.
    for obj in assets():
        if obj.name.startswith('03 Headland') and ('_pine' in obj.name or '_snow' in obj.name):
            remember(obj);before=triangles(obj)
            mod=obj.modifiers.new('Edge cleanup - distant forest budget','DECIMATE')
            mod.ratio=.50;mod.use_collapse_triangulate=True;apply(obj,mod)
            REPORT['terrain'].append({'name':obj.name,'before':before,'after':triangles(obj),'kind':'distant forest economy'})
    for name,ratio in [('02 Near shore_rock.003',.35),('02 Near shore_snow.003',.42),('02 Wind-sculpted snow_snow.003',.42)]:
        round_form(bpy.data.objects[name],ratio)
    # Snow on the axe stump has few faces and a prominent angular silhouette.
    round_form(bpy.data.objects['lake-america-axe-stump_snow.003'],1)
    fit_snow_caps()
    REPORT['afterTerrainTriangles']=total()
    assert total()<237000,total()
    return {'before':REPORT['beforeTriangles'],'after':total(),'terrain':REPORT['terrain']}

def bevels():
    done={item['name'] for item in REPORT['bevels']}
    first={'lake-america-axe detail rebuilt_haft','lake-america-axe detail rebuilt_toolsteel','lake-america-axe detail rebuilt_toolbit','07 Cedar rescue station_red.003'}
    priority=lambda o:(0 if o.name in first else 1 if o.name.startswith(('08 ','lake-america-axe-stump','lake-america-trail-sign','lake-america-rescue-ring')) else 2,triangles(o))
    for obj in sorted(assets(),key=priority):
        if obj.name in done:continue
        name=obj.name;mat=' '.join(m.name.lower() for m in obj.data.materials if m)
        if triangles(obj)<10 or name.startswith(('01 ','03 ','04 ','12 MCP Floe')):continue
        if any(word in mat for word in ['snow','pine','ice','fur','feather','glass','parchment','rubber','rope','coat']):continue
        if any(word in name.lower() for word in ['maple badge','boot','plaque','price display','cracked bronze shell','growth rings','feather']):continue
        if triangles(obj)>3500:continue
        if not any(word in mat for word in ['cedar','enamel','steel','bronz','hickory','charcoal','granite','ivory','bark']):continue
        # Physical radius in metres: small enough to preserve rivets, glyphs and blade.
        width=.008
        if 'steel' in mat or 'bronze' in mat:width=.004
        if name.startswith('lake-america-axe detail'):width=.003
        if 'stump' in name:width=.012
        width=min(width,min(obj.dimensions)*.08)
        if width<.0004:continue
        remember(obj);previous=obj.data.copy();before=triangles(obj)
        mod=obj.modifiers.new('Edge cleanup - soft catching edge','BEVEL')
        mod.width=width;mod.segments=3;mod.limit_method='ANGLE';mod.angle_limit=math.radians(38)
        mod.use_clamp_overlap=True;mod.harden_normals=False
        apply(obj,mod)
        added=triangles(obj)-before
        # Larger connected batches are already chamfered; their normals get a full pass.
        allowance=min(1800,max(300,int(before*4.5)))
        if added<=0 or added>allowance or total()>237000:
            rejected=obj.data;obj.data=previous
            if rejected.users==0:bpy.data.meshes.remove(rejected)
        else:
            bpy.data.meshes.remove(previous)
            REPORT['bevels'].append({'name':name,'radius':width,'segments':3,'addedTriangles':added})
    REPORT['afterBevelTriangles']=total()
    return {'beveledObjects':len(REPORT['bevels']),'triangles':total(),'details':REPORT['bevels']}

def shading():
    REPORT['shading']=[]
    for obj in assets():
        if triangles(obj)<=4:continue # Baked text / flat image quads.
        remember(obj)
        mat=' '.join(m.name.lower() for m in obj.data.materials if m)
        name=obj.name.lower()
        organic=any(w in mat for w in ['snow','pine','bark','fur','coat','feather','rope','rubber','parchment','granite'])
        angle=100 if organic else 62
        if 'axe detail' in name and 'toolbit' in name:angle=45
        if 'stump' in name and 'endgrain' in name:angle=65
        for poly in obj.data.polygons:poly.use_smooth=True
        obj.data.set_sharp_from_angle(angle=math.radians(angle))
        if not organic and '01 fighting shelf' not in name:
            mod=obj.modifiers.new('Edge cleanup - broad planar normals','WEIGHTED_NORMAL')
            mod.keep_sharp=True;mod.weight=50;mod.mode='FACE_AREA_WITH_ANGLE';mod.thresh=.01
            apply(obj,mod)
        obj.data.update()
        REPORT['shading'].append({'name':obj.name,'angle':angle,'weightedPlanarNormals':not organic and '01 fighting shelf' not in name})
    REPORT['afterTriangles']=total()
    REPORT['shadedMeshes']=len(REPORT['shading'])
    (ROOT/'artifacts/lake-america/mcp-edges-report.json').write_text(json.dumps(REPORT,indent=2)+'\n',encoding='utf8')
    return {k:REPORT[k] for k in ['beforeTriangles','afterTerrainTriangles','afterBevelTriangles','afterTriangles','shadedMeshes']}

def export_edges():
    props=bpy.app.driver_namespace.get('lake_satire_mcp')
    if not props:
        path=ROOT/'tools/props-lake-america-mcp.py'
        props={'__name__':'lake_satire_recipe','__file__':str(path)}
        exec(compile(path.read_text(encoding='utf8'),str(path),'exec'),props)
        props['bind_helpers']()
        bpy.app.driver_namespace['lake_satire_mcp']=props
    result=props['export_props']()
    path=ROOT/'game/public/stages/lake-america-3d/manifest.json'
    manifest=json.loads(path.read_text(encoding='utf8'))
    manifest['edgeCleanup']={'version':EDGE_VERSION,'recipe':'web/tools/edges-lake-america-mcp.py',
        'backup':'web/'+Path(str(bpy.context.scene['edge_cleanup_backup'])).relative_to(ROOT).as_posix(),
        'shadedMeshes':len(REPORT['shading']),'roundedProps':len(REPORT['bevels']),
        'renderAntialiasing':{'desktopSamples':4,'lowPowerSamples':2,'cappedToHardware':True},
        'method':'Native Blender MCP; angle-aware smoothing, weighted planar normals, rounded near-shore silhouettes and three-segment prop bevels'}
    manifest['features']=list(dict.fromkeys(manifest['features']+[
        'Rounded shoreline rocks and snow silhouettes, with angle-aware curved shading throughout',
        'Three-segment corner highlights and weighted planar normals on park props and equipment']))
    path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
    return result

def save_master():
    props=bpy.app.driver_namespace['lake_satire_mcp']
    scene=bpy.context.scene
    props['save_props_master']()
    scene['lake_edge_finish']=EDGE_VERSION
    scene['edge_cleanup_recipe']='Execute web/tools/edges-lake-america-mcp.py through Blender MCP on the pre-edge backup. Do not apply twice.'
    scene['last_authoring_pass']='Native Blender MCP: rounded shore rocks and snow, soft prop corners, smooth curved surfaces and weighted planar normals'
    scene['edge_cleanup_summary']=json.dumps({k:v for k,v in REPORT.items() if k not in {'terrain','bevels','shading'}})
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'stages/lake_america/blender/lake-america.blend'))

def main():
    terrain();bevels();shading();print(json.dumps(export_edges()));save_master()

if __name__=='__main__':
    main()
