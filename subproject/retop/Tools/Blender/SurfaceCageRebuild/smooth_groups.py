"""Infer candidate smoothing regions from geometric boundaries on a COPY.

Region IDs are connected face labels, not recovered historical smoothing masks.
Open barriers are reported explicitly and do not silently become hard seams.
"""
from collections import Counter
import hashlib
import math
import struct

import bpy
import bmesh

from . import analysis, multiscale_boundaries


GROUP_ATTRIBUTE='scr_smooth_group'
UNCERTAIN_ATTRIBUTE='scr_smooth_uncertain'
BOUNDARY_ATTRIBUTE='scr_smooth_boundary'


def preview_signature(mesh):
    """Preserve manual face grouping, sharp flags, normals and rewiring too."""
    digest=hashlib.sha256(analysis.mesh_signature(mesh).encode())
    for edge in mesh.edges:
        digest.update(struct.pack('<2I?',*edge.vertices,edge.use_edge_sharp))
    for face in mesh.polygons:digest.update(struct.pack('<?',face.use_smooth))
    for name in (GROUP_ATTRIBUTE,UNCERTAIN_ATTRIBUTE,BOUNDARY_ATTRIBUTE):
        attr=mesh.attributes.get(name)
        digest.update(name.encode())
        if attr:
            for item in attr.data:digest.update(struct.pack('<i',item.value))
    for normal in mesh.corner_normals:
        digest.update(struct.pack('<3d',*(round(c,6) for c in normal.vector)))
    return digest.hexdigest()


def _partition(adjacency,barriers):
    labels=[0]*len(adjacency);count=0
    for start in range(len(labels)):
        if labels[start]:continue
        count+=1;labels[start]=count;stack=[start]
        while stack:
            current=stack.pop()
            for following,edge in adjacency[current]:
                if edge not in barriers and not labels[following]:
                    labels[following]=count;stack.append(following)
    return labels,count


def _options(settings):
    options=settings or {}
    if options.get('smooth_group_method','BOUNDARIES') not in {'BOUNDARIES','MULTISCALE'}:
        raise ValueError('平滑组只接受四档面积比＋曲率差边界；起伏分区已停用')
    minimum=float(options.get('smooth_min_area',.002))
    if not math.isfinite(minimum) or not 0<=minimum<=.1:raise ValueError('碎组面积参数无效')
    level=options.get('smooth_boundary_level','NEAR')
    if level not in multiscale_boundaries.LEVELS:raise ValueError('平滑组边界档位无效')
    return options,minimum,level


def _make_preview(source,level,common,minimum,requested=None):
    evidence=common['levels'][level];detected=set(evidence['edge_indices'])
    rejected=[]
    if requested is not None:
        rejected=sorted(set(requested)-detected);detected.intersection_update(requested)
    bm=bmesh.new();preview=None
    try:
        bm.from_mesh(source);bm.edges.ensure_lookup_table();bm.faces.ensure_lookup_table()
        adjacency=[[] for _ in bm.faces];open_edges=[]
        for edge in bm.edges:
            if len(edge.link_faces)==2:
                a,b=(f.index for f in edge.link_faces)
                adjacency[a].append((b,edge.index));adjacency[b].append((a,edge.index))
            elif edge.is_boundary:open_edges.append(edge.index)
        labels,count=_partition(adjacency,detected);confirmed=[];leaked=[]
        for index in sorted(detected):
            a,b=bm.edges[index].link_faces
            (confirmed if labels[a.index]!=labels[b.index] else leaked).append(index)
        areas=Counter();sizes=Counter(labels)
        for face,label in zip(bm.faces,labels):areas[label]+=face.calc_area()
        total=sum(areas.values());small={label for label,area in areas.items() if area<total*minimum}
        leaking_groups={labels[f.index] for i in leaked for f in bm.edges[i].link_faces};uncertain=small|leaking_groups
        diagnostics=[{'id':label,'faces':sizes[label],'area_fraction':areas[label]/total,
                      'small_fragment':label in small,'contains_leaked_boundary':label in leaking_groups,
                      'candidate_uncertain':label in uncertain} for label in range(1,count+1)]
        preview=source.copy();preview.name='SCR_StrictSmoothGroups_'+level
        confirmed_set=set(confirmed);leaked_set=set(leaked)
        for name,domain,values in (
            (GROUP_ATTRIBUTE,'FACE',labels),(UNCERTAIN_ATTRIBUTE,'FACE',[int(label in uncertain) for label in labels]),
            (BOUNDARY_ATTRIBUTE,'EDGE',[1 if i in confirmed_set else 2 if i in leaked_set else 0 for i in range(len(preview.edges))])):
            attr=preview.attributes.get(name)
            if attr:preview.attributes.remove(attr)
            attr=preview.attributes.new(name,'INT',domain);attr.data.foreach_set('value',values)
        for face in preview.polygons:face.use_smooth=True
        for edge in preview.edges:edge.use_edge_sharp=edge.index in confirmed_set
        preview.normals_split_custom_set([(0.,0.,0.)]*len(preview.loops));preview.update()
        _,native_count=preview.calc_smooth_groups(use_bitflags=False)
        if native_count!=count:raise ValueError('严格边界分组与Blender实际平滑区域不一致')
        if analysis.mesh_signature(preview)!=common['source_signature']:raise AssertionError('分组预览修改了几何')
        return preview,{'method':'BOUNDARY_SMOOTH_GROUPS','boundary_source':'FOUR_SCALE_AREA_CURVATURE','boundary_level':level,
                        'status':'面积比＋曲率差严格边界的平滑组候选；未保证闭合',
                        'source_signature':common['source_signature'],'groups_count':count,'native_smooth_regions':native_count,
                        'groups':diagnostics,'source_face_count':len(labels),'face_labels':labels,
                        'detected_boundary_edges':sorted(detected),'geometric_crease_edges':[],
                        'confirmed_boundary_edges':confirmed,'leaked_boundary_edges':leaked,'source_open_edges':open_edges,
                        'uncertain_groups':sorted(uncertain),'small_groups':sorted(small),'candidate_edges':len(detected),
                        'actual_sharp_edges':len(confirmed),'minimum_group_area_fraction':minimum,
                        'thresholds':common['thresholds'],'window':evidence['window'],
                        'rejected_requested_edges':rejected,'standalone_angle_edges':0,'relief_regions_used':False,
                        'custom_normals_policy':'automatic on preview; source unchanged',
                        'group_semantics':'connected regions separated only by verified area AND curvature edges',
                        'images_used':False,'camera_used':False,'semantic_acceptance':False}
    except Exception:
        if preview is not None and preview.users==0:bpy.data.meshes.remove(preview)
        raise
    finally:bm.free()


def infer_four_groups(source,settings=None):
    options,minimum,_=_options(settings);meshes={};reports={}
    common=multiscale_boundaries.detect_four_boundaries(source,options)
    try:
        for level in multiscale_boundaries.LEVELS:
            meshes[level],reports[level]=_make_preview(source,level,common,minimum)
        return meshes,{'method':'FOUR_SCALE_STRICT_GROUPS','source_signature':common['source_signature'],
                       'boundary_analysis':common,'levels':reports,
                       'status':'同一高模四档面积比＋曲率差边界；分组仍需检查'}
    except Exception:
        for mesh in meshes.values():
            if mesh.users==0:bpy.data.meshes.remove(mesh)
        raise


def infer_groups(source,settings=None,boundary_edges=None):
    """One selected scale. Supplied IDs are revalidated, never a bypass."""
    options,minimum,level=_options(settings)
    if boundary_edges is not None:
        boundary_edges=list(boundary_edges)
        if any(isinstance(i,bool) or not isinstance(i,int) or not 0<=i<len(source.edges) for i in boundary_edges):
            raise ValueError('边界索引不属于当前源网格')
    common=multiscale_boundaries.detect_four_boundaries(source,options)
    preview,report=_make_preview(source,level,common,minimum,boundary_edges)
    report['four_scale_boundary_report']=common
    return preview,report

