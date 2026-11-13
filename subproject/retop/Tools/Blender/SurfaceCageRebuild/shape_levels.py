"""Camera-independent five-scale shape study; only source geometry is input.

    Four independent editable meshes are returned. The fifth level IS the caller's
original, never a resampled substitute. These are shape candidates, not a claim
of recovered bevel/support topology. All temporary geometry is owned here.
"""
import heapq
import math

import bpy
import bmesh
from mathutils import Matrix, Vector

from . import analysis, validation
from .voxel_curvature import fitted_box


LEVELS = ('FAR', 'FAR_MID', 'MIDDLE', 'NEAR')
LABELS = {'FAR': '远 · 整体长方体', 'FAR_MID': '远中 · 连续四边面大形',
          'MIDDLE': '中 · 大块曲面', 'NEAR': '近 · 结构形体', 'SOURCE': '超近 · 原高模'}
BOX_FACES = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4),
             (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]


class _Meshes:
    def __init__(self):
        self.items = []

    def add(self, mesh):
        self.items.append(mesh)
        return mesh

    def make(self, name, points, faces):
        mesh = self.add(bpy.data.meshes.new(name))
        mesh.from_pydata(points, [], faces)
        mesh.update()
        return mesh

    def close(self, keep=()):
        for mesh in reversed(self.items):
            if mesh not in keep and mesh.users == 0:
                bpy.data.meshes.remove(mesh)


def _evaluate(mesh, stages, owned):
    obj = bpy.data.objects.new('SCR_ShapeTemporary', mesh)
    bpy.context.scene.collection.objects.link(obj)
    try:
        for kind, properties in stages:
            modifier = obj.modifiers.new('SCR_ShapeStage', kind)
            for key, value in properties.items():
                setattr(modifier, key, value)
        graph = bpy.context.evaluated_depsgraph_get()
        graph.update()
        return owned.add(bpy.data.meshes.new_from_object(obj.evaluated_get(graph), depsgraph=graph))
    finally:
        bpy.data.objects.remove(obj, do_unlink=True)


def health(mesh):
    """Cheap topology checks on normalized geometry, separate from recognition."""
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        faces = set(bm.faces)
        topology = []
        while faces:
            first = faces.pop()
            shell = {first}
            stack = [first]
            while stack:
                for edge in stack.pop().edges:
                    for face in edge.link_faces:
                        if face in faces:
                            faces.remove(face)
                            shell.add(face)
                            stack.append(face)
            edges = {e for f in shell for e in f.edges}
            vertices = {v for f in shell for v in f.verts}
            topology.append(len(vertices) - len(edges) + len(shell))
        volume = bm.calc_volume(signed=True)
        return {'vertices': len(bm.verts), 'faces': len(bm.faces),
                'triangles': sum(len(f.verts) - 2 for f in bm.faces),
                'shells': len(topology), 'euler': sorted(topology),
                'boundary_edges': sum(e.is_boundary for e in bm.edges),
                'bad_edges': sum(not e.is_manifold for e in bm.edges),
                'bad_vertices': sum(not v.is_manifold for v in bm.verts),
                'degenerate_faces': sum(f.calc_area() <= 1e-12 for f in bm.faces),
                'finite': all(math.isfinite(c) for v in bm.verts for c in v.co),
                'volume': volume}
    finally:
        bm.free()


def _require_volume(mesh, expected=None):
    info = health(mesh)
    if not info['finite'] or not info['faces'] or info['degenerate_faces']:
        raise ValueError('形体重建存在无效坐标或退化面')
    if info['bad_edges'] or info['bad_vertices'] or info['boundary_edges']:
        raise ValueError('五档体积路径只支持闭合流形；不会自动补孔或跨层焊接')
    if abs(info['volume']) < 1e-10:
        raise ValueError('闭合形体体积不足，不能建立体块')
    if expected and (info['shells'], info['euler']) != (expected['shells'], expected['euler']):
        raise ValueError('此档改变了壳体或孔洞拓扑，已拒绝输出')
    return info


def _frame(mesh, owned):
    """Center first, normalize before eigensolving, then align to source area."""
    mesh.update()
    total = sum(f.area for f in mesh.polygons)
    if total <= 0:
        raise ValueError('源表面面积为零')
    center = sum((f.center * f.area for f in mesh.polygons), Vector()) / total
    radius = max((v.co - center).length for v in mesh.vertices)
    if not math.isfinite(radius) or radius < 1e-12:
        raise ValueError('源物体尺度不足')
    local = owned.add(mesh.copy())
    first = Matrix.Scale(1 / radius, 4) @ Matrix.Translation(-center)
    local.transform(first)
    local.update()
    box = fitted_box([f.center for f in local.polygons], [f.area for f in local.polygons],
                     [v.co for v in local.vertices])
    axes = [Vector(v) for v in box['axes']]
    # Eigenvectors have an arbitrary sign. Resolve it from source vertex order
    # (only as a symmetry tie-break), so rotating an object cannot mirror the
    # sampling frame and make a symmetric QEM choose the opposite diagonal.
    mean = Vector(box['center'])
    for k in (0, 1):
        projections = [(v.co - mean).dot(axes[k]) for v in local.vertices]
        extent = max(abs(p) for p in projections)
        anchor = next((p for p in projections if abs(p) > extent * .1), 1.)
        if anchor < 0:
            axes[k].negate()
    axes[2] = axes[0].cross(axes[1]).normalized()
    length = max(box['dimensions'])
    matrix = Matrix([(*axis / length, 0.) for axis in axes] + [(0., 0., 0., 1.)])
    local.transform(matrix)
    # Float mesh coordinates otherwise perturb native collapse ties after a
    # world transform. This is < 0.0001% of the object's longest dimension.
    for vertex in local.vertices:
        vertex.co = tuple(round(c, 6) for c in vertex.co)
    local.update()
    return local, (matrix @ first).inverted()


def _split(mesh, owned):
    neighbors = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        neighbors[a].add(b)
        neighbors[b].add(a)
    labels = [-1] * len(neighbors)
    count = 0
    for start in range(len(labels)):
        if labels[start] >= 0:
            continue
        labels[start] = count
        queue = [start]
        while queue:
            for other in neighbors[queue.pop()]:
                if labels[other] < 0:
                    labels[other] = count
                    queue.append(other)
        count += 1
    shells = []
    for index in range(count):
        ids = [i for i, label in enumerate(labels) if label == index]
        mapping = {old: new for new, old in enumerate(ids)}
        shells.append(owned.make('SCR_ShapeShell', [mesh.vertices[i].co for i in ids],
                      [tuple(mapping[i] for i in f.vertices) for f in mesh.polygons
                       if labels[f.vertices[0]] == index]))
    return shells


def _normals_filter(mesh, radius, allowance, owned):
    """Area-weighted bilateral normals, connected neighborhoods, bounded solve."""
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.faces.ensure_lookup_table()
        bm.faces.index_update()
        bm.normal_update()
        centers = [f.calc_center_median() for f in bm.faces]
        areas = [f.calc_area() for f in bm.faces]
        normals = [f.normal.copy() for f in bm.faces]
        adjacency = [{g.index for e in f.edges for g in e.link_faces if g != f} for f in bm.faces]
        kernels = []
        pairs = 0
        for i in range(len(centers)):
            distances = {i: 0.}
            queue = [(0., i)]
            kernel = []
            while queue:
                cost, j = heapq.heappop(queue)
                if cost != distances[j]:
                    continue
                kernel.append((j, areas[j] * math.exp(-.5 * (cost / (radius * .6)) ** 2)))
                for k in adjacency[j]:
                    distance = cost + (centers[k] - centers[j]).length
                    if (distance <= radius and distance < distances.get(k, math.inf)
                            and normals[i].dot(normals[k]) > 0.):
                        distances[k] = distance
                        heapq.heappush(queue, (distance, k))
            kernels.append(kernel)
            pairs += len(kernel)
            if pairs > 2500000:
                raise ValueError('近档法线邻域预算超限，请减小近档结构窗口')
        for _ in range(3):
            normals = [sum((normals[j] * (w * math.exp(-(1 - min(1., normals[i].dot(normals[j]))) / .14 ** 2))
                            for j, w in kernel), Vector()).normalized() for i, kernel in enumerate(kernels)]
        original = [v.co.copy() for v in bm.verts]
        for _ in range(12):
            centers = [f.calc_center_median() for f in bm.faces]
            updated = []
            for i, vertex in enumerate(bm.verts):
                delta = sum((normals[f.index] * normals[f.index].dot(centers[f.index] - vertex.co)
                             for f in vertex.link_faces), Vector()) / len(vertex.link_faces)
                point = vertex.co + .8 * delta + .02 * (original[i] - vertex.co)
                offset = point - original[i]
                if offset.length > allowance:
                    point = original[i] + offset.normalized() * allowance
                updated.append(point)
            for vertex, point in zip(bm.verts, updated):
                vertex.co = point
        bm.normal_update()
        result = owned.add(bpy.data.meshes.new('SCR_NearFiltered'))
        bm.to_mesh(result)
        return result, {'kernel_pairs': pairs, 'maximum_move_relative':
                        max((v.co - p).length for v, p in zip(bm.verts, original))}
    finally:
        bm.free()


def _contour_cage(source, guide, divisions, owned):
    from .contour_cage import build_cage
    return build_cage(source, guide, divisions, owned)


def _simplify(mesh, ratio, angle, owned, smooth):
    result = _evaluate(mesh, [('DECIMATE', {'ratio': ratio, 'use_collapse_triangulate': False})], owned)
    bm = bmesh.new()
    try:
        bm.from_mesh(result)
        bm.normal_update()
        cosine=math.cos(math.radians(angle))
        # Angle-only dissolve accumulates small bends into a large warped ngon
        # and can remove its supporting interior vertices. Check the ENTIRE
        # proposed patch against BOTH planes before each individual merge.
        for edge in list(bm.edges):
            if not edge.is_valid or len(edge.link_faces)!=2:continue
            a,b=edge.link_faces
            if a==b or a.normal.dot(b.normal)<cosine:continue
            if len(set(a.edges).intersection(b.edges))!=1:continue
            ca,cb=a.calc_center_median(),b.calc_center_median()
            if max(abs(a.normal.dot(v.co-ca)) for v in b.verts)>1e-5:continue
            if max(abs(b.normal.dot(v.co-cb)) for v in a.verts)>1e-5:continue
            changed=bmesh.ops.dissolve_edges(bm,edges=[edge],use_verts=False,use_face_split=False)
            for face in changed.get('region',[]):
                if face.is_valid:face.normal_update()
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        # A warped ngon can be re-tessellated along a different diagonal after
        # minute float changes, moving its actual surface far more than its
        # vertices. Retain polygons only when they really are planar.
        warped = [f for f in bm.faces if len(f.verts) > 3 and
                  max(abs(f.normal.dot(v.co - f.calc_center_median())) for v in f.verts) > 1e-5]
        if warped:
            bmesh.ops.triangulate(bm, faces=warped, quad_method='FIXED', ngon_method='EAR_CLIP')
        bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
        bm.to_mesh(result)
    finally:
        bm.free()
    result.update()
    for face in result.polygons:
        face.use_smooth = smooth
    return result


def _combine(meshes, owned, name):
    vertices, faces = [], []
    for mesh in meshes:
        offset = len(vertices)
        vertices.extend(tuple(v.co) for v in mesh.vertices)
        faces.extend(tuple(i + offset for i in f.vertices) for f in mesh.polygons)
    return owned.make(name, vertices, faces)


def build_levels(source, settings=None, levels=None):
    """Return ({FAR, FAR_MID, MIDDLE, NEAR: Mesh}, JSON-serializable report).

    levels can restrict regeneration to a subset; other stages are not built.
    Caller owns returned meshes. No selection, mode, original or scene output
    is changed; only temporary scene objects are used for native modifiers.
    """
    options = settings or {}
    requested=tuple(levels) if levels is not None else LEVELS
    if not requested or len(set(requested))!=len(requested) or any(key not in LEVELS for key in requested):
        raise ValueError('请求的形体档位无效')
    resolution = int(options.get('shape_middle_resolution', 40))
    rounds = int(options.get('shape_middle_smoothing', 40))
    divs = (int(options.get('shape_block_columns', 4)), int(options.get('shape_block_rows', 6)))
    near_ratio = float(options.get('shape_near_ratio', .35))
    near_radius = float(options.get('shape_near_radius', .035))
    if (not 24 <= resolution <= 80 or not 8 <= rounds <= 100 or not all(2 <= d <= 8 for d in divs)
            or not math.isfinite(near_ratio) or not .1 <= near_ratio <= 1
            or not math.isfinite(near_radius) or not .005 <= near_radius <= .08):
        raise ValueError('多尺度形体参数无效')
    if not 4 <= len(source.polygons) <= 30000 or len(source.vertices) > 30000:
        raise ValueError('五档形体预算为每部件最多30000顶点/面，请分部件处理')
    if not all(math.isfinite(c) for v in source.vertices for c in v.co):
        raise ValueError('源网格含无效坐标')
    signature = analysis.mesh_signature(source)
    owned = _Meshes()
    outputs = {}
    try:
        normalized, restore = _frame(source, owned)
        before = _require_volume(normalized)
        shells = _split(normalized, owned)
        if len(shells) > 16:
            raise ValueError('独立壳体超过16个，请分部件处理')
        box = fitted_box([f.center for f in normalized.polygons], [f.area for f in normalized.polygons],
                         [v.co for v in normalized.vertices])
        if 'FAR' in requested:outputs['FAR'] = owned.make('SCR_Far', box['corners'], BOX_FACES)
        parts = {key: [] for key in requested if key!='FAR'}
        shell_reports = []
        for shell in shells:
            local, inverse = _frame(shell, owned)
            expected = _require_volume(local)
            # Correct winding on this owned copy only, including reflected input.
            if expected['volume'] < 0:
                bm = bmesh.new()
                try:
                    bm.from_mesh(local)
                    bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
                    bm.to_mesh(local)
                finally:
                    bm.free()
            data={};details={}
            if 'FAR_MID' in requested or 'MIDDLE' in requested:
                mid_dense = _evaluate(local, [('REMESH', {'mode': 'VOXEL', 'voxel_size': 1 / resolution}),
                                             ('SMOOTH', {'factor': .5, 'iterations': rounds})], owned)
                _require_volume(mid_dense, expected)
                if 'MIDDLE' in requested:
                    data['MIDDLE']=_simplify(mid_dense,min(1.,1000/max(1,health(mid_dense)['triangles'])),2.,owned,True)
                if 'FAR_MID' in requested:
                    if expected['euler']!=[2]:raise ValueError('连续四边面大形暂不支持有孔洞的壳体，请先拆分结构')
                    data['FAR_MID'],details['contour_cage']=_contour_cage(local,mid_dense,divs,owned)
            if 'NEAR' in requested:
                filtered,details['near_filter']=_normals_filter(local,near_radius,.008,owned)
                data['NEAR']=_simplify(filtered,near_ratio,4.,owned,True)
            shell_reports.append(details)
            for key, mesh in data.items():
                try:
                    _require_volume(mesh, expected)
                except ValueError as exc:
                    raise ValueError(LABELS[key]+'：'+str(exc)) from exc
                mesh.transform(inverse)
                mesh.update()
                parts[key].append(mesh)
        for key, meshes in parts.items():
            outputs[key] = _combine(meshes, owned, 'SCR_' + key)
        stages = {}
        for key, mesh in outputs.items():
            info = _require_volume(mesh, None if key == 'FAR' else before)
            stages[key] = {'label': LABELS[key], 'health': info,
                           'surface_samples': validation._distance(normalized, mesh, max(analysis.size(normalized), 1e-12), 1500),
                           'volume_ratio': abs(info['volume'] / before['volume'])}
            mesh.transform(restore)
            mesh.update()
            for face in mesh.polygons:
                face.use_smooth = key in {'MIDDLE', 'NEAR'}
        if analysis.mesh_signature(source) != signature:
            raise AssertionError('源几何被意外修改')
        report = {'method': 'GEOMETRIC_FIVE_LEVELS',
                  'status':'远中连续四边面大形候选；形状厚度仍需检查' if requested==('FAR_MID',) else '四档形体候选；近档未完成卡线拓扑验收',
                  'requested_levels':list(requested),
                  'source_signature': signature, 'source': before, 'levels': stages,
                  'shells': shell_reports, 'settings': {'middle_resolution': resolution, 'middle_smoothing': rounds,
                  'cage_divisions': list(divs), 'near_ratio': near_ratio, 'near_radius': near_radius},
                  'fifth_level': 'original source object, no reconstruction',
                  'reference_images_used': False, 'camera_used': False,
                  'near_method': 'topological area/normal filter, bounded plane constraints, geometric decimation and planar dissolution',
                  'support_topology_restored': False, 'self_intersections': 'not comprehensively proven',
                  'uv_weights': 'not transferred'}
        owned.close(outputs.values())
        return outputs, report
    except Exception:
        owned.close()
        raise
