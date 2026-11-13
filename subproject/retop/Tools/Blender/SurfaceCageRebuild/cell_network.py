"""Geometry-only relief watershed. A development experiment, no image inputs."""
import math
import statistics
from mathutils import Vector
from .structure_network import simplify_network


def relief_cells(bm, scale, settings):
    bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
    rounds=int(settings.get('network_relief_rounds',8))
    fraction=float(settings.get('network_relief_prominence',.24))
    if not 2<=rounds<=30 or not math.isfinite(fraction) or not .01<=fraction<=.8:
        raise ValueError('局部起伏参数超出范围')
    co=[v.co.copy() for v in bm.verts]
    center=sum(co,Vector())/max(len(co),1)
    co=[p-center for p in co]
    adjacency=[[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
    base=[p.copy() for p in co];normals=[v.normal.copy() for v in bm.verts]
    for _ in range(rounds):
        moved=[]
        for i,ns in enumerate(adjacency):
            allowed=[j for j in ns if normals[i].dot(normals[j])>.25]
            if not allowed:moved.append(base[i]);continue
            weights=[1/max((co[j]-co[i]).length,scale*1e-8) for j in allowed]
            avg=sum((base[j]*w for j,w in zip(allowed,weights)),Vector())/sum(weights)
            moved.append(base[i].lerp(avg,.5))
        base=moved
    values=[(p-b).dot(n)/scale for p,b,n in zip(co,base,normals)]
    sorted_values=sorted(values);n=len(values)
    span=sorted_values[int((n-1)*.95)]-sorted_values[int((n-1)*.05)]
    if span<1e-8:return [0]*n,{'regions':1,'relief_span':span,'prominence':0}
    # Quantize only sub-prominence noise after normalizing the local relief.
    # This prevents float32 object transforms from changing plateau tie order.
    values=[round(value/span,3) for value in values]
    threshold=fraction
    order=sorted(range(n),key=lambda i:(-values[i],i));rank={i:k for k,i in enumerate(order)}
    # Ascend to a local maximum, then suppress shallow maxima using persistence
    # of the upper excursion components. Deep saddles retain distinct cells.
    ascent=[min([i]+adjacency[i],key=lambda j:rank[j]) for i in range(n)]
    labels=[None]*n
    for i in order:labels[i]=i if ascent[i]==i else labels[ascent[i]]
    parent=list(range(n));peak=list(range(n));alive=set();death={};peak_parent={}
    def find(i):
        while parent[i]!=i:parent[i]=parent[parent[i]];i=parent[i]
        return i
    for i in order:
        alive.add(i)
        roots={find(j) for j in adjacency[i] if j in alive}
        roots.add(i);elder=min(roots,key=lambda r:rank[peak[r]])
        elder_peak=peak[elder]
        for r in roots:
            if r==elder:continue
            younger=peak[r]
            death[younger]=values[younger]-values[i];peak_parent[younger]=elder_peak
            parent[r]=elder
        peak[elder]=elder_peak
    def surviving(p):
        while p in peak_parent and round(death[p],6)<round(threshold,6):p=peak_parent[p]
        return p
    labels=[surviving(p) for p in labels]
    return labels,{'regions':len(set(labels)),'relief_span':span,'prominence':span*fraction,'relief_quantization_fraction':.001,
                   'raw_peaks':len(set(i for i in ascent if ascent[i]==i)),
                   'rounds':rounds,'prominence_fraction':fraction}


def filter_supported_chains(graph, confidence, threshold):
    """Select complete chains by geometric support before vector fairing.

    Unsupported regions are omitted. Short weak samples inside an otherwise
    supported chain do not cause a shower of independent fragments.
    """
    points=[Vector(p) for p in graph['vertices']];adj=[[] for _ in points]
    for a,b in graph['edges']:adj[a].append(b);adj[b].append(a)
    used=set();kept=[];accepted=rejected=0
    starts=[i for i,ns in enumerate(adj) if len(ns)!=2]+[i for i,ns in enumerate(adj) if len(ns)==2]
    for start in starts:
        for neighbor in adj[start]:
            if tuple(sorted((start,neighbor))) in used:continue
            path=[];a,b=start,neighbor
            while True:
                key=tuple(sorted((a,b)));used.add(key);path.append(key)
                if b==start or len(adj[b])!=2:break
                a,b=b,next(i for i in adj[b] if i!=a)
            weighted=supported=total=peak=0.
            for a,b in path:
                length=(points[a]-points[b]).length;score=confidence.get((a,b),0.)
                total+=length;weighted+=score*length;peak=max(peak,score)
                if score>=threshold:supported+=length
            if total>0 and weighted/total>=threshold and supported/total>=.6 and peak>=1:
                kept.extend(path);accepted+=1
            else:rejected+=1
    return dict(graph,edges=kept,accepted_chains=accepted,rejected_chains=rejected)


def contract_x_junctions(graph, scale):
    """Convert a short pair of opposing T nodes into one evidenced four-way node.

    Four distinct, approximately opposite spokes are required. A generic short
    edge or a three-way branch is not enough; no axis-aligned lattice is imposed.
    """
    vertices=[Vector(p) for p in graph['vertices']];edges={tuple(sorted(e)) for e in graph['edges']}
    adj=[set() for _ in vertices]
    for a,b in edges:adj[a].add(b);adj[b].add(a)
    aliases={};count=0
    for a,b in sorted(edges,key=lambda e:(vertices[e[0]]-vertices[e[1]]).length):
        if a in aliases or b in aliases or len(adj[a])!=3 or len(adj[b])!=3:continue
        if (vertices[a]-vertices[b]).length>scale*.012:continue
        spokes=list((adj[a]-{b})|(adj[b]-{a}))
        if len(spokes)!=4 or any(i in aliases for i in spokes):continue
        center=(vertices[a]+vertices[b])*.5
        dirs=[(vertices[i]-center).normalized() for i in spokes]
        good=False
        for j in (1,2,3):
            other=[i for i in (1,2,3) if i!=j]
            if dirs[0].dot(dirs[j])<-.75 and dirs[other[0]].dot(dirs[other[1]])<-.75 and abs(dirs[0].dot(dirs[other[0]]))<.8:good=True
        if not good:continue
        vertices[a]=center;aliases[b]=a;adj[a]=set(spokes)
        for i in spokes:adj[i].discard(b);adj[i].add(a)
        count+=1
    def resolve(i):
        while i in aliases:i=aliases[i]
        return i
    new_edges={tuple(sorted((resolve(a),resolve(b)))) for a,b in edges if resolve(a)!=resolve(b)}
    active=sorted({i for e in new_edges for i in e});ids={i:j for j,i in enumerate(active)}
    return dict(graph,vertices=[tuple(vertices[i]) for i in active],edges=[[ids[a],ids[b]] for a,b in sorted(new_edges)],contracted_x_junctions=count)


def detect_cells(bm, response, evidence, settings, weak, cutoff):
    scale=evidence['curvature_scale']
    labels,diagnostics=relief_cells(bm,scale,settings)
    # Flat or genuinely broad smooth surfaces have no narrow-turn seed.
    if max(response,default=0)<1:labels=[0]*len(labels);diagnostics['regions']=1
    vertices=[];edges=[];cache={};confidence={}
    def point(key,co):
        if key not in cache:cache[key]=len(vertices);vertices.append(tuple(co))
        return cache[key]
    for t,tri in enumerate(bm.calc_loop_triangles()):
        ids=[l.vert.index for l in tri];crossings=[]
        for a,b in zip(ids,ids[1:]+ids[:1]):
            if labels[a]!=labels[b]:
                crossings.append(point(('e',min(a,b),max(a,b)),(bm.verts[a].co+bm.verts[b].co)*.5))
        if len(crossings)==2:
            edges.append(crossings);confidence[tuple(sorted(crossings))]=response[tri[0].face.index]
        elif len(crossings)==3:
            center=point(('f',t),sum((bm.verts[i].co for i in ids),Vector())/3)
            for i in crossings:
                edges.append([i,center]);confidence[tuple(sorted((i,center)))]=response[tri[0].face.index]
    graph={'vertices':vertices,'edges':edges,'joined_contacts':0,'evidence_gap_bridges':0}
    tolerance=float(settings.get('network_simplify_error',.004))
    if not math.isfinite(tolerance) or not .0001<=tolerance<=.02:raise ValueError('线网简化预算无效')
    support=float(settings.get('network_boundary_support',.55))
    iterations=int(settings.get('network_vector_smoothing',12))
    allowance=float(settings.get('network_smooth_allowance',.004))
    if not math.isfinite(support) or not .1<=support<=2 or not 0<=iterations<=40 or not math.isfinite(allowance) or not 0<=allowance<=.02:
        raise ValueError('边界支持度或矢量平滑参数无效')
    graph=filter_supported_chains(graph,confidence,support)
    graph=simplify_network(graph,scale,tolerance,iterations,allowance,protect_corners=True)
    # Preserve selected junctions while fairing: no post-selection junction move.
    graph['contracted_x_junctions']=0
    degree=[0]*len(graph['vertices'])
    for a,b in graph['edges']:degree[a]+=1;degree[b]+=1
    graph['junction_vertices']=[i for i,d in enumerate(degree) if d>2]
    graph['endpoint_vertices']=[i for i,d in enumerate(degree) if d==1]
    remaining=set(range(len(degree)));components=0
    adjacency=[[] for _ in degree]
    for a,b in graph['edges']:adjacency[a].append(b);adjacency[b].append(a)
    while remaining:
        stack=[remaining.pop()];components+=1
        while stack:
            for j in adjacency[stack.pop()]:
                if j in remaining:remaining.remove(j);stack.append(j)
    graph['connected_components']=components
    graph['cycle_rank']=len(graph['edges'])-len(degree)+components
    lines=[{'role':'boundary','points':[graph['vertices'][a],graph['vertices'][b]],'closed':False,
            'length':(Vector(graph['vertices'][a])-Vector(graph['vertices'][b])).length,
            'has_branch':degree[a]>2 or degree[b]>2,'has_weak_evidence':True} for a,b in graph['edges']]
    return {'method':'NETWORK','status':'纯几何起伏分区边界候选；未确认结构语义','source_signature':evidence['signature'],
            'lines':lines,'network':graph,'boundary_count':len(lines),'line_count':len(lines),'closed_count':graph['cycle_rank'],
            'support_count':0,'branch_vertices':graph['junction_vertices'],'endpoint_vertices':graph['endpoint_vertices'],
            'edge_indices':[],'requires_confirmation':True,'semantic_labels_used':False,
            'parameters':dict(diagnostics,input='source mesh geometry only',path='RELIEF_CELLS',boundary_support=support,vector_smoothing=iterations,smooth_allowance_relative=allowance),
            'limitations':['连续区域边界不等于正确鳞片语义','可能将宽曲面过分区，不能据此自动铺面','只恢复结构线候选，未做倒角截面配对与全面自交检查']}
