"""Geometry-first turning edges. Does not consume semantic partitions.

Direct edge evidence is the default. The optional band-boundary preview is not
a claim to have recovered paired rails, a centreline or historical support loops.
"""
import math
import statistics
from collections import defaultdict

import bmesh

from .analysis import analyze
from .boundary_trace import trace_boundaries


def _solve_fit(matrix, rhs):
    """Small pivoted solve; rank-deficient mesh patches remain unclassified."""
    rows=[list(row)+[value] for row,value in zip(matrix,rhs)]
    scale=max(abs(x) for row in matrix for x in row)
    for col in range(len(rhs)):
        pivot=max(range(col,len(rhs)),key=lambda i:abs(rows[i][col]))
        if abs(rows[pivot][col])<=scale*1e-12:return None
        rows[col],rows[pivot]=rows[pivot],rows[col]
        divisor=rows[col][col];rows[col]=[x/divisor for x in rows[col]]
        for i in range(len(rhs)):
            if i!=col:
                factor=rows[i][col]
                rows[i]=[a-factor*b for a,b in zip(rows[i],rows[col])]
    result=[row[-1] for row in rows]
    return result if all(math.isfinite(x) for x in result) else None


def _fit_surface_axis(vertex, rings, diagnostics=None):
    """Fit a quadratic height surface on connected mesh neighbours only.

    Principal directions use both fundamental forms, including nonzero slope
    in the initial frame. This is not a ridge extractor.
    """
    def reject(reason):
        if diagnostics is not None:diagnostics[reason]=diagnostics.get(reason,0)+1
        return None
    patch={vertex};front={vertex}
    for _ in range(rings):
        front={e.other_vert(v) for v in front for e in v.link_edges}-patch
        patch.update(front)
        if len(patch)>128:return reject('patch_budget')
    if len(patch)<9:return reject('insufficient_samples')
    normal=vertex.normal.normalized()
    if normal.length_squared<.5:return reject('invalid_normal')
    tangents=[v.co-vertex.co-normal*(v.co-vertex.co).dot(normal) for v in patch]
    u=max(tangents,key=lambda p:p.length_squared)
    radius=max((v.co-vertex.co).length for v in patch)
    if radius<=1e-15 or u.length<=radius*1e-8:return reject('collapsed_patch')
    u=u.normalized();w=normal.cross(u).normalized()
    samples=[]
    for v in sorted(patch,key=lambda p:p.index):
        delta=(v.co-vertex.co)/radius
        x,y,z=delta.dot(u),delta.dot(w),delta.dot(normal)
        # Area quadrature prevents densely triangulated patches dominating.
        area=sum(f.calc_area()/len(f.verts) for f in v.link_faces)/(radius*radius)
        weight=area/(1+delta.length_squared)**2
        samples.append(([x*x*.5,x*y,y*y*.5,x,y,1.],z,weight))
    matrix=[[sum(p[i]*p[j]*weight for p,z,weight in samples) for j in range(6)] for i in range(6)]
    rhs=[sum(p[i]*z*weight for p,z,weight in samples) for i in range(6)]
    fitted=_solve_fit(matrix,rhs)
    if fitted is None:return reject('rank_deficient')
    a,b,c,dx,dy,_=fitted
    # Shape operator I^-1 II, not the Hessian alone: the mesh vertex normal
    # need not equal the fitted surface normal, especially on uneven triangles.
    metric=1+dx*dx+dy*dy;factor=metric**1.5
    s00=((1+dy*dy)*a-dx*dy*b)/factor
    s01=((1+dy*dy)*b-dx*dy*c)/factor
    s10=((1+dx*dx)*b-dx*dy*a)/factor
    s11=((1+dx*dx)*c-dx*dy*b)/factor
    middle=(s00+s11)*.5
    gap=math.sqrt(max(0.,((s00-s11)*.5)**2+s01*s10))
    eigenvalues=(middle+gap,middle-gap)
    dominant=max(eigenvalues,key=abs);minor=min(eigenvalues,key=abs)
    if abs(dominant)<1e-6:return reject('flat_patch')
    if abs(minor)>abs(dominant)*.5:return reject('ambiguous_axis')
    error=sum(weight*(sum(x*y for x,y in zip(p,fitted))-z)**2 for p,z,weight in samples)
    residual=math.sqrt(error/max(sum(weight for p,z,weight in samples),1e-30))/abs(dominant)
    if residual>.04:return reject('fit_residual')
    ex,ey=max(((s01,dominant-s00),(dominant-s11,s10)),key=lambda p:p[0]**2+p[1]**2)
    axis=((u+normal*dx)*ex+(w+normal*dy)*ey).normalized()
    normal=(normal-u*dx-w*dy).normalized()
    if diagnostics is not None:diagnostics['valid']=diagnostics.get('valid',0)+1
    return {'axis':axis,'normal':normal,'curvature':dominant/radius,'residual':residual}


def _filter_surface_directions(bm, candidates, sharp, tolerance, diagnostics=None):
    bm.edges.ensure_lookup_table()
    cache={};rejected=set();uncertain=set()
    limit=math.sin(math.radians(tolerance))
    def fit(vertex):
        if vertex.index not in cache:
            small=_fit_surface_axis(vertex,2,diagnostics);large=_fit_surface_axis(vertex,3,diagnostics)
            cache[vertex.index]=(small if small and large and
                small['curvature']*large['curvature']>0 and
                abs(small['axis'].dot(large['axis']))>=.94 else None)
        return cache[vertex.index]
    for index in sorted(candidates-sharp):
        edge=bm.edges[index];a,b=(fit(v) for v in edge.verts)
        if a is None or b is None or abs(a['axis'].dot(b['axis']))<.85:
            uncertain.add(index);continue
        tangent=(edge.verts[1].co-edge.verts[0].co).normalized()
        if all(abs(tangent.dot(f['axis']))>limit for f in (a,b)):rejected.add(index)
    return set(candidates)-rejected,sorted(rejected),sorted(uncertain)


def _number(settings, name, default, low, high):
    try:
        value=float(settings.get(name,default))
    except (ValueError,TypeError) as error:
        raise ValueError('转折线参数无效：'+name) from error
    if not math.isfinite(value) or not low<=value<=high:
        raise ValueError('转折线参数超出范围：'+name)
    return value


def _chains(bm, edge_indices):
    incident=defaultdict(list)
    for index in edge_indices:
        for vertex in bm.edges[index].verts:incident[vertex.index].append(index)
    remaining=set(edge_indices);result=[]
    def walk(vertex, first):
        vertices=[vertex];edges=[];edge=first
        while edge in remaining:
            remaining.remove(edge);edges.append(edge)
            a,b=(v.index for v in bm.edges[edge].verts)
            vertex=b if vertex==a else a
            vertices.append(vertex)
            if vertex==vertices[0] or len(incident[vertex])!=2:break
            edge=next((i for i in incident[vertex] if i in remaining),-1)
        return {'vertices':vertices,'edges':edges,'closed':vertices[-1]==vertices[0],
                'length':sum(bm.edges[i].calc_length() for i in edges)}
    for vertex in sorted(incident):
        if len(incident[vertex])==2:continue
        for edge in sorted(incident[vertex]):
            if edge in remaining:result.append(walk(vertex,edge))
    while remaining:
        edge=min(remaining);result.append(walk(min(v.index for v in bm.edges[edge].verts),edge))
    return result


def _long_components(bm, edge_indices, cutoff):
    """Do not erase a dense band just because each junction splits a short edge."""
    remaining=set(edge_indices);retained=set();discarded=0
    while remaining:
        start=min(remaining);remaining.remove(start);component={start};pending=[start]
        while pending:
            for vertex in bm.edges[pending.pop()].verts:
                for edge in vertex.link_edges:
                    if edge.index in remaining:
                        remaining.remove(edge.index);component.add(edge.index);pending.append(edge.index)
        if sum(bm.edges[i].calc_length() for i in component)>=cutoff:retained.update(component)
        else:discarded+=1
    return retained,discarded


def _adaptive_area_match(curvature_a, curvature_b, area_a, area_b,
                         base_ratio, relaxation, curvature_tolerance):
    """Symmetric local match; curvature is signed, areas are raw face areas.

    Equal curvature permits base_ratio * relaxation; at the relative curvature
    tolerance the area budget returns to base_ratio. No match creates evidence.
    """
    if curvature_a*curvature_b<=0:return False,base_ratio
    relative=abs(curvature_a-curvature_b)/max(abs(curvature_a),abs(curvature_b))
    similarity=max(0.,1-relative/curvature_tolerance)
    allowed=base_ratio*relaxation**similarity
    ratio=max(area_a,area_b)/max(min(area_a,area_b),1e-30)
    return relative<=curvature_tolerance and ratio<=allowed,allowed


def contrast_passes(adjacent_area_ratio,area_ratio,side_curvatures,area_limit,change_limit,curvature_floor):
    """One mandatory AND rule; a hinge angle can never bypass either test."""
    low,high=sorted(side_curvatures)
    change=(high-low)/max(high,curvature_floor)
    return (adjacent_area_ratio>=area_limit and area_ratio>=area_limit
            and high>=curvature_floor and change>=change_limit)


def _contrast_boundaries(bm, scale, area_limit, curvature_change, curvature_floor, curvature_settings=None):
    """Two independent one-ring face patches, clipped to opposite edge sides.

    Compare raw triangle area and maximum normal variation per transverse span.
    The tested hinge itself is excluded from both curvature measurements, so
    its angle alone cannot turn a surface-internal diagonal into a boundary.
    """
    areas=[f.calc_area() for f in bm.faces]
    centers=[f.calc_center_median() for f in bm.faces]
    hinges={}
    for e in bm.edges:
        if len(e.link_faces)!=2:continue
        a,b=e.link_faces;t=(e.verts[1].co-e.verts[0].co).normalized()
        distance=sum((centers[f.index]-e.verts[0].co).cross(t).length for f in (a,b))
        hinges[e.index]=a.normal.angle(b.normal,0)*scale/max(distance,scale*1e-12)
    if curvature_settings is not None and hinges:
        from .curvature_filter import settings_filter
        ids=sorted(hinges);mapping={e:i for i,e in enumerate(ids)};neighbors=[]
        for index in ids:
            edge=bm.edges[index];axis=(edge.verts[1].co-edge.verts[0].co).normalized()
            nearby={other.index for v in edge.verts for other in v.link_edges if other.index in mapping and other is not edge}
            neighbors.append([mapping[j] for j in sorted(nearby) if abs(axis.dot((bm.edges[j].verts[1].co-bm.edges[j].verts[0].co).normalized()))>.75])
        if curvature_settings.get('boundary_curvature_kernel','GRAPH')=='VOXEL':
            from .voxel_curvature import multiscale_curvature
            edge_adjacency=[[mapping[j] for j in sorted({o.index for v in bm.edges[i].verts for o in v.link_edges if o.index in mapping and o.index!=i})] for i in ids]
            filtered,_=multiscale_curvature([hinges[i] for i in ids],
                [(bm.edges[i].verts[0].co+bm.edges[i].verts[1].co)*.5 for i in ids],
                [(bm.edges[i].link_faces[0].normal+bm.edges[i].link_faces[1].normal).normalized() for i in ids],
                [sum(areas[f.index] for f in bm.edges[i].link_faces) for i in ids],edge_adjacency,scale,curvature_settings,
                [(bm.edges[i].verts[1].co-bm.edges[i].verts[0].co).normalized() for i in ids],bounds_points=[v.co for v in bm.verts])
        else:filtered=settings_filter([hinges[i] for i in ids],neighbors,curvature_settings)
        hinges=dict(zip(ids,filtered))
    accepted=[];unresolved=[];metrics={}
    epsilon=max(scale*1e-10,1e-15)
    for edge in bm.edges:
        if len(edge.link_faces)!=2:continue
        a,b=edge.link_faces
        direct_ratio=max(areas[a.index],areas[b.index])/min(areas[a.index],areas[b.index])
        if direct_ratio<area_limit:continue
        tangent=(edge.verts[1].co-edge.verts[0].co).normalized()
        normal=a.normal+b.normal
        if normal.length<1e-8:unresolved.append(edge.index);continue
        across=normal.normalized().cross(tangent).normalized()
        origin=(edge.verts[0].co+edge.verts[1].co)*.5
        signs=[(centers[f.index]-origin).dot(across) for f in (a,b)]
        if signs[0]*signs[1]>=0 or min(abs(s) for s in signs)<epsilon:
            unresolved.append(edge.index);continue
        sides=[]
        for seed,sign in zip((a,b),signs):
            patch={seed}
            for other_edge in seed.edges:
                if other_edge is edge:continue
                for face in other_edge.link_faces:
                    if ((centers[face.index]-origin).dot(across)*sign>0 and
                            face.normal.dot(seed.normal)>.5):patch.add(face)
            side_area=statistics.median(areas[f.index] for f in patch)
            # Missing neighbours at an open border are not zero-curvature
            # observations. Measure available same-side hinges, not a count of
            # them divided by triangle area (which depends on triangulation).
            side_hinges={e for f in patch for e in f.edges if e is not edge and len(e.link_faces)==2
                and all((centers[g.index]-origin).dot(across)*sign>0 and
                        g.normal.dot(seed.normal)>.5 for g in e.link_faces)}
            if not side_hinges:break
            side_curvature=max(hinges[e.index] for e in side_hinges)
            sides.append((side_area,side_curvature))
        if len(sides)!=2:unresolved.append(edge.index);continue
        ratio=max(s[0] for s in sides)/min(s[0] for s in sides)
        low,high=sorted(s[1] for s in sides)
        change=(high-low)/max(high,curvature_floor)
        if contrast_passes(direct_ratio,ratio,[s[1] for s in sides],area_limit,curvature_change,curvature_floor):
            accepted.append(edge.index)
            metrics[str(edge.index)]={'area_ratio':ratio,'curvature_change':change,
                                      'adjacent_area_ratio':direct_ratio,
                                      'side_curvatures':[s[1] for s in sides]}
    return set(accepted),unresolved,metrics


def detect_turn_lines(mesh, settings):
    """Extract actual edge chains on the source, without changing any labels.

    Strong curvature seeds grow only through weak geometric evidence. Density
    can reinforce this response, never create a line on a flat dense surface.
    Open source borders are not themselves classified as a turn.
    """
    weak_ratio=_number(settings,'turn_weak_ratio',.55,.1,1.)
    min_length=_number(settings,'turn_min_length',.03,0.,1.)
    density_weight=_number(settings,'density_weight',.25,0.,.45)
    curvature_ratio=_number(settings,'curvature_ratio',2.5,1.01,20.)
    angle=math.radians(_number(settings,'feature_angle',28.,1.,179.))
    adaptive=settings.get('turn_adaptive_area',True)
    if not isinstance(adaptive,bool):raise ValueError('曲率自适应面积匹配必须为布尔值')
    area_ratio=_number(settings,'turn_area_ratio',2.,1.,100.)
    area_relax=_number(settings,'turn_area_relax',3.,1.,20.)
    curvature_tolerance=_number(settings,'turn_curvature_tolerance',.35,.01,.95)
    direction_fit=settings.get('turn_surface_fit',True)
    if not isinstance(direction_fit,bool):raise ValueError('局部曲面方向过滤必须为布尔值')
    direction_angle=_number(settings,'turn_direction_angle',35.,5.,85.)
    boundary_area=_number(settings,'boundary_area_ratio',2.,1.01,100.)
    boundary_change=_number(settings,'boundary_curvature_change',.5,.01,1.)
    boundary_floor=_number(settings,'boundary_curvature_floor',4.,.01,1000.)
    method=settings.get('turn_method','EDGE')
    if method not in {'EDGE','BAND','CONTRAST','TRACE','NETWORK'}:raise ValueError('未知转折线识别方式')
    # Ignore seed labels and locks by analysing a temporary copy without them.
    # They describe human semantic choices, not evidence of a geometric turn.
    reference=mesh.copy()
    try:
        for name in ('scr_seed','scr_locked'):
            attribute=reference.attributes.get(name)
            if attribute:reference.attributes.remove(attribute)
        evidence=analyze(reference,dict(settings,curvature_ratio=curvature_ratio))
    finally:
        import bpy
        bpy.data.meshes.remove(reference)
    health=evidence['health']
    if health['degenerate_faces'] or health['nonmanifold_edges'] or health['nonmanifold_vertices']:
        raise ValueError('转折线识别需要无退化、无非流形的源表面')
    bm=bmesh.new()
    try:
        bm.from_mesh(mesh);bm.normal_update()
        bm.faces.ensure_lookup_table();bm.edges.ensure_lookup_table();bm.verts.ensure_lookup_table()
        adjacent=[[] for _ in bm.faces]
        for edge in bm.edges:
            if len(edge.link_faces)==2:
                a,b=(f.index for f in edge.link_faces)
                adjacent[a].append(b);adjacent[b].append(a)
        threshold=evidence['curvature_threshold']
        spacing=evidence['spacing'];response=[]
        for face,neighbors in enumerate(adjacent):
            ids=set(neighbors)
            ids.update(k for j in neighbors for k in adjacent[j])
            background=statistics.median(spacing[j] for j in ids) if ids else spacing[face]
            density=max(0.,min(1.,background/max(spacing[face],1e-15)-1))
            response.append(evidence['curvature'][face]/threshold*(1+density_weight*density))
        if method=='NETWORK':
            from .structure_network import detect_network
            return detect_network(bm,response,evidence,settings,weak_ratio,evidence['curvature_scale']*min_length)
        if method=='TRACE':
            return trace_boundaries(bm,response,evidence,settings,weak_ratio,evidence['curvature_scale']*min_length)
        band={i for i,value in enumerate(response) if value>=1}
        pending=list(sorted(band))
        while pending:
            face=pending.pop()
            for other in adjacent[face]:
                if other not in band and response[other]>=weak_ratio:
                    band.add(other);pending.append(other)
        # Keep sharp edges as exact lines, and smooth narrow turns as two rails.
        boundary=[];sharp=[]
        for edge in bm.edges:
            if len(edge.link_faces)!=2:continue
            a,b=edge.link_faces
            if (a.index in band)!=(b.index in band):boundary.append(edge.index)
            if a.normal.angle(b.normal,0)>=angle:sharp.append(edge.index)
        edge_response={};edge_curvature={};edge_area={};area_relaxed=set()
        contrast_uncertain=[];contrast_metrics={}
        if method=='CONTRAST':
            candidate_edges,contrast_uncertain,contrast_metrics=_contrast_boundaries(
                bm,evidence['curvature_scale'],boundary_area,boundary_change,boundary_floor)
        elif method=='EDGE':
            # Unfolded centroid distance perpendicular to the shared edge:
            # each triangle contributes one third of its altitude. A large
            # planar neighbour therefore cannot inherit a narrow band's bend
            # merely because one of its vertices touches that band.
            for edge in bm.edges:
                if len(edge.link_faces)!=2:continue
                a,b=edge.link_faces
                tangent=(edge.verts[1].co-edge.verts[0].co).normalized()
                distance=sum((f.calc_center_median()-edge.verts[0].co).cross(tangent).length
                             for f in (a,b))
                curvature=a.normal.angle(b.normal,0)/max(distance,1e-15)*evidence['curvature_scale']
                signed=(b.calc_center_median()-a.calc_center_median()).dot(b.normal-a.normal)
                edge_curvature[edge.index]=math.copysign(curvature,signed) if signed else 0.
                edge_area[edge.index]=(a.calc_area()+b.calc_area())*.5
                local=[spacing[f.index] for v in edge.verts for f in v.link_faces]
                background=statistics.median(local)
                spacing_here=(spacing[a.index]+spacing[b.index])*.5
                density=max(0.,min(1.,background/max(spacing_here,1e-15)-1))
                edge_response[edge.index]=max(curvature/threshold*(1+density_weight*density),
                                               a.normal.angle(b.normal,0)/angle)
            candidate_edges={i for i,value in edge_response.items() if value>=1}
            pending=list(sorted(candidate_edges))
            while pending:
                index=pending.pop();edge=bm.edges[index]
                for vertex in edge.verts:
                    incoming=(vertex.co-edge.other_vert(vertex).co).normalized()
                    for other in vertex.link_edges:
                        if other.index in candidate_edges or edge_response.get(other.index,0)<weak_ratio:continue
                        outgoing=(other.other_vert(vertex).co-vertex.co).normalized()
                        # Reject lateral weak continuations. Some diagonals can
                        # still pass, so this remains an unconfirmed line network.
                        if incoming.dot(outgoing)>=.5:
                            if adaptive:
                                matches,_=_adaptive_area_match(edge_curvature[index],edge_curvature[other.index],
                                    edge_area[index],edge_area[other.index],area_ratio,area_relax,curvature_tolerance)
                                if not matches:continue
                                ratio=max(edge_area[index],edge_area[other.index])/min(edge_area[index],edge_area[other.index])
                                if ratio>area_ratio:area_relaxed.add(other.index)
                            candidate_edges.add(other.index);pending.append(other.index)
        else:
            candidate_edges=set(boundary)|set(sharp)
        direction_rejected=[];direction_uncertain=[];direction_diagnostics={}
        if method=='EDGE' and direction_fit:
            candidate_edges,direction_rejected,direction_uncertain=_filter_surface_directions(
                bm,candidate_edges,set(sharp),direction_angle,direction_diagnostics)
        cutoff=evidence['curvature_scale']*min_length
        kept,discarded=_long_components(bm,candidate_edges,cutoff)
        lines=_chains(bm,kept)
        retained=sorted(kept)
        degree=defaultdict(int)
        for index in retained:
            for vertex in bm.edges[index].verts:degree[vertex.index]+=1
        branches=sorted(v for v,count in degree.items() if count>2)
        endpoints=sorted(v for v,count in degree.items() if count==1)
        for line in lines:
            line['has_branch']=any(v in branches for v in line['vertices'])
            line['has_weak_evidence']=any(edge_response.get(i,1)<1 for i in line['edges'])
            line['source_faces']=sorted({f.index for i in line['edges'] for f in bm.edges[i].link_faces})
        status={'EDGE':'逐边转折线候选；尚未确认，不用于自动切面',
                'BAND':'转折带双边界候选；尚未配对，不用于自动切面',
                'CONTRAST':'面积与曲率差异边界候选；尚未闭合，不用于自动切面'}
        return {'status':status[method],
                'method':method,
                'source_signature':evidence['signature'],'band_faces':sorted(band) if method=='BAND' else [],
                'edge_indices':retained,'lines':lines,'line_count':len(lines),
                'branch_vertices':branches,'endpoint_vertices':endpoints,
                'strong_edge_indices':[i for i in retained if edge_response.get(i,0)>=1],
                'weak_edge_indices':[i for i in retained if i in edge_response and edge_response[i]<1],
                'area_relaxed_edge_indices':sorted(area_relaxed&kept),
                'direction_rejected_edges':direction_rejected,
                'direction_uncertain_edges':direction_uncertain,
                'direction_fit_diagnostics':direction_diagnostics,
                'contrast_uncertain_edges':contrast_uncertain,
                'contrast_metrics':{str(i):contrast_metrics[str(i)] for i in retained} if method=='CONTRAST' else {},
                'discarded_short_components':discarded,
                'boundary_edges':retained if method=='CONTRAST' else sorted(set(boundary)&set(retained)) if method=='BAND' else [],
                'sharp_edges':sorted(set(sharp)&set(retained)),
                'requires_confirmation':True,'semantic_labels_used':False,
                'parameters':{'weak_ratio':weak_ratio,'min_length_relative':min_length,
                              'boundary_contrast':{'enabled':method=='CONTRAST','area_ratio':boundary_area,
                                  'curvature_change':boundary_change,'curvature_floor':boundary_floor,
                                  'rule':'area AND curvature contrast; no sharp-angle bypass; no weak growth'},
                              'surface_direction_fit':{'enabled':direction_fit and method=='EDGE',
                                                       'max_deviation_degrees':direction_angle,
                                                       'rings':[2,3],'uncertain_policy':'retain before component filter',
                                                       'sharp_policy':'retain before component filter'},
                              'curvature_threshold':threshold,'density_weight':density_weight,
                              'adaptive_area':{'enabled':adaptive and method=='EDGE','base_ratio':area_ratio,
                                               'same_curvature_multiplier':area_relax,'curvature_tolerance':curvature_tolerance,
                                               'area_measure':'mean raw face area at successive edges; weak continuation only',
                                               'scope':'EDGE weak growth before component filtering; final strong fragments may be filtered'},
                              'density_scale_mix':evidence['density_scale_mix']},
                'limitations':['原三角网格上的边链，尚未跨三角面平滑','同一转折可能有多条平行线，尚未选定主线和配对',
                               '面积与曲率差异模式会漏掉等密度结构边；候选不闭合时不能用于切面',
                               '曲面方向过滤不是曲率极值/脊线提取；沿结构方向的三角斜边仍可能保留',
                               '拓扑邻域可能经薄侧壁接触另一侧；拟合失败时保留并标为不确定',
                               '分叉和断点需人工检查','没有把候选线自动写回分区']}
    finally:
        bm.free()
