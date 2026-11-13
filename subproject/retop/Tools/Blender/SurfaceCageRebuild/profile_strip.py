"""Bounded annular reconstruction along source-triangle cross profiles.

This produces an independently validated candidate, not a global inverse
subdivision or a self-intersection certificate. No source geometry is modified.
"""
import bisect
import heapq
import math
import statistics

import bpy
import bmesh

from .analysis import size
from .reconstruct import (_boundary_samples, _check_strip_faces, _ensure_safe,
                          _ordered_loops, selected_mesh)
from .validation import compare_meshes


def _face_graph(bm, selected):
    centers = {i:bm.faces[i].calc_center_median() for i in selected}
    adjacency = {i:{} for i in selected}
    boundary_faces = {}
    for edge in bm.edges:
        faces = [face.index for face in edge.link_faces if face.index in selected]
        boundary_faces[tuple(sorted(v.index for v in edge.verts))] = faces
        if len(faces) == 2:
            a,b = faces
            adjacency[a][b] = edge
            adjacency[b][a] = edge
    seen = {next(iter(selected))}; todo = list(seen)
    while todo:
        for other in adjacency[todo.pop()]:
            if other not in seen:
                seen.add(other); todo.append(other)
    if seen != selected:
        raise ValueError('请选择同一个连通的曲面包边区域')
    return centers,adjacency,boundary_faces


def _profile(bm, start, end, start_faces, end_faces, graph, settings, scale):
    centers,adjacency = graph
    distance = {i:(centers[i]-start).length for i in start_faces}
    heap = [(cost,i) for i,cost in distance.items()]; heapq.heapify(heap)
    previous = {}; reached = None; visited = 0
    while heap:
        cost,face = heapq.heappop(heap)
        if cost > distance[face]:
            continue
        visited += 1
        if visited > settings.get('profile_search_budget',30000):
            raise ValueError('曲面路径搜索超出预算，请缩小选区')
        if face in end_faces:
            reached = face; break
        for other in adjacency[face]:
            new = cost+(centers[face]-centers[other]).length
            if new < distance.get(other,float('inf')):
                distance[other] = new; previous[other] = face
                heapq.heappush(heap,(new,other))
    if reached is None:
        raise ValueError('两条边界之间没有连通的源曲面路径')
    faces = [reached]
    while reached in previous:
        reached = previous[reached]; faces.append(reached)
    faces.reverse()
    portals = [adjacency[a][b] for a,b in zip(faces,faces[1:])]
    points = [start.copy()]+[(e.verts[0].co+e.verts[1].co)*.5 for e in portals]+[end.copy()]
    # Each crossing can move only along its shared source edge. Therefore the
    # adjacent segments stay inside their original triangles, including turns.
    # Optimize within the chosen corridor; do not claim a global geodesic.
    for iteration in range(16):
        order = range(len(portals)) if iteration%2 == 0 else reversed(range(len(portals)))
        for index in order:
            edge = portals[index]; a,b = (v.co for v in edge.verts)
            before,after = points[index],points[index+2]
            low,high = 0.,1.
            for _ in range(14):
                u = low+(high-low)/3; v = high-(high-low)/3
                pu,pv = a.lerp(b,u),a.lerp(b,v)
                if (before-pu).length+(pu-after).length <= (before-pv).length+(pv-after).length:
                    high = v
                else:
                    low = u
            choices = (a,b,a.lerp(b,(low+high)*.5),points[index+1])
            points[index+1] = min(choices,key=lambda p:(before-p).length+(p-after).length).copy()
    distances = [0.]
    for a,b in zip(points,points[1:]):
        distances.append(distances[-1]+(b-a).length)
    total = distances[-1]
    if total <= scale*1e-7 or total > scale*settings.get('profile_length_limit',3.):
        raise ValueError('曲面路径退化或过长，请修正边界对应')
    turns = []
    threshold = math.radians(settings.get('profile_turn_angle',30.))
    for index,(a,b) in enumerate(zip(faces,faces[1:])):
        if bm.faces[a].normal.angle(bm.faces[b].normal) >= threshold:
            parameter = distances[index+1]/total
            if .01 < parameter < .99:
                turns.append(parameter)
    return {'points':points,'distances':distances,'length':total,'faces':faces,'turns':turns}


def _parameters(profiles, rows, settings):
    # Cluster repeated observations of one continuous structural turn. Each
    # column must observe the turn: a lone internal feature is not a full ring.
    observations = sorted((t,column) for column,p in enumerate(profiles) for t in p['turns'])
    clusters = []
    for t,column in observations:
        if not clusters or t-clusters[-1][0][0] > .06:
            clusters.append([])
        clusters[-1].append((t,column))
    turns = []
    for cluster in clusters:
        if len({column for _,column in cluster}) < len(profiles)*.75:
            raise ValueError('转折线在周向不连续，请拆分面带或修正结构边界')
        turns.append(statistics.median(t for t,_ in cluster))
    support = min(max(settings.get('support_spacing',.08),.01),.2)
    required = [0.,support,1.-support,1.]
    for t in turns:
        gap = min(support,t/3,(1-t)/3)
        required.extend((t-gap,t,t+gap))
    required = sorted(set(required))
    # Merge only almost identical fractions, preserving the structural rows.
    ts = []
    for t in required:
        if not ts or t-ts[-1] > 1e-5:
            ts.append(t)
    while len(ts) < rows+1:
        index = max(range(len(ts)-1),key=lambda i:ts[i+1]-ts[i])
        ts.insert(index+1,(ts[index]+ts[index+1])*.5)
    if len(ts) > settings.get('profile_max_rows',32)+1:
        raise ValueError('连续转折需要过多支撑行，请拆分包边')
    return ts,turns


def _sample(profile, t, bm):
    distance = t*profile['length']
    index = min(len(profile['faces'])-1,max(0,bisect.bisect_right(profile['distances'],distance)-1))
    a,b = profile['points'][index:index+2]
    length = profile['distances'][index+1]-profile['distances'][index]
    factor = min(1.,max(0.,(distance-profile['distances'][index])/max(length,1e-30)))
    return a.lerp(b,factor),bm.faces[profile['faces'][index]].normal.copy(),profile['faces'][index]


def build_profile_strip(mesh, selected_faces, settings):
    """Reconstruct a connected annulus, following its cross fold.

    Uses strip_segments, strip_rows and strip_anchor_pairs like build_strip.
    Additional profile settings bound search, turn angle and row budget. Both
    base and finite-subdivision sampled errors must meet their own budgets.
    Non-triangular source faces are triangulated only in the temporary BMesh.
    """
    tolerance=settings.get('tolerance',.01)
    base_tolerance=settings.get('base_tolerance',tolerance)
    if any(not isinstance(value,(int,float)) or not math.isfinite(value) or value<=0
           for value in (tolerance,base_tolerance)):
        raise ValueError('基础和细分表面容差必须是有限正数')
    _ensure_safe(mesh,settings)
    selected = set(selected_faces)
    if not selected or any(type(i) is not int or i<0 or i>=len(mesh.polygons) for i in selected):
        raise ValueError('请选择有效的三角化包边面带')
    n=int(settings.get('strip_segments',32)); rows=int(settings.get('strip_rows',8))
    levels=int(settings.get('subdivision',2))
    if levels<0 or levels>3:
        raise ValueError('曲面面带回验细分级别必须在 0–3 之间')
    if n<4 or rows<3 or n>512 or rows>32:
        raise ValueError('曲面面带要求 4–512 个周向分段、3–32 个横向分段')
    if len(selected)>30000 or len(selected)*n>4000000:
        raise ValueError('曲面路径规模超出交互预算，请分部件处理')
    bm=bmesh.new();result=None;reference=None
    try:
        bm.from_mesh(mesh);bm.faces.ensure_lookup_table();bm.verts.ensure_lookup_table()
        original_selected=selected.copy()
        original_face=bm.faces.layers.int.new('SCR_ProfileOriginalFace')
        for face in bm.faces:
            face[original_face]=face.index
        bmesh.ops.triangulate(bm,faces=[bm.faces[i] for i in selected if len(bm.faces[i].verts)>3])
        bm.faces.ensure_lookup_table();bm.faces.index_update()
        selected={face.index for face in bm.faces if face[original_face] in original_selected}
        if len(selected)>30000 or len(selected)*n>4000000:
            raise ValueError('三角化后曲面路径规模超出交互预算，请分部件处理')
        centers,adjacency,edge_faces = _face_graph(bm,selected)
        loops = _ordered_loops(bm,selected)
        a,b,ea,eb,anchors = _boundary_samples(bm,loops,n,settings)
        scale=max(size(mesh),1e-12)
        profiles = [_profile(bm,x,y,edge_faces[sa],edge_faces[sb],(centers,adjacency),settings,scale)
                    for x,y,sa,sb in zip(a,b,ea,eb)]
        lengths = [p['length'] for p in profiles]
        if max(lengths)>min(lengths)*settings.get('width_ratio_limit',12.):
            raise ValueError('曲面包边宽度变化异常，请修正对应')
        ts,turns = _parameters(profiles,rows,settings)
        if n*(len(ts)-1)*4**levels>500000:
            raise ValueError('曲面面带细分回验超出面数预算，请减少分段或细分级别')
        vertices=[];normals=[];source_faces=[]
        for t in ts:
            for profile in profiles:
                point,normal,face = _sample(profile,t,bm)
                vertices.append(point); normals.append(normal); source_faces.append(bm.faces[face][original_face])
        faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
               for j in range(len(ts)-1) for i in range(n)]
        direction,normal_min=_check_strip_faces(vertices,faces,normals,settings)
        if direction<0:
            faces=[tuple(reversed(face)) for face in faces]
        result=bpy.data.meshes.new('SCR_ProfileStrip');result.from_pydata(vertices,[],faces);result.update()
        reference=selected_mesh(mesh,sorted(original_selected))
        comparison=compare_meshes(reference,result,settings)
        if not comparison['topology_basic_check']:
            raise ValueError('曲面包边候选未通过基础拓扑检查')
        if comparison['base']['max_relative']>base_tolerance or not comparison['within_surface_tolerance']:
            raise ValueError('曲面包边候选超出双向表面采样容差：基础 %.6f / %.6f，细分 %.6f / %.6f' %
                             (comparison['base']['max_relative'],base_tolerance,
                              comparison['subdivided']['max_relative'],tolerance))
        return result,{'status':'沿源曲面路径的独立包边候选；仍需轮廓、截面和视觉验收',
                       'source_faces':len(original_selected),'source_triangles':len(selected),
                       'faces':len(faces),'boundary_loops':2,
                       'anchor_pairs':anchors,'ts':ts,'turn_parameters':turns,
                       'profile_length_min':min(lengths),'profile_length_max':max(lengths),
                       'local_normal_dot_min':normal_min,'projection_source_faces':source_faces,
                       'comparison':comparison,'base_tolerance':base_tolerance,'subdivided_tolerance':tolerance,
                       'self_intersections':'未全面验证；仅检查局部面翻转和基础拓扑',
                       'path_method':'源三角面邻接走廊；共边约束路径；弧长采样'}
    except Exception:
        if result is not None:
            bpy.data.meshes.remove(result)
        raise
    finally:
        if reference is not None:
            bpy.data.meshes.remove(reference)
        bm.free()
