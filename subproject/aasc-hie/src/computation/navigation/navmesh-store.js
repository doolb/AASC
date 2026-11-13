import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const SPACE_MODELS = new Set(['spatial-3d', 'moba-25d', 'horizontal']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const missing = (error) => error?.code === 'ENOENT';

const assertId = (value, field) => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || value === '.' || value === '..') throw new Error(`invalid ${field}: ${value}`);
};

export class NavMeshRevisionConflict extends Error {
  constructor(mapId, expectedRevision, actualRevision) {
    super(`NavMesh revision conflict for ${mapId}: expected ${expectedRevision}, actual ${actualRevision}`);
    this.name = 'NavMeshRevisionConflict';
    this.code = 'NAVMESH_REVISION_CONFLICT';
    this.mapId = mapId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

/** Persist independent JSON NavMesh documents without touching Markdown packages. */
export class NavMeshStore {
  constructor(options = {}) {
    this.rootDir = resolve(options.rootDir ?? 'data/navmesh/maps');
    this.now = options.now ?? (() => new Date().toISOString());
  }

  filePath(mapId) {
    assertId(mapId, 'map id');
    const path = resolve(this.rootDir, `${mapId}.navmesh`);
    if (dirname(path) !== this.rootDir) throw new Error(`invalid map id: ${mapId}`);
    return path;
  }

  async load(mapId) {
    const path = this.filePath(mapId);
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      this.validateMap(value, mapId);
      return clone({ ...value, schemaVersion: value.schemaVersion ?? 1, spaceModel: value.spaceModel ?? 'spatial-3d', updatedAt: value.updatedAt ?? this.now() });
    } catch (error) {
      if (missing(error)) return {
        schemaVersion: 1, mapId, spaceModel: 'spatial-3d', coordinateSystem: { up: 'y', horizontal: ['x', 'z'] }, revision: 0, tiles: [], updatedAt: this.now(),
      };
      if (error instanceof SyntaxError) throw new Error(`invalid NavMesh JSON: ${mapId}`, { cause: error });
      if (error.message.startsWith('invalid NavMesh')) throw error;
      throw new Error(`failed to load NavMesh: ${mapId}`, { cause: error });
    }
  }

  async upsertTile(mapId, tile, expectedRevision) {
    assertId(mapId, 'map id');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('NavMesh expected revision must be a non-negative integer');
    this.validateTile(tile);
    const current = await this.load(mapId);
    if (current.revision !== expectedRevision) throw new NavMeshRevisionConflict(mapId, expectedRevision, current.revision);
    const tiles = current.tiles.filter((candidate) => candidate.id !== tile.id).concat([clone(tile)]).sort((a, b) => a.id.localeCompare(b.id));
    const spaceModel = tile.spaceModel ?? current.spaceModel ?? 'spatial-3d';
    const next = { ...current, schemaVersion: spaceModel === 'moba-25d' ? 2 : current.schemaVersion, mapId, spaceModel, tiles, revision: current.revision + 1, updatedAt: this.now() };
    await this.writeMap(next);
    return clone(next);
  }

  async replaceDocument(mapId, document, expectedRevision) {
    assertId(mapId, 'map id');
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('NavMesh expected revision must be a non-negative integer');
    this.validateMap(document, mapId);
    const current = await this.load(mapId);
    if (current.revision !== expectedRevision) throw new NavMeshRevisionConflict(mapId, expectedRevision, current.revision);
    const next = { ...clone(document), mapId, revision: current.revision + 1, updatedAt: this.now() };
    await this.writeMap(next);
    return clone(next);
  }

  async save(mapId) { const current = await this.load(mapId); await this.writeMap(current); return clone(current); }
  async get(mapId) { return this.load(mapId); }

  validateMap(value, mapId) {
    if (!value || typeof value !== 'object' || value.mapId !== mapId || !Number.isInteger(value.revision) || value.revision < 0 || !Array.isArray(value.tiles)
      || (value.spaceModel !== undefined && !SPACE_MODELS.has(value.spaceModel))) throw new Error(`invalid NavMesh document: ${mapId}`);
    for (const tile of value.tiles) this.validateTile(tile);
    if (value.spaceModel === 'moba-25d' && value.schemaVersion !== 2) throw new Error(`moba-25d NavMesh requires schema version 2: ${mapId}`);
  }

  validateTile(tile) {
    if (!tile || typeof tile !== 'object') throw new Error('NavMesh tile must be an object');
    assertId(tile.id, 'NavMesh tile id');
    if (!Number.isInteger(tile.version) || tile.version < 0 || !Array.isArray(tile.vertices) || !Array.isArray(tile.polygons)) throw new Error('invalid NavMesh tile');
    if (tile.spaceModel !== undefined && !SPACE_MODELS.has(tile.spaceModel)) throw new Error(`invalid NavMesh tile space model: ${tile.spaceModel}`);
  }

  async writeMap(map) {
    await mkdir(this.rootDir, { recursive: true });
    const destination = this.filePath(map.mapId);
    const temporary = join(this.rootDir, `.${map.mapId}.${randomUUID()}.tmp`);
    try { await writeFile(temporary, `${JSON.stringify(map, null, 2)}\n`, 'utf8'); await rename(temporary, destination); }
    finally { try { await unlink(temporary); } catch (error) { if (!missing(error)) throw error; } }
  }
}
