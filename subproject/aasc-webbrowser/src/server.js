'use strict';

const { createHttpApi } = require('./http-api');

function createServer({ registry, browsers, tasks, cdpProxy, shutdown, maxBodyBytes } = {}) {
  const server = createHttpApi({ registry, browsers, tasks, cdpProxy, shutdown }, { maxBodyBytes });
  if (cdpProxy?.attachUpgrade) cdpProxy.attachUpgrade(server);
  return server;
}

module.exports = { createServer };
