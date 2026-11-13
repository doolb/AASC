"""Area/curvature boundary -> two stable side planes -> virtual hard edge.
Geometry only, without views, image priors or target coordinates.
"""
import math
import statistics
from mathutils import Vector,Matrix
from mathutils.geometry import closest_point_on_tri
from mathutils.bvhtree import BVHTree
from .structure_network import simplify_network, bridge_evidence_gaps


def plane_intersection_at(a,b,target,max_distance,min_angle=10.):
    """Closest point on two extended planes' intersection, or an explicit reject."""
    na,da=a;nb,db=b;dot=na.dot(nb);det=1-dot*dot
    if det<math.sin(math.radians(min_angle))**2:return None
    ra=da-na.dot(target);rb=db-nb.dot(target)
    result=target+na*((ra-dot*rb)/det)+nb*((rb-dot*ra)/det)
    return result if (result-target).length<=max_distance else None


def _side_plane(bm,seed,origin,across,sign,scale,curvature,threshold,radius):
    pending=[seed];seen={seed.index};pool=[]
    while pending and len(seen)<=500:
        face=pending.pop();center=face.calc_center_median()
        polygon=[v.co for v in face.verts]
        distance=min((closest_point_on_tri(origin,polygon[0],polygon[i],polygon[i+1])-origin).length for i in range(1,len(polygon)-1))
        if distance>radius:continue
        if (center-origin).dot(across)*sign< -scale*1e-8:continue
        if face.normal.dot(seed.normal)<-.1:continue
        pool.append(face)
        for edge in face.edges:
            for other in edge.link_faces:
                if other.index not in seen:seen.add(other.index);pending.append(other)
    if len(pool)<2:return None
    # Use the lower-curvature side of the neighbourhood, rather than requiring
    # a curved shell to contain an exactly flat face patch.
    stable=[f for f in pool if curvature[f.index]<=threshold*.6]
    if len(stable)>=2:pool=stable
    else:
        low=min(curvature[f.index] for f in pool)
        pool=[f for f in pool if curvature[f.index]<=max(threshold*.6,low*1.2)]
    if len(pool)<2:return None
    # Largest coherent normal patch outside the highest-curvature transition.
    anchor=max(pool,key=lambda f:sum(g.calc_area() for g in pool if f.normal.dot(g.normal)>math.cos(math.radians(12))))
    patch=[f for f in pool if anchor.normal.dot(f.normal)>math.cos(math.radians(12))]
    area=sum(f.calc_area() for f in patch)
    if area<=scale*scale*1e-12:return None
    normal=sum((f.normal*f.calc_area() for f in patch),Vector()).normalized()
    samples=[]
    for face in patch:
        polygon=[v.co for v in face.verts]
        near=min((closest_point_on_tri(origin,polygon[0],polygon[i],polygon[i+1]) for i in range(1,len(polygon)-1)),key=lambda p:(p-origin).length)
        samples.append(near)
        for point in polygon:
            delta=point-near;offset=near-origin
            if delta.length_squared<1e-20:continue
            c=offset.length_squared-radius*radius
            b=offset.dot(delta)
            t=min(1.,max(0.,(-b+math.sqrt(max(0.,b*b-delta.length_squared*c)))/delta.length_squared))
            samples.append(near+delta*t)
    center=sum(samples,Vector())/len(samples)
    # Extent in two independent directions must exist; a line is not a plane.
    far=max(samples,key=lambda v:(v-center).length);axis=far-center
    if axis.length<scale*1e-6:return None
    if max((v-center).cross(axis.normalized()).length for v in samples)<scale*1e-5:return None
    residual=max(abs((v-center).dot(normal)) for v in samples)
    if residual>scale*.002:return None
    return (normal,normal.dot(center)),{'faces':len(patch),'max_residual_relative':residual/scale}


def weld_virtual_graph(vertices,edges,planes,shells,tolerance,return_representatives=False):
    """Weld only coincident intersections from the same shell and plane pair."""
    cells={};out=[];mapping=[];representatives=[]
    def compatible(a,b):
        first=planes[a][:2];second=planes[b][:2]
        return all(any(abs(n.dot(m))>math.cos(math.radians(5)) for m,d in second) for n,c in first)
    for i,p in enumerate(vertices):
        p=Vector(p);key=tuple(math.floor(c/tolerance) for c in p);found=None
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                for dz in (-1,0,1):
                    for j in cells.get((key[0]+dx,key[1]+dy,key[2]+dz),[]):
                        if shells[i]==shells[representatives[j]] and (p-out[j]).length<=tolerance and compatible(i,representatives[j]):found=j;break
        if found is None:
            found=len(out);out.append(p);representatives.append(i);cells.setdefault(key,[]).append(found)
        mapping.append(found)
    merged=sorted({tuple(sorted((mapping[a],mapping[b]))) for a,b in edges if mapping[a]!=mapping[b]})
    result=([tuple(p) for p in out],[list(e) for e in merged],len(vertices)-len(out))
    return result+(representatives,) if return_representatives else result


def connect_vector_graph(graph,bm,response,scale,merge_relative=.0001):
    """Final vector deduplication/splitting, followed by evidenced tip bridging."""
    if not math.isfinite(merge_relative) or not 0<merge_relative<=.005:
        raise ValueError('矢量合并距离无效')
    tolerance=scale*merge_relative;points=[Vector(p) for p in graph['vertices']]
    if len(points)*len(graph['edges'])>3000000:raise ValueError('矢量连接搜索超过预算，请分部件处理')
    triangles=bm.calc_loop_triangles();tree=BVHTree.FromPolygons([v.co for v in bm.verts],[tuple(l.vert.index for l in t) for t in triangles],all_triangles=True)
    vertex_labels={};component=0
    for vertex in bm.verts:
        if vertex.index in vertex_labels:continue
        pending=[vertex];vertex_labels[vertex.index]=component
        while pending:
            for edge in pending.pop().link_edges:
                for other in edge.verts:
                    if other.index not in vertex_labels:vertex_labels[other.index]=component;pending.append(other)
        component+=1
    labels={face.index:vertex_labels[face.verts[0].index] for face in bm.faces}
    def layer(point):
        hit=tree.find_nearest(point)
        return labels[triangles[hit[2]][0].face.index],hit[1]
    layers=[layer(p) for p in points]
    if graph.get('vertex_shells') is not None:
        layers=[(sid,normal) for sid,(_,normal) in zip(graph['vertex_shells'],layers)]
    canonical=[];mapping=[];cells={}
    for i,p in enumerate(points):
        key=tuple(math.floor(c/tolerance) for c in p);found=None
        for dx in (-1,0,1):
            for dy in (-1,0,1):
                for dz in (-1,0,1):
                    for j in cells.get((key[0]+dx,key[1]+dy,key[2]+dz),[]):
                        original=canonical[j]
                        if layers[i][0]==layers[original][0] and layers[i][1].dot(layers[original][1])>.5 and (p-points[original]).length<=tolerance:found=j;break
        if found is None:
            found=len(canonical);canonical.append(i);cells.setdefault(key,[]).append(found)
        mapping.append(found)
    merged_points=[points[i] for i in canonical];new_edges=set();splits=0
    for aa,bb in graph['edges']:
        a,b=mapping[aa],mapping[bb]
        if a==b:continue
        start,end=merged_points[a],merged_points[b];delta=end-start
        if delta.length_squared<scale*scale*1e-20:continue
        stations=[(0.,a),(1.,b)]
        for c,p in enumerate(merged_points):
            if c in (a,b):continue
            t=(p-start).dot(delta)/delta.length_squared
            if not 1e-6<t<1-1e-6 or (p-start-delta*t).length>tolerance:continue
            sid,normal=layer(start+delta*t);original=canonical[c]
            if layers[original][0]==sid and layers[original][1].dot(normal)>.5:stations.append((t,c));splits+=1
        stations.sort()
        for (_,i),(_,j) in zip(stations,stations[1:]):
            if i!=j:new_edges.add(tuple(sorted((i,j))))
    active=sorted({i for edge in new_edges for i in edge});ids={i:j for j,i in enumerate(active)}
    result=dict(graph,vertices=[tuple(merged_points[i]) for i in active],edges=[[ids[a],ids[b]] for a,b in sorted(new_edges)],
        vertex_shells=[layers[canonical[i]][0] for i in active],vector_merged_vertices=len(points)-len(canonical),vector_split_contacts=splits,
        vector_duplicate_edges_removed=max(0,len(graph['edges'])+splits-len(new_edges)))
    result=bridge_evidence_gaps(result,bm,response,scale,.55)
    return result


def detect_plane_boundaries(bm,evidence,settings,cutoff):
    from .turn_lines import _contrast_boundaries,_long_components
    scale=evidence['curvature_scale']
    ratio=float(settings.get('boundary_area_ratio',2));change=float(settings.get('boundary_curvature_change',.5));floor=float(settings.get('boundary_curvature_floor',4))
    radius=float(settings.get('boundary_plane_radius',.06));max_offset=float(settings.get('boundary_hard_offset',.03))
    if not all(math.isfinite(v) for v in (radius,max_offset)) or not .005<=radius<=.2 or not .001<=max_offset<=.1:
        raise ValueError('局部平面搜索或硬转折外扩预算无效')
    iterations=int(settings.get('network_vector_smoothing',12));allowance=float(settings.get('network_smooth_allowance',.004));tolerance=float(settings.get('network_simplify_error',.004))
    if not 0<=iterations<=40 or not math.isfinite(allowance) or not 0<=allowance<=.02 or not math.isfinite(tolerance) or not .0001<=tolerance<=.02:
        raise ValueError('硬交线矢量平滑参数无效')
    from .curvature_filter import settings_filter
    face_neighbors=[]
    for f in bm.faces:face_neighbors.append(sorted({g.index for e in f.edges for g in e.link_faces if g is not f}))
    raw_curvature=evidence['curvature']
    convolution=None
    if settings.get('boundary_curvature_kernel','GRAPH')=='VOXEL':
        from .voxel_curvature import multiscale_curvature
        filtered,convolution=multiscale_curvature(raw_curvature,[f.calc_center_median() for f in bm.faces],
            [f.normal for f in bm.faces],[f.calc_area() for f in bm.faces],face_neighbors,scale,settings,bounds_points=[v.co for v in bm.verts])
    else:filtered=settings_filter(raw_curvature,face_neighbors,settings)
    evidence=dict(evidence,curvature=filtered)
    candidates,uncertain,metrics=_contrast_boundaries(bm,scale,ratio,change,floor,settings)
    retained,discarded=_long_components(bm,candidates,cutoff)
    proposals={};accepted=[];rejected={'no_stable_planes':0,'intersection':0,'direction':0};fits=[]
    for index in sorted(retained):
        edge=bm.edges[index];a,b=edge.link_faces
        origin=(edge.verts[0].co+edge.verts[1].co)*.5;tangent=(edge.verts[1].co-edge.verts[0].co).normalized()
        normal=a.normal+b.normal
        if normal.length<1e-8:rejected['no_stable_planes']+=1;continue
        across=normal.normalized().cross(tangent).normalized();planes=[];details=[]
        for face in (a,b):
            sign=1 if (face.calc_center_median()-origin).dot(across)>0 else -1
            fit=None
            for factor in (1.,.5,.25):
                fit=_side_plane(bm,face,origin,across,sign,scale,raw_curvature,evidence['curvature_threshold'],radius*factor*scale)
                if fit is not None:
                    fit[1]['search_radius_relative']=radius*factor;break
            if fit is None:break
            plane,detail=fit;planes.append(plane);details.append(detail)
        if len(planes)!=2:rejected['no_stable_planes']+=1;continue
        intersection=plane_intersection_at(*planes,origin,scale*max_offset)
        if intersection is None:rejected['intersection']+=1;continue
        direction=planes[0][0].cross(planes[1][0]).normalized()
        if abs(direction.dot(tangent))<math.cos(math.radians(40)):rejected['direction']+=1;continue
        ids=[]
        for v in edge.verts:
            target=plane_intersection_at(*planes,v.co,scale*max_offset)
            if target is None:break
            ids.append(v.index)
        if len(ids)!=2:rejected['intersection']+=1;continue
        for v in edge.verts:proposals.setdefault(v.index,[]).extend(planes)
        accepted.append(ids);fits.append({'source_edge':index,'planes':details,'offset_relative':(intersection-origin).length/scale})
    vertices=[];mapping={};max_shared_residual=0.;vertex_planes=[];vertex_shells=[];shared_rejected={'offset':0,'residual':0}
    source_shell={};component=0
    for v in bm.verts:
        if v.index in source_shell:continue
        pending=[v];source_shell[v.index]=component
        while pending:
            for e in pending.pop().link_edges:
                for other in e.verts:
                    if other.index not in source_shell:source_shell[other.index]=component;pending.append(other)
        component+=1
    for index,planes in proposals.items():
        target=bm.verts[index].co.copy();mat=Matrix.Identity(3)*1e-6;rhs=Vector()
        for normal,d in planes:
            for i in range(3):
                rhs[i]+=normal[i]*(d-normal.dot(target))
                for j in range(3):mat[i][j]+=normal[i]*normal[j]
        # The small anchor fixes the free coordinate along a single intersection.
        position=target+mat.inverted()@rhs
        if not all(math.isfinite(c) for c in position) or (position-target).length>scale*max_offset:
            shared_rejected['offset']+=1;continue
        residual=max(abs(n.dot(position)-d) for n,d in planes)
        if residual>scale*.002:shared_rejected['residual']+=1;continue
        max_shared_residual=max(max_shared_residual,residual/scale)
        mapping[index]=len(vertices);vertices.append(tuple(position));vertex_planes.append(planes);vertex_shells.append(source_shell[index])
    edges=[[mapping[a],mapping[b]] for a,b in accepted if a in mapping and b in mapping]
    vertices,edges,welded,representatives=weld_virtual_graph(vertices,edges,vertex_planes,vertex_shells,scale*1e-5,True)
    vertex_shells=[vertex_shells[i] for i in representatives]
    graph={'vertices':vertices,'edges':edges,'vertex_shells':vertex_shells,'joined_contacts':0,'evidence_gap_bridges':0}
    # Keep the virtual hard turn first; fair only its vector representation.
    graph=simplify_network(graph,scale,tolerance,iterations,allowance,True)
    response=[v/max(evidence['curvature_threshold'],1e-12) for v in evidence['curvature']]
    graph=connect_vector_graph(graph,bm,response,scale,float(settings.get('boundary_vector_merge',.0001)))
    degree=[0]*len(graph['vertices'])
    for a,b in graph['edges']:degree[a]+=1;degree[b]+=1
    graph['junction_vertices']=[i for i,d in enumerate(degree) if d>2];graph['endpoint_vertices']=[i for i,d in enumerate(degree) if d==1]
    lines=[{'role':'boundary','points':[graph['vertices'][a],graph['vertices'][b]],'closed':False,'length':(Vector(graph['vertices'][a])-Vector(graph['vertices'][b])).length,'has_branch':degree[a]>2 or degree[b]>2,'has_weak_evidence':False} for a,b in graph['edges']]
    return {'method':'NETWORK','status':'曲率＋面积候选经双侧平面延伸所得虚拟硬转折；待确认',
            'source_signature':evidence['signature'],'lines':lines,'network':graph,'line_count':len(lines),'boundary_count':len(lines),'closed_count':0,'support_count':0,
            'branch_vertices':graph['junction_vertices'],'endpoint_vertices':graph['endpoint_vertices'],'edge_indices':sorted(retained),
            'requires_confirmation':True,'semantic_labels_used':False,
            'parameters':{'input':'source mesh geometry only','path':'PLANE_INTERSECTION','rule':'area AND curvature contrast before plane fitting','area_ratio':ratio,'curvature_change':change,'curvature_floor':floor,'plane_radius_relative':radius,'hard_offset_relative':max_offset,'curvature_rounds':int(settings.get('boundary_curvature_rounds',2)),'curvature_change_gate':float(settings.get('boundary_curvature_gate',.25)),'curvature_contrast_gain':float(settings.get('boundary_curvature_gain',.5)),'vector_smoothing':iterations,'smooth_allowance_relative':allowance,'simplify_error_relative':tolerance},
            'diagnostics':{'contrast_edges':len(candidates),'retained_edges':len(retained),'stable_intersections':len(accepted),'welded_virtual_vertices':welded,'shared_vertex_rejections':shared_rejected,'rejected':rejected,'fits':fits,'max_shared_plane_residual_relative':max_shared_residual,'curvature_convolution':convolution},
            'limitations':['两侧不存在稳定面时拒绝生成，不将阴影或视角轮廓当边界','平面交线外推有预算，不保证恢复原历史控制笼','末端仅在同壳和连续几何证据下连接，仍可能保留断口','矢量平滑可能小幅偏离虚拟硬交线，未自动铺面或验收完整包边']}
