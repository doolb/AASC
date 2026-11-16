'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../src/config');
const { createService } = require('../src/index');

test('parseArgs accepts only the config override', () => {
  assert.deepEqual(parseArgs([]), {});
  assert.deepEqual(parseArgs(['--config', 'custom.json']), { configPath: 'custom.json' });
});

test('createService is side-effect free until start and shuts down once', async () => {
  let closed = 0;
  const service = createService({
    config: { host: '127.0.0.1', port: 0, browsers: {}, businesses: {} },
    createRegistry: () => ({ close: async () => { closed += 1; } }),
    createBusinessRegistry: () => ({ close: async () => { closed += 1; } }),
    createProxy: () => ({ close: async () => { closed += 1; } })
  });
  assert.equal(service.started, false);
  await service.shutdown();
  await service.shutdown();
  assert.equal(closed, 3);
});
