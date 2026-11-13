"""Generate reproducible supported examples in a separate Blender process."""
import json
import math
import pathlib
import sys
import bpy
import bmesh

sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[2]))
from SurfaceCageRebuild import analysis, reconstruct, validation

out=pathlib.Path(sys.argv[sys.argv.index('--')+1])
out.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)


def triangulated_high(mesh,levels):
    high=validation.subdivided_mesh(mesh,levels)
    bm=bmesh.new();bm.from_mesh(high);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(high);bm.free()
    return high


def object_for(name,mesh,location):
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj);obj.location=location
    obj.show_wire=True;obj.show_all_edges=True
    for p in mesh.polygons:p.use_smooth=True
    return obj


reports={}
# A bevel cage contains support loops; high mesh is then triangulated.
bm=bmesh.new();bmesh.ops.create_cube(bm,size=2)
bmesh.ops.bevel(bm,geom=list(bm.edges),offset=.12,segments=1,affect='EDGES')
cage=bpy.data.meshes.new('BevelCage');bm.to_mesh(cage);bm.free()
high=triangulated_high(cage,2)
object_for('BeveledBox_High',high,(-2,0,0))
try:
    result,report=reconstruct.rebuild(high,{'method':'INVERSE','reverse_steps':1,'subdivision':1,'fit_iterations':20,'tolerance':.01})
    object_for('BeveledBox_Candidate',result,(1,0,0));reports['beveled_box']=report
except ValueError as exc:reports['beveled_box']={'unsupported':str(exc)}

# Closed curved shell, with several close cross-section rings at transitions.
n=16
cross=[(.9,-.12),(.96,-.12),(1.,-.08),(1.,.08),(.96,.12),(.9,.12),(.86,.08),(.86,-.08)]
verts=[(r*math.cos(i*2*math.pi/n),r*math.sin(i*2*math.pi/n),z) for r,z in cross for i in range(n)]
faces=[(j*n+i,j*n+(i+1)%n,((j+1)%len(cross))*n+(i+1)%n,((j+1)%len(cross))*n+i) for j in range(len(cross)) for i in range(n)]
cage=bpy.data.meshes.new('CurvedShellCage');cage.from_pydata(verts,[],faces);cage.update()
high=triangulated_high(cage,1)
object_for('CurvedShell_High',high,(-2,3,0))
try:
    result,report=reconstruct.rebuild(high,{'method':'INVERSE','reverse_steps':1,'subdivision':1,'fit_iterations':20,'tolerance':.01})
    object_for('CurvedShell_Candidate',result,(1,3,0));reports['curved_shell']=report
except ValueError as exc:reports['curved_shell']={'unsupported':str(exc)}

with open(out/'examples-report.json','w',encoding='utf-8') as f:json.dump(reports,f,ensure_ascii=False,indent=2)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'surface-cage-examples.blend'))
print('EXAMPLES',json.dumps(reports,ensure_ascii=False))
