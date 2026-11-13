const finite = (value) => Number.isFinite(Number(value));
const clone = (value) => {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  return value;
};

const horizontalAxes = (map, options = {}) => (
  options.horizontal ?? map?.coordinateSystem?.horizontal ?? ['x', 'z']
);

const positionFor = (value, axes) => {
  if (!value || !finite(value[axes[0]]) || !finite(value[axes[1]])) return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([, coordinate]) => finite(coordinate))
    .map(([axis, coordinate]) => [axis, Number(coordinate)]));
};

const distance = (left, right, axes) => Math.hypot(
  left[axes[0]] - right[axes[0]],
  left[axes[1]] - right[axes[1]],
);

const pointKey = (point, axes) => `${point[axes[0]]}:${point[axes[1]]}`;

const polygonData = (map, axes) => {
  const polygons = [];
  const verticesByReference = new Map();
  for (const tile of map?.tiles ?? []) {
    for (const [index, vertex] of (tile.vertices ?? []).entries()) {
      const point = positionFor(vertex, axes);
      if (!point) continue;
      verticesByReference.set(`${tile.id}:${index}`, point);
      verticesByReference.set(`${tile.id}:${String(index)}`, point);
    }
    for (const polygon of tile.polygons ?? []) {
      const vertices = (polygon.vertices ?? []).map((reference) => {
        if (reference && typeof reference === 'object') return positionFor(reference, axes);
        return verticesByReference.get(`${tile.id}:${reference}`)
          ?? verticesByReference.get(String(reference));
      }).filter(Boolean);
      const id = String(polygon.id);
      polygons.push({ ...clone(polygon), id, tileId: tile.id, vertices });
    }
  }
  return polygons;
};

const centroid = (polygon, axes) => {
  if (!polygon.vertices.length) return undefined;
  const result = {
    [axes[0]]: polygon.vertices.reduce((sum, point) => sum + point[axes[0]], 0) / polygon.vertices.length,
    [axes[1]]: polygon.vertices.reduce((sum, point) => sum + point[axes[1]], 0) / polygon.vertices.length,
  };
  const extraAxes = new Set(polygon.vertices.flatMap((point) => Object.keys(point))).difference?.(new Set(axes))
    ?? new Set(Object.keys(polygon.vertices[0]).filter((axis) => !axes.includes(axis)));
  for (const axis of extraAxes) {
    const values = polygon.vertices.map((point) => point[axis]).filter(finite);
    if (values.length === polygon.vertices.length) result[axis] = values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return result;
};

const containsPoint = (polygon, point, axes) => {
  if (polygon.vertices.length < 3) return false;
  let inside = false;
  const first = axes[0];
  const second = axes[1];
  for (let index = 0, previous = polygon.vertices.length - 1; index < polygon.vertices.length; previous = index++) {
    const current = polygon.vertices[index];
    const prior = polygon.vertices[previous];
    const intersects = ((current[second] > point[second]) !== (prior[second] > point[second]))
      && (point[first] < (((prior[first] - current[first]) * (point[second] - current[second]))
        / (prior[second] - current[second])) + current[first]);
    if (intersects) inside = !inside;
  }
  return inside;
};

const edgeKey = (left, right, axes) => [pointKey(left, axes), pointKey(right, axes)].sort().join('|');

const boundsFor = (value, axes) => {
  const bounds = value?.bounds ?? value;
  let min = bounds?.min;
  let max = bounds?.max;
  if ((!min || !max) && Array.isArray(value?.vertices) && value.vertices.length) {
    min = Object.fromEntries(axes.map((axis) => [axis, Math.min(...value.vertices.map((point) => Number(point[axis])))]));
    max = Object.fromEntries(axes.map((axis) => [axis, Math.max(...value.vertices.map((point) => Number(point[axis])))]));
  }
  if ((!min || !max) && value?.center && value?.size) {
    min = Object.fromEntries(axes.map((axis) => [axis, Number(value.center[axis]) - Number(value.size[axis] ?? value.size) / 2]));
    max = Object.fromEntries(axes.map((axis) => [axis, Number(value.center[axis]) + Number(value.size[axis] ?? value.size) / 2]));
  }
  if (!min || !max || axes.some((axis) => !finite(min[axis]) || !finite(max[axis]) || Number(max[axis]) < Number(min[axis]))) return undefined;
  const normalizedMin = Object.fromEntries(axes.map((axis) => [axis, Number(min[axis])]));
  const normalizedMax = Object.fromEntries(axes.map((axis) => [axis, Number(max[axis])]));
  return {
    min: normalizedMin,
    max: normalizedMax,
    center: Object.fromEntries(axes.map((axis) => [axis, (normalizedMin[axis] + normalizedMax[axis]) / 2])),
  };
};

const volumeData = (map, axes) => {
  const volumes = [];
  for (const tile of map?.tiles ?? []) {
    for (const volume of tile.volumes ?? []) {
      const bounds = boundsFor(volume, axes);
      if (!bounds) continue;
      volumes.push({ ...clone(volume), id: String(volume.id), tileId: tile.id, ...bounds });
    }
  }
  for (const volume of map?.volumes ?? []) {
    const bounds = boundsFor(volume, axes);
    if (!bounds) continue;
    volumes.push({ ...clone(volume), id: String(volume.id), ...bounds });
  }
  return volumes;
};

const containsVolume = (volume, point, axes) => axes.every((axis) => (
  point[axis] >= volume.min[axis] && point[axis] <= volume.max[axis]
));

const volumesTouch = (left, right, axes) => {
  let touchingAxes = 0;
  for (const axis of axes) {
    const gap = Math.min(Math.abs(left.max[axis] - right.min[axis]), Math.abs(right.max[axis] - left.min[axis]));
    const overlap = Math.min(left.max[axis], right.max[axis]) - Math.max(left.min[axis], right.min[axis]);
    if (gap <= 1e-6) touchingAxes += 1;
    else if (overlap <= 1e-6) return false;
  }
  return touchingAxes === 1;
};

const volumeNeighbours = (volumes, byId, axes) => {
  const adjacency = new Map(volumes.map((volume) => [volume.id, new Set()]));
  for (const volume of volumes) {
    for (const neighbour of volume.neighbors ?? volume.neighbours ?? []) {
      const id = String(neighbour);
      if (byId.has(id)) adjacency.get(volume.id).add(id);
    }
  }
  for (let leftIndex = 0; leftIndex < volumes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < volumes.length; rightIndex += 1) {
      const left = volumes[leftIndex];
      const right = volumes[rightIndex];
      if (!volumesTouch(left, right, axes)) continue;
      adjacency.get(left.id).add(right.id);
      adjacency.get(right.id).add(left.id);
    }
  }
  return adjacency;
};

const findVolumePath = (map, startPosition, targetPosition, options, axes) => {
  const empty = { status: 'blocked', reason: 'invalid-3d-path-position', polygonIds: [], volumeIds: [], waypoints: [] };
  const volumes = volumeData(map, axes).filter((volume) => (
    volume.walkable !== false && !volume.blocked && !((options.blockedRegions ?? ['obstacle', 'blocked', 'wall'])
      .map((region) => String(region).toLowerCase()).includes(String(volume.region ?? '').toLowerCase()))
  ));
  const start = positionFor(startPosition, axes);
  const target = positionFor(targetPosition, axes);
  if (!start || !target) return empty;
  const startVolume = volumes.find((volume) => containsVolume(volume, start, axes));
  const targetVolume = volumes.find((volume) => containsVolume(volume, target, axes));
  if (!startVolume) return { ...empty, reason: 'start-outside-3d-navmesh' };
  if (!targetVolume) return { ...empty, reason: 'target-outside-3d-navmesh' };
  if (startVolume.id === targetVolume.id) return {
    status: 'complete', polygonIds: [startVolume.id], volumeIds: [startVolume.id], waypoints: [clone(startPosition), clone(targetPosition)], cost: 0,
  };
  const byId = new Map(volumes.map((volume) => [volume.id, volume]));
  const adjacency = volumeNeighbours(volumes, byId, axes);
  const open = [startVolume.id];
  const openSet = new Set(open);
  const cameFrom = new Map();
  const gScore = new Map([[startVolume.id, 0]]);
  const distance3d = (left, right) => Math.hypot(...axes.map((axis) => left[axis] - right[axis]));
  const fScore = new Map([[startVolume.id, distance3d(startVolume.center, target)]]);
  while (open.length) {
    open.sort((left, right) => (fScore.get(left) ?? Infinity) - (fScore.get(right) ?? Infinity) || left.localeCompare(right));
    const current = open.shift();
    openSet.delete(current);
    if (current === targetVolume.id) {
      const volumeIds = reconstruct(cameFrom, current);
      const waypoints = [clone(startPosition), ...volumeIds.slice(1, -1).map((id) => clone(byId.get(id).center)), clone(targetPosition)];
      return { status: 'complete', polygonIds: volumeIds, volumeIds, waypoints, cost: gScore.get(current) ?? 0 };
    }
    for (const neighbour of adjacency.get(current) ?? []) {
      const from = byId.get(current).center;
      const to = byId.get(neighbour).center;
      const candidate = byId.get(neighbour);
      const stepCost = distance3d(from, to) * (finite(candidate.cost) ? Number(candidate.cost) : 1);
      const tentative = (gScore.get(current) ?? Infinity) + stepCost;
      if (tentative >= (gScore.get(neighbour) ?? Infinity)) continue;
      cameFrom.set(neighbour, current);
      gScore.set(neighbour, tentative);
      fScore.set(neighbour, tentative + distance3d(to, target));
      if (!openSet.has(neighbour)) { open.push(neighbour); openSet.add(neighbour); }
    }
  }
  return { ...empty, reason: 'no-3d-path' };
};

const neighboursFor = (polygons, polygonById, axes) => {
  const adjacency = new Map(polygons.map((polygon) => [polygon.id, new Set()]));
  const edgeOwners = new Map();
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.vertices.length; index += 1) {
      const edge = edgeKey(polygon.vertices[index], polygon.vertices[(index + 1) % polygon.vertices.length], axes);
      const owners = edgeOwners.get(edge) ?? [];
      owners.push(polygon.id);
      edgeOwners.set(edge, owners);
    }
  }
  for (const polygon of polygons) {
    for (const neighbour of polygon.neighbors ?? []) {
      if (polygonById.has(String(neighbour))) adjacency.get(polygon.id).add(String(neighbour));
    }
  }
  for (const owners of edgeOwners.values()) {
    if (owners.length < 2) continue;
    for (const owner of owners) for (const neighbour of owners) {
      if (owner !== neighbour) adjacency.get(owner)?.add(neighbour);
    }
  }
  return adjacency;
};

const reconstruct = (cameFrom, current) => {
  const result = [current];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    result.unshift(current);
  }
  return result;
};

/** Find a deterministic least-cost route through a graph-backed NavMesh. */
export const findPolygonPath = (map, startPosition, targetPosition, options = {}) => {
  const axes = horizontalAxes(map, options);
  const dimensions = options.dimensions ?? (map?.spaceModel === 'spatial-3d' ? [...axes, map?.coordinateSystem?.up ?? 'y'] : axes);
  if (dimensions.length > 2 && (map?.spaceModel === 'spatial-3d' || (map?.tiles ?? []).some((tile) => (tile.volumes ?? []).length))) {
    return findVolumePath(map, startPosition, targetPosition, options, dimensions);
  }
  const empty = { status: 'blocked', reason: 'invalid-path-position', polygonIds: [], waypoints: [] };
  if (!map || !Array.isArray(map.tiles)) return { ...empty, reason: 'navmesh-required' };
  const start = positionFor(startPosition, axes);
  const target = positionFor(targetPosition, axes);
  if (!start || !target) return empty;
  const blockedRegions = new Set((options.blockedRegions ?? ['obstacle', 'blocked', 'wall'])
    .map((region) => String(region).toLowerCase()));
  const polygons = polygonData(map, axes).filter((polygon) => (
    polygon.walkable !== false && !polygon.blocked && !blockedRegions.has(String(polygon.region ?? '').toLowerCase())
  ));
  const polygonById = new Map(polygons.map((polygon) => [polygon.id, polygon]));
  const startPolygon = polygons.find((polygon) => containsPoint(polygon, start, axes));
  const targetPolygon = polygons.find((polygon) => containsPoint(polygon, target, axes));
  if (!startPolygon) return { status: 'blocked', reason: 'start-outside-navmesh', polygonIds: [], waypoints: [] };
  if (!targetPolygon) return { status: 'blocked', reason: 'target-outside-navmesh', polygonIds: [], waypoints: [] };
  if (startPolygon.id === targetPolygon.id) return {
    status: 'complete', polygonIds: [startPolygon.id], waypoints: [clone(startPosition), clone(targetPosition)], cost: 0,
  };

  const centers = new Map(polygons.map((polygon) => [polygon.id, centroid(polygon, axes)]));
  const adjacency = neighboursFor(polygons, polygonById, axes);
  const open = [startPolygon.id];
  const openSet = new Set(open);
  const cameFrom = new Map();
  const gScore = new Map([[startPolygon.id, 0]]);
  const fScore = new Map([[startPolygon.id, distance(centers.get(startPolygon.id), target, axes)]]);
  while (open.length) {
    open.sort((left, right) => (fScore.get(left) ?? Infinity) - (fScore.get(right) ?? Infinity) || left.localeCompare(right));
    const current = open.shift();
    openSet.delete(current);
    if (current === targetPolygon.id) {
      const polygonIds = reconstruct(cameFrom, current);
      const waypoints = [clone(startPosition), ...polygonIds.slice(1, -1)
        .map((id) => centers.get(id)).filter(Boolean).map(clone), clone(targetPosition)];
      return { status: 'complete', polygonIds, waypoints, cost: gScore.get(current) ?? 0 };
    }
    for (const neighbour of adjacency.get(current) ?? []) {
      const from = centers.get(current);
      const to = centers.get(neighbour);
      if (!from || !to) continue;
      const polygon = polygonById.get(neighbour);
      const stepCost = distance(from, to, axes) * (finite(polygon.cost) ? Number(polygon.cost) : 1);
      const tentative = (gScore.get(current) ?? Infinity) + stepCost;
      if (tentative >= (gScore.get(neighbour) ?? Infinity)) continue;
      cameFrom.set(neighbour, current);
      gScore.set(neighbour, tentative);
      fScore.set(neighbour, tentative + distance(to, target, axes));
      if (!openSet.has(neighbour)) { open.push(neighbour); openSet.add(neighbour); }
    }
  }
  return { status: 'blocked', reason: 'no-path', polygonIds: [], waypoints: [] };
};

export const findPath = findPolygonPath;
export const buildPolygonGraph = (map, options = {}) => {
  const axes = horizontalAxes(map, options);
  const polygons = polygonData(map, axes);
  const polygonById = new Map(polygons.map((polygon) => [polygon.id, polygon]));
  const adjacency = neighboursFor(polygons, polygonById, axes);
  return Object.fromEntries([...adjacency.entries()].map(([id, neighbours]) => [id, [...neighbours].sort()]));
};

export { containsPoint, centroid, positionFor };
