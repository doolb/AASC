"""Geometric evidence on an unchanged mesh. No object names or preferred axes."""
import hashlib
import heapq
import math
import statistics
import struct
from collections import Counter

import bmesh
from mathutils import Vector


def mesh_signature(mesh):
    digest = hashlib.sha256()
    for v in mesh.vertices:
        digest.update(struct.pack('<3d', *v.co))
    for p in mesh.polygons:
        digest.update(struct.pack('<I', len(p.vertices)))
        digest.update(struct.pack('<' + 'I' * len(p.vertices), *p.vertices))
    return digest.hexdigest()


def size(mesh):
    if not mesh.vertices:
        return 0.0
    return (Vector([max(v.co[k] for v in mesh.vertices) for k in range(3)]) -
            Vector([min(v.co[k] for v in mesh.vertices) for k in range(3)])).length


def _components(neighbors, allowed=None):
    labels = [-1] * len(neighbors)
    component = 0
    for start in range(len(labels)):
        if labels[start] >= 0:
            continue
        labels[start] = component
        stack = [start]
        while stack:
            current = stack.pop()
            for other, edge in neighbors[current]:
                if labels[other] < 0 and (allowed is None or allowed[edge]):
                    labels[other] = component
                    stack.append(other)
        component += 1
    return labels


def _weighted_median(values, weights):
    ordered = sorted(zip(values, weights))
    half = sum(weights) * .5
    accumulated = 0.0
    for value, weight in ordered:
        accumulated += weight
        if accumulated >= half:
            return value
    return ordered[-1][0]


def _seed_partition(neighbors, centers, scores, curvature, density, locks, seeds, scale):
    """Two best different seed labels on a positive-cost surface graph.

    Seeds are immutable; hard locks cannot be crossed. Unknown components stay
    zero, rather than silently inheriting a label from another shell.
    """
    best = [[] for _ in neighbors]
    queue = [(0.0, label, i) for i, label in enumerate(seeds) if label > 0]
    heapq.heapify(queue)
    while queue:
        distance, label, i = heapq.heappop(queue)
        if seeds[i] > 0 and seeds[i] != label:
            continue
        if any(old_label == label for _, old_label in best[i]) or len(best[i]) == 2:
            continue
        best[i].append((distance, label))
        for j, edge in neighbors[i]:
            if locks[edge] or len(best[j]) == 2:
                continue
            if any(old_label == label for _, old_label in best[j]):
                continue
            geometric = scores[edge] + abs(math.log1p(curvature[i])-math.log1p(curvature[j]))
            # Density reinforces geometry only. Distance is measured in source units.
            cost = max((centers[i]-centers[j]).length/scale, 1e-12)
            cost *= 1 + 12 * geometric * (1 + min(density[edge]-1, 1)*.25)
            heapq.heappush(queue, (distance+cost, label, j))
    labels = [entries[0][1] if entries else 0 for entries in best]
    margin = [(entries[1][0]-entries[0][0])/max(entries[1][0],1e-12)
              if len(entries)>1 else (1.0 if entries else 0.0) for entries in best]
    return labels, margin


def analyze(mesh, settings):
    """Return JSON-safe face/edge arrays; inputs are never modified.

    Density is deliberately capped below a blocking feature score. A density
    change alone cannot cut a perfectly planar or smoothly sampled surface.
    """
    if not mesh.polygons:
        raise ValueError('网格没有面')
    if len(mesh.polygons) > settings.get('face_limit', 300000):
        raise ValueError('超过当前交互分析上限；请先按独立物件拆分')
    try:
        area_percent = float(settings.get('density_area_percent', 100.0))
    except (ValueError, TypeError) as error:
        raise ValueError('面积尺度占比必须是 0–100 的有限数值') from error
    if not math.isfinite(area_percent) or not 0 <= area_percent <= 100:
        raise ValueError('面积尺度占比必须是 0–100 的有限数值')
    area_weight = area_percent / 100.0
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        bm.normal_update()
        bm.faces.ensure_lookup_table()
        bm.edges.ensure_lookup_table()
        bm.verts.ensure_lookup_table()
        faces, edges = list(bm.faces), list(bm.edges)
        scale = size(mesh)
        epsilon = max(scale * 1e-10, 1e-15)
        areas = [f.calc_area() for f in faces]
        normals = [f.normal.copy() for f in faces]
        neighbors = [[] for _ in faces]
        for e in edges:
            if len(e.link_faces) == 2:
                a, b = e.link_faces
                neighbors[a.index].append((b.index, e.index))
                neighbors[b.index].append((a.index, e.index))
        vertex_spacing = ([statistics.median([e.calc_length() for e in v.link_edges])
                           if v.link_edges else epsilon for v in bm.verts]
                          if area_weight < 1 else None)
        log_spacing = []
        for f in faces:
            # Both inputs are lengths. Blend in log space: 50% reproduces
            # the original geometric mean, 100% removes edge-length evidence.
            area_spacing = math.sqrt(max(areas[f.index], epsilon ** 2))
            value = area_weight * math.log(area_spacing)
            if vertex_spacing is not None:
                median = statistics.median(vertex_spacing[v.index] for v in f.verts)
                value += (1-area_weight) * math.log(max(median,epsilon))
            log_spacing.append(value)
        rounds = int(settings.get('analysis_rings', 2))
        smooth_normals = [n.copy() for n in normals]
        for _ in range(rounds):
            new_spacing, new_normals = [], []
            for i, adjacent in enumerate(neighbors):
                ids = [i] + [j for j, _ in adjacent]
                new_spacing.append(.5 * log_spacing[i] + .5 * statistics.median(log_spacing[j] for j in ids))
                value = sum((smooth_normals[j] * areas[j] for j in ids), Vector())
                new_normals.append(value.normalized() if value.length > epsilon ** 2 else normals[i])
            log_spacing, smooth_normals = new_spacing, new_normals
        bend = [0.0] * len(faces)
        for i, adjacent in enumerate(neighbors):
            if adjacent:
                bend[i] = sum(normals[i].angle(normals[j], 0) for j, _ in adjacent) / len(adjacent)
        threshold = math.radians(settings.get('feature_angle', 28.0))
        density_weight = min(max(settings.get('density_weight', .25), 0), .45)
        scores, angles, density_change, allowed = [], [], [], []
        for e in edges:
            if len(e.link_faces) != 2:
                scores.append(1.0); angles.append(0.0); density_change.append(1.0); allowed.append(False)
                continue
            a, b = (f.index for f in e.link_faces)
            angle = normals[a].angle(normals[b], 0)
            density = abs(log_spacing[a] - log_spacing[b])
            change = abs(bend[a] - bend[b])
            geometric = max(angle / max(threshold, .001),
                            change / max(threshold * .6, .001) * min(angle / max(threshold * .2, .001), 1))
            # Density may reinforce a real bend, but does not invent one.
            score = min(1.0, geometric * (1 + density_weight * min(density / .25, 1)))
            scores.append(score); angles.append(angle); density_change.append(math.exp(density))
            allowed.append(score < 1.0)
        # Normal variation per physical distance distinguishes a narrow smooth
        # bevel from a broad bend even when every dihedral is below threshold.
        # Area-weighted statistics keep dense tessellation from setting the scale.
        centers = [f.calc_center_median() for f in faces]
        total_area = sum(areas)
        center = sum((p*a for p,a in zip(centers,areas)),Vector())/max(total_area,epsilon**2)
        feature_scale = max(2*max((v.co-center).length for v in bm.verts),epsilon)
        curvature = []
        for i, adjacent in enumerate(neighbors):
            ids = {j for j, _ in adjacent}
            ids.update(k for j, _ in adjacent for k, _ in neighbors[j] if k != i)
            normal = smooth_normals[i]
            tangents = [centers[j]-centers[i] for j in ids]
            tangents = [d-normal*d.dot(normal) for d in tangents]
            axis = max(tangents, key=lambda d:d.length_squared, default=Vector())
            if axis.length <= epsilon:
                curvature.append(0.0)
                continue
            u = axis.normalized(); v = normal.cross(u).normalized()
            aa = ab = bb = 0.0; da = Vector(); db = Vector()
            for j in ids:
                delta = centers[j]-centers[i]
                x, y = delta.dot(u), delta.dot(v)
                weight = 1/max(delta.length_squared, epsilon**2)
                dn = smooth_normals[j]-normal
                aa += weight*x*x; ab += weight*x*y; bb += weight*y*y
                da += dn*(weight*x); db += dn*(weight*y)
            determinant = aa*bb-ab*ab
            if determinant > 1e-10*(aa+bb)**2:
                du=(da*bb-db*ab)/determinant; dv=(db*aa-da*ab)/determinant
                curvature.append(math.sqrt(du.length_squared+dv.length_squared)*feature_scale)
            else:
                curvature.append(0.0)
        for _ in range(1):
            curvature = [statistics.median([curvature[i]]+[curvature[j] for j, _ in adj])
                         for i, adj in enumerate(neighbors)]
        baseline = _weighted_median(curvature, areas)
        band_threshold = max(settings.get('curvature_floor', 4.0),
                             baseline * settings.get('curvature_ratio', 2.5))
        turn_band = [value > band_threshold for value in curvature]
        lock_layer = bm.edges.layers.int.get('scr_locked')
        locks = [bool(e[lock_layer]) for e in edges] if lock_layer else [False]*len(edges)
        seed_layer = bm.faces.layers.int.get('scr_seed')
        seeds = [f[seed_layer] for f in faces] if seed_layer else [0]*len(faces)
        seed_labels, margin = [0]*len(faces), [0.0]*len(faces)
        seeded = any(label > 0 for label in seeds)
        if seeded:
            seed_labels, margin = _seed_partition(neighbors, centers, scores, curvature,
                                                  density_change, locks, seeds, max(scale,epsilon))
        for e in edges:
            if len(e.link_faces) != 2:
                continue
            a, b = (f.index for f in e.link_faces)
            allowed[e.index] = (not locks[e.index] and
                (seed_labels[a] == seed_labels[b] if seeded else
                 allowed[e.index] and turn_band[a] == turn_band[b]))
        regions = _components(neighbors, allowed)
        # A strong edge whose two sides can reach each other is a measurable
        # open barrier, not a successfully identified closed structural region.
        leaked = [e.index for e in edges if len(e.link_faces)==2 and scores[e.index]>=1
                  and regions[e.link_faces[0].index]==regions[e.link_faces[1].index]]
        unresolved = [i for i in range(len(faces)) if seeded and
                      (seed_labels[i] == 0 or margin[i] < settings.get('seed_margin', .08))]
        shells = _components(neighbors)
        shell_topology=[]
        bad_vertices=0
        for v in bm.verts:
            incident=set(v.link_faces)
            if not incident:continue
            reached={next(iter(incident))};pending=list(reached)
            while pending:
                f=pending.pop()
                for e in f.edges:
                    if v not in e.verts:continue
                    for other in e.link_faces:
                        if other not in reached:reached.add(other);pending.append(other)
            if reached!=incident or sum(e.is_boundary for e in v.link_edges) not in (0,2):bad_vertices+=1
        for shell in sorted(set(shells)):
            sf=[f for f in faces if shells[f.index]==shell]
            se={e for f in sf for e in f.edges};sv={v for f in sf for v in f.verts}
            remaining={e for e in se if e.is_boundary};loops=0;branched=False
            while remaining:
                edge=remaining.pop();stack=[edge];loops+=1
                while stack:
                    edge=stack.pop()
                    for vertex in edge.verts:
                        boundary=[e for e in vertex.link_edges if e.is_boundary]
                        if len(boundary)!=2:branched=True
                        for other in boundary:
                            if other in remaining:remaining.remove(other);stack.append(other)
            shell_topology.append((len(sv)-len(se)+len(sf),loops,int(branched)))
        counts = Counter(regions)
        region_areas = Counter()
        for region, area in zip(regions, areas):
            region_areas[region] += area
        # Classification is evidence, not claimed semantic identification.
        classes = []
        for i in range(len(faces)):
            if bend[i] > threshold * .6:
                classes.append(2)  # turn/detail candidate
            elif bend[i] > threshold * .12:
                classes.append(1)  # broad curved candidate
            else:
                classes.append(0)  # near-flat candidate
        return {
            'signature': mesh_signature(mesh), 'scale': scale,
            'regions': regions, 'shell_ids': shells, 'classes': classes,
            'spacing': [math.exp(x) / max(scale, epsilon) for x in log_spacing],
            'bend': bend, 'scores': scores, 'angles': angles,
            'density_change': density_change,
            'density_scale_mix': {'area_percent': area_percent, 'edge_percent': 100-area_percent,
                                  'method': 'weighted_geometric_mean', 'smoothing_rings': rounds},
            'curvature': curvature, 'turn_band': turn_band,
            'curvature_threshold': band_threshold, 'curvature_baseline': baseline,
            'curvature_scale': feature_scale,
            'seed_labels': seed_labels, 'seed_margin': margin,
            'unresolved_faces': unresolved, 'leaked_feature_edges': leaked,
            'partition_method': 'SEED_COMPETITION' if seeded else 'MULTISCALE_BANDS',
            'partition_requires_confirmation': True,
            'regions_count': len(counts),
            'region_faces': dict(counts), 'region_areas': dict(region_areas),
            'health': {
                'shells': len(set(shells)),
                'boundary_edges': sum(e.is_boundary for e in edges),
                'nonmanifold_edges': sum(len(e.link_faces) > 2 or len(e.link_faces) == 0 for e in edges),
                'nonmanifold_vertices':bad_vertices,
                'shell_topology':sorted(shell_topology),
                'degenerate_faces': sum(a < epsilon ** 2 for a in areas),
                'loose_vertices': sum(not v.link_faces for v in bm.verts),
                'vertices': len(bm.verts), 'faces': len(faces),
                'triangles': sum(len(f.verts) - 2 for f in faces),
            },
            'status': '候选分区；密度和转折响应均不是已确认的结构边界',
        }
    finally:
        bm.free()
