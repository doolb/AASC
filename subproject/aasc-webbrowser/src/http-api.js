'use strict';

const { URL } = require('node:url');

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;
const MAX_URL_LENGTH = 8192;
const MAX_SCRIPT_LENGTH = 128 * 1024;
const ALLOWED_ACTIONS = new Set(['click', 'type', 'text', 'html', 'evaluate', 'screenshot', 'pdf', 'downloadStatus']);

function apiError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}

function matchPath(pathname, pattern) {
  const match = pathname.match(pattern);
  return match?.groups || null;
}

function createHttpApi({ registry, browsers, tasks, shutdown = async () => {}, cdpProxy = null } = {}, { maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  const http = require('node:http');
  const server = http.createServer(async (request, response) => {
    try {
      if (cdpProxy && request.url.startsWith('/cdp/')) {
        const result = await routeCdp(request, cdpProxy);
        return sendJson(response, result.status || 200, result.body);
      }
      const result = await route(request, { registry, browsers, tasks, shutdown, maxBodyBytes });
      sendJson(response, result.status || 200, result.body);
    } catch (error) {
      sendJson(response, error.statusCode || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.message || 'Internal server error' } });
    }
  });
  return server;
}

async function routeCdp(request, cdpProxy) {
  const url = new URL(request.url, 'http://localhost');
  const match = url.pathname.match(/^\/cdp\/([^/]+)\/json\/(version|list|new|close\/([^/]+))$/);
  if (request.method !== 'GET' || !match) throw apiError('NOT_FOUND', 'Route not found', 404);
  const browserId = decodeURIComponent(match[1]);
  const kind = match[2].startsWith('close/') ? 'close' : match[2];
  if (kind === 'new') return { body: await cdpProxy.discovery(browserId, 'new') };
  if (kind === 'close') return { body: await cdpProxy.discovery(browserId, 'close', decodeURIComponent(match[3])) };
  return { body: await cdpProxy.discovery(browserId, kind) };
}

async function readJson(request, maxBodyBytes) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBodyBytes) throw apiError('REQUEST_TOO_LARGE', 'Request body is too large', 413);
    chunks.push(chunk);
  }
  if (!total) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw apiError('INVALID_JSON', 'Request body must be valid JSON', 400);
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

async function route(request, dependencies) {
  const { registry, browsers, tasks, shutdown, maxBodyBytes } = dependencies;
  if (request.url.length > MAX_URL_LENGTH) throw apiError('URL_TOO_LONG', 'Request URL is too long', 414);
  const url = new URL(request.url, 'http://localhost');
  const pathname = url.pathname;
  const method = request.method;
  if (method === 'GET' && pathname === '/api/status') return { body: { ok: true, browsers: browsers.list(), businesses: registry.list() } };
  if (method === 'GET' && pathname === '/api/browsers') return { body: browsers.list() };
  const browserMatch = matchPath(pathname, /^\/api\/browsers\/(?<browserId>[^/]+)\/ensure$/);
  if (method === 'POST' && browserMatch) return { body: (await browsers.ensure(browserMatch.browserId)).status() };
  if (method === 'GET' && pathname === '/api/businesses') return { body: registry.list() };
  const businessMatch = matchPath(pathname, /^\/api\/businesses\/(?<businessId>[^/]+)$/);
  if (method === 'GET' && businessMatch) {
    const snapshot = registry.getBusinessSnapshot(businessMatch.businessId);
    if (!snapshot) throw apiError('BUSINESS_NOT_FOUND', `Unknown business ${businessMatch.businessId}`, 404);
    return { body: snapshot };
  }
  const ensureBusinessMatch = matchPath(pathname, /^\/api\/businesses\/(?<businessId>[^/]+)\/ensure$/);
  if (method === 'POST' && ensureBusinessMatch) return { body: registry.getBusinessSnapshot((await registry.ensureBusiness(ensureBusinessMatch.businessId)).businessId) };
  const subMatch = matchPath(pathname, /^\/api\/businesses\/(?<businessId>[^/]+)\/sub-businesses\/(?<subBusinessId>[^/]+)\/(?<operation>ensure|navigate|action|activate)$/);
  if (method === 'POST' && subMatch) {
    const body = await readJson(request, maxBodyBytes);
    const { businessId, subBusinessId, operation } = subMatch;
    if (operation === 'ensure') return { body: await registry.ensureSubBusiness(businessId, subBusinessId) };
    if (operation === 'activate') return { status: 202, body: await registry.activateSubBusiness(businessId, subBusinessId) };
    const tab = await registry.ensureSubBusiness(businessId, subBusinessId);
    const business = registry.get(businessId);
    if (operation === 'navigate') {
      if (typeof body.url !== 'string' || !body.url || body.url.length > MAX_URL_LENGTH) throw apiError('INVALID_URL', 'url is required and must be bounded');
      try { new URL(body.url); } catch { throw apiError('INVALID_URL', 'url must be valid'); }
      return { status: 202, body: business.queue.enqueue(async () => navigateTab(tab, body.url), { businessId, subBusinessId, operation }) };
    }
    if (!ALLOWED_ACTIONS.has(body.action)) throw apiError('INVALID_ACTION', 'Unsupported action');
    if (body.action === 'evaluate' && typeof body.script === 'string' && body.script.length > MAX_SCRIPT_LENGTH) throw apiError('SCRIPT_TOO_LARGE', 'evaluate script is too large', 413);
    return { status: 202, body: business.queue.enqueue(async () => performAction(tab, body), { businessId, subBusinessId, operation }) };
  }
  const taskMatch = matchPath(pathname, /^\/api\/tasks\/(?<taskId>[^/]+)$/);
  if (method === 'GET' && taskMatch) {
    const task = tasks.get(taskMatch.taskId);
    if (!task) throw apiError('TASK_NOT_FOUND', `Unknown task ${taskMatch.taskId}`, 404);
    return { body: task };
  }
  if (method === 'POST' && pathname === '/api/shutdown') {
    await shutdown();
    return { body: { ok: true } };
  }
  throw apiError('NOT_FOUND', 'Route not found', 404);
}

async function navigateTab(tab, url) {
  tab.url = url;
  tab.lastActivityAt = new Date().toISOString();
  return { targetId: tab.targetId, url };
}

async function performAction(tab, action) {
  tab.lastActivityAt = new Date().toISOString();
  if (action.action === 'text') return { targetId: tab.targetId, text: '' };
  if (action.action === 'html') return { targetId: tab.targetId, html: '' };
  return { targetId: tab.targetId, action: action.action, ok: true };
}

module.exports = { createHttpApi, route, readJson, apiError };
