"""Geometry-only structure candidates: separate valleys/ridges, retain junctions.
No image, template, asset name, fixed axis or target coordinates are used.
"""
import math
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from .boundary_trace import trace_boundaries, _cage_smooth, _simple_indices


def signed_curvature(bm, scale):
    """Cotan mean-curvature sign from geometry; flat triangulation is neutral."""
    bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
    co=[v.co.copy() for v in bm.verts];lap=[Vector() for _ in co];area=[0.]*len(co)
    for tri in bm.calc_loop_triangles():
        ids=[loop.vert.index for loop in tri];a,b,c=[co[i] for i in ids]
        cross=(b-a).cross(c-a).length
        if cross<=scale*scale*1e-15:continue
        for i in ids:area[i]+=cross/6
        for j in range(3):
            i,k,l=ids[j],ids[(j+1)%3],ids[(j+2)%3]
            cot=(co[i]-co[l]).dot(co[k]-co[l])/cross
            delta=(co[k]-co[i])*cot
            lap[i]+=delta;lap[k]-=delta
    return [lap[i].dot(v.normal)*scale/max(area[i]*2,1e-30) for i,v in enumerate(bm.verts)]


def join_endpoints(lines, bm, scale, radius):
    """Make genuine endpoint/segment T contacts share a graph vertex.

    Only same-shell, similarly facing surface layers may join. Neighbouring
    parallel rails do not merge. Geometry near a junction is moved at most radius.
    """
    vertices=[];segments=[];ends=[];owners=[]
    for owner,line in enumerate(lines):
        ids=[]
        for point in line['points']:
            ids.append(len(vertices));vertices.append(Vector(point));owners.append(owner)
        for a,b in zip(ids,ids[1:]+ids[:1] if line['closed'] else ids[1:]):segments.append([a,b])
        if not line['closed'] and len(ids)>1:ends.extend(((ids[0],ids[1]),(ids[-1],ids[-2])))
    # Map nearest source faces to topological shells, not spatial proximity.
    shells={};shell=0
    for f in bm.faces:
        if f.index in shells:continue
        pending=[f];shells[f.index]=shell
        while pending:
            for edge in pending.pop().edges:
                for other in edge.link_faces:
                    if other.index not in shells:shells[other.index]=shell;pending.append(other)
        shell+=1
    tris=bm.calc_loop_triangles();polys=[tuple(l.vert.index for l in tri) for tri in tris]
    tree=BVHTree.FromPolygons([v.co for v in bm.verts],polys,all_triangles=True)
    def layer(point):
        hit=tree.find_nearest(point)
        return (shells[tris[hit[2]][0].face.index],hit[1]) if hit[0] is not None else (None,Vector())
    if len(ends)*len(segments)>3000000:
        raise ValueError('结构线网交点搜索超过当前预算，请分部件处理')
    joins=0;aliases={}
    def root(i):
        while i in aliases:i=aliases[i]
        return i
    for endpoint,neighbor in ends:
        endpoint=root(endpoint);p=vertices[endpoint];tangent=(vertices[neighbor]-p).normalized();sid,normal=layer(p)
        best=None
        for idx,(aa,bb) in enumerate(segments):
            a,b=root(aa),root(bb)
            if a==b or endpoint in (a,b) or owners[a]==owners[endpoint] or owners[b]==owners[endpoint]:continue
            delta=vertices[b]-vertices[a];length=delta.length
            if length<=1e-12 or abs(tangent.dot(delta/length))>math.cos(math.radians(25)):continue
            t=max(0.,min(1.,(p-vertices[a]).dot(delta)/delta.length_squared));target=vertices[a]+delta*t;dist=(target-p).length
            if dist>radius or (best is not None and dist>=best[0]):continue
            other_sid,other_normal=layer(target)
            if sid!=other_sid or normal.dot(other_normal)<.5:continue
            best=dist,idx,a,b,t,target
        if best is None:continue
        dist,idx,a,b,t,target=best
        if t<1e-5:aliases[endpoint]=a
        elif t>1-1e-5:aliases[endpoint]=b
        else:
            # Reuse the endpoint itself as the shared node, splitting target edge.
            vertices[endpoint]=target;segments[idx]=[a,endpoint];segments.append([endpoint,b])
        joins+=1
    active=sorted({root(i) for edge in segments for i in edge});mapping={i:j for j,i in enumerate(active)}
    edges=sorted({tuple(sorted((mapping[root(a)],mapping[root(b)]))) for a,b in segments if root(a)!=root(b)})
    vs=[vertices[i] for i in active];degree=[0]*len(vs)
    for a,b in edges:degree[a]+=1;degree[b]+=1
    return {'vertices':[tuple(p) for p in vs],'edges':edges,'joined_contacts':joins,
            'junction_vertices':[i for i,d in enumerate(degree) if d>2],
            'endpoint_vertices':[i for i,d in enumerate(degree) if d==1]}


def bridge_evidence_gaps(graph, bm, response, scale, weak):
    """Join mutually facing tips only along a short, geometrically supported gap."""
    points=[Vector(p) for p in graph['vertices']];edges=[list(e) for e in graph['edges']]
    adj=[[] for _ in points]
    for a,b in edges:adj[a].append(b);adj[b].append(a)
    tips=[i for i,ns in enumerate(adj) if len(ns)==1]
    tris=bm.calc_loop_triangles();tree=BVHTree.FromPolygons([v.co for v in bm.verts],[tuple(l.vert.index for l in t) for t in tris],all_triangles=True)
    # Face-connected component IDs guard nearby independent layers.
    labels={};label=0
    for face in bm.faces:
        if face.index in labels:continue
        pending=[face];labels[face.index]=label
        while pending:
            for e in pending.pop().edges:
                for f in e.link_faces:
                    if f.index not in labels:labels[f.index]=label;pending.append(f)
        label+=1
    best={}
    for ii,a in enumerate(tips):
        for b in tips[ii+1:]:
            if graph.get('vertex_shells') is not None and graph['vertex_shells'][a]!=graph['vertex_shells'][b]:continue
            d=points[b]-points[a];distance=d.length
            if not scale*.001<distance<scale*.04:continue
            direction=d/distance
            ta=(points[a]-points[adj[a][0]]).normalized();tb=(points[b]-points[adj[b][0]]).normalized()
            if ta.dot(direction)<.7 or tb.dot(-direction)<.7:continue
            layer=None;normal=None;values=[];valid=True
            for j in range(7):
                p=points[a].lerp(points[b],j/6);hit=tree.find_nearest(p)
                if hit[0] is None or hit[3]>scale*.004:valid=False;break
                face=tris[hit[2]][0].face.index;sid=labels[face]
                if layer is not None and (sid!=layer or hit[1].dot(normal)<.5):valid=False;break
                layer=sid;normal=hit[1];values.append(response[face])
            if not valid or min(values)<weak*.6 or sum(values)/len(values)<weak:continue
            score=distance*(3-ta.dot(direction)-tb.dot(-direction))
            for i,k in ((a,b),(b,a)):
                if i not in best or score<best[i][0]:best[i]=(score,k)
    count=0
    for a,(score,b) in best.items():
        if a<b and best.get(b,(None,None))[1]==a:edges.append([a,b]);count+=1
    return dict(graph,edges=edges,evidence_gap_bridges=count)


def simplify_network(graph, scale, tolerance, iterations=8, allowance=.002, protect_corners=False):
    """Simplify whole chains between junctions, never each branch independently."""
    points=[Vector(p) for p in graph['vertices']];adj=[[] for _ in points]
    for a,b in graph['edges']:adj[a].append(b);adj[b].append(a)
    used=set();chains=[]
    starts=[i for i,ns in enumerate(adj) if len(ns)!=2]+[i for i,ns in enumerate(adj) if len(ns)==2]
    for start in starts:
        for neighbor in adj[start]:
            if tuple(sorted((start,neighbor))) in used:continue
            chain=[start];a,b=start,neighbor
            while True:
                used.add(tuple(sorted((a,b))));chain.append(b)
                if b==start or len(adj[b])!=2:break
                c=next(i for i in adj[b] if i!=a);a,b=b,c
            closed=chain[-1]==start
            if closed:chain.pop()
            chains.append((chain,closed))
    vertices=[];edges=[];junction_map={};max_move=0.;protected=0;new_shells=[]
    for ids,closed in chains:
        curve=[points[i] for i in ids]
        if len(curve)>2:
            fixed=[]
            if protect_corners and len(curve)>4:
                spacing=sorted((a-b).length for a,b in zip(curve,curve[1:]))
                window=min(max(1,len(curve)//4),max(1,round(scale*.012/max(spacing[len(spacing)//2],scale*1e-8))))
                turns=[0.]*len(curve)
                for i in range(len(curve)):
                    if not closed and (i<window or i>=len(curve)-window):continue
                    a=curve[i]-curve[(i-window)%len(curve)];b=curve[(i+window)%len(curve)]-curve[i]
                    if min(a.length,b.length)>1e-12:turns[i]=a.angle(b)
                fixed=[i for i,t in enumerate(turns) if t>math.radians(50) and all(t>=turns[j%len(curve)] for j in range(i-window,i+window+1) if closed or 0<=j<len(curve))]
            original_curve=[p.copy() for p in curve];protected+=len(fixed)
            curve=_cage_smooth(curve,closed,fixed,iterations,scale*allowance)
            max_move=max(max_move,max((a-b).length for a,b in zip(original_curve,curve)))
            stations=_simple_indices([curve],closed,fixed,scale*tolerance)
        else:stations=list(range(len(curve)))
        new=[]
        for j in stations:
            old=ids[j]
            if len(adj[old])!=2:
                if old not in junction_map:
                    junction_map[old]=len(vertices);vertices.append(points[old]);new_shells.append(graph['vertex_shells'][old] if graph.get('vertex_shells') is not None else None)
                index=junction_map[old]
            else:
                index=len(vertices);vertices.append(curve[j]);new_shells.append(graph['vertex_shells'][old] if graph.get('vertex_shells') is not None else None)
            new.append(index)
        edges.extend(zip(new,new[1:]+new[:1] if closed else new[1:]))
    degree=[0]*len(vertices)
    for a,b in edges:degree[a]+=1;degree[b]+=1
    return dict(graph,vertices=[tuple(p) for p in vertices],edges=[list(e) for e in edges],
                vertex_shells=new_shells if graph.get('vertex_shells') is not None else None,raw_vertex_count=len(points),max_smooth_displacement_relative=max_move/scale,protected_corner_count=protected,junction_vertices=[i for i,d in enumerate(degree) if d>2],
                endpoint_vertices=[i for i,d in enumerate(degree) if d==1])


def detect_network(bm, response, evidence, settings, weak, cutoff):
    if settings.get('network_path','TRACE')=='PLANES':
        from .plane_boundary import detect_plane_boundaries
        return detect_plane_boundaries(bm,evidence,settings,cutoff)
    if settings.get('network_path','TRACE')=='CELLS':
        from .cell_network import detect_cells
        return detect_cells(bm,response,evidence,settings,weak,cutoff)
    scale=evidence['curvature_scale'];signed=signed_curvature(bm,scale)
    tolerance=float(settings.get('network_simplify_error',.004))
    if not math.isfinite(tolerance) or not .0001<=tolerance<=.02:
        raise ValueError('结构线网简化预算必须为0.0001到0.02')
    # Area-weighted local smoothing reduces sign alternation from triangulation.
    areas=[sum(f.calc_area() for f in v.link_faces) for v in bm.verts]
    for _ in range(2):
        updated=[]
        for v in bm.verts:
            ids=[v.index]+[e.other_vert(v).index for e in v.link_edges]
            updated.append(sum(signed[i]*areas[i] for i in ids)/max(sum(areas[i] for i in ids),1e-30))
        signed=updated
    lines=[];bands=[]
    # Signed evidence prevents a concave scale valley from drifting to the
    # adjacent convex scale summit merely because its unsigned bend is stronger.
    for polarity in (-1,1):
        values=[]
        for face in bm.faces:
            value=sum(signed[v.index] for v in face.verts)/len(face.verts)
            values.append(response[face.index] if value*polarity>1e-6 else 0.)
        report=trace_boundaries(bm,values,evidence,dict(settings,trace_support=False,_local_structure_band=True),weak,cutoff)
        band=[dict(line,curvature_polarity=polarity) for line in report['lines']]
        lines.extend(band);bands.append({'polarity':polarity,'lines':len(band)})
    # No blanket duplicated support rails: the actual detected ridges/valleys
    # supply separate boundaries; pairing a real chamfer remains a later step.
    graph=join_endpoints(lines,bm,scale,scale*.008)
    graph=bridge_evidence_gaps(graph,bm,response,scale,weak)
    graph=simplify_network(graph,scale,tolerance)
    graph_lines=[]
    for a,b in graph['edges']:
        pa,pb=graph['vertices'][a],graph['vertices'][b]
        graph_lines.append({'role':'boundary','points':[pa,pb],'closed':False,
                            'length':(Vector(pa)-Vector(pb)).length,
                            'has_branch':a in graph['junction_vertices'] or b in graph['junction_vertices'],
                            'has_weak_evidence':True})
    return {'method':'NETWORK','status':'纯几何凹凸分离结构线网候选；未配对卡线、未铺面',
            'source_signature':evidence['signature'],'lines':graph_lines,'network':graph,
            'boundary_count':len(lines),'line_count':len(lines),'closed_count':sum(l['closed'] for l in lines),
            'support_count':0,'branch_vertices':graph['junction_vertices'],'endpoint_vertices':graph['endpoint_vertices'],
            'edge_indices':[],'requires_confirmation':True,'semantic_labels_used':False,
            'parameters':{'input':'source mesh geometry only','polarity_bands':bands,'join_radius_relative':.008,'simplify_error_relative':tolerance},
            'limitations':['参考图只用于研发比较，运行不读取图片或参考点','凹凸符号分离仍是局部几何线索，不是鳞片语义识别',
                           '线网可能断裂或错追，尚未自动恢复参考图完整拓扑','未识别倒角截面配对，不机械生成双线，未自动铺面']}
