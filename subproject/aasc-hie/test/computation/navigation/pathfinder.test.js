import { describe, expect, it } from 'vitest';
import { findPolygonPath } from '../../../src/computation/navigation/pathfinder.js';
import { HorizontalNavigator, Spatial3dNavigator } from '../../../src/computation/navigation/map-navigator.js';
import { NavMeshBuilder } from '../../../src/computation/navigation/navmesh-builder.js';

const gridMap = () => {
  const vertices = [];
  const polygons = [];
  const idAt = (x, z) => `poly:${x}:${z}`;
  for (let z = 0; z < 2; z += 1) {
    for (let x = 0; x < 3; x += 1) {
      const first = vertices.length;
      vertices.push(
        { x: x * 10, y: 0, z: z * 10 },
        { x: x * 10 + 10, y: 0, z: z * 10 },
        { x: x * 10 + 10, y: 0, z: z * 10 + 10 },
        { x: x * 10, y: 0, z: z * 10 + 10 },
      );
      polygons.push({
        id: idAt(x, z),
        vertices: [first, first + 1, first + 2, first + 3],
        neighbors: [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]
          .filter(([nx, nz]) => nx >= 0 && nx < 3 && nz >= 0 && nz < 2)
          .map(([nx, nz]) => idAt(nx, nz)),
        region: x === 1 && z === 0 ? 'wall' : 'road',
        cost: 1,
      });
    }
  }
  return {
    mapId: 'test-map',
    spaceModel: 'moba-25d',
    revision: 4,
    tiles: [{ id: 'tile-0', vertices, polygons }],
  };
};

describe('findPolygonPath', () => {
  it('returns a complete walkable path around configured blocked regions', () => {
    const result = findPolygonPath(gridMap(), { x: 5, z: 5 }, { x: 25, z: 5 });

    expect(result).toMatchObject({ status: 'complete', polygonIds: ['poly:0:0', 'poly:0:1', 'poly:1:1', 'poly:2:1', 'poly:2:0'] });
    expect(result.waypoints.at(0)).toEqual({ x: 5, z: 5 });
    expect(result.waypoints.at(-1)).toEqual({ x: 25, z: 5 });
    expect(result.polygonIds).not.toContain('poly:1:0');
  });

  it('reports blocked positions without fabricating a partial route', () => {
    expect(findPolygonPath(gridMap(), { x: 5, z: 5 }, { x: 15, z: 5 }))
      .toMatchObject({ status: 'blocked', reason: 'target-outside-navmesh', polygonIds: [], waypoints: [] });
  });

  it('returns both endpoints for a direct route inside one polygon', () => {
    const map = gridMap();
    expect(findPolygonPath(map, { x: 2, z: 2 }, { x: 8, z: 8 })).toMatchObject({
      status: 'complete',
      polygonIds: ['poly:0:0'],
      waypoints: [{ x: 2, z: 2 }, { x: 8, z: 8 }],
    });
  });

  it('preserves vertical movement for a 3D target in the same horizontal cell', () => {
    const map = { mapId: 'volume', spaceModel: 'spatial-3d', coordinateSystem: { horizontal: ['x', 'z'], up: 'y' }, tiles: [{ id: 'tile', vertices: [], polygons: [], volumes: [{ id: 'v', bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 10 } }, neighbors: [], region: 'walkable' }] }] };
    const navigator = new Spatial3dNavigator({ map });
    const plan = navigator.plan({ stateVersion: 1, self: { position: { x: 5, y: 0, z: 5 } } }, { id: 'rise', target: { x: 5, y: 10, z: 5 } });

    expect(plan.status).toBe('complete');
    expect(navigator.generateInstruction({ stateVersion: 1, self: { position: { x: 5, y: 0, z: 5 } } }, plan)).toMatchObject({
      action: 'move',
      vector: { x: 0, y: 10, z: 0 },
    });
  });

  it('plans and builds using a configured non-XZ horizontal coordinate pair', () => {
    const map = new NavMeshBuilder({
      spaceModel: 'horizontal',
      coordinateSystem: { horizontal: ['u', 'v'], up: 'w' },
      cellSize: 10,
    }).build({ mapId: 'surface', observations: [
      { position: { u: 2, v: 2 }, region: 'walkable' },
      { position: { u: 12, v: 2 }, region: 'walkable' },
    ] });
    const navigator = new HorizontalNavigator({ map });
    const plan = navigator.plan({ stateVersion: 2, map: { position: { u: 2, v: 2 } } }, { id: 'cross', target: { u: 12, v: 2 } });

    expect(map.coordinateSystem).toEqual({ horizontal: ['u', 'v'], up: 'w' });
    expect(map.tiles[0].vertices[0]).toMatchObject({ u: 0, v: 0, w: 0 });
    expect(plan).toMatchObject({ status: 'complete', path: { status: 'complete' } });
    expect(navigator.generateInstruction({ stateVersion: 2, map: { position: { u: 2, v: 2 } } }, plan)).toMatchObject({
      action: 'move',
      vector: { u: 10, v: 0 },
    });
  });

  it('builds and traverses connected 3D volumes instead of flattening height', () => {
    const map = new NavMeshBuilder({
      spaceModel: 'spatial-3d',
      coordinateSystem: { horizontal: ['x', 'z'], up: 'y' },
      cellSize: 10,
    }).build({ mapId: 'volume-grid', observations: [
      { position: { x: 2, y: 2, z: 2 }, region: 'walkable' },
      { position: { x: 12, y: 2, z: 2 }, region: 'walkable' },
      { position: { x: 12, y: 12, z: 2 }, region: 'walkable' },
    ] });

    const result = findPolygonPath(map, { x: 2, y: 2, z: 2 }, { x: 12, y: 12, z: 2 });

    expect(map.tiles[0].volumes).toHaveLength(3);
    expect(result).toMatchObject({ status: 'complete', volumeIds: expect.arrayContaining([expect.stringContaining('volume:')]) });
    expect(result.volumeIds).toHaveLength(3);
    expect(result.waypoints.at(-1)).toEqual({ x: 12, y: 12, z: 2 });
  });

  it('keeps obstacle volumes as non-walkable map data', () => {
    const map = new NavMeshBuilder({ spaceModel: 'spatial-3d' }).build({ mapId: 'semantic-volume', observations: [
      { position: { x: 2, y: 1, z: 2 }, region: 'road' },
      { bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 20, y: 5, z: 10 } }, region: 'obstacle' },
    ] });

    expect(map.tiles[0].volumes).toHaveLength(1);
    expect(map.tiles[0].obstacles).toMatchObject([{ region: 'obstacle', bounds: { min: { x: 10, y: 0, z: 0 } } }]);
  });

  it('includes configured movement speed and accepted motion samples in navigation data', () => {
    const map = new NavMeshBuilder({ spaceModel: 'moba-25d' }).build({ mapId: 'motion-map', observations: [
      { position: { x: 2, z: 2 }, region: 'road', motionSample: { speed: 3, durationMs: 100 } },
      { position: { x: 12, z: 2 }, region: 'road' },
    ] });
    const navigator = new HorizontalNavigator({ map, movementSpeed: 3 });
    const plan = navigator.plan({ stateVersion: 1, map: { position: { x: 2, z: 2 } } }, { id: 'move', target: { x: 12, z: 2 } });

    expect(map.motionSamples).toEqual([{ speed: 3, durationMs: 100 }]);
    expect(navigator.generateInstruction({ stateVersion: 1, map: { position: { x: 2, z: 2 } } }, plan)).toMatchObject({ action: 'move', speed: 3 });
  });
});
