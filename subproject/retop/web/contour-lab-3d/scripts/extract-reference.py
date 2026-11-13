"""Read-only static mesh extraction for the development FBX reference; stdlib only."""
from pathlib import Path
import struct,zlib,json,math,hashlib
root=Path(__file__).resolve().parents[3]
source=root/'srcmodel/Shoulder_Highpoly.fbx';raw=source.read_bytes()
version=struct.unpack_from('<I',raw,23)[0];wide=version>=7500;header=25 if wide else 13

def prop(o):
    t=chr(raw[o]);o+=1
    if t in 'YCILFD':
        fmt={'Y':'h','C':'?','I':'i','L':'q','F':'f','D':'d'}[t]
        return struct.unpack_from('<'+fmt,raw,o)[0],o+struct.calcsize(fmt)
    if t in 'SR':
        n=struct.unpack_from('<I',raw,o)[0];o+=4;v=raw[o:o+n]
        return (v.decode('utf8','replace') if t=='S' else None),o+n
    if t in 'fdilbc':
        n,enc,length=struct.unpack_from('<III',raw,o);o+=12;b=raw[o:o+length]
        if enc:b=zlib.decompress(b)
        fmt={'f':'f','d':'d','i':'i','l':'q','b':'b','c':'b'}[t]
        return list(struct.unpack('<'+str(n)+fmt,b)),o+length
    raise ValueError('Unsupported FBX property '+t)

def node(o):
    end,count,_=struct.unpack_from('<QQQ' if wide else '<III',raw,o)
    n=raw[o+header-1];name=raw[o+header:o+header+n].decode();o+=header+n;ps=[]
    for _ in range(count):v,o=prop(o);ps.append(v)
    children=[]
    while o+header<=end and any(raw[o:o+header]):c,o=node(o);children.append(c)
    return {'name':name,'p':ps,'children':children},end

def walk(ns):
    for n in ns:yield n;yield from walk(n['children'])

nodes=[];o=27
while o+header<len(raw) and any(raw[o:o+header]):n,o=node(o);nodes.append(n)
allnodes=list(walk(nodes));geometries=[n for n in allnodes if n['name']=='Geometry' and n['p'][-1]=='Mesh']
models=[n for n in allnodes if n['name']=='Model' and n['p'][-1]=='Mesh']
if len(geometries)!=1 or len(models)!=1:raise ValueError('Reference extraction requires one static mesh, not a general FBX scene importer')
g=geometries[0];verts=next(n['p'][0] for n in g['children'] if n['name']=='Vertices');indices=next(n['p'][0] for n in g['children'] if n['name']=='PolygonVertexIndex')
props={n['p'][0]:n['p'][-3:] for n in walk(models) if n['name']=='P'}
t=props.get('Lcl Translation',[0,0,0]);angles=props.get('Lcl Rotation',[0,0,0]);scale=props.get('Lcl Scaling',[1,1,1])
vertices=[]
for k in range(0,len(verts),3):
    p=[verts[k+i]*scale[i] for i in range(3)]
    for axis in range(3):
        a=math.radians(angles[axis]);c,s=math.cos(a),math.sin(a);i,j=(axis+1)%3,(axis+2)%3
        p[i],p[j]=c*p[i]-s*p[j],s*p[i]+c*p[j]
    vertices.append([round(p[i]+t[i],9) for i in range(3)])
faces=[];face=[]
for i in indices:
    face.append(i if i>=0 else -i-1)
    if i<0:faces.append(face);face=[]
if face:raise ValueError('Unterminated polygon')
result={'name':'原肩甲高模','vertices':vertices,'faces':faces,'provenance':{'file':str(source.relative_to(root)),'sha256':hashlib.sha256(raw).hexdigest(),'method':'Read-only FBX geometry and static XYZ model transform; no remesh or normalization','sourceVertices':len(vertices),'sourceFaces':len(faces)}}
output=Path(__file__).resolve().parents[1]/'reference/shoulder.json';output.write_text(json.dumps(result,ensure_ascii=False,separators=(',',':')))
print(len(vertices),'vertices;',len(faces),'source polygons;',sum(len(f)-2 for f in faces),'triangles')
