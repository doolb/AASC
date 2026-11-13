"""Conservative candidates and explicit annular quad strips, never source edits."""
import math
import heapq
from collections import defaultdict
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from .analysis import analyze, size
from .validation import compare_meshes, surface


def _blend(terms):
    result = defaultdict(float)
    for weights, factor in terms:
        for i,w in weights.items():
            result[i] += factor*w
    return dict(result)


def _stencils(mesh, levels):
    """Catmull-Clark linear stencils; smooth manifold, boundary rule EDGE_ONLY.

    Used only on reconstruction meshes with no crease/custom boundary options.
    """
    weights = [{i:1.0} for i in range(len(mesh.vertices))]
    faces = [list(p.vertices) for p in mesh.polygons]
    for _ in range(levels):
        ef = defaultdict(list); vf = defaultdict(list); ve = defaultdict(set)
        fp = []
        for fi,face in enumerate(faces):
            fp.append(_blend((weights[v],1/len(face)) for v in face))
            for a,b in zip(face,face[1:]+face[:1]):
                edge=tuple(sorted((a,b)));ef[edge].append(fi)
                vf[a].append(fi);ve[a].add(edge);ve[b].add(edge)
        ew = {}
        for (a,b),adj in ef.items():
            ew[(a,b)] = _blend([(weights[a],.25),(weights[b],.25)]+[(fp[f],.25) for f in adj]) if len(adj)==2 else _blend([(weights[a],.5),(weights[b],.5)])
        updated=[]
        for i,w in enumerate(weights):
            boundary=[e for e in ve[i] if len(ef[e])==1]
            if len(boundary)==2:
                others=[b if a==i else a for a,b in boundary]
                updated.append(_blend([(w,.75)]+[(weights[j],.125) for j in others]))
            elif boundary or not ve[i]:
                updated.append(w)
            else:
                n=len(ve[i]); terms=[(w,(n-3)/n)]
                terms.extend((fp[f],1/(n*len(vf[i]))) for f in vf[i])
                for a,b in ve[i]:
                    terms.extend([(weights[a],1/(n*n)),(weights[b],1/(n*n))])
                updated.append(_blend(terms))
        ei={e:len(updated)+i for i,e in enumerate(ef)}
        start_faces=len(updated)+len(ef)
        newfaces=[]
        for fi,face in enumerate(faces):
            for k,a in enumerate(face):
                newfaces.append([a,ei[tuple(sorted((a,face[(k+1)%len(face)])))],start_faces+fi,ei[tuple(sorted((a,face[k-1])))]] )
        weights=updated+list(ew.values())+fp;faces=newfaces
    return weights


def _fit(mesh, source, settings):
    levels=settings.get('subdivision',2)
    if len(mesh.polygons)*4**levels>150000:
        raise ValueError('拟合规模超出交互预算；请降低细分级别或按物件处理')
    rows=_stencils(mesh,levels);tree=surface(source)
    points=[v.co.copy() for v in mesh.vertices]
    scale=max(size(source),1e-12)
    cap=scale*settings.get('fit_distance',.15)
    def evaluate(control):
        residuals=[];loss=0.0
        for row in rows:
            point=sum((control[i]*w for i,w in row.items()),Vector())
            hit=tree.find_nearest(point)
            if hit[0] is None or hit[3]>cap:
                raise ValueError('拟合距离过大，无法确认对应表面')
            delta=hit[0]-point;residuals.append(delta);loss+=delta.length_squared
        return residuals,loss
    residuals,loss=evaluate(points)
    initial=loss
    for _ in range(settings.get('fit_iterations',12)):
        sums=[Vector() for _ in points];weights=[0.0]*len(points)
        for row,delta in zip(rows,residuals):
            for i,w in row.items():
                sums[i]+=delta*w;weights[i]+=abs(w)
        directions=[v/max(w,1e-12) for v,w in zip(sums,weights)]
        accepted=False
        for step in (1.0,.5,.25,.125):
            proposal=[p+d*step for p,d in zip(points,directions)]
            r,newloss=evaluate(proposal)
            if newloss<loss:
                points,residuals,loss=proposal,r,newloss;accepted=True;break
        if not accepted:break
    for v,p in zip(mesh.vertices,points):v.co=p
    mesh.update()
    return {'fit_loss_before':initial,'fit_loss_after':loss,'fit_sample_count':len(rows)}


def _ensure_safe(mesh, settings):
    data=analyze(mesh,settings);health=data['health']
    if health['nonmanifold_edges'] or health['nonmanifold_vertices'] or health['degenerate_faces'] or health['loose_vertices']:
        raise ValueError('网格有非流形、退化面或游离点；请先修正或排除该区域')
    return data


def rebuild(mesh, settings):
    data=_ensure_safe(mesh,settings)
    method=settings.get('method','CONSERVATIVE')
    bm=bmesh.new();result=None
    try:
        bm.from_mesh(mesh);bm.faces.ensure_lookup_table();bm.edges.ensure_lookup_table()
        if method=='INVERSE':
            for name in ('crease_edge','crease_vert'):
                attr=mesh.attributes.get(name)
                if attr and any(abs(v.value)>1e-8 for v in attr.data):
                    raise ValueError('逆细分拟合不支持非零 crease；请使用无折痕快照或结构保留路径')
            if data['health']['shells']!=1:
                raise ValueError('逆细分拟合目前仅支持单个连通壳体，请分开处理')
            for name in ('scr_locked','scr_protect'):
                attr=mesh.attributes.get(name)
                if attr and any(v.value for v in attr.data):
                    raise ValueError('有锁定边界或受保护细节；请使用结构保留候选，不能全件逆细分')
            bmesh.ops.join_triangles(bm,faces=list(bm.faces),angle_face_threshold=math.pi,
                                    angle_shape_threshold=math.radians(60),cmp_seam=True,cmp_sharp=True,
                                    cmp_uvs=False,cmp_vcols=False,cmp_materials=False)
            ratio=sum(len(f.verts)==4 for f in bm.faces)/max(len(bm.faces),1)
            if ratio<.95:raise ValueError('没有恢复出可靠的规则四边网格，请先分区后重建面带')
            original_faces=len(bm.faces)
            bmesh.ops.unsubdivide(bm,verts=list(bm.verts),iterations=2*settings.get('reverse_steps',1))
            if len(bm.faces)>=original_faces*.8:raise ValueError('未识别出可逆的规则细分层级')
        else:
            locked=mesh.attributes.get('scr_locked');protect=mesh.attributes.get('scr_protect')
            regions=mesh.attributes.get('scr_region')
            safe=[]
            for e in bm.edges:
                e.smooth=True
                if len(e.link_faces)!=2:continue
                a,b=(f.index for f in e.link_faces)
                is_locked=bool(locked and locked.data[e.index].value)
                if protect and (protect.data[a].value or protect.data[b].value):is_locked=True
                if regions and regions.data[a].value!=regions.data[b].value:is_locked=True
                if data['scores'][e.index]>=1:is_locked=True
                e.smooth=not is_locked
                if not is_locked:safe.append(e)
            bmesh.ops.dissolve_limit(bm,angle_limit=math.radians(settings.get('planar_angle',1.0)),
                                    use_dissolve_boundaries=False,verts=[],edges=safe,delimit={'SHARP'})
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        result=bpy.data.meshes.new('SCR_CandidateMesh');bm.to_mesh(result)
        for p in result.polygons:p.use_smooth=True
        fit=_fit(result,mesh,settings) if method=='INVERSE' else {}
        report={'method':method,'fit':fit,'status':'卡线控制网格候选' if method=='INVERSE' else '结构保留混合拓扑候选；未恢复完整卡线',
                'comparison':compare_meshes(mesh,result,settings),'source_signature':data['signature']}
        if not report['comparison']['topology_basic_check']:
            raise ValueError('候选未通过基础拓扑检查；未保留该结果')
        return result,report
    except Exception:
        if result is not None:bpy.data.meshes.remove(result)
        raise
    finally:bm.free()


def _ordered_loops(bm, selected):
    edges=[e for e in bm.edges if sum(f.index in selected for f in e.link_faces)==1]
    adjacent=defaultdict(list)
    for e in edges:
        a,b=e.verts;adjacent[a.index].append(b.index);adjacent[b.index].append(a.index)
    if not adjacent or any(len(x)!=2 for x in adjacent.values()):
        raise ValueError('选区边界不是连续闭环，存在分叉或交叉')
    remaining=set(adjacent);loops=[]
    while remaining:
        start=min(remaining);loop=[start];previous=None;current=start
        while True:
            following=next(v for v in adjacent[current] if v!=previous)
            if following==start:break
            if following in loop:raise ValueError('边界自交或无法排序')
            loop.append(following);previous,current=current,following
        remaining.difference_update(loop);loops.append(loop)
    if len(loops)!=2:raise ValueError('面带重建需要恰好两条闭合边界；不会自动封孔或处理分叉')
    return loops


def _resample(points, count):
    lengths=[(points[(i+1)%len(points)]-p).length for i,p in enumerate(points)]
    total=sum(lengths)
    if total<=1e-12:raise ValueError('边界长度为零')
    result=[];edge=0;offset=0
    for i in range(count):
        t=total*i/count
        while edge<len(lengths)-1 and offset+lengths[edge]<t:
            offset+=lengths[edge];edge+=1
        result.append(points[edge].lerp(points[(edge+1)%len(points)],(t-offset)/max(lengths[edge],1e-12)))
    return result


def _sample_boundary_path(bm, ids, count):
    """Sample an open path, keeping its first endpoint and source edge identity."""
    points = [bm.verts[i].co.copy() for i in ids]
    lengths = [(b-a).length for a,b in zip(points, points[1:])]
    total = sum(lengths)
    if total <= 1e-12:
        raise ValueError('边界锚点之间的长度为零')
    samples = []; edges = []; edge = 0; offset = 0.0
    for i in range(count):
        distance = total*i/count
        while edge < len(lengths)-1 and offset+lengths[edge] < distance:
            offset += lengths[edge]; edge += 1
        samples.append(points[edge].lerp(points[edge+1], (distance-offset)/max(lengths[edge],1e-12)))
        edges.append(tuple(sorted((ids[edge],ids[edge+1]))))
    return samples, edges


def _boundary_corners(bm, loops, settings):
    threshold = math.radians(settings.get('strip_corner_angle',35.0))
    corners = []
    for loop in loops:
        found = set()
        for i, vertex in enumerate(loop):
            p = bm.verts[vertex].co
            incoming = p-bm.verts[loop[i-1]].co
            outgoing = bm.verts[loop[(i+1)%len(loop)]].co-p
            if incoming.length and outgoing.length and incoming.angle(outgoing) >= threshold:
                found.add(vertex)
        corners.append(found)
    return corners


def _boundary_samples(bm, loops, count, settings):
    """Explicit vertex correspondences partition both rings into matching arcs.

    No automatic correspondence is claimed for discrete sharp corners/notches.
    Every detected corner must be included in the supplied anchor pairs.
    """
    corners = _boundary_corners(bm,loops,settings)
    supplied = settings.get('strip_anchor_pairs') or []
    if not supplied:
        if any(corners):
            raise ValueError('边界含尖角或凹口，请提供成对边界锚点后重建')
        a, ea = _sample_boundary_path(bm,loops[0]+loops[0][:1],count)
        best = None
        # Reverse the source IDs before sampling; rotate samples and their
        # source edges together. Bound the search by output segment count.
        for loop in (loops[1],list(reversed(loops[1]))):
            samples, edges = _sample_boundary_path(bm,loop+loop[:1],count)
            for shift in range(count):
                b = samples[shift:]+samples[:shift]
                cost = sum((x-y).length_squared for x,y in zip(a,b))
                if best is None or cost<best[0]:
                    best = cost,b,edges[shift:]+edges[:shift]
        _, b, eb = best
        return a,b,ea,eb,[]
    try:
        pairs = [tuple(pair) for pair in supplied]
    except TypeError as error:
        raise ValueError('锚点必须是源顶点 ID 对') from error
    if len(pairs)<3 or any(len(pair)!=2 or any(type(v) is not int for v in pair) for pair in pairs):
        raise ValueError('至少提供 3 对不重复的源顶点锚点')
    left,right = (set(loop) for loop in loops)
    pairs = [(b,a) if a in right and b in left else (a,b) for a,b in pairs]
    if not all(a in left and b in right for a,b in pairs):
        raise ValueError('每对锚点必须分别位于两条不同边界')
    if len({a for a,b in pairs}) != len(pairs) or len({b for a,b in pairs}) != len(pairs):
        raise ValueError('边界锚点不能重复使用')
    if any(not corner_set.issubset({pair[k] for pair in pairs}) for k,corner_set in enumerate(corners)):
        raise ValueError('锚点未覆盖全部尖角或凹口，请补齐特征点')
    if count < len(pairs):
        raise ValueError('周向分段数不能少于锚点对数')
    index_a = {v:i for i,v in enumerate(loops[0])}
    pairs.sort(key=lambda pair:index_a[pair[0]])
    loop_b = loops[1]
    for direction in (1,-1):
        ids = loop_b if direction==1 else list(reversed(loop_b))
        index_b = {v:i for i,v in enumerate(ids)}
        indices = [index_b[b] for a,b in pairs]
        if sum((indices[(i+1)%len(indices)]-j)%len(ids) for i,j in enumerate(indices)) == len(ids):
            loop_b = ids
            break
    else:
        raise ValueError('锚点次序交叉或扭转，请修正边界对应')
    def arc(loop,start,end):
        i = loop.index(start); j = loop.index(end)
        return loop[i:j+1] if j>i else loop[i:]+loop[:j+1]
    paths = [(arc(loops[0],a,pairs[(i+1)%len(pairs)][0]),
              arc(loop_b,b,pairs[(i+1)%len(pairs)][1])) for i,(a,b) in enumerate(pairs)]
    lengths = [sum(sum((bm.verts[v].co-bm.verts[u].co).length for u,v in zip(path,path[1:]))
                   for path in pair) for pair in paths]
    quota = [(count-len(pairs))*length/sum(lengths) for length in lengths]
    counts = [1+int(q) for q in quota]
    for i in sorted(range(len(pairs)),key=lambda i:quota[i]-int(quota[i]),reverse=True)[:count-sum(counts)]:
        counts[i] += 1
    a=[]; b=[]; ea=[]; eb=[]
    for (pa,pb),segments in zip(paths,counts):
        sa,se = _sample_boundary_path(bm,pa,segments); a.extend(sa); ea.extend(se)
        sb,se = _sample_boundary_path(bm,pb,segments); b.extend(sb); eb.extend(se)
    return a,b,ea,eb,[list(pair) for pair in pairs]


def propose_strip_anchors(mesh, selected_faces, settings):
    """Propose, never confirm, cyclic monotone source-vertex correspondences.

    The smaller boundary is matched completely to a subsequence of the larger
    one. Only non-corners on the larger ring may be skipped. Squared distance
    is minimized over both windings and every cyclic phase using dynamic
    programming; no object names, world axes or hand-authored points enter it.
    Dense triangular edge zigzags remain visible in this proposal. It does not
    certify feature identity or authorize build_strip to bypass its checks.
    """
    selected = set(selected_faces)
    if not selected or min(selected)<0 or max(selected)>=len(mesh.polygons):
        raise ValueError('请选择有效面带区域')
    _ensure_safe(mesh,settings)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh);bm.faces.ensure_lookup_table();bm.verts.ensure_lookup_table()
        seen = {next(iter(selected))};todo = list(seen)
        while todo:
            for edge in bm.faces[todo.pop()].edges:
                for face in edge.link_faces:
                    if face.index in selected and face.index not in seen:
                        seen.add(face.index);todo.append(face.index)
        if seen != selected:
            raise ValueError('锚点建议需要同一个连通面带，不能跨独立表面')
        loops = _ordered_loops(bm,selected)
        corners = _boundary_corners(bm,loops,settings)
        small_index = 0 if len(loops[0])<=len(loops[1]) else 1
        small = loops[small_index];large = loops[1-small_index]
        m,n = len(small),len(large)
        states = 2*n*m*(n-m+1)
        if n>int(settings.get('anchor_max_boundary_vertices',512)) or states>int(settings.get('anchor_state_budget',2000000)):
            raise ValueError('锚点匹配规模超出预算，请分区或手动指定锚点')
        required = corners[1-small_index]
        if len(required)>m:
            raise ValueError('两环显著角点数量无法单调对应；不能略过显著角点，请人工修正锚点')
        lengths = [sum((bm.verts[loop[(i+1)%len(loop)]].co-bm.verts[v].co).length
                       for i,v in enumerate(loop)) for loop in loops]
        if min(lengths)<=1e-12 or max(lengths)>min(lengths)*settings.get('anchor_length_ratio_limit',4.0):
            raise ValueError('边界长度比例超出锚点建议预算，请分区或人工确认结构')
        # Perimeter normalization makes scores independent of uniform scale.
        scale = (sum(lengths)*.5)**2
        costs = [[(bm.verts[a].co-bm.verts[b].co).length_squared/scale for b in large] for a in small]
        large_indices = {v:i for i,v in enumerate(large)}
        best = None
        for direction in (1,-1):
            for start in range(n):
                ids = [large[(start+direction*j)%n] for j in range(n)]
                indices = [large_indices[v] for v in ids]
                mandatory = [v in required for v in ids]
                previous = [float('inf')]*n
                previous[0] = costs[0][indices[0]]
                choices = [bytearray(n) for _ in range(m)]
                choices[0][0] = 1
                for j in range(1,n-m+1):
                    if not mandatory[j]:
                        previous[j] = previous[j-1]
                for i in range(1,m):
                    current = [float('inf')]*n
                    for j in range(i,n-m+i+1):
                        matched = previous[j-1]+costs[i][indices[j]]
                        skipped = current[j-1] if not mandatory[j] else float('inf')
                        if matched<=skipped:
                            current[j] = matched;choices[i][j] = 1
                        else:
                            current[j] = skipped
                    previous = current
                score = previous[-1]
                if math.isfinite(score) and (best is None or score<best[0]):
                    pairs = [];i = m-1;j = n-1
                    while i>=0:
                        if choices[i][j]:
                            pair = [small[i],ids[j]]
                            pairs.append(pair if small_index==0 else list(reversed(pair)))
                            i -= 1
                        j -= 1
                    pairs.reverse();best = score,pairs
        if best is None:
            raise ValueError('无法覆盖全部显著角点的循环单调锚点对应，请人工修正边界')
        score,pairs = best
        order = {v:i for i,v in enumerate(loops[0])}
        pairs.sort(key=lambda pair:order[pair[0]])
        return {'status':'锚点建议；需逐段检查并确认','requires_confirmation':True,
                'anchor_pairs':pairs,'normalized_cost':score,'estimated_states':states,
                'boundary_vertex_counts':[len(loop) for loop in loops],
                'corner_counts':[len(found) for found in corners],
                'skipped_noncorner_vertices':n-m,'matching':'cyclic_monotone_minimum_squared_distance',
                'geometry_validation':'未验证；确认后仍须通过面带重建检查'}
    finally:
        bm.free()


def selected_mesh(mesh, selected_faces):
    faces=[mesh.polygons[i] for i in selected_faces]
    ids=sorted({v for p in faces for v in p.vertices});mapping={v:i for i,v in enumerate(ids)}
    result=bpy.data.meshes.new('SCR_SelectedReference')
    result.from_pydata([mesh.vertices[i].co[:] for i in ids],[],[tuple(mapping[v] for v in p.vertices) for p in faces])
    result.update()
    return result


def _local_strip_trees(bm, selected, edges_a, edges_b, widths, settings):
    """Restrict each column to a connected source-face corridor.

    Centroid graph distance is a conservative heuristic, not a geodesic proof.
    A fold whose connected route greatly exceeds its chord must be split into
    separate front/turn/side strips instead of jumping to its nearby back layer.
    """
    centers = {i:bm.faces[i].calc_center_median() for i in selected}
    adjacent = {i:set() for i in selected}
    edge_faces = {}
    for edge in bm.edges:
        faces = {f.index for f in edge.link_faces if f.index in selected}
        edge_faces[tuple(sorted(v.index for v in edge.verts))] = faces
        for face in faces:
            adjacent[face].update(faces-{face})
    vertices = [v.co.copy() for v in bm.verts]
    trees = []
    for start_edge,end_edge,width in zip(edges_a,edges_b,widths):
        starts = edge_faces[start_edge]; ends = edge_faces[end_edge]
        distance = {i:0.0 for i in starts}; previous = {}
        heap = [(0.0,i) for i in starts]; heapq.heapify(heap)
        reached = None
        cap = width*settings.get('strip_route_ratio',3.0)
        while heap:
            cost,face = heapq.heappop(heap)
            if cost > distance[face]:
                continue
            if face in ends:
                reached = face; break
            for other in adjacent[face]:
                new_cost = cost+(centers[face]-centers[other]).length
                if new_cost<=cap and new_cost<distance.get(other,float('inf')):
                    distance[other] = new_cost; previous[other] = face
                    heapq.heappush(heap,(new_cost,other))
        if reached is None:
            raise ValueError('两边界的局部曲面路径过长，疑似跨层；请拆分转折面带')
        path = {reached}
        while reached in previous:
            reached = previous[reached]; path.add(reached)
        corridor = set(path)
        for face in path:
            corridor.update(adjacent[face])
        ids = sorted(corridor)
        tree = BVHTree.FromPolygons(vertices,[list(v.index for v in bm.faces[i].verts) for i in ids])
        trees.append((tree,ids))
    return trees


def _check_strip_faces(vertices, faces, normals, settings):
    """Check both triangles of each quad against its locally mapped source.

    This detects local folds/inversions; distant patch self-intersections still
    require a separate intersection test and must not be reported as verified.
    """
    minimum = settings.get('strip_normal_dot_min',.15)
    agreement = []
    for face in faces:
        a,b,c,d = (vertices[i] for i in face)
        reference = sum((normals[i] for i in face),Vector())
        if reference.length <= 1e-8:
            raise ValueError('局部源法线互相抵消，疑似跨层或转折过大')
        reference.normalize()
        for normal in ((b-a).cross(c-a),(c-a).cross(d-a)):
            if normal.length <= 1e-18:
                raise ValueError('局部面带退化，请增加分段或修正锚点')
            agreement.append(normal.normalized().dot(reference))
    direction = 1 if sum(agreement)>=0 else -1
    if any(value*direction < minimum for value in agreement):
        raise ValueError('局部面法线翻转或跨度异常，疑似扭转/跨孔，请修正锚点')
    return direction,min(value*direction for value in agreement)


def build_strip(mesh, selected_faces, settings):
    _ensure_safe(mesh,settings)
    selected=set(selected_faces)
    if not selected or min(selected)<0 or max(selected)>=len(mesh.polygons):raise ValueError('请选择有效面带区域')
    bm=bmesh.new();result=None
    try:
        bm.from_mesh(mesh);bm.faces.ensure_lookup_table();bm.verts.ensure_lookup_table()
        # Annulus must be one connected selection, not two separate disk caps.
        seen={next(iter(selected))};todo=list(seen)
        while todo:
            f=bm.faces[todo.pop()]
            for e in f.edges:
                for other in e.link_faces:
                    if other.index in selected and other.index not in seen:seen.add(other.index);todo.append(other.index)
        if seen!=selected:raise ValueError('请选择同一个连通面带，不能跨独立表面连接')
        loops=_ordered_loops(bm,selected)
        n=int(settings.get('strip_segments',32));rows=int(settings.get('strip_rows',4))
        if n<4 or rows<2:raise ValueError('面带至少需要 4 个周向分段、2 个横向分段')
        a,b,source_edges_a,source_edges_b,anchors=_boundary_samples(bm,loops,n,settings)
        widths=[(x-y).length for x,y in zip(a,b)]
        if min(widths)<=size(mesh)*1e-6 or max(widths)>min(widths)*settings.get('width_ratio_limit',12):
            raise ValueError('边界配对出现异常宽度，请分段或修正选区')
        # Each column maps only onto a connected corridor inside the selection.
        local_trees=_local_strip_trees(bm,selected,source_edges_a,source_edges_b,widths,settings)
        support=min(max(settings.get('support_spacing',.12),.01),.24)
        ts=[0,support]+[support+(1-2*support)*i/(rows-2) for i in range(1,rows-2)]+[1-support,1] if rows>=3 else [0,.5,1]
        vertices=[];normals=[];source_faces=[]
        for t in ts:
            for i,(x,y) in enumerate(zip(a,b)):
                point=x.lerp(y,t)
                local_tree,local_ids=local_trees[i]
                hit=local_tree.find_nearest(point)
                if hit[0] is None or hit[3]>widths[i]*settings.get('strip_projection_ratio',.2):
                    raise ValueError('面带贴面超出局部跨度，疑似跨孔或跨层，停止生成')
                vertices.append(point if t in (0,1) else hit[0])
                normals.append(hit[1]);source_faces.append(local_ids[hit[2]])
        faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(len(ts)-1) for i in range(n)]
        direction,normal_min=_check_strip_faces(vertices,faces,normals,settings)
        if direction<0:
            faces=[tuple(reversed(face)) for face in faces]
        result=bpy.data.meshes.new('SCR_QuadStrip');result.from_pydata(vertices,[],faces);result.update()
        health=analyze(result,settings)['health']
        if health['degenerate_faces'] or health['nonmanifold_edges']:raise ValueError('生成面带存在退化或非流形')
        return result,{'status':'独立面带候选；未焊接源网格','source_faces':len(selected),'faces':len(faces),
                       'boundary_loops':2,'width_min':min(widths),'width_max':max(widths),'anchor_pairs':anchors,
                       'projection_source_faces':source_faces,'local_normal_dot_min':normal_min,
                       'self_intersections':'未全面验证；已检查局部面翻转、跨孔跨度与连通投影走廊','ts':ts}
    except Exception:
        if result is not None:bpy.data.meshes.remove(result)
        raise
    finally:
        bm.free()
