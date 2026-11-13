"""One traced line per structural boundary, plus the two chamfer support lines beside it."""
import math
import statistics

from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

UNIT = (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))


class _Surface:
    """Nearest-point queries returning vertex-interpolated normal and strength."""

    def __init__(self, bm, strength):
        self.co = [v.co.copy() for v in bm.verts]
        self.normals = [v.normal.copy() for v in bm.verts]
        self.tris = [tuple(loop.vert.index for loop in tri) for tri in bm.calc_loop_triangles()]
        self.tree = BVHTree.FromPolygons(self.co, self.tris, all_triangles=True)
        self.strength = strength

    def query(self, point):
        location, face_normal, index, _ = self.tree.find_nearest(point)
        if location is None:
            return None
        a, b, c = self.tris[index]
        w = barycentric_transform(location, self.co[a], self.co[b], self.co[c], *UNIT)
        normal = self.normals[a] * w.x + self.normals[b] * w.y + self.normals[c] * w.z
        if normal.length < 1e-9:
            normal = face_normal
        strength = w.x * self.strength[a] + w.y * self.strength[b] + w.z * self.strength[c]
        return location, normal.normalized(), strength


class _Grid:
    """Uniform hash grid; nearest() is exact for radius <= cell."""

    def __init__(self, cell):
        self.cell, self.cells = cell, {}

    def _key(self, point):
        return tuple(math.floor(c / self.cell) for c in point)

    def add(self, point, payload=None):
        self.cells.setdefault(self._key(point), []).append((point.copy(), payload))

    def nearest(self, point, radius):
        kx, ky, kz = self._key(point)
        best, limit = None, radius
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for other, payload in self.cells.get((kx + dx, ky + dy, kz + dz), ()):
                        distance = (other - point).length
                        if distance < limit:
                            best, limit = (other, payload), distance
        return best


class _Params:
    def __init__(self, scale, weak, smoothing):
        self.step = scale * .006
        self.width = scale * .02
        self.samples = 8
        self.sigma = self.width * .5
        self.weak = weak
        self.seed = 1.0
        self.max_gap = 8
        self.inertia = .35
        self.max_steps = 5000
        self.corner_angle = math.radians(40)
        self.window = max(2, round(self.width / self.step))
        self.smoothing = smoothing


def _tangent(vector, normal):
    vector = vector - normal * vector.dot(normal)
    return vector.normalized() if vector.length > 1e-12 else None


def _refine(surface, point, normal, tangent, p):
    """Centre of the strength band across the predicted path: (location, normal, peak, half-widths, band points)."""
    lateral = normal.cross(tangent)
    if lateral.length < 1e-9:
        return None
    lateral.normalize()
    k, dw = p.samples, p.width / p.samples
    cache = {}

    def sample(i):
        if i not in cache:
            hit = surface.query(point + lateral * (i * dw))
            # A sample whose normal turns away has crossed onto another layer.
            cache[i] = hit if hit and hit[1].dot(normal) > -.2 else None
        return cache[i]

    def score(i):
        hit = sample(i)
        return hit[2] * math.exp(-.5 * (i * dw / p.sigma) ** 2) if hit else None

    scored = [(score(i), i) for i in range(-k, k + 1) if sample(i)]
    if not scored:
        return None
    best = max(scored)[1]
    peak = sample(best)[2]
    # A flat or two-peaked chamfer band still yields one line at its centre.
    edges = []
    for direction in (-1, 1):
        i = best
        while abs(i + direction) <= k * getattr(p, 'band_extent', 4):
            following = sample(i + direction)
            if following is None or following[2] < peak * .4:
                break
            i += direction
        edges.append(i)
    centre = (edges[0] + edges[1]) * .5
    hit = sample(int(centre)) if centre == int(centre) else surface.query(point + lateral * (centre * dw))
    if hit is None:
        return None
    half = ((edges[1] - edges[0]) * .5 + .5) * dw
    band = [sample(i)[0] for i in range(edges[0], edges[1] + 1) if sample(i)]
    return hit[0], hit[1], peak, (half, half), band


def _fan(surface, point, normal, tangent, p):
    """Re-acquire the ridge after a corner: the strongest nearby turn, mildly preferring small ones."""
    best = None
    for angle in (25, -25, 50, -50, 75, -75, 100, -100):
        direction = _tangent(Matrix.Rotation(math.radians(angle), 3, normal) @ tangent, normal)
        probe = surface.query(point + direction * p.step) if direction else None
        if probe is None:
            continue
        candidate = _refine(surface, probe[0], probe[1], direction, p)
        if candidate and candidate[2] >= p.weak:
            value = candidate[2] * (.75 + .25 * math.cos(math.radians(angle)))
            if best is None or value > best[0]:
                best = value, candidate
    return best[1] if best else None


def _trace(surface, start, normal, tangent, p, guard):
    """Follow the strength ridge; guard(point) returns ('line', point) or ('self', index) to stop."""
    points, peaks, widths, band = [start], [], [], []
    point, gap, tail, travelled = start, 0, 0, 0.
    closed, stop = False, None
    for count in range(p.max_steps):
        ahead = surface.query(point + tangent * p.step)
        if ahead is None:
            break
        step, turned = _refine(surface, ahead[0], ahead[1], tangent, p), False
        if step is None or step[2] < p.weak:
            step, turned = _fan(surface, point, normal, tangent, p), True
        if step is None or step[2] < p.weak:
            gap, turned = gap + 1, False
            if gap > p.max_gap:
                break
            step = ahead[0], ahead[1], ahead[2], None, ()
        else:
            gap = 0
        location, location_normal, peak, width, covered = step
        move = location - point
        if move.length < p.step * .2 or move.normalized().dot(tangent) < -.2:
            break
        if travelled > p.width * 6 and min((location - x).length for x in points[:4]) < p.step * 2:
            closed = True
            break
        stop = guard(location)
        if stop is not None:
            if stop[0] == 'line':
                points.append(stop[1]); peaks.append(peak); widths.append(width)
            break
        if count % 4 == 0 and travelled > p.width * 6:
            older = points[:-p.window * 3]
            if older and min((location - x).length for x in older) < p.width * .4:
                break
        measured = move.normalized()
        blended = measured if turned else tangent * (1 - p.inertia) + measured * p.inertia
        tangent = _tangent(blended, location_normal) or tangent
        points.append(location); peaks.append(peak); widths.append(width); band.extend(covered)
        tail = tail + 1 if width is None else 0
        travelled += move.length
        point, normal = location, location_normal
    if tail and stop is None and not closed:
        del points[-tail:], peaks[-tail:], widths[-tail:]
    return {'points': points, 'peaks': peaks, 'widths': widths, 'band': band, 'closed': closed, 'stop': stop}


def _direction(surface, origin, normal, p):
    """Direction along which interpolated strength persists; independent of vertex spacing."""
    u = _tangent(Vector((1, 0, 0)) if abs(normal.x) < .9 else Vector((0, 1, 0)), normal)
    if u is None:
        return None
    w = normal.cross(u)
    best = None
    for i in range(12):
        angle = math.pi * i / 12
        direction = u * math.cos(angle) + w * math.sin(angle)
        total = 0.
        for k in (1.5, 3, 4.5, 6):
            for sign in (1, -1):
                hit = surface.query(origin + direction * (sign * k * p.step))
                total += hit[2] if hit else 0.
        if best is None or total > best[0]:
            best = total, direction
    return best[1]


def _corners(points, closed, p):
    n, m = len(points), p.window
    turning = [0.] * n
    for i in range(n):
        if not closed and (i < m or i >= n - m):
            continue
        a, b = points[i] - points[(i - m) % n], points[(i + m) % n] - points[i]
        if a.length > 1e-12 and b.length > 1e-12:
            turning[i] = a.angle(b)
    return [i for i in range(n) if turning[i] >= p.corner_angle and
            all(turning[i] >= turning[(i + d) % n] for d in range(-m, m + 1) if closed or 0 <= i + d < n)]


def _smooth(surface, points, closed, fixed, iterations):
    points = [x.copy() for x in points]
    fixed = set(fixed) | (set() if closed else {0, len(points) - 1})
    for _ in range(iterations):
        moved = points[:]
        for i in range(len(points)):
            if i in fixed:
                continue
            hit = surface.query(points[i] * .5 + (points[i - 1] + points[(i + 1) % len(points)]) * .25)
            if hit:
                moved[i] = hit[0]
        points = moved
    return points


def _cage_smooth(points, closed, fixed, iterations, budget):
    """Smooth in space inside a fixed displacement envelope, without re-snapping.

    The envelope is relative to the original samples, not the previous iteration,
    so iterations cannot accumulate unlimited shrinkage or drift.
    """
    anchors = [x.copy() for x in points]
    result = [x.copy() for x in points]
    fixed = set(fixed) | (set() if closed else {0, len(points)-1})
    for _ in range(iterations):
        moved = result[:]
        for i, point in enumerate(result):
            if i in fixed:
                continue
            target = point*.5 + (result[i-1]+result[(i+1)%len(result)])*.25
            delta = target-anchors[i]
            moved[i] = anchors[i]+delta.normalized()*min(delta.length, budget)
        result = moved
    return result


def _simple_indices(curves, closed, fixed, tolerance):
    """Shared RDP stations for a centre and its rails; bound all three errors.

    Fixed corners and cyclic order survive. No independent resampling that could
    twist subsequent strips. This only simplifies curves, never builds faces.
    """
    n = len(curves[0])
    keep = set(fixed) | {0, n-1}
    if closed:
        # Three separated stations avoid collapsing a small loop into a segment.
        keep.update((n//3, 2*n//3))
    stops = sorted(keep)
    stack = list(zip(stops, stops[1:]))
    if closed:
        stack.append((n-1, n))
    while stack:
        a,b = stack.pop()
        worst, chosen = tolerance, None
        for i in range(a+1,b):
            for curve in curves:
                start,end,point = curve[a%n],curve[b%n],curve[i%n]
                direction = end-start
                t = min(1.,max(0.,(point-start).dot(direction)/max(direction.length_squared,1e-30)))
                error = (point-(start+direction*t)).length
                if error > worst:
                    worst,chosen = error,i
        if chosen is not None:
            keep.add(chosen%n);stack.extend(((a,chosen),(chosen,b)))
    return sorted(keep)


def _offset(surface, points, closed, distance):
    n = len(points)
    result = []
    for i, point in enumerate(points):
        before = points[i - 1] if closed or i > 0 else point
        after = points[(i + 1) % n] if closed or i < n - 1 else point
        hit = surface.query(point)
        tangent = _tangent(after - before, hit[1]) if hit else None
        if tangent is None:
            continue
        moved = surface.query(point + hit[1].cross(tangent) * distance)
        if moved:
            result.append(moved[0])
    return result


def _length(points, closed):
    total = sum((b - a).length for a, b in zip(points, points[1:]))
    return total + ((points[0] - points[-1]).length if closed and len(points) > 2 else 0.)


def trace_boundaries(bm, face_response, evidence, settings, weak, min_length):
    """Traced boundary lines across triangles; candidates that may leave the source surface slightly."""
    support = settings.get('trace_support', True)
    if not isinstance(support, bool):
        raise ValueError('切角卡线开关必须为布尔值')
    try:
        chamfer = float(settings.get('trace_chamfer_scale', 1.))
        smoothing = int(settings.get('trace_smoothing', 8))
        allowance = float(settings.get('trace_cage_allowance', .003))
        simplify = float(settings.get('trace_simplify_error', .0015))
    except (TypeError, ValueError) as error:
        raise ValueError('边界单线参数无效') from error
    if (not all(math.isfinite(x) for x in (chamfer, allowance, simplify)) or
            not .2 <= chamfer <= 3 or not 0 <= smoothing <= 40 or
            not 0 <= allowance <= .02 or not 0 <= simplify <= .01):
        raise ValueError('边界单线参数超出范围')
    scale = evidence['curvature_scale']
    p = _Params(scale, weak, smoothing)
    p.band_extent = 1 if settings.get('_local_structure_band', False) else 4
    areas = [f.calc_area() for f in bm.faces]
    strength = []
    for v in bm.verts:
        total = sum(areas[f.index] for f in v.link_faces)
        strength.append(sum(face_response[f.index] * areas[f.index] for f in v.link_faces) / total if total > 0 else 0.)
    surface = _Surface(bm, strength)
    visited, accepted = _Grid(p.width), _Grid(p.width)

    def guard(point):
        hit = accepted.nearest(point, p.width * .6)
        return ('line', hit[0]) if hit else None

    raw = []
    for index in sorted(range(len(strength)), key=lambda i: (-strength[i], i)):
        if strength[index] < p.seed or len(raw) >= 400:
            break
        origin = surface.co[index]
        if visited.nearest(origin, p.width):
            continue
        tangent = _direction(surface, origin, surface.normals[index], p)
        start = _refine(surface, origin, surface.normals[index], tangent, p) if tangent else None
        if start is None:
            visited.add(origin)
            continue
        forward = _trace(surface, start[0], start[1], tangent, p, guard)
        backward = {'points': [start[0]], 'peaks': [], 'widths': [], 'band': [], 'closed': False, 'stop': None}
        cut = len(forward['points'])
        if not forward['closed']:
            skip = p.window * 3
            own = _Grid(p.width)
            for i, x in enumerate(forward['points'][skip:], skip):
                own.add(x, i)

            def guard_back(point):
                hit = own.nearest(point, p.width * .6)
                return ('self', hit[1]) if hit else guard(point)

            backward = _trace(surface, start[0], start[1], -tangent, p, guard_back)
            if backward['stop'] and backward['stop'][0] == 'self':
                cut = backward['stop'][1] + 1
        points = list(reversed(backward['points'][1:])) + forward['points'][:cut]
        peaks = list(reversed(backward['peaks'])) + [start[2]] + forward['peaks'][:cut - 1]
        widths = list(reversed(backward['widths'])) + [start[3]] + forward['widths'][:cut - 1]
        joined = backward['stop'] is not None and backward['stop'][0] == 'self'
        bridged = (forward['stop'] is None and backward['stop'] is None and len(points) > 8 and
                   (points[0] - points[-1]).length < p.step * p.max_gap and _length(points, False) > p.width * 6)
        closed = forward['closed'] or joined or bridged
        for x in points + forward['band'] + backward['band'] + list(start[4]):
            visited.add(x)
        if len(points) < 3 or _length(points, closed) < min_length:
            continue
        for x in points:
            accepted.add(x)
        junctions = [s[1] for s in (forward['stop'], backward['stop']) if s and s[0] == 'line']
        raw.append((points, peaks, widths, closed, junctions))
    lines = []
    for points, peaks, widths, closed, junctions in sorted(raw, key=lambda r: -_length(r[0], r[3])):
        corners = _corners(_smooth(surface, points, closed, [], 2), closed, p)
        smooth = _cage_smooth(points, closed, corners, p.smoothing, scale*allowance)
        measured = [x for pair in widths if pair for x in pair]
        half_width = min(max(statistics.median(measured) if measured else p.width * .5, p.step), p.width)
        observed = [x for x, pair in zip(peaks, widths) if pair]
        parent = len(lines)
        rails = []
        if support:
            for side in (-1, 1):
                offset = _offset(surface, smooth, closed, side*half_width*chamfer)
                # An incomplete rail must not silently shift the correspondence.
                if len(offset) != len(smooth):
                    rails = []
                    break
                rails.append(_cage_smooth(offset, closed, corners, p.smoothing, scale*allowance))
        stations = _simple_indices([smooth]+rails, closed, corners, scale*simplify)
        sampled = [smooth[i] for i in stations]
        lines.append({'role': 'boundary', 'points': [tuple(x) for x in sampled],
                      'closed': closed, 'length': _length(sampled, closed),
                      'corners': [stations.index(i) for i in corners if i in stations],
                      'junctions': [tuple(x) for x in junctions], 'half_width': half_width,
                      'raw_sample_count': len(points), 'control_point_count': len(stations),
                      'support_pair_complete': len(rails)==2,
                      'mean_strength': statistics.fmean(observed) if observed else 0.,
                      'bridged_fraction': 1-len(observed)/max(len(peaks),1),
                      'has_branch': bool(junctions), 'has_weak_evidence': len(observed)<len(peaks)})
        for side,rail in zip(('left','right'),rails):
            sampled = [rail[i] for i in stations]
            lines.append({'role': 'support', 'parent': parent, 'side': side,
                          'points': [tuple(x) for x in sampled], 'closed': closed,
                          'length': _length(sampled, closed), 'offset': half_width*chamfer,
                          'has_branch': bool(junctions),
                          'has_weak_evidence': len(observed)<len(peaks)})
    boundaries = [line for line in lines if line['role'] == 'boundary']
    return {'status': '结构边界单线与两侧切角卡线候选；尚未确认，不用于自动切面',
            'method': 'TRACE', 'source_signature': evidence['signature'],
            'lines': lines, 'line_count': len(boundaries), 'boundary_count': len(boundaries),
            'closed_count': sum(line['closed'] for line in boundaries),
            'support_count': len(lines) - len(boundaries),
            'branch_vertices': [], 'endpoint_vertices': [], 'edge_indices': [],
            'requires_confirmation': True, 'semantic_labels_used': False,
            'parameters': {'step_relative': .006, 'search_half_width_relative': .02, 'weak_ratio': weak,
                           'seed_ratio': p.seed, 'max_bridged_steps': p.max_gap, 'inertia': p.inertia,
                           'corner_angle_degrees': math.degrees(p.corner_angle), 'smoothing': smoothing,
                           'support_lines': support, 'chamfer_scale': chamfer,
                           'cage_allowance_relative': allowance, 'simplify_error_relative': simplify,
                           'min_length_relative': min_length / scale if scale else 0.,
                           'curvature_threshold': evidence['curvature_threshold'],
                           'density_scale_mix': evidence['density_scale_mix']},
            'limitations': ['三线共用简化站点；空间平滑允许有限偏离，预算不是严格表面误差证明',
                            '卡线按转折带半宽对称偏移，宽度可用倍数调整；尚未按局部截面自适应',
                            '交汇处按 T 形截止，复杂分叉需人工检查', '没有把候选线自动写回分区或生成网格']}
