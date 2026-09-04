import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const assertId = (value, field) => {
    if (typeof value !== 'string' || !ID_PATTERN.test(value) || value === '.' || value === '..') {
        throw new Error('invalid ' + field + ': ' + value);
    }
};

const isNotFound = (error) => error && typeof error === 'object' && error.code === 'ENOENT';

const copy = (value) => JSON.parse(JSON.stringify(value));

export class NavMeshRevisionConflict extends Error {
    code = 'NAVMESH_REVISION_CONFLICT';
    constructor(mapId, expectedRevision, actualRevision) {
        super('NavMesh revision conflict for ' + mapId
            + ': expected ' + expectedRevision + ', actual ' + actualRevision);
    }
}

export class NavMeshStore {
    constructor(options) {
        this.rootDir = resolve(options.rootDir);
        this.now = options.now ?? (() => new Date().toISOString());
        if (typeof this.now !== 'function') {
            throw new Error('NavMesh clock must be a function');
        }
    }

    async load(mapId) {
        const filePath = this.filePath(mapId);
        try {
            const content = await readFile(filePath, 'utf8');
            return this.parseMap(content, mapId);
        }
        catch (error) {
            if (isNotFound(error)) {
                return {
                    mapId,
                    revision: 0,
                    tiles: [],
                    updatedAt: this.now(),
                };
            }
            throw new Error('failed to load NavMesh: ' + mapId, { cause: error });
        }
    }

    async upsertTile(mapId, tile, expectedRevision) {
        assertId(mapId, 'map id');
        if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
            throw new Error('NavMesh expected revision must be a non-negative integer');
        }
        this.validateTile(tile);
        const current = await this.load(mapId);
        if (current.revision !== expectedRevision) {
            throw new NavMeshRevisionConflict(mapId, expectedRevision, current.revision);
        }
        const tiles = current.tiles.filter((candidate) => candidate.id !== tile.id);
        tiles.push(copy(tile));
        tiles.sort((left, right) => left.id.localeCompare(right.id));
        const next = {
            mapId,
            revision: current.revision + 1,
            tiles,
            updatedAt: this.now(),
        };
        await this.writeMap(next);
        return copy(next);
    }

    async save(mapId) {
        const current = await this.load(mapId);
        await this.writeMap(current);
        return copy(current);
    }

    filePath(mapId) {
        assertId(mapId, 'map id');
        const filePath = resolve(this.rootDir, mapId + '.navmesh');
        if (dirname(filePath) !== this.rootDir) {
            throw new Error('invalid map id: ' + mapId);
        }
        return filePath;
    }

    parseMap(content, mapId) {
        let value;
        try {
            value = JSON.parse(content);
        }
        catch (error) {
            throw new Error('invalid NavMesh JSON: ' + mapId, { cause: error });
        }
        if (!value || typeof value !== 'object' || value.mapId !== mapId
            || !Number.isInteger(value.revision) || value.revision < 0
            || !Array.isArray(value.tiles)) {
            throw new Error('invalid NavMesh document: ' + mapId);
        }
        for (const tile of value.tiles) {
            this.validateTile(tile);
        }
        return {
            mapId,
            revision: value.revision,
            tiles: copy(value.tiles),
            updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : this.now(),
        };
    }

    validateTile(tile) {
        if (!tile || typeof tile !== 'object') {
            throw new Error('NavMesh tile must be an object');
        }
        assertId(tile.id, 'NavMesh tile id');
        if (!Number.isInteger(tile.version) || tile.version < 0) {
            throw new Error('NavMesh tile version must be a non-negative integer');
        }
        if (!Array.isArray(tile.vertices) || !Array.isArray(tile.polygons)) {
            throw new Error('NavMesh tile vertices and polygons must be arrays');
        }
    }

    async writeMap(map) {
        await mkdir(this.rootDir, { recursive: true });
        const filePath = this.filePath(map.mapId);
        const temporaryPath = join(this.rootDir, '.' + map.mapId + '.' + randomUUID() + '.tmp');
        try {
            await writeFile(temporaryPath, JSON.stringify(map, null, 2) + '\n', 'utf8');
            await rename(temporaryPath, filePath);
        }
        finally {
            try {
                await unlink(temporaryPath);
            }
            catch (error) {
                if (!isNotFound(error))
                    throw error;
            }
        }
    }
}
