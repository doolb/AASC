"""Four cubic neighborhood scales on ONE unchanged high-resolution mesh.

Every accepted edge must pass the same area-ratio AND curvature-difference
rule. No relief watershed, standalone crease angle or generated LOD is input.
"""
import heapq
import math

import bmesh
from mathutils import Vector

from . import analysis,shape_levels,turn_lines


LEVELS=('FAR','FAR_MID','MIDDLE','NEAR')
LABELS={'FAR':'远','FAR_MID':'远中','MIDDLE':'中','NEAR':'近'}


def _weighted_median(values):
    ordered=sorted(values);half=sum(w for _,w in ordered)*.5;total=0.
    for value,weight in ordered:
        total+=weight
        if total>=half:return value
    return ordered[-1][0]


def _side(seed,sign,origin,across,cube_lo,cube_hi,limit,arrays,budget):
    centers,normals,areas,neighbors,bounds,face_edges,hinges,edge_faces=arrays
    distances={seed:0.};queue=[(0.,seed)];patch={};reference=normals[seed]
    sigma=max((cube_hi-cube_lo).length*.3,1e-12)
    while queue:
        distance,index=heapq.heappop(queue)
        if distance!=distances[index]:continue
        budget[0]+=1
        if budget[0]>12000000:raise ValueError('四档边界邻域访问超过1200万预算，请分部件处理')
        # Seeds touch the tested edge even when their triangle center is far
        # away. Keep original triangle areas, not artificial clipped areas.
        spatial=min((centers[index]-origin).length,sigma*2)
        patch[index]=max(areas[index],1e-30)*math.exp(-.5*(spatial/sigma)**2)
        for other,cost in neighbors[index]:
            candidate=distance+cost
            if candidate>limit or candidate>=distances.get(other,math.inf):continue
            if normals[other].dot(reference)<=.5 or (centers[other]-origin).dot(across)*sign<=1e-10:continue
            low,high=bounds[other]
            if any(high[k]<cube_lo[k] or low[k]>cube_hi[k] for k in range(3)):continue
            distances[other]=candidate;heapq.heappush(queue,(candidate,other))
    # One hinge / two triangles observes only one direction. Treating its
    # zero response as a flat surface would turn a mere density jump on a
    # cylinder into an apparent curvature jump at small windows.
    if len(patch)<3:return None
    axis=reference.orthogonal().normalized();second=reference.cross(axis).normalized()
    aa=ab=bb=0.
    for index,weight in patch.items():
        offset=centers[index]-centers[seed];x=offset.dot(axis);y=offset.dot(second)
        aa+=weight*x*x;ab+=weight*x*y;bb+=weight*y*y
    if aa*bb-ab*ab<=1e-8*(aa+bb)**2:return None
    internal=set()
    for index in patch:
        for edge in face_edges[index]:
            pair=edge_faces[edge]
            if len(pair)==2 and all(i in patch for i in pair):internal.add(edge)
    # A missing same-side hinge is unknown, not evidence of zero curvature.
    if not internal:return None
    weight=sum(sum(patch[i] for i in edge_faces[e]) for e in internal)
    curvature=sum(hinges[e]*sum(patch[i] for i in edge_faces[e]) for e in internal)/max(weight,1e-30)
    area=_weighted_median([(areas[i],w) for i,w in patch.items()])
    return area,curvature,len(patch),len(internal)


def detect_four_boundaries(source,settings=None):
    options=settings or {}
    area_limit=float(options.get('boundary_area_ratio',2.))
    change_limit=float(options.get('boundary_curvature_change',.5))
    floor=float(options.get('boundary_curvature_floor',4.))
    divisions=(1,int(options.get('boundary_scale_far_mid',4)),
               int(options.get('boundary_scale_middle',16)),int(options.get('boundary_scale_near',64)))
    cutoff=float(options.get('turn_min_length',.03))
    if (not all(math.isfinite(v) for v in (area_limit,change_limit,floor,cutoff))
            or not 1.01<=area_limit<=100 or not .01<=change_limit<=1 or not .01<=floor<=1000
            or not 0<=cutoff<=1 or not 1<divisions[1]<divisions[2]<divisions[3]<=256):
        raise ValueError('四档面积比/曲率差或窗口参数无效')
    if not 1<=len(source.polygons)<=30000 or len(source.vertices)>30000:
        raise ValueError('四档边界预算为30000顶点/面，请分部件处理')
    if not all(math.isfinite(c) for v in source.vertices for c in v.co):raise ValueError('源网格坐标无效')
    signature=analysis.mesh_signature(source);owned=shape_levels._Meshes();bm=bmesh.new()
    try:
        normalized,_=shape_levels._frame(source,owned)
        evidence=analysis.analyze(normalized,options);health=evidence['health']
        if health['degenerate_faces'] or health['nonmanifold_edges'] or health['nonmanifold_vertices']:
            raise ValueError('四档边界需要无退化、无非流形的源表面')
        bm.from_mesh(normalized);bm.normal_update()
        bm.faces.ensure_lookup_table();bm.edges.ensure_lookup_table();bm.verts.ensure_lookup_table()
        centers=[f.calc_center_median() for f in bm.faces];normals=[f.normal.copy() for f in bm.faces]
        areas=[f.calc_area() for f in bm.faces];scale=evidence['curvature_scale']
        neighbors=[[] for _ in bm.faces];edge_faces=[];hinges=[];face_edges=[[e.index for e in f.edges] for f in bm.faces]
        bounds=[(Vector(tuple(min(v.co[k] for v in f.verts) for k in range(3))),
                 Vector(tuple(max(v.co[k] for v in f.verts) for k in range(3)))) for f in bm.faces]
        candidates=[]
        for edge in bm.edges:
            ids=[f.index for f in edge.link_faces];edge_faces.append(ids)
            if len(ids)!=2:hinges.append(0.);continue
            a,b=ids;cost=(centers[a]-centers[b]).length
            neighbors[a].append((b,cost));neighbors[b].append((a,cost))
            tangent=(edge.verts[1].co-edge.verts[0].co).normalized()
            transverse=sum((centers[i]-edge.verts[0].co).cross(tangent).length for i in ids)
            hinges.append(normals[a].angle(normals[b],0.)*scale/max(transverse,scale*1e-12))
            direct=max(areas[a],areas[b])/max(min(areas[a],areas[b]),1e-30)
            if direct>=area_limit:candidates.append((edge.index,direct))
        arrays=(centers,normals,areas,neighbors,bounds,face_edges,hinges,edge_faces)
        low=Vector(tuple(min(v.co[k] for v in bm.verts) for k in range(3)))
        high=Vector(tuple(max(v.co[k] for v in bm.verts) for k in range(3)))
        length=max(high-low);global_center=(low+high)*.5;grid_origin=global_center-Vector((length,)*3)*.5
        budget=[0];results={}
        for level,division in zip(LEVELS,divisions):
            width=length/division;accepted=set();metrics={};unresolved=[];rejected_area=0;rejected_curvature=0
            before=budget[0]
            for index,direct in candidates:
                edge=bm.edges[index];a,b=edge_faces[index]
                origin=(edge.verts[0].co+edge.verts[1].co)*.5
                normal=normals[a]+normals[b]
                if normal.length<1e-8:unresolved.append(index);continue
                tangent=(edge.verts[1].co-edge.verts[0].co).normalized();across=normal.normalized().cross(tangent).normalized()
                signs=[(centers[i]-origin).dot(across) for i in (a,b)]
                if signs[0]*signs[1]>=0 or min(abs(s) for s in signs)<1e-10:
                    unresolved.append(index);continue
                if level=='FAR':
                    cube_lo,cube_hi=grid_origin,grid_origin+Vector((length,)*3);limit=scale*2
                else:
                    center=Vector(tuple(grid_origin[k]+(math.floor((origin[k]-grid_origin[k])/width)+.5)*width for k in range(3)))
                    cube_lo=center-Vector((width*1.5,)*3);cube_hi=center+Vector((width*1.5,)*3);limit=width*3
                sides=[_side(seed,sign,origin,across,cube_lo,cube_hi,limit,arrays,budget)
                       for seed,sign in zip((a,b),signs)]
                if any(side is None for side in sides):unresolved.append(index);continue
                ratio=max(s[0] for s in sides)/max(min(s[0] for s in sides),1e-30)
                curvature=[s[1] for s in sides];lo,hi=sorted(curvature);change=(hi-lo)/max(hi,floor)
                if ratio<area_limit:rejected_area+=1;continue
                if not turn_lines.contrast_passes(direct,ratio,curvature,area_limit,change_limit,floor):
                    rejected_curvature+=1;continue
                accepted.add(index)
                metrics[str(index)]={'adjacent_area_ratio':direct,'area_ratio':ratio,'curvature_change':change,
                                     'side_curvatures':curvature,'side_faces':[s[2] for s in sides],
                                     'side_internal_hinges':[s[3] for s in sides]}
            retained,discarded=turn_lines._long_components(bm,accepted,cutoff*scale)
            results[level]={'label':LABELS[level],'source_signature':signature,'edge_indices':sorted(retained),
                            'contrast_metrics':{str(i):metrics[str(i)] for i in sorted(retained)},
                            'unresolved_edges':unresolved,'before_length_filter':len(accepted),'discarded_short_components':discarded,
                            'rejected_patch_area':rejected_area,'rejected_curvature':rejected_curvature,
                            'window':{'divisions':division,'cells':1 if level=='FAR' else 27,
                                      'diameter_over_longest_dimension':1. if level=='FAR' else 3/division,
                                      'topology_gate':'face adjacency + seed normal hemisphere + edge half-space'},
                            'face_visits':budget[0]-before}
        if analysis.mesh_signature(source)!=signature:raise AssertionError('四档判断修改了原几何')
        return {'method':'FOUR_SCALE_AREA_CURVATURE','status':'同一高模的四尺度严格边界候选；未保证闭合',
                'source_signature':signature,'source_faces':len(source.polygons),'source_edges':len(source.edges),
                'rule':'adjacent_area AND window_area AND curvature_difference AND curvature_floor',
                'thresholds':{'area_ratio':area_limit,'curvature_change':change_limit,'curvature_floor':floor},
                'sampling':{'area':'physical-area/Gaussian weighted median of original face areas',
                            'curvature':'weighted mean of internal hinges; tested hinge excluded'},
                'levels':results,'direct_area_candidates':len(candidates),'total_face_visits':budget[0],
                'standalone_angle_edges':0,'relief_regions_used':False,'candidate_meshes_used':False,
                'camera_used':False,'images_used':False,'source_frame':'area principal frame; longest dimension normalized'}
    finally:
        bm.free();owned.close()
