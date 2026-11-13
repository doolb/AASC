"""Run only with Blender --background --factory-startup; never opens a scene."""
import json
from pathlib import Path
import bpy
from mathutils import Vector, kdtree

root = Path(__file__).resolve().parents[3] / 'artifacts/contour-lab-3d'
fixtures = json.loads((root / 'subdivision-native-input.json').read_text())
results = []
for fixture in fixtures:
    data = bpy.data.meshes.new('comparison-control')
    data.from_pydata(fixture['mesh']['vertices'], [], fixture['mesh']['faces'])
    data.update()
    obj = bpy.data.objects.new('comparison-control', data)
    bpy.context.collection.objects.link(obj)
    modifier = obj.modifiers.new('native-reference', 'SUBSURF')
    modifier.subdivision_type = 'CATMULL_CLARK'
    modifier.quality = 10
    for level in [1, 2]:
        for limit in [False, True]:
            for boundary in ['ALL', 'PRESERVE_CORNERS']:
                modifier.levels = modifier.render_levels = level
                modifier.use_limit_surface = limit
                modifier.boundary_smooth = boundary
                bpy.context.view_layer.update()
                evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
                mesh = evaluated.to_mesh()
                vertices = [list(v.co) for v in mesh.vertices]
                candidate = fixture.get('expected', fixture['finite'])[level - 1]
                tree = kdtree.KDTree(len(vertices))
                for i, p in enumerate(vertices):
                    tree.insert(Vector(p), i)
                tree.balance()
                forward = max(tree.find(Vector(p))[2] for p in candidate['vertices'])
                reverse_tree = kdtree.KDTree(len(candidate['vertices']))
                for i, p in enumerate(candidate['vertices']):
                    reverse_tree.insert(Vector(p), i)
                reverse_tree.balance()
                reverse = max(reverse_tree.find(Vector(p))[2] for p in vertices)
                results.append(dict(id=fixture['id'], level=level, limit=limit,
                                    boundary=boundary, maxVertexDistance=max(forward, reverse),
                                    vertices=len(vertices), faces=len(mesh.polygons),
                                    positions=vertices,
                                    polygons=[list(p.vertices) for p in mesh.polygons]))
                evaluated.to_mesh_clear()
    bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.meshes.remove(data)
(root / 'subdivision-native-results.json').write_text(json.dumps(dict(
    blender=bpy.app.version_string, results=results)))
print('NATIVE_REFERENCE_COMPLETE', len(results))
