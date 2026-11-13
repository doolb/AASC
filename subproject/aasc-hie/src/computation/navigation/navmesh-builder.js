const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const clone = (value) => JSON.parse(JSON.stringify(value));
const cellKey = (x, z) => `${x}:${z}`;
const neighbours = (x, z) => [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]].map(([nx, nz]) => cellKey(nx, nz));
const motionSamplesFor = (input) => [
  ...(Array.isArray(input.motionSamples) ? input.motionSamples : []),
  ...(input.observations ?? []).map((observation) => observation?.motionSample).filter(Boolean),
].map(clone);

/** Build a generic grid NavMesh from configured horizontal observations. */
export class NavMeshBuilder {
  constructor(options = {}) {
    this.cellSize = options.cellSize ?? 10;
    this.walkableLabels = new Set((options.walkableLabels ?? ['walkable', 'road', 'ground', 'path', 'floor', 'jungle', 'river', 'water']).map((value) => String(value).toLowerCase()));
    this.obstacleLabels = new Set((options.obstacleLabels ?? ['obstacle', 'wall', 'blocker', 'blocked', 'rock', 'tree']).map((value) => String(value).toLowerCase()));
    this.spaceModel = options.spaceModel ?? 'moba-25d';
    this.coordinateSystem = clone(options.coordinateSystem ?? { horizontal: ['x', 'z'], up: 'y' });
    this.now = options.now ?? (() => new Date().toISOString());
    if (!Number.isFinite(this.cellSize) || this.cellSize <= 0) throw new Error('NavMesh cell size must be positive');
  }

  buildVolumes(input) {
    const axes = [...this.coordinateSystem.horizontal, this.coordinateSystem.up];
    const cells = new Map();
    const obstacles = [];
    let sourcePointCount = 0;
    let confidenceTotal = 0;
    for (const observation of input.observations) {
      const position = observation?.position ?? observation;
      const region = String(observation?.region ?? observation?.semanticLabel ?? 'unknown').trim().toLowerCase();
      const suppliedBounds = observation?.bounds ?? (observation?.min && observation?.max ? { min: observation.min, max: observation.max } : undefined);
      if (this.obstacleLabels.has(region) && suppliedBounds) {
        const valid = axes.every((axis) => Number.isFinite(Number(suppliedBounds.min?.[axis])) && Number.isFinite(Number(suppliedBounds.max?.[axis])));
        if (valid) obstacles.push({ id: observation.id ?? `obstacle:${obstacles.length}`, region, bounds: clone(suppliedBounds), confidence: Number.isFinite(Number(observation.confidence)) ? Math.max(0, Math.min(1, Number(observation.confidence))) : 1 });
      }
      if (!this.walkableLabels.has(region)) continue;
      const size = observation?.size;
      const dimensions = Object.fromEntries(axes.map((axis) => {
        const extent = typeof size === 'object' ? Number(size[axis] ?? this.cellSize) : Number(size ?? this.cellSize);
        const coordinate = Number(position?.[axis]);
        const min = suppliedBounds ? Number(suppliedBounds.min?.[axis]) : Math.floor(coordinate / extent) * extent;
        const max = suppliedBounds ? Number(suppliedBounds.max?.[axis]) : min + extent;
        return [axis, { min, max }];
      }));
      if (axes.some((axis) => !Number.isFinite(dimensions[axis].min) || !Number.isFinite(dimensions[axis].max) || dimensions[axis].max < dimensions[axis].min)) continue;
      const key = axes.map((axis) => `${dimensions[axis].min}:${dimensions[axis].max}`).join('|');
      const cell = cells.get(key) ?? { key, min: {}, max: {}, count: 0, confidenceTotal: 0, regions: new Map() };
      for (const axis of axes) { cell.min[axis] = dimensions[axis].min; cell.max[axis] = dimensions[axis].max; }
      const confidence = Number.isFinite(Number(observation.confidence)) ? Math.max(0, Math.min(1, Number(observation.confidence))) : 1;
      cell.count += 1;
      cell.confidenceTotal += confidence;
      cell.regions.set(region, (cell.regions.get(region) ?? 0) + 1);
      cells.set(key, cell);
      sourcePointCount += 1;
      confidenceTotal += confidence;
    }
    const cellValues = [...cells.values()];
    const volumeIdFor = (cell) => `volume:${cell.key}`;
    const adjacent = (left, right) => {
      let touchingAxes = 0;
      for (const axis of axes) {
        const gap = Math.min(Math.abs(left.max[axis] - right.min[axis]), Math.abs(right.max[axis] - left.min[axis]));
        const overlap = Math.min(left.max[axis], right.max[axis]) - Math.max(left.min[axis], right.min[axis]);
        if (gap <= 1e-6) touchingAxes += 1;
        else if (overlap <= 1e-6) return false;
      }
      return touchingAxes === 1;
    };
    const volumes = cellValues.sort((left, right) => left.key.localeCompare(right.key)).map((cell) => {
      const region = [...cell.regions.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'unknown';
      const neighbors = cellValues.filter((other) => other !== cell && adjacent(cell, other)).map(volumeIdFor).sort();
      return {
        id: volumeIdFor(cell),
        bounds: { min: { ...cell.min }, max: { ...cell.max } },
        neighbors,
        region,
        cost: Number(input.costs?.[region] ?? 1),
        confidence: cell.confidenceTotal / cell.count,
      };
    });
    return {
      schemaVersion: 1,
      mapId: input.mapId,
      spaceModel: this.spaceModel,
      revision: input.revision ?? 1,
      coordinateSystem: clone(this.coordinateSystem),
      ...(input.projection ? { projection: clone(input.projection) } : {}),
      landmarks: clone(input.landmarks ?? []),
      motionSamples: motionSamplesFor(input),
      sourceSessions: clone(input.sourceSessions ?? []),
      tiles: [{ id: input.tileId ?? 'tile-0-0', version: input.tileVersion ?? 1, spaceModel: this.spaceModel, coordinateSystem: clone(this.coordinateSystem), cellSize: this.cellSize, sourcePointCount, confidence: sourcePointCount ? confidenceTotal / sourcePointCount : 0, vertices: [], polygons: [], volumes, obstacles }],
      updatedAt: this.now(),
    };
  }

  build(input = {}) {
    if (typeof input.mapId !== 'string' || !ID_PATTERN.test(input.mapId) || input.mapId === '.' || input.mapId === '..') throw new Error(`invalid NavMesh map id: ${input.mapId}`);
    if (!Array.isArray(input.observations)) throw new Error('NavMesh observations must be an array');
    if (this.spaceModel === 'spatial-3d') return this.buildVolumes(input);
    const cells = new Map();
    let sourcePointCount = 0;
    let confidenceTotal = 0;
    for (const observation of input.observations) {
      const position = observation?.position ?? observation;
      const region = String(observation?.region ?? observation?.semanticLabel ?? 'unknown').trim().toLowerCase();
      const axes = this.coordinateSystem.horizontal;
      if (!Number.isFinite(Number(position?.[axes[0]])) || !Number.isFinite(Number(position?.[axes[1]])) || !this.walkableLabels.has(region)) continue;
      const x = Math.floor(Number(position[axes[0]]) / this.cellSize);
      const z = Math.floor(Number(position[axes[1]]) / this.cellSize);
      const key = cellKey(x, z);
      const value = cells.get(key) ?? { x, z, count: 0, confidenceTotal: 0, regions: new Map() };
      const confidence = Number.isFinite(Number(observation.confidence)) ? Math.max(0, Math.min(1, Number(observation.confidence))) : 1;
      const up = this.coordinateSystem.up;
      value.upTotal = (value.upTotal ?? 0) + (Number.isFinite(Number(position?.[up])) ? Number(position[up]) : 0);
      value.count += 1; value.confidenceTotal += confidence; value.regions.set(region, (value.regions.get(region) ?? 0) + 1); cells.set(key, value);
      sourcePointCount += 1; confidenceTotal += confidence;
    }
    const vertexIds = new Map();
    const vertices = [];
    const vertexId = (x, z, cell) => { const key = cellKey(x, z); if (!vertexIds.has(key)) { vertexIds.set(key, vertices.length); vertices.push({ [this.coordinateSystem.horizontal[0]]: x * this.cellSize, [this.coordinateSystem.horizontal[1]]: z * this.cellSize, [this.coordinateSystem.up]: (cell.upTotal ?? 0) / Math.max(1, cell.count) }); } return vertexIds.get(key); };
    const sortedCells = [...cells.values()].sort((a, b) => a.z - b.z || a.x - b.x);
    const polygons = sortedCells.map((cell) => {
      const region = [...cell.regions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';
      return { id: `poly:${cellKey(cell.x, cell.z)}`, vertices: [vertexId(cell.x, cell.z, cell), vertexId(cell.x + 1, cell.z, cell), vertexId(cell.x + 1, cell.z + 1, cell), vertexId(cell.x, cell.z + 1, cell)], neighbors: neighbours(cell.x, cell.z).filter((key) => cells.has(key)).map((key) => `poly:${key}`), region, cost: Number(input.costs?.[region] ?? 1), confidence: cell.confidenceTotal / cell.count };
    });
    return {
      schemaVersion: this.spaceModel === 'moba-25d' ? 2 : 1,
      mapId: input.mapId,
      spaceModel: this.spaceModel,
      revision: input.revision ?? 1,
      coordinateSystem: clone(this.coordinateSystem),
      ...(input.projection ? { projection: clone(input.projection) } : {}),
      landmarks: clone(input.landmarks ?? []),
      motionSamples: motionSamplesFor(input),
      sourceSessions: clone(input.sourceSessions ?? []),
      tiles: [{ id: input.tileId ?? 'tile-0-0', version: input.tileVersion ?? 1, spaceModel: this.spaceModel, coordinateSystem: clone(this.coordinateSystem), cellSize: this.cellSize, sourcePointCount, confidence: sourcePointCount ? confidenceTotal / sourcePointCount : 0, vertices, polygons }],
      updatedAt: this.now(),
    };
  }

  async buildAndStore(store, mapId, input = {}) {
    if (!store?.load || !store?.replaceDocument) throw new Error('NavMesh store with load() and replaceDocument() is required');
    const current = await store.load(mapId);
    return store.replaceDocument(mapId, this.build({ ...input, mapId, revision: current.revision + 1 }), current.revision);
  }
}

export class Moba25dNavMeshBuilder extends NavMeshBuilder {
  constructor(options = {}) { super({ ...options, spaceModel: 'moba-25d' }); }
}
