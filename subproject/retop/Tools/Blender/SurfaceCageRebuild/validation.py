"""Deterministic sampled, bidirectional checks. Not an exact Hausdorff bound."""
import math
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .analysis import analyze, size


def surface(mesh):
    mesh.calc_loop_triangles()
    vertices = [v.co.copy() for v in mesh.vertices]
    triangles = [tuple(t.vertices) for t in mesh.loop_triangles]
    return BVHTree.FromPolygons(vertices, triangles, all_triangles=True)


def subdivided_mesh(mesh, levels):
    if levels == 0:
        return mesh.copy()
    obj = bpy.data.objects.new('SCR_Temporary_Evaluation', mesh)
    bpy.context.scene.collection.objects.link(obj)
    try:
        modifier = obj.modifiers.new('SCR_Evaluation', 'SUBSURF')
        modifier.subdivision_type = 'CATMULL_CLARK'
        modifier.levels = levels
        modifier.render_levels = levels
        modifier.use_limit_surface = False
        modifier.boundary_smooth = 'ALL'
        depsgraph = bpy.context.evaluated_depsgraph_get()
        depsgraph.update()
        return bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph), depsgraph=depsgraph)
    finally:
        bpy.data.objects.remove(obj, do_unlink=True)


def _samples(mesh, budget):
    mesh.calc_loop_triangles()
    triangles = mesh.loop_triangles
    stride = max(1, math.ceil(len(triangles) / max(budget // 4, 1)))
    points = []
    for index in range(0,len(triangles),stride):
        triangle=triangles[index]
        a, b, c = [mesh.vertices[i].co for i in triangle.vertices]
        points.extend(((a+b+c)/3, .6*a+.2*b+.2*c, .2*a+.6*b+.2*c, .2*a+.2*b+.6*c))
    vstride = max(1, math.ceil(len(mesh.vertices) / max(budget // 2, 1)))
    points.extend(mesh.vertices[i].co.copy() for i in range(0,len(mesh.vertices),vstride))
    return points


def _distance(a, b, scale, budget):
    av, bv = surface(a), surface(b)
    distances = []
    for mesh, target in ((a,bv),(b,av)):
        for point in _samples(mesh, budget):
            hit = target.find_nearest(point)
            if hit[0] is None:
                raise ValueError('表面距离检查没有命中有效三角形')
            distances.append(hit[3])
    distances.sort()
    if not distances:
        raise ValueError('没有可验证的表面样本')
    return {'max_relative': distances[-1]/scale,
            'p95_relative': distances[min(len(distances)-1,int(len(distances)*.95))]/scale,
            'mean_relative':sum(distances)/len(distances)/scale,
            'samples':len(distances)}


def compare_meshes(source, candidate, settings):
    scale = max(size(source), 1e-12)
    levels = int(settings.get('subdivision', 2))
    budget = int(settings.get('sample_budget', 12000))
    tolerance = settings.get('tolerance', .01)
    evaluated = subdivided_mesh(candidate, levels)
    try:
        base = _distance(source,candidate,scale,budget)
        smooth = _distance(source,evaluated,scale,budget)
        before = analyze(source,settings)['health']
        after = analyze(candidate,settings)['health']
        topology_ok = (not after['degenerate_faces'] and not after['nonmanifold_edges'] and
                       not after['nonmanifold_vertices'] and after['shells']==before['shells'] and
                       after['shell_topology']==before['shell_topology'])
        return {'base':base,'subdivided':smooth,'subdivision':levels,'tolerance':tolerance,
                'before':before,'after':after,'evaluated_triangles':sum(len(p.vertices)-2 for p in evaluated.polygons),
                'within_surface_tolerance':smooth['max_relative']<=tolerance,
                'topology_basic_check':topology_ok,
                'subdivision_rule':{'type':'CATMULL_CLARK','use_limit_surface':False,'boundary_smooth':'ALL'},
                'status':'采样检查；仍需轮廓和截面验收',
                'self_intersections':'未作全面自交证明','uv_weights':'重建结果尚未迁移 UV / 蒙皮'}
    finally:
        bpy.data.meshes.remove(evaluated)
