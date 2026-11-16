'use strict';

const { URL } = require('node:url');
const http = require('node:http');
const { WebSocket } = require('ws');

function proxyEndpoint(origin, browserId, suffix) {
  const url = new URL(origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/cdp/${encodeURIComponent(browserId)}${suffix}`;
  return url.toString();
}

class CdpProxy {
  constructor({ browsers, publicOrigin = 'http://127.0.0.1:3090', queueForTarget = async () => null } = {}) {
    this.browsers = browsers;
    this.publicOrigin = publicOrigin;
    this.queueForTarget = queueForTarget;
    this.sessions = new Set();
  }

  browser(id) {
    return this.browsers.require(id);
  }

  async discovery(browserId, kind, targetId) {
    const browser = await this.ensureBrowser(browserId);
    const upstream = browser.upstream || {};
    if (kind === 'version') {
      const version = typeof upstream.version === 'function' ? await upstream.version() : upstream.version;
      return {
        ...version,
        webSocketDebuggerUrl: proxyEndpoint(this.publicOrigin, browserId, `/devtools/browser/${this.sessionId(version.webSocketDebuggerUrl)}`)
      };
    }
    if (kind === 'list') {
      const list = typeof upstream.list === 'function' ? await upstream.list() : upstream.list || [];
      return list.map(target => ({ ...target, webSocketDebuggerUrl: proxyEndpoint(this.publicOrigin, browserId, `/devtools/page/${target.id}`) }));
    }
    if (kind === 'new') {
      const result = await this.request(browserId, '/json/new', 'PUT');
      return { ...result, webSocketDebuggerUrl: proxyEndpoint(this.publicOrigin, browserId, `/devtools/page/${result.id}`) };
    }
    if (kind === 'close') return this.request(browserId, `/json/close/${encodeURIComponent(targetId)}`, 'GET');
    throw Object.assign(new Error('unknown discovery resource'), { statusCode: 404, code: 'NOT_FOUND' });
  }

  async ensureBrowser(browserId) {
    const browser = this.browser(browserId);
    if (typeof browser.ensure === 'function') await browser.ensure();
    if (!browser.upstream) browser.upstream = this.createHttpUpstream(browser);
    return browser;
  }

  createHttpUpstream(browser) {
    const host = '127.0.0.1';
    const port = browser.debugPort;
    const json = pathname => new Promise((resolve, reject) => {
      const request = http.get({ host, port, path: pathname }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
    });
    return {
      version: () => json('/json/version'),
      list: () => json('/json/list'),
      connect: ({ targetId, browser: browserConnection }) => {
        const endpoint = browserConnection
          ? `ws://127.0.0.1:${port}/devtools/browser/${browserConnection}`
          : `ws://127.0.0.1:${port}/devtools/page/${targetId}`;
        return new Promise((resolve, reject) => {
          const socket = new WebSocket(endpoint);
          socket.once('open', () => resolve(socket));
          socket.once('error', reject);
        });
      }
    };
  }

  request(browserId, pathname, method) {
    const browser = this.browser(browserId);
    return new Promise((resolve, reject) => {
      const request = http.request({ host: '127.0.0.1', port: browser.debugPort, path: pathname, method }, response => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
        });
      });
      request.on('error', reject);
      request.end();
    });
  }

  sessionId(endpoint) {
    return String(endpoint).split('/').pop() || 'session';
  }

  async attachPage(browserId, targetId, client) {
    const browser = this.browser(browserId);
    const upstream = await browser.upstream.connect({ targetId });
    const connection = { client, upstream, browserId, targetId };
    this.sessions.add(connection);
    const close = () => {
      this.sessions.delete(connection);
      if (client.readyState === 1) client.close();
      if (upstream.readyState === 1) upstream.close();
    };
    client.on('message', data => this.forwardCommand(connection, data));
    client.on('close', close);
    upstream.on('message', data => {
      if (client.readyState === 1) client.send(data.toString());
    });
    upstream.on('close', close);
    return connection;
  }

  async forwardCommand(connection, data) {
    const send = () => {
      if (connection.upstream.readyState === 1) connection.upstream.send(data.toString());
    };
    const queue = await this.queueForTarget(connection.browserId, connection.targetId);
    if (queue) {
      const task = queue.enqueue(send, { operation: 'cdp', targetId: connection.targetId });
      await task.done;
    } else {
      send();
    }
  }

  attachUpgrade(server) {
    const wss = new (require('ws').WebSocketServer)({ noServer: true });
    server.on('upgrade', async (request, socket, head) => {
      const match = request.url.match(/^\/cdp\/([^/]+)\/devtools\/(page|browser)\/([^/?]+)/);
      if (!match) return socket.destroy();
      const browserId = decodeURIComponent(match[1]);
      try {
        this.browser(browserId);
        wss.handleUpgrade(request, socket, head, client => {
          if (match[2] === 'page') this.attachPage(browserId, decodeURIComponent(match[3]), client).catch(() => client.close());
          else this.attachBrowser(browserId, client).catch(() => client.close());
        });
      } catch {
        socket.destroy();
      }
    });
    return wss;
  }

  async attachBrowser(browserId, client) {
    const browser = this.browser(browserId);
    const upstream = await browser.upstream.connect({ browser: true });
    const connection = { client, upstream, browserId };
    this.sessions.add(connection);
    const close = () => {
      this.sessions.delete(connection);
      if (client.readyState === 1) client.close();
      if (upstream.readyState === 1) upstream.close();
    };
    client.on('message', data => this.forwardCommand(connection, data));
    client.on('close', close);
    upstream.on('message', data => { if (client.readyState === 1) client.send(data.toString()); });
    upstream.on('close', close);
    return connection;
  }

  async close() {
    for (const connection of [...this.sessions]) {
      if (connection.client.readyState === 1) connection.client.close();
      if (connection.upstream.readyState === 1) connection.upstream.close();
    }
    this.sessions.clear();
  }
}

module.exports = { CdpProxy, proxyEndpoint };
