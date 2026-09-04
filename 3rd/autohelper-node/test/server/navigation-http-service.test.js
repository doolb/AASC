import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { NavMeshStore } from '../../src/navigation/navmesh-store.js';
import { createNavigationHttpService } from '../../src/server/navigation-http-service.js';

const packageMarkdown = () => {
  const fence = String.fromCharCode(96).repeat(3);
  return [
    fence + 'navigation-json',
    JSON.stringify({
      metadata: { id: 'game' },
      goals: [{ id: 'reach', kind: 'ui', flowId: 'flow' }],
      flows: [{
        id: 'flow',
        navigator: 'ui',
        steps: [
          { id: 'tap', kind: 'action', goto: 'done' },
          { id: 'done', kind: 'terminal', terminal: true },
        ],
      }],
    }),
    fence,
  ].join('\n');
};

const createClient = async (options = {}) => {
  const rootDir = await mkdtemp(join(tmpdir(), 'autohelper-http-navmesh-'));
  const server = createNavigationHttpService({
    navMeshStore: new NavMeshStore({ rootDir }),
    ...options,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    server,
    url: 'http://127.0.0.1:' + address.port,
  };
};

const jsonRequest = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  return { response, body: await response.json() };
};

describe('Navigation HTTP service', () => {
  it('uploads a package and exposes static graph, validation and runtime chain without ADB', async () => {
    const { server, url } = await createClient({
      rootDir: '/tmp/autohelper-http-navmesh',
    });
    try {
      const upload = await jsonRequest(url + '/api/v1/packages', {
        method: 'POST',
        body: JSON.stringify({ markdown: packageMarkdown(), sourcePath: 'game.nav.md' }),
      });
      expect(upload.response.status).toBe(201);
      expect(upload.body.packageId).toBe('game');

      const graph = await jsonRequest(url + '/api/v1/packages/game/graph');
      expect(graph.response.status).toBe(200);
      expect(graph.body.nodes.map((node) => node.id)).toContain('flow:flow:done');

      const validation = await jsonRequest(url + '/api/v1/packages/game/validate');
      expect(validation.body).toEqual([]);

      const session = await jsonRequest(url + '/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ packageId: 'game', goalId: 'reach' }),
      });
      const chain = await jsonRequest(
        url + '/api/v1/sessions/' + session.body.sessionId + '/chain?state=%7B%7D',
      );
      expect(chain.body.chain.nodeIds).toEqual([
        'goal:reach',
        'flow:flow:tap',
        'flow:flow:done',
      ]);
    } finally {
      server.close();
    }
  });

  it('updates a NavMesh tile and calls the registered local YOLO detector', async () => {
    const calls = [];
    const { server, url } = await createClient({
      rootDir: '/tmp/autohelper-http-navmesh-yolo',
      yoloDetector: {
        detect: async (frame, options) => {
          calls.push({ frame, options });
          return [{
            classId: 0,
            label: 'road',
            confidence: 0.9,
            bounds: { x: 0, y: 0, width: 10, height: 10 },
          }];
        },
      },
    });
    try {
      const tile = await jsonRequest(url + '/api/v1/maps/world/tiles', {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: 0,
          tile: { id: 'tile-0', version: 1, vertices: [], polygons: [] },
        }),
      });
      expect(tile.response.status).toBe(200);
      expect(tile.body.revision).toBe(1);

      const yolo = await jsonRequest(url + '/api/v1/vision/yolo', {
        method: 'POST',
        body: JSON.stringify({ imageBase64: Buffer.from('frame').toString('base64'), modelId: 'road' }),
      });
      expect(yolo.response.status).toBe(200);
      expect(yolo.body.detections[0].label).toBe('road');
      expect(calls[0].options).toEqual({ modelId: 'road' });
    } finally {
      server.close();
    }
  });

  it('accepts structured package data and rejects stale NavMesh revisions', async () => {
    const { server, url } = await createClient({
      rootDir: '/tmp/autohelper-http-navmesh-data',
    });
    try {
      await jsonRequest(url + '/api/v1/packages', {
        method: 'POST',
        body: JSON.stringify({ markdown: packageMarkdown() }),
      });
      const added = await jsonRequest(url + '/api/v1/packages/game/data', {
        method: 'POST',
        body: JSON.stringify({
          section: 'goals',
          value: { id: 'extra', kind: 'combat', success: 'combat.won == true' },
        }),
      });
      expect(added.response.status).toBe(200);
      expect(added.body.goals.map((goal) => goal.id)).toContain('extra');

      const stale = await jsonRequest(url + '/api/v1/maps/world/tiles', {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: 0,
          tile: { id: 'tile-0', version: 1, vertices: [], polygons: [] },
        }),
      });
      expect(stale.response.status).toBe(200);
      const conflict = await jsonRequest(url + '/api/v1/maps/world/tiles', {
        method: 'POST',
        body: JSON.stringify({
          expectedRevision: 0,
          tile: { id: 'tile-1', version: 1, vertices: [], polygons: [] },
        }),
      });
      expect(conflict.response.status).toBe(409);
    } finally {
      server.close();
    }
  });
});
