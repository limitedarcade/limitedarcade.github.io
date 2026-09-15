"""Reproducible Blender master and runtime GLB. Run with Blender --background --python.

Authored in game coordinates (X across combat, Y up, Z toward the audience).
Mesh creation converts once to Blender Z-up; glTF restores game coordinates.
"""
import bpy
import math
import random
import json
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'web/stages/lake_america/blender'
OUT = ROOT / 'web/game/public/stages/lake-america-3d'
SOURCE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
random.seed(7319)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for data in list(bpy.data.materials):
    bpy.data.materials.remove(data)

def coord(p):
    return (p[0], -p[2], p[1])

def material(name, color, roughness=.8, metallic=0, emission=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1)
        p.inputs['Emission Strength'].default_value = emission
    vc = m.node_tree.nodes.new('ShaderNodeVertexColor')
    vc.layer_name = 'Color'
    p.inputs['Base Color'].default_value = (1, 1, 1, 1)
    m.node_tree.links.new(vc.outputs['Color'], p.inputs['Base Color'])
    return m, color

M = {
    'slate': material('Slate · glacial bedrock', (.11,.24,.30), .32, .12),
    'rock': material('Granite · cold blue fractures', (.19,.27,.33), .95),
    'snow': material('Snow · sunlit chalk and blue shade', (.78,.87,.94), .92),
    'ice': material('Ice · compressed shoreline', (.26,.57,.69), .24),
    'pine': material('Pine · winter needles', (.025,.10,.095), .9),
    'bark': material('Bark · weathered cedar', (.15,.12,.095), .96),
    'city': material('City · limestone and steel', (.07,.17,.25), .65, .15),
    'glass': material('City · lake glass', (.025,.09,.15), .28, .35),
    'trim': material('Architecture · pale concrete', (.25,.35,.4), .68),
    'window': material('Windows · winter light', (.16,.32,.45), .35, .2, .16),
    'metal': material('Flagpole · brushed steel', (.35,.44,.5), .3, .75),
    'cedar': material('Cedar · weathered amber boards', (.33,.19,.095), .86),
    'endgrain': material('Cedar · fresh cut endgrain', (.57,.36,.17), .9),
    'red': material('Rescue · vermilion enamel', (.7,.035,.045), .42, .12),
    'cream': material('Lettering · ivory enamel', (.91,.89,.73), .58),
    'navy': material('Station · deep lake enamel', (.025,.075,.105), .52, .1),
    'rope': material('Rope · natural flax', (.44,.35,.22), .96),
    'blade': material('Axe · forged steel', (.54,.66,.72), .2, .82),
    'edge': material('Axe · polished cutting edge', (.86,.93,.96), .15, .88),
    'grip': material('Axe · black rubber grip', (.023,.032,.036), .88),
    'crack': material('Ice · submerged fracture', (.14,.32,.38), .6),
    'lamp': material('Lantern · amber glass', (1,.43,.09), .3, 0, 3),
    'charcoal': material('Festival · charcoal wool', (.018,.026,.03), .9),
    'goose': material('Goose · winter taupe', (.31,.29,.25), .92),
    'moose': material('Moose · cocoa winter coat', (.24,.125,.065), .96),
    'orange': material('Safety · traffic cone orange', (.96,.19,.025), .54, .04),
    'syrup': material('Syrup · impossible amber', (.62,.16,.025), .24, .08, .28),
}
collections = {}
def collection(name):
    if name not in collections:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
        collections[name] = c
    return collections[name]

class Batch:
    def __init__(self, group, mat):
        self.group, self.mat = group, mat
        self.vertices, self.faces, self.colors = [], [], []
    def add(self, verts, faces, tint=1):
        start = len(self.vertices)
        self.vertices.extend(coord(v) for v in verts)
        self.faces.extend(tuple(start+i for i in f) for f in faces)
        base = M[self.mat][1]
        for v in verts:
            n = .965 + .035 * math.sin(v[0]*1.7 + v[1]*2.6 + v[2]*.7)
            self.colors.append(tuple(min(1, max(0, c*tint*n)) for c in base) + (1,))
    def finish(self):
        mesh = bpy.data.meshes.new(f'{self.group}_{self.mat}')
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.materials.append(M[self.mat][0])
        mesh.update()
        if self.mat == 'snow':
            for polygon in mesh.polygons: polygon.use_smooth = True
        color = mesh.color_attributes.new(name='Color', type='BYTE_COLOR', domain='POINT')
        for i, rgba in enumerate(self.colors):
            color.data[i].color = rgba
        obj = bpy.data.objects.new(mesh.name, mesh)
        collection(self.group).objects.link(obj)
        return obj

batches = {}
def batch(group, mat):
    key = (group,mat)
    if key not in batches: batches[key] = Batch(group, mat)
    return batches[key]

def box(group, mat, x,y,z, w,h,d, tint=1):
    verts = [(x+sx*w/2,y+sy*h/2,z+sz*d/2) for sx,sy,sz in
             [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]]
    faces = [(0,3,2,1),(4,5,6,7),(0,4,7,3),(1,2,6,5),(3,7,6,2),(0,1,5,4)]
    batch(group, mat).add(verts,faces,tint)

def beam(group, mat, a, b, radius, sides=8, tint=1):
    """Round timber, rope or metal with an arbitrary axis, in game coordinates."""
    a,b=Vector(a),Vector(b)
    axis=(b-a).normalized()
    tangent=axis.cross(Vector((0,1,0)))
    if tangent.length<.001: tangent=axis.cross(Vector((1,0,0)))
    tangent.normalize(); bitangent=axis.cross(tangent)
    verts=[tuple(p+radius*(tangent*math.cos(j*math.tau/sides)+bitangent*math.sin(j*math.tau/sides)))
           for p in (a,b) for j in range(sides)]
    faces=[(j,(j+1)%sides,sides+(j+1)%sides,sides+j) for j in range(sides)]
    faces += [tuple(reversed(range(sides))),tuple(sides+j for j in range(sides))]
    batch(group,mat).add(verts,faces,tint)

def profile(group,mat,points,z,depth,tint=1):
    """Extruded XY silhouette, giving signs and axe heads a genuine side profile."""
    n=len(points)
    verts=[(x,y,z+dz) for dz in (-depth/2,depth/2) for x,y in points]
    faces=[tuple(reversed(range(n))),tuple(n+j for j in range(n))]
    faces += [(j,(j+1)%n,n+(j+1)%n,n+j) for j in range(n)]
    batch(group,mat).add(verts,faces,tint)

def ring(group,mat,x,y,z,radius,tube,segments=32,sides=8):
    verts=[]
    for i in range(segments):
        a=i*math.tau/segments
        for j in range(sides):
            b=j*math.tau/sides; r=radius+math.cos(b)*tube
            verts.append((x+math.cos(a)*r,y+math.sin(a)*r,z+math.sin(b)*tube))
    faces=[(i*sides+j,((i+1)%segments)*sides+j,((i+1)%segments)*sides+(j+1)%sides,i*sides+(j+1)%sides)
           for i in range(segments) for j in range(sides)]
    batch(group,mat).add(verts,faces)

def lathe(group, mat, x,y,z, rings, sides=20, tint=1):
    verts = [(x+math.cos(j*math.tau/sides)*r,y+height,z+math.sin(j*math.tau/sides)*r)
             for height,r in rings for j in range(sides)]
    faces=[]
    for k in range(len(rings)-1):
        for j in range(sides):
            a=k*sides+j; b=k*sides+(j+1)%sides
            faces.append((a,a+sides,b+sides,b))
    faces.extend([tuple(range(sides)),tuple((len(rings)-1)*sides+j for j in reversed(range(sides)))])
    batch(group,mat).add(verts,faces,tint)

def ellipsoid(group, mat, x,y,z, rx,ry,rz, segments=10, rings=5, tint=1):
    """Low-poly character volume in game coordinates."""
    verts=[(x,y+ry,z)]
    for ring_index in range(1,rings):
        angle=math.pi*ring_index/rings
        for j in range(segments):
            around=j*math.tau/segments
            verts.append((x+math.sin(angle)*math.cos(around)*rx,
                          y+math.cos(angle)*ry,
                          z+math.sin(angle)*math.sin(around)*rz))
    bottom=len(verts); verts.append((x,y-ry,z))
    faces=[]
    for j in range(segments): faces.append((0,1+j,1+(j+1)%segments))
    for ring_index in range(rings-2):
        a=1+ring_index*segments; b=a+segments
        for j in range(segments): faces.append((a+j,b+j,b+(j+1)%segments,a+(j+1)%segments))
    last=1+(rings-2)*segments
    for j in range(segments): faces.append((last+j,bottom,last+(j+1)%segments))
    batch(group,mat).add(verts,faces,tint)

def rock(group, x,y,z, sx,sy,sz, snowy=True, tint=1):
    n=11 if group.startswith('03') else 15
    radii=[random.uniform(.78,1.12) for _ in range(n)]
    verts=[]
    for height, radius in [(-.18,.72),(.18,1),(.65,.87),(1,.47)]:
        for j in range(n):
            a=j*math.tau/n
            verts.append((x+math.cos(a)*sx*radii[j]*radius,y+height*sy+(random.random()-.5)*sy*.14,z+math.sin(a)*sz*radii[j]*radius))
    faces=[]
    for k in range(3):
        for j in range(n): faces.append((k*n+j,(k+1)*n+j,(k+1)*n+(j+1)%n,k*n+(j+1)%n))
    faces.append(tuple(3*n+j for j in reversed(range(n))))
    batch(group,'rock').add(verts,faces,tint)
    if snowy:
        lower=[(v[0],v[1]+.025,v[2]) for v in verts[2*n:3*n]]
        upper=[(v[0],v[1]+.045,v[2]) for v in verts[3*n:4*n]]
        caps=[(j,n+j,n+(j+1)%n,(j+1)%n) for j in range(n)]
        caps.append(tuple(n+j for j in reversed(range(n))))
        batch(group,'snow').add(lower+upper,caps,random.uniform(.84,1.05))

def pine(group,x,y,z,height,seed):
    rng=random.Random(seed)
    lathe(group,'bark',x,y,z,[(0,height*.027),(height*.87,height*.009)],7)
    if group.startswith('02'):
        # Individual drooping branches replace solid cone skirts near camera.
        # Gaps reveal dark needles and the trunk beneath uneven snow pillows.
        for tier in range(9):
            fraction=tier/9
            level=y+height*(.14+fraction*.77)
            radius=height*.22*(1-fraction*.91)
            for branch in range(9):
                a=branch*math.tau/9+tier*.71+rng.uniform(-.12,.12)
                reach=radius*rng.uniform(.72,1.16); wide=reach*.24
                ux,uz=math.cos(a),math.sin(a); vx,vz=-uz,ux
                def point(r,w,dy): return (x+ux*r+vx*w,level+dy,z+uz*r+vz*w)
                verts=[point(.08,0,height*.13),point(reach,0,-height*.025),
                       point(reach*.65,wide,0),point(reach*.65,-wide,0),
                       point(reach*.49,0,height*.048),point(.1,0,-height*.025)]
                batch(group,'pine').add(verts,[(0,4,2),(0,3,4),(4,1,2),(4,3,1),(5,2,1),(5,1,3),(0,2,5),(0,5,3)],rng.uniform(.7,1.15))
                snow=[point(.11,0,height*.132),point(reach*.91,0,height*.002),
                      point(reach*.61,wide*.83,height*.02),point(reach*.61,-wide*.83,height*.02),
                      point(reach*.43,0,height*.074)]
                batch(group,'snow').add(snow,[(0,4,2),(0,3,4),(4,1,2),(4,3,1)],rng.uniform(.84,1.))
        return
    # Irregular overlapping bough skirts create actual silhouettes at every angle.
    tiers=6 if group.startswith('02') else 4
    count=11 if group.startswith('02') else 9
    for k in range(tiers):
        fraction=k/tiers
        level=.13+fraction*.73
        radius=height*(.21*(1-fraction*.86))
        verts=[]
        for ring in range(3):
            for j in range(count):
                a=j*math.tau/count+k*.61
                r=radius*([1,.62,.06][ring])*rng.uniform(.86,1.12)
                if ring == 0 and j%2: r *= .73
                yy=y+height*(level+[0,.045,.24 if tiers==4 else .18][ring])
                if ring==0: yy-=height*(.018 if j%2 else 0)
                verts.append((x+math.cos(a)*r,yy,z+math.sin(a)*r))
        faces=[(j,count+j,count+(j+1)%count,(j+1)%count) for j in range(count)]
        faces += [(count+j,2*count+j,2*count+(j+1)%count,count+(j+1)%count) for j in range(count)]
        batch(group,'pine').add(verts,faces,rng.uniform(.78,1.17))
        # Snow loads the upper boughs; dark tips and underside remain exposed.
        snowverts=[(x+(v[0]-x)*.98,v[1]+height*.027,z+(v[2]-z)*.98) for v in verts]
        batch(group,'snow').add(snowverts,faces,rng.uniform(.8,1.0))

# Flat, triangulated playable shelf. Each inset polygon is a separate glacial slab.
# Height stays zero across all contact points; narrow joints reveal dark substrate.
nx,nz=34,19
grid={}
for i in range(nx+1):
    for j in range(nz+1):
        grid[i,j]=(-25+i*50/nx+random.uniform(-.58,.58), -13+j*28/nz+random.uniform(-.52,.52))
def cell(i,j):
    cx,cz=grid[i,j]
    polygon=[(cx-2.5,cz-2.5),(cx+2.5,cz-2.5),(cx+2.5,cz+2.5),(cx-2.5,cz+2.5)]
    for a in range(max(0,i-2),min(nx,i+2)+1):
        for b in range(max(0,j-2),min(nz,j+2)+1):
            if (a,b)==(i,j): continue
            px,pz=grid[a,b]; dx,dz=px-cx,pz-cz
            limit=(px*px+pz*pz-cx*cx-cz*cz)/2
            clipped=[]
            for k,point in enumerate(polygon):
                prev=polygon[k-1]; dp=prev[0]*dx+prev[1]*dz-limit; dc=point[0]*dx+point[1]*dz-limit
                if (dp<=0)!=(dc<=0):
                    t=dp/(dp-dc)
                    clipped.append((prev[0]+(point[0]-prev[0])*t,prev[1]+(point[1]-prev[1])*t))
                if dc<=0: clipped.append(point)
            polygon=clipped
    return polygon
for i in range(nx):
    for j in range(nz):
        raw=cell(i,j)
        if len(raw)<3: continue
        cx=sum(v[0] for v in raw)/len(raw); cz=sum(v[1] for v in raw)/len(raw)
        if (cx/24)**2+((cz-1)/13)**2>1: continue
        points=[(x,0,z) for x,z in raw]
        batch('01 Fighting shelf','slate').add(points,[tuple(reversed(range(len(points))))],1)
        # Snow is sculpted as wind-loaded drifts below, never flat polygon tiles.
# The continuous top of the elliptical cliff below closes every slab joint.
# Keep it below Y=0: one uninterrupted, level collision/readability surface.
# Elliptical island cliff skirt, fully closed around the rear and front.
verts=[]; n=100
for height,rad in [(-1.3,.91),(-.42,1.02),(-.05,1)]:
    for j in range(n):
        a=j*math.tau/n; noise=1+.028*math.sin(a*13)
        verts.append((24.9*math.cos(a)*rad*noise,height,1+13.9*math.sin(a)*rad*noise))
faces=[(j,n+j,n+(j+1)%n,(j+1)%n) for j in range(n)]
faces += [(n+j,2*n+j,2*n+(j+1)%n,n+(j+1)%n) for j in range(n)]
faces.append(tuple(2*n+j for j in reversed(range(n))))
batch('01 Fighting shelf','rock').add(verts,faces,.66)
for i in range(64):
    a=i*math.tau/64; x=24.3*math.cos(a); z=1+13.25*math.sin(a)
    rock('02 Near shore',x,-.48,z,random.uniform(.45,1.5),random.uniform(.24,.62),random.uniform(.5,1.1))
# Side framing stays outside the active lane and pursuit path.
for side in [-1,1]:
    for i in range(16):
        x=side*random.uniform(12,23); z=random.uniform(-9,10)
        rock('02 Near shore',x,-.12,z,random.uniform(.5,1.8),random.uniform(.45,1.6),random.uniform(.5,1.2))
    for i in range(10):
        x=side*random.uniform(17,24); z=random.uniform(-10,9)
        pine('02 Near shore',x,0,z,random.uniform(3.8,7.5),100+i+(side+1)*100)

# Smaller inland groves enter the combat composition and frame the open bay.
# All trunks remain well behind the lane, including at maximum camera pan.
for side in [-1,1]:
    for i,(x,z,h) in enumerate([(10.8,-10.2,4.8),(13,-12,6.1),(15,-10.8,5.4),(11.7,-15,3.8),(16,-7,6.5)]):
        pine('02 Near shore',side*x,0,z,h,4500+i+int(side+1)*200)
        rock('02 Near shore',side*x,-.12,z,1.25,.6,1.1)

def drift(x,z,rx,rz,height):
    vertices=[]; faces=[]; segments=36; rings=7
    for ring_index in range(rings):
        r=.015+(ring_index/(rings-1))*.985
        for j in range(segments):
            a=j*math.tau/segments
            rim=1+.1*math.sin(a*3+x)+.035*math.sin(a*7+z)
            y=.009+height*(1-r*r)**2*(.86+.14*math.sin(a))
            vertices.append((x+math.cos(a)*rx*r*rim,y,z+math.sin(a)*rz*r*rim))
    for k in range(rings-1):
        for j in range(segments):
            faces.append((k*segments+j,k*segments+(j+1)%segments,(k+1)*segments+(j+1)%segments,(k+1)*segments+j))
    faces.append(tuple(reversed(range(segments))))
    batch('02 Wind-sculpted snow','snow').add(vertices,faces,1)

for x,z,rx,rz,h in [(-10,-7.7,2.8,1.2,.24),(-7,-10.8,2.4,1.05,.19),(-3.6,-12,2.6,.8,.12),
                    (0,-12.2,2.7,.9,.15),(4.2,-11.7,2.4,.8,.12),(8.9,-9.3,2.8,1.3,.24),
                    (-10,3.5,1.8,3.2,.15),(10.6,4.2,2,3.1,.19),(-3,9,5,1.3,.10),(4,10,4,1.2,.14)]:
    drift(x,z,rx,rz,h)

# Headlands at multiple distances, with tapered shoreline and dense irregular trees.
for side in [-1,1]:
    for layer in range(3):
        group=f'03 Headland {side} {layer}'
        for i in range(24):
            x=side*(25+i*2.3+layer*14); z=-34-layer*28+math.sin(i*.26)*8
            h=(2.8+math.sin(i*.15)*3+random.random()*2)*(1+layer*.2)
            rock(group,x,-1.2,z,4.2,h,7,True,1-layer*.035)
            for k in range(2):
                pine(group,x+random.uniform(-2,2),h*.63,z+random.uniform(-3,2),random.uniform(5,10),i+layer*100+k*600+(side+1)*1000)

# Distant city has real mass, setbacks, roofs, and repeated facade strips.
for i in range(88):
    x=-112+i*2.65+random.uniform(-1,1)
    z=-178-random.uniform(0,42)
    w=random.uniform(1.3,3.7); d=random.uniform(2.2,4.5)
    cluster=.42+.58*max(math.exp(-((x+34)/21)**2),math.exp(-((x-37)/28)**2))
    h=random.uniform(5,22)*cluster
    group='04 Toronto skyline'
    box(group,'city',x,h/2-.5,z,w,h,d,random.uniform(.72,1.28))
    box(group,'trim',x,h-.43,z,w+.1,.18,d+.1)
    if i%3==0: box(group,'city',x,h+.3,z,w*.65,1.4,d*.64,.9)
    # Horizontal bands and vertical mullions give skyline detail with little geometry.
    for level in range(1,int(h/.95)):
        yy=level*.95
        for front in [-1,1]:
            box(group,'glass',x,yy,z+front*(d/2+.012),w*.89,.36,.025,random.uniform(.7,1.3))
        for side in [-1,1]:
            box(group,'window',x+side*(w/2+.012),yy,z,.025,.27,d*.88,random.uniform(.7,1.2))
    for offset in [-.25,0,.25]:
        for front in [-1,1]: box(group,'trim',x+w*offset,h/2,z+front*(d/2+.035),.045,h,.035,.7)
    if i%9==0: lathe(group,'metal',x,h,z,[(0,.035),(1.6,.025)],6)

# CN Tower: tapered concrete shaft, layered observation pod, antenna.
tx,tz=-24,-182
lathe('05 Landmarks','trim',tx,0,tz,[(0,.68),(4,.39),(17,.24),(22,.18)],24)
lathe('05 Landmarks','city',tx,0,tz,[(17,.25),(17.5,1.3),(18,1.65),(18.4,1.6),(18.8,.94),(19.15,.48)],32)
lathe('05 Landmarks','glass',tx,0,tz,[(17.9,1.67),(18.4,1.62)],32)
lathe('05 Landmarks','trim',tx,0,tz,[(19.1,.45),(22.5,.21),(23,.4),(23.5,.38),(24,.16),(27.5,.06)],20)
lathe('05 Landmarks','metal',tx,27.5,tz,[(0,.05),(3,.012)],12)
# The tower is still recognizable; it is simply prepared for the forecast.
lathe('05 Landmarks','red',tx,26.92,tz,[(0,.43),(.28,.58),(.7,.31),(.92,.08)],12)
ellipsoid('05 Landmarks','cream',tx,27.91,tz,.16,.16,.16,8,4)
# Stadium's broad low dome beside the needle.
rings=[(0,8.7),(.6,8.7),(1.3,8.1),(2.3,6.7),(3.25,4.5),(3.8,.1)]
lathe('05 Landmarks','trim',-40,0,-182,rings,48)
for i in range(10): box('05 Landmarks','city',-48+i*1.8,.8,-174,.22,1.6,.3)
# Waterfront pier line grounds every building on the same horizon.
box('04 Toronto skyline','trim',0,-.28,-176,238,.4,4,.65)

# A low ferry in the bay gives the skyline a believable distance and scale.
g='11 Winter ferry'; fx,fz=18,-67
profile(g,'navy',[(fx-3.1,-.83),(fx+2.9,-.83),(fx+3.5,.12),(fx-3.4,.12)],fz,1.9)
box(g,'cream',fx,.43,fz,5.4,.62,1.7)
box(g,'navy',fx,.85,fz,5.7,.14,1.85)
box(g,'cream',fx+.65,1.13,fz,2.3,.47,1.42)
box(g,'red',fx-.7,1.18,fz,.4,.62,.6)
for i in range(10): box(g,'glass',fx-2.35+i*.51,.48,fz+.86,.34,.26,.025)
beam(g,'metal',(fx+.6,1.4,fz),(fx+.6,2.2,fz),.028)

# A pole and an attachment marker; cloth is deformed in the runtime shader.
lathe('06 Flag station','metal',8.8,0,-5.9,[(0,.052),(6.8,.036)],12)
lathe('06 Flag station','metal',8.8,6.8,-5.9,[(0,.065),(.12,.025)],12)
box('06 Flag station','rock',8.8,.08,-5.9,.42,.16,.42)

# Lakeshore architecture is kept behind the fighting plane. The open center
# reads as a rink; the dock and rescue hut tell the story of a working waterfront.
g='07 Cedar rescue station'
sx,sz=8.8,-13.8
for x in [sx-1.6,sx+1.6]:
    for z in [sz-1.25,sz+1.25]:
        beam(g,'cedar',(x,-.45,z),(x,2.8,z),.095,8)
for i in range(17):
    x=sx-1.65+i*.206
    box(g,'cedar',x,.14,sz,.19,.2,2.8,random.uniform(.8,1.15))
# Rear and side boards have physical gaps, including visible roof overhang.
for i in range(12):
    yy=.36+i*.185
    box(g,'cedar',sx,yy,sz-1.18,3.22,.17,.12,random.uniform(.8,1.14))
    for side in [-1,1]:
        box(g,'cedar',sx+side*1.59,yy,sz,.11,.17,2.35,random.uniform(.8,1.1))
profile(g,'navy',[(sx-1.94,2.65),(sx+1.94,2.65),(sx,3.65)],sz,3.12)
profile(g,'snow',[(sx-2.03,2.68),(sx,3.77),(sx+2.03,2.68),(sx+1.91,2.82),(sx,3.69),(sx-1.91,2.82)],sz,3.25)
box(g,'navy',sx,2.18,sz+1.31,3.1,.49,.14)
for i in range(19):
    xx=sx-1.83+i*.204
    lathe(g,'ice',xx,2.65,sz+1.64,[(-random.uniform(.09,.29),.005),(0,.022)],6)
box(g,'red',sx-.94,.98,sz+1.33,.82,1.15,.22)
box(g,'cream',sx-.94,1.1,sz+1.46,.44,.12,.018)
box(g,'cream',sx-.94,1.1,sz+1.46,.12,.44,.019)
# Flotation ring and its upper hanging loop, readable from the action camera.
ring(g,'red',sx+.74,1.15,sz+1.42,.37,.075)
for xx,yy in [(sx+.74,1.52),(sx+.74,.78),(sx+.37,1.15),(sx+1.11,1.15)]:
    box(g,'cream',xx,yy,sz+1.49,.1,.1,.07)
beam(g,'rope',(sx+.43,1.15,sz+1.45),(sx+.74,1.78,sz+1.43),.014,6)
beam(g,'rope',(sx+1.04,1.15,sz+1.45),(sx+.74,1.78,sz+1.43),.014,6)
# Warm glazed opening, cedar mullions, snow-covered bench and a rescue sled.
box(g,'lamp',sx+.1,1.38,sz-1.09,1.18,.85,.024)
for dx in [-.64,0,.64]: box(g,'cedar',sx+.1+dx,1.38,sz-1.06,.07,1,.08)
box(g,'cedar',sx+.1,1.38,sz-1.04,1.32,.055,.06)
box(g,'cedar',sx-2.8,.5,sz+.3,1.55,.12,.54)
box(g,'snow',sx-2.8,.58,sz+.3,1.6,.08,.56)
for dx in [-.6,.6]: box(g,'metal',sx-2.8+dx,.25,sz+.3,.065,.5,.45)
box(g,'red',sx+2.4,.23,sz+.2,.66,.27,1.8)
for dx in [-.24,.24]: beam(g,'metal',(sx+2.4+dx,.08,sz-.8),(sx+2.4+dx,.08,sz+1.3),.035)
# Slender timber dock ends in a low landing beyond the back edge of the island.
for i in range(42):
    z=sz-1.5-i*.225
    box(g,'cedar',sx,.045,z,2.5,.16,.212,random.uniform(.8,1.13))
    if i%7==0:
        for side in [-1,1]:
            x=sx+side*1.27
            beam(g,'cedar',(x,-1,z),(x,.8,z),.075,8)
            lathe(g,'snow',x,.79,z,[(0,.085),(.03,.06)],8)
for side in [-1,1]:
    x=sx+side*1.27
    for i in range(5):
        a=sz-1.5-i*1.575
        for j in range(6):
            za=a-j*1.575/6; zb=a-(j+1)*1.575/6
            ya=.73-.16*math.sin(j*math.pi/6); yb=.73-.16*math.sin((j+1)*math.pi/6)
            beam(g,'rope',(x,ya,za),(x,yb,zb),.019,6)
# Public shoreline sign deliberately uses editable text in the master.
g='08 Lake America trail sign'
wx,wz=-3.2,-7.4
for dx in [-2.18,2.18]:
    beam(g,'cedar',(wx+dx,0,wz),(wx+dx,2.47,wz),.075,8)
    lathe(g,'metal',wx+dx,.04,wz,[(0,.1),(.22,.1)],8)
box(g,'cedar',wx,1.95,wz,5.04,1.49,.2)
box(g,'navy',wx,1.96,wz+.12,4.84,1.3,.04)
box(g,'snow',wx,2.75,wz,5.26,.07,.4)
box(g,'red',wx,1.42,wz+.16,4.68,.22,.025)
# Routed timber frame, brass edging, real fixings and stone footings.
for dx in [-2.48,2.48]:
    box(g,'cedar',wx+dx,1.96,wz+.16,.13,1.52,.16)
for yy in [1.22,2.68]:
    box(g,'cedar',wx,yy,wz+.16,5.12,.13,.18)
    box(g,'cream',wx,yy+(.08 if yy<2 else -.08),wz+.26,4.88,.025,.018)
for dx in [-2.18,2.18]:
    box(g,'cedar',wx+dx,1.3,wz,.19,2.6,.23)
    box(g,'rock',wx+dx,.17,wz,.45,.34,.45)
    box(g,'snow',wx+dx,.355,wz,.47,.045,.47)
    beam(g,'cedar',(wx+dx,.8,wz-.05),(wx+dx*.6,1.28,wz-.05),.055,8)
    for yy in [1.32,2.58]:
        beam(g,'metal',(wx+dx,yy,wz+.23),(wx+dx,yy,wz+.29),.035,10)
profile(g,'cedar',[(wx-.72,2.71),(wx-.52,3.02),(wx,3.22),(wx+.52,3.02),(wx+.72,2.71)],wz,.2)
profile(g,'navy',[(wx-.58,2.74),(wx-.43,2.96),(wx,3.12),(wx+.43,2.96),(wx+.58,2.74)],wz+.12,.025)
# Mountain-and-wave crest: deliberate geometry, no generated lettering.
profile(g,'cream',[(wx-.34,2.79),(wx-.10,3.02),(wx+.07,2.84),(wx+.19,2.94),(wx+.35,2.79)],wz+.15,.018)
box(g,'ice',wx,2.755,wz+.16,.7,.025,.02)

# Shore lamps establish a repeating human scale without fencing the fighters in.
g='10 Waterfront lanterns'
for x,z in [(-8.2,-9.3),(-3.8,-11.6),(3.6,-11.6),(7.1,-9.3)]:
    lathe(g,'metal',x,0,z,[(0,.12),(.12,.12),(.18,.055),(2.75,.04)],10)
    lathe(g,'metal',x,2.52,z,[(0,.18),(.07,.23),(.11,.15)],10)
    lathe(g,'lamp',x,2.63,z,[(0,.115),(.34,.13)],8)
    lathe(g,'metal',x,2.96,z,[(0,.22),(.08,.22),(.2,.045)],10)
    lathe(g,'snow',x,3.04,z,[(0,.22),(.14,.055)],10)
    for dx,dz in [(-.13,0),(.13,0),(0,-.13),(0,.13)]:
        beam(g,'metal',(x+dx,2.6,z+dz),(x+dx,3.0,z+dz),.014,5)

# Axe pickup: all vertices below are local to a stable reusable game pivot.
# Only the weapon parent disappears when used; the stump is independent.
AXE_POSITION=(-5,.85,-.65)
g='lake-america-axe'
beam(g,'cedar',(-.065,-.63,0),(.035,.32,0),.045,12)
beam(g,'grip',(-.065,-.64,0),(-.03,-.28,0),.052,12)
for i in range(9):
    yy=-.60+i*.036; xx=-.065+(yy+.63)/.95*.1
    lathe(g,'red',xx,yy,0,[(0,.055),(.016,.055)],12)
profile(g,'blade',[(-.33,.31),(-.19,.39),(.005,.43),(.12,.41),(.31,.54),(.42,.57),(.44,.27),(.33,.22),(.14,.30),(-.06,.28),(-.32,.25)],0,.12)
profile(g,'edge',[(.31,.54),(.42,.57),(.44,.27),(.33,.22),(.335,.28),(.32,.5)],0,.128)
profile(g,'edge',[(-.38,.245),(-.33,.31),(-.19,.39),(-.22,.34)],0,.09)
beam(g,'metal',(.04,.32,-.083),(.04,.32,.083),.048,12)
ring(g,'metal',-.068,-.65,0,.049,.013,16,6)
g='lake-america-axe-stump'
ax,ay,az=AXE_POSITION
lathe(g,'bark',ax,0,az,[(0,.29),(.12,.255),(.43,.245),(.46,.25)],13)
lathe(g,'endgrain',ax,.458,az,[(0,.239),(.013,.234)],13)
for i in range(9):
    a=i*math.tau/9; x=ax+math.cos(a)*.248; z=az+math.sin(a)*.248
    beam(g,'cedar',(x,.09,z),(x,.42,z),.012,5,.7)
for side in [-1,1]:
    profile(g,'snow',[(ax+side*.17,.466),(ax+side*.27,.466),(ax+side*.25,.5),(ax+side*.2,.51)],az,.3)
box(g,'crack',ax-.035,.474,az,.028,.012,.24)

# Opposite-side pickup: buoyant rescue ring with four reflective wraps.
RING_POSITION=(5,.92,-.65)
g='lake-america-rescue-ring'
ring(g,'red',0,0,0,.32,.09,48,10)
ring(g,'rope',0,0,-.035,.44,.018,48,6)
for dx,dy in [(0,.32),(0,-.32),(.32,0),(-.32,0)]:
    box(g,'cream',dx,dy,.013,.145 if dx==0 else .185,.185 if dx==0 else .145,.184)
    beam(g,'rope',(dx,dy,-.02),(dx*1.37,dy*1.37,-.02),.017,6)
g='12 Rescue ring stand'
rx,ry,rz=RING_POSITION
for dx in [-.25,.25]:
    box(g,'metal',rx+dx,.62,rz-.16,.055,1.24,.07)
    box(g,'metal',rx+dx,.025,rz-.12,.22,.05,.3)
box(g,'navy',rx,.72,rz-.18,.69,.94,.1)
box(g,'metal',rx,1.25,rz-.06,.12,.055,.32)
box(g,'snow',rx,1.31,rz-.16,.79,.055,.26)
box(g,'red',rx,.23,rz-.09,.61,.16,.08)
for dx in [-.22,0,.22]: box(g,'cream',rx+dx,.23,rz-.045,.08,.12,.015)

# Layered, low waterfront furnishings preserve the open fighting corridor.
g='13 Working waterfront'
for x in [-2.6,1.3]:
    z=-9.7
    for dx in [-.63,.63]:
        box(g,'metal',x+dx,.25,z,.075,.5,.54)
        beam(g,'metal',(x+dx,.4,z-.19),(x+dx,.97,z-.32),.032,8)
    for j in range(4): box(g,'cedar',x,.5,z-.24+j*.16,1.65,.07,.14)
    for yy in [.72,.89]: box(g,'cedar',x,yy,z-.32,1.65,.13,.07)
    box(g,'snow',x,.55,z-.14,1.5,.045,.25)
for x in [-9,-4.5,0,4.5,9]:
    z=-12.1
    lathe(g,'metal',x,0,z,[(0,.17),(.08,.17),(.12,.08),(.48,.085),(.53,.14),(.6,.14)],12)
    lathe(g,'snow',x,.6,z,[(0,.14),(.035,.1)],12)
    for j in range(3): ring(g,'rope',x,.27+j*.04,z,.13,.015,20,6)
# Flaked ice at the back edge, with real bevels instead of rectangular cards.
for i in range(22):
    x=-12+i*1.12; z=-13.1-random.uniform(0,.8)
    if 6.8<x<10.6: continue
    w=random.uniform(.32,.85); h=random.uniform(.12,.33)
    profile('14 Pressure ice','ice',[(x-w,-.36),(x-w*.8,h*.3),(x-w*.2,h),(x+w*.8,h*.55),(x+w,-.35)],z,random.uniform(.2,.48))
    box('14 Pressure ice','snow',x,.035,z,w*.9,.045,.23)
# Chimney, roof seams, and stacked fuel give the rescue hut a working scale.
g='07 Cedar rescue station'
box(g,'rock',sx+.92,3.47,sz-.4,.38,1.17,.42)
box(g,'metal',sx+.92,4.09,sz-.4,.54,.1,.56)
box(g,'snow',sx+.92,4.16,sz-.4,.56,.045,.58)
for side in [-1,1]:
    for i in range(12):
        zz=sz-1.47+i*.27
        beam(g,'metal',(sx,3.665,zz),(sx+side*1.94,2.69,zz),.015,5)
for row in range(3):
    for col in range(5-row):
        x=sx-1.65+col*.2+row*.1
        beam(g,'bark',(x,.24+row*.17,sz+1.42),(x,.24+row*.17,sz+2.05),.095,9)
        beam(g,'endgrain',(x,.24+row*.17,sz+2.05),(x,.24+row*.17,sz+2.065),.08,9)

# World-space frost, scoring and branching fractures are shaded at runtime.
FLOATING={}
floe_positions=[(-5,-16.2,1.7,.85),(2,-16.8,2.1,.85),(9,-15.3,1.3,.7),(-19,-11.8,1.2,.6),(18,12.2,1.7,.65),(5,17.1,1.8,.8)]
for i in range(18): floe_positions.append((random.uniform(-33,33),random.uniform(-22,-58),random.uniform(.5,1.8),random.uniform(.25,.7)))
for i,(x,z,fw,fd) in enumerate(floe_positions,1):
    g=f'lake-america-floe-{i}'; FLOATING[g]=(x,-.56,z)
    points=[]; n=8
    for j in range(n):
        a=j*math.tau/n; r=random.uniform(.82,1.14)
        points.append((math.cos(a)*fw*r,math.sin(a)*fd*r))
    verts=[(px,y,pz) for y in [-.1,.065] for px,pz in points]
    batch(g,'ice').add(verts,[(j,n+j,n+(j+1)%n,(j+1)%n) for j in range(n)]+[tuple(n+j for j in reversed(range(n)))],1.2)
    top=[(px*.87,.071,pz*.87) for px,pz in points]
    b=batch(g,'ice'); start=len(b.colors); b.add(top,[tuple(reversed(range(n)))])
    b.colors[start:]=[(.76,.87,.9,1)]*n
g='lake-america-buoy'; FLOATING[g]=(14,-.5,-18)
lathe(g,'red',0,0,0,[(-.35,.32),(0,.48),(.22,.33),(.34,.23)],16)
lathe(g,'cream',0,.32,0,[(0,.22),(.16,.19)],16)
beam(g,'metal',(0,.4,0),(0,1.4,0),.035,8)
lathe(g,'red',0,1.19,0,[(0,.13),(.18,.13),(.3,.0)],12)

# The waterfront's winter festival has gone cheerfully off script. These
# low-poly vignettes sit entirely behind the combat corridor and give every
# camera angle a small story: a goose safety committee, an overqualified moose
# lifeguard, a maple-syrup Zamboni and a curling house nobody asked for.
def goose_character(group,x,y,z,scale=1,spread=False,crowned=False,tint=1):
    s=scale
    ellipsoid(group,'goose',x,y+.52*s,z,.47*s,.55*s,.36*s,10,5,tint)
    ellipsoid(group,'cream',x,y+.47*s,z+.31*s,.29*s,.34*s,.095*s,8,4,1.04)
    beam(group,'charcoal',(x,y+.71*s,z),(x-.03*s,y+1.24*s,z+.015*s),.14*s,7)
    ellipsoid(group,'charcoal',x-.03*s,y+1.35*s,z+.02*s,.28*s,.25*s,.25*s,9,4)
    beam(group,'orange',(x-.03*s,y+1.31*s,z+.2*s),(x-.03*s,y+1.27*s,z+.5*s),.082*s,6)
    for side in [-1,1]:
        ellipsoid(group,'cream',x+side*.145*s,y+1.37*s,z+.205*s,.075*s,.115*s,.045*s,6,3)
        ellipsoid(group,'charcoal',x+side*.105*s,y+1.43*s,z+.248*s,.025*s,.035*s,.018*s,5,3)
        beam(group,'orange',(x+side*.14*s,y+.1*s,z),(x+side*.16*s,y-.01*s,z+.03*s),.026*s,5)
        beam(group,'orange',(x+side*.16*s,y-.01*s,z+.03*s),(x+side*.31*s,y-.015*s,z+.15*s),.024*s,5)
    if spread:
        profile(group,'goose',[(x-.18*s,y+.77*s),(x-1.2*s,y+1.17*s),(x-1.62*s,y+.96*s),(x-1.05*s,y+.52*s),(x-.18*s,y+.34*s)],z,.17*s,.93)
        profile(group,'goose',[(x+.18*s,y+.77*s),(x+1.18*s,y+1.02*s),(x+1.48*s,y+.74*s),(x+.94*s,y+.45*s),(x+.18*s,y+.34*s)],z,.17*s,1.07)
    else:
        profile(group,'goose',[(x-.17*s,y+.78*s),(x-.66*s,y+.62*s),(x-.43*s,y+.27*s),(x-.05*s,y+.34*s)],z,.14*s,.88)
        profile(group,'goose',[(x+.17*s,y+.78*s),(x+.66*s,y+.62*s),(x+.43*s,y+.27*s),(x+.05*s,y+.34*s)],z,.14*s,1.04)
    if crowned:
        lathe(group,'orange',x,y+1.53*s,z,[(0,.21*s),(.10*s,.16*s),(.42*s,.025*s)],9)
        lathe(group,'cream',x,y+1.61*s,z,[(0,.168*s),(.055*s,.145*s)],9)

goose_character('07 Goose safety committee',8.8,3.82,-13.8,1.02,True,True)
goose_character('07 Goose safety committee',5.85,.05,-10.25,.55,False,False,.9)
goose_character('07 Goose safety committee',11.9,.05,-11.35,.62,False,False,1.08)

# A binocular-wielding moose takes "lake rescue" far too seriously.
g='02 Moose lifeguard'; mx,my,mz=-11.45,.02,-10.15
ellipsoid(g,'moose',mx,my+.86,mz,.63,.85,.42,10,5)
profile(g,'red',[(mx-.57,my+.25),(mx+.57,my+.25),(mx+.49,my+1.34),(mx-.49,my+1.34)],mz+.39,.08)
box(g,'cream',mx,my+.8,mz+.455,.42,.11,.025)
box(g,'cream',mx,my+.8,mz+.457,.11,.43,.027)
ellipsoid(g,'moose',mx,my+1.72,mz+.02,.46,.58,.38,10,5,1.06)
ellipsoid(g,'endgrain',mx,my+1.55,mz+.37,.39,.25,.31,9,4)
for side in [-1,1]:
    profile(g,'moose',[(mx+side*.31,my+1.95),(mx+side*.72,my+2.18),(mx+side*.5,my+1.72)],mz,.18)
    ellipsoid(g,'cream',mx+side*.17,my+1.83,mz+.36,.07,.095,.04,6,3)
    ellipsoid(g,'charcoal',mx+side*.15,my+1.84,mz+.397,.026,.04,.018,5,3)
    beam(g,'endgrain',(mx+side*.23,my+2.12,mz),(mx+side*.46,my+2.62,mz),.035,6)
    beam(g,'endgrain',(mx+side*.46,my+2.58,mz),(mx+side*.78,my+2.78,mz),.035,6)
    beam(g,'endgrain',(mx+side*.43,my+2.48,mz),(mx+side*.69,my+2.38,mz),.03,6)
    beam(g,'moose',(mx+side*.48,my+1.16,mz),(mx+side*.82,my+1.58,mz+.18),.085,7)
# Comically serious field glasses project toward the action camera.
for side in [-1,1]:
    beam(g,'navy',(mx+side*.13,my+1.77,mz+.38),(mx+side*.13,my+1.77,mz+.69),.095,8)
    ring(g,'metal',mx+side*.13,my+1.77,mz+.7,.098,.015,12,5)
beam(g,'navy',(mx-.16,my+1.77,mz+.49),(mx+.16,my+1.77,mz+.49),.035,6)

# A toy maple Zamboni drifts across the back ice with a snowman at the wheel
# and an emergency reserve of glowing syrup.
g='10 Maple Zamboni parade'; zx,zy,zz=.65,.04,-13.55
box(g,'navy',zx,zy+.36,zz,3.15,.55,1.48)
box(g,'red',zx-.35,zy+.78,zz,2.35,.55,1.38)
box(g,'cream',zx-.35,zy+.83,zz+.72,2.18,.35,.035)
box(g,'glass',zx+.92,zy+1.25,zz+.05,.9,.95,1.18)
box(g,'navy',zx+.92,zy+1.76,zz+.05,1.02,.11,1.28)
profile(g,'cream',[(zx-.92,zy+.68),(zx-.36,zy+.68),(zx-.25,zy+1.05),(zx-.52,zy+1.27),(zx-.8,zy+1.03)],zz+.755,.025)
for wx2 in [zx-1.05,zx+.95]:
    points=[(wx2+math.cos(j*math.tau/12)*.33,zy+.29+math.sin(j*math.tau/12)*.33) for j in range(12)]
    profile(g,'charcoal',points,zz+.7,.24)
    points=[(wx2+math.cos(j*math.tau/10)*.14,zy+.29+math.sin(j*math.tau/10)*.14) for j in range(10)]
    profile(g,'metal',points,zz+.835,.04)
# Syrup tank, beacon and snowman driver.
lathe(g,'syrup',zx-1.03,zy+.87,zz,[(0,.38),(.68,.38),(.76,.31)],12)
lathe(g,'red',zx-1.03,zy+1.2,zz,[(0,.405),(.09,.405)],12)
ellipsoid(g,'snow',zx+.9,zy+1.51,zz+.22,.29,.33,.27,9,4)
ellipsoid(g,'snow',zx+.9,zy+2.0,zz+.22,.23,.24,.22,9,4)
lathe(g,'charcoal',zx+.9,zy+2.18,zz+.22,[(0,.27),(.13,.27),(.17,.18)],10)
beam(g,'orange',(zx+.9,zy+1.98,zz+.4),(zx+.9,zy+1.94,zz+.66),.055,6)
for side in [-1,1]:
    ellipsoid(g,'charcoal',zx+.9+side*.08,zy+2.04,zz+.425,.025,.033,.018,5,3)
lathe(g,'lamp',zx-.05,zy+1.88,zz,[(0,.11),(.22,.08)],8)
lathe(g,'metal',zx-.05,zy+1.86,zz,[(0,.14),(.035,.14)],8)
for i in range(5):
    ellipsoid(g,'snow',zx-1.85-i*.38,zy+.22+math.sin(i)*.08,zz+(.18 if i%2 else -.16),.34-i*.035,.2,.3,8,4,.9+i*.03)

# Curling's house has migrated behind the fighters; the last stone missed by a
# distance impressive enough to qualify as public art.
g='10 Curling catastrophe'; cx,cz=3.25,-8.75
for level,(mat,radius) in enumerate([('navy',1.32),('cream',.98),('red',.66),('cream',.27)]):
    lathe(g,mat,cx,.012+level*.012,cz,[(0,radius),(.018,radius)],24)
for i,(x,z,mat) in enumerate([(1.65,-8.1,'red'),(4.65,-8.0,'navy'),(2.25,-9.75,'red'),(5.25,-9.6,'navy')]):
    lathe(g,mat,x,.06,z,[(0,.28),(.08,.34),(.18,.28)],12)
    box(g,'cream',x,.27,z,.28,.09,.11)
beam(g,'cedar',(1.2,.07,-9.45),(2.15,.82,-9.48),.028,6)
profile(g,'cream',[(2.08,.75),(2.36,.81),(2.2,.98),(1.98,.9)],-9.48,.15)
beam(g,'cedar',(4.95,.07,-7.75),(4.25,.78,-7.72),.028,6)
profile(g,'red',[(4.14,.7),(4.4,.77),(4.28,.95),(4.04,.88)],-7.72,.15)

# Sagging lights and alternating pennants tie the sign and hut together as one
# deliberately overcommitted civic celebration.
g='10 Festival bunting'
festival=[(-6.5,3.35,-11.15),(-3.2,3.73,-10.45),(0,3.55,-10.15),(4.2,3.78,-10.85),(8.8,3.82,-12.9)]
for a,b in zip(festival,festival[1:]): beam(g,'rope',a,b,.014,6)
for i in range(15):
    t=(i+1)/16; segment=min(3,int(t*4)); local=t*4-segment
    a=Vector(festival[segment]); b=Vector(festival[segment+1]); p=a.lerp(b,local)
    beam(g,'metal',tuple(p),tuple(p+Vector((0,-.14,0))),.009,5)
    lathe(g,'lamp',p.x,p.y-.26,p.z,[(0,.07),(.13,.052)],7,.82+(.22 if i%3==0 else 0))
    mat='red' if i%2 else 'cream'
    profile(g,mat,[(p.x-.12,p.y-.08),(p.x+.12,p.y-.08),(p.x,p.y-.48)],p.z-.035,.025)

objects=[b.finish() for b in batches.values()]

def text_label(group,name,value,x,y,z,size,mat='cream'):
    data=bpy.data.curves.new(name,'FONT'); data.body=value; data.align_x='CENTER'; data.size=size
    data.extrude=.001; data.bevel_depth=0; data.resolution_u=8; data.space_character=1.08
    font=Path('C:/Windows/Fonts/georgiab.ttf' if value=='LAKE AMERICA' else 'C:/Windows/Fonts/segoeuib.ttf')
    if font.exists(): data.font=bpy.data.fonts.load(str(font), check_existing=True)
    obj=bpy.data.objects.new(name,data); collection(group).objects.link(obj)
    obj.location=coord((x,y,z)); obj.rotation_euler=(math.pi/2,0,0)
    # Keep labels editable in .blend, convert only the export copy later.
    plain=bpy.data.materials.new(f'Paint · {name}'); plain.diffuse_color=(*M[mat][1],1); plain.use_nodes=True
    p=plain.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*M[mat][1],1); p.inputs['Roughness'].default_value=.65
    data.materials.append(plain)
    return obj

labels=[
    text_label('08 Lake America trail sign','Sign · Lake America','LAKE AMERICA',wx,2.16,wz+.15,.38),
    text_label('08 Lake America trail sign','Sign · Lac America','FROZEN WATERFRONT',wx,1.83,wz+.15,.15),
    text_label('08 Lake America trail sign','Sign · Ice warning','CAUTION  /  THIN ICE',wx,1.37,wz+.184,.12),
    text_label('07 Cedar rescue station','Station · Rescue','LAKE RESCUE',sx,2.10,sz+1.395,.23),
]
# Compose the park sign on the rear-left shore; fighters retain the center of
# the frame. The original design dimensions stay easy to edit in this script.
sign_parent=bpy.data.objects.new('lake-america-trail-sign',None)
collection('08 Lake America trail sign').objects.link(sign_parent)
sign_parent.location=coord((-6.5,0,-11.2)); sign_parent.scale=(.72,.72,.72)
for obj in list(collection('08 Lake America trail sign').objects):
    if obj==sign_parent: continue
    if obj.type=='MESH':
        for vert in obj.data.vertices: vert.co-=Vector(coord((wx,0,wz)))
    else: obj.location-=Vector(coord((wx,0,wz)))
    obj.parent=sign_parent
objects.append(sign_parent)
# glTF keeps stable scene nodes with local children for movable scenery.
anchors={'lake-america-axe':AXE_POSITION, 'lake-america-rescue-ring':RING_POSITION, **FLOATING}
for group,position in anchors.items():
    anchor=bpy.data.objects.new(group,None); collection(group).objects.link(anchor); anchor.location=coord(position)
    anchor['role']='round-pickup' if group in ('lake-america-axe','lake-america-rescue-ring') else 'floating-scenery'
    anchor['game_position']=list(position)
    for obj in list(collection(group).objects):
        if obj!=anchor: obj.parent=anchor
    objects.append(anchor)
# Curated cameras remain in the editable master; GLB contains only scenery.
for name,pos,target in [
    ('CAM Combat',(0,2.6,11.8),(0,1.25,-2)),
    ('CAM Establishing',(19,13.5,27),(0,1,-9)),
    ('CAM Axe detail',(-3.25,1.65,2.6),(-5,.75,-.65)),
    ('CAM Waterfront',(-5.4,3.4,1.5),(-8.3,1.3,-7.5)),
    ('CAM Low strike',(2.5,.42,4.3),(.45,.48,0)),
    ('CAM Slapshot pursuit',(5,.64,3.68),(3.4,.25,.38)),
    ('CAM Reverse',(0,1.6,-6),(0,1.1,0)),
    ('CAM Aerial',(10,20,18),(0,0,0)),
    ('CAM Absurdity',(-2.8,4.2,7.4),(0,2.15,-10.8)),
]:
    data=bpy.data.cameras.new(name); data.type='PERSP'; data.lens=36 if name=='CAM Combat' else 44
    obj=bpy.data.objects.new(name,data); collection('90 Review cameras').objects.link(obj)
    obj.location=coord(pos); obj.rotation_euler=(Vector(coord(target))-obj.location).to_track_quat('-Z','Y').to_euler()
    if name=='CAM Combat': bpy.context.scene.camera=obj
sun_data=bpy.data.lights.new('Winter sun','SUN'); sun_data.energy=2.1; sun_data.angle=.08
sun=bpy.data.objects.new('Winter sun',sun_data); collection('91 Preview lighting').objects.link(sun)
sun.rotation_euler=(math.radians(27),math.radians(-24),math.radians(-35))
world=bpy.context.scene.world or bpy.data.worlds.new('Lake America winter sky')
bpy.context.scene.world=world; world.use_nodes=True
sky_node=world.node_tree.nodes.new('ShaderNodeTexSky')
sky_models=sky_node.bl_rna.properties['sky_type'].enum_items.keys()
sky_node.sky_type='MULTIPLE_SCATTERING' if 'MULTIPLE_SCATTERING' in sky_models else 'NISHITA'
sky_node.sun_elevation=math.radians(25); sky_node.sun_rotation=math.radians(135); sky_node.altitude=.2
world.node_tree.links.new(sky_node.outputs['Color'],world.node_tree.nodes['Background'].inputs[0])
world.node_tree.nodes['Background'].inputs[1].default_value=.035

# Review equivalents for the runtime's moving water and Canadian flag. These are
# intentionally separate from the exported scenery so there is one lake in game.
preview=collection('92 Preview water and flag · runtime equivalents')
water_mesh=bpy.data.meshes.new('Preview lake surface')
water_mesh.from_pydata([coord(p) for p in [(-480,-.65,-480),(480,-.65,-480),(480,-.65,480),(-480,-.65,480)]],[],[(3,2,1,0)])
lake=bpy.data.objects.new('PREVIEW · animated lake equivalent',water_mesh); preview.objects.link(lake)
water_mat=bpy.data.materials.new('PREVIEW · cold lake ripples'); water_mat.use_nodes=True
nodes=water_mat.node_tree.nodes; links=water_mat.node_tree.links; bsdf=nodes.get('Principled BSDF')
bsdf.inputs['Base Color'].default_value=(.014,.065,.115,1); bsdf.inputs['Roughness'].default_value=.2; bsdf.inputs['Metallic'].default_value=.38
tex=nodes.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value=3; tex.inputs['Detail'].default_value=2
coords=nodes.new('ShaderNodeTexCoord'); links.new(coords.outputs['Object'],tex.inputs['Vector'])
bump=nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value=.24; bump.inputs['Distance'].default_value=.06
links.new(tex.outputs['Fac'],bump.inputs['Height']); links.new(bump.outputs['Normal'],bsdf.inputs['Normal']); water_mesh.materials.append(water_mat)
preview_flag=[]
for mat in ['cream','red']:
    b=Batch('92 Preview water and flag · runtime equivalents',mat)
    for i in range(32):
        if (mat=='red') != (i<8 or i>=24): continue
        for j in range(12):
            verts=[]
            for u,v in [(i/32,j/12),((i+1)/32,j/12),((i+1)/32,(j+1)/12),(i/32,(j+1)/12)]:
                verts.append((8.8+u*2.6,6.6-v*1.3-u*.12,-5.9+math.sin(u*8+v*1.2)*.17*u))
            b.add(verts,[(3,2,1,0)])
    preview_flag.append(b.finish())
leaf=[(0,-95),(16,-58),(33,-68),(30,-24),(64,-44),(61,-16),(90,-22),(73,12),(83,26),(38,53),(41,70),(6,65),(6,99),(-6,99),(-6,65),(-41,70),(-38,53),(-83,26),(-73,12),(-90,-22),(-61,-16),(-64,-44),(-30,-24),(-33,-68),(-16,-58)]
b=Batch('92 Preview water and flag · runtime equivalents','red')
verts=[]
for lx,ly in leaf:
    u=.5+lx/512; v=.5+ly/256
    verts.append((8.8+u*2.6,6.6-v*1.3-u*.12,-5.895+math.sin(u*8+v*1.2)*.17*u))
b.add(verts,[tuple(reversed(range(len(verts))))]); preview_flag.append(b.finish())

# Correct face orientation for every closed component without flattening the
# authored snow/rock shading. Recalculate is deterministic in the saved master.
import bmesh
for obj in objects:
    if obj.type!='MESH': continue
    bm=bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(obj.data); bm.free()

scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.cycles.use_denoising=True
scene.render.resolution_x=1600; scene.render.resolution_y=900; scene.render.resolution_percentage=100
scene.view_settings.view_transform='AgX'
scene.view_settings.exposure=-.6
scene['runtime_notes']='Scenery GLB uses baked vertex color. Collection 92 previews runtime-only water/flag; physical world previews the runtime sky. Export excludes these and cameras/lights. X across stage, ground Y=0 in glTF. Axe/floe/buoy children are local to named pivots.'
scene['rebuild']='blender --background --python web/tools/build-lake-america.py'
scene['art_direction']='Lake America: amber winter sunset over blue glacial ice, now hosting a traffic-cone goose marshal, goose deputies, a binocular moose lifeguard, a snowman-driven maple Zamboni, curling chaos, festival bunting and a toque-wearing CN Tower. Runtime adds moving sky/water/flag, surface frost, planar ice reflections and spindrift.'
scene['playable_lane']='X [-8,8], Z approximately 0; axe at x=-5 and rescue ring at x=5, both z=-.65 and outside the combat corridor.'
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'lake-america.blend'))
# Runtime repaints these labels with crisp canvas plates and immediately hides
# the exported nodes. Keep the editable fonts in the master, but export only a
# two-triangle proxy for each label so invisible glyph tessellation does not
# consume nearly eighteen thousand scenery triangles.
export_labels=[]
for label in labels:
    bounds=[Vector(point) for point in label.bound_box]
    min_x=min(point.x for point in bounds); max_x=max(point.x for point in bounds)
    min_y=min(point.y for point in bounds); max_y=max(point.y for point in bounds)
    face_z=max(point.z for point in bounds)
    mesh=bpy.data.meshes.new(f'{label.name} · runtime proxy')
    mesh.from_pydata([(min_x,min_y,face_z),(max_x,min_y,face_z),(max_x,max_y,face_z),(min_x,max_y,face_z)],[],[(0,1,2,3)])
    if label.data.materials: mesh.materials.append(label.data.materials[0])
    copy=bpy.data.objects.new(label.name,mesh); collection('93 Temporary text export').objects.link(copy)
    world=label.matrix_world.copy(); copy.parent=label.parent; copy.matrix_world=world
    export_labels.append(copy)
bpy.ops.object.select_all(action='DESELECT')
for obj in objects+export_labels: obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'lake-america.glb'),export_format='GLB',use_selection=True,
    export_yup=True,export_animations=False,export_cameras=False,export_lights=False)
meshes=[o for o in objects+export_labels if o.type=='MESH']
stats={'objects':len(objects)+len(export_labels),'meshObjects':len(meshes),'vertices':sum(len(o.data.vertices) for o in meshes),
       'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in meshes),
       'source':'web/stages/lake_america/blender/lake-america.blend', 'seed':7319,
       'bounds':'Arena contact Y=0; layered skyline 178–220m away; 360 degree island coverage',
       'axe':{'node':'lake-america-axe','position':list(AXE_POSITION),'bladeCenterLocal':[.12,.36,0],'stumpCollection':'lake-america-axe-stump','childrenUseLocalCoordinates':True},
       'rescueRing':{'node':'lake-america-rescue-ring','position':list(RING_POSITION),'standCollection':'12 Rescue ring stand','childrenUseLocalCoordinates':True},
       'floatingNodes':list(FLOATING),
       'features':['Continuous reflective glacial fighting shelf','Framed park sign with mountain crest and editable English lettering','Illuminated cedar rescue hut and rope-lined dock','Independent rescue ring pickup and persistent stand','Canadian flag review equivalent','Layered Toronto skyline with a winter-toqued CN Tower','24 independent ice floes','Red navigation buoy and winter ferry','Snow-loaded individual pine boughs','Sculpted shoreline snowdrifts','Four waterfront lanterns','Separate axe and persistent stump','Waterfront benches, mooring bollards, pressure ice, chimney and stacked firewood','Traffic-cone-crowned goose marshal and two safety deputies','Binocular-wielding moose lifeguard','Snowman-driven maple-syrup Zamboni','Curling catastrophe and civic festival bunting'],
       'previews':['lake-america-combat.png','lake-america-establishing.png','lake-america-axe-detail.png','lake-america-waterfront.png','lake-america-absurdity.png']}
(OUT/'manifest.json').write_text(json.dumps(stats,indent=2))
print(json.dumps(stats))
for obj in export_labels: bpy.data.objects.remove(obj,do_unlink=True)
# Optional --no-render supports quick deterministic geometry-only iteration.
if '--no-render' not in sys.argv:
    for camera,filename in [('CAM Combat','lake-america-combat.png'),('CAM Establishing','lake-america-establishing.png'),('CAM Axe detail','lake-america-axe-detail.png'),('CAM Waterfront','lake-america-waterfront.png'),('CAM Absurdity','lake-america-absurdity.png')]:
        scene.camera=bpy.data.objects.get(camera); scene.render.filepath=str(SOURCE/filename)
        bpy.ops.render.render(write_still=True)
