'use strict';

const http = require('node:http');
const path = require('node:path');
const { loadConfig, parseArgs } = require('./config');
const { BrowserRegistry } = require('./browser-registry');
const { BusinessRegistry } = require('./business-registry');
const { TaskStore } = require('./task-store');
const { createServer } = require('./server');
const { CdpProxy } = require('./cdp-proxy');

function createService({
  config,
  createRegistry = options => new BrowserRegistry(options),
  createBusinessRegistry = options => new BusinessRegistry(options),
  createProxy = options => new CdpProxy(options)
} = {}) {
  if (!config) throw new Error('config is required');
  const taskStore = new TaskStore();
  const browserRegistry = createRegistry({ browsers: config.browsers });
  const businessRegistry = createBusinessRegistry({ businesses: config.businesses, browsers: browserRegistry, taskStore });
  const proxy = createProxy({ browsers: browserRegistry, businessRegistry, queueForTarget: targetId => businessRegistry.queueForTarget(targetId), publicOrigin: `http://${config.host}:${config.port}` });
  let server;
  let started = false;
  let shuttingDown = null;
  const api = createServer({
    registry: businessRegistry,
    browsers: browserRegistry,
    tasks: taskStore,
    cdpProxy: proxy,
    shutdown: () => service.shutdown()
  });

  const service = {
    get server() { return server; },
    get started() { return started; },
    browserRegistry,
    businessRegistry,
    proxy,
    async start() {
      if (started) return service;
      await new Promise((resolve, reject) => {
        api.once('error', reject);
        api.listen(config.port, config.host, resolve);
      });
      server = api;
      started = true;
      return service;
    },
    async shutdown() {
      if (shuttingDown) return shuttingDown;
      shuttingDown = (async () => {
        await businessRegistry.close?.();
        await proxy.close?.();
        await browserRegistry.close?.();
        if (started) await new Promise(resolve => api.close(() => resolve()));
        started = false;
      })();
      return shuttingDown;
    }
  };
  return service;
}

async function startService(config) {
  const service = createService({ config });
  await service.start();
  return service;
}

if (require.main === module) {
  const { configPath } = parseArgs(process.argv.slice(2));
  const config = loadConfig(configPath || path.join(__dirname, '..', 'config.json'));
  const servicePromise = startService(config);
  const stop = () => servicePromise.then(service => service.shutdown()).catch(error => { console.error(error); process.exitCode = 1; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  servicePromise.catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { createService, startService };
