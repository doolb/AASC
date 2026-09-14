'use strict';

const crypto = require('node:crypto');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const MAX_PATH_LENGTH = 512;
const MAX_ROUTE_ID_LENGTH = 256;
const DEFAULT_TIMEOUT_MS = 120000;

function createTaskRouteError(message, code, statusCode) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function normalizeRoute(route = {}) {
    const method = String(route.method || '').trim().toUpperCase();
    const routePath = String(route.path || '').trim();
    if (!ALLOWED_METHODS.has(method)) {
        throw createTaskRouteError(`任务路由不支持 HTTP 方法: ${method || '(empty)'}`, 'TASK_ROUTE_METHOD_INVALID', 400);
    }
    if (!routePath || !routePath.startsWith('/') || routePath.includes('?') || routePath.includes('..')) {
        throw createTaskRouteError(`任务路由路径无效: ${routePath || '(empty)'}`, 'TASK_ROUTE_PATH_INVALID', 400);
    }
    if (routePath.length > MAX_PATH_LENGTH) {
        throw createTaskRouteError('任务路由路径过长', 'TASK_ROUTE_PATH_INVALID', 400);
    }
    return { method, path: routePath };
}

function normalizeRouteId(routeId) {
    const value = String(routeId || '').trim();
    if (!value || value.length > MAX_ROUTE_ID_LENGTH) {
        throw createTaskRouteError('任务路由 ID 无效', 'TASK_ROUTE_ID_INVALID', 400);
    }
    return value;
}

function createRequestId() {
    return `task-route-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function toPlainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return { ...value };
}

function normalizeChunk(data, encoding) {
    if (encoding === 'base64' && typeof data === 'string') {
        return Buffer.from(data, 'base64');
    }
    if (Buffer.isBuffer(data)) return data;
    if (data === undefined || data === null) return '';
    return typeof data === 'string' ? data : JSON.stringify(data);
}

class TaskRouteRegistry {
    constructor(options = {}) {
        this.routes = new Map();
        this.routeIds = new Map();
        this.instanceRoutes = new Map();
        this.pendingRequests = new Map();
        this.sendToDisplay = options.sendToDisplay || (() => false);
        this.timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? Math.round(options.timeoutMs)
            : DEFAULT_TIMEOUT_MS;
        this.logger = typeof options.logger === 'function' ? options.logger : () => {};
    }

    registerServerRoute(route = {}) {
        const registration = this._register({
            ...route,
            target: 'server',
            displayId: null,
            handler: route.handler
        });
        const unregister = () => this.unregisterRoute(registration.routeId, route.instanceId);
        unregister.routeId = registration.routeId;
        return unregister;
    }

    registerDisplayRoute(route = {}) {
        const registration = this._register({
            ...route,
            target: 'display',
            routeId: normalizeRouteId(route.routeId),
            handler: null
        });
        return {
            routeId: registration.routeId,
            unregister: () => this.unregisterRoute(registration.routeId, route.instanceId)
        };
    }

    _register(route) {
        const taskName = String(route.taskName || '').trim();
        const instanceId = String(route.instanceId || '').trim();
        if (!taskName || !instanceId) {
            throw createTaskRouteError('任务路由缺少 taskName 或 instanceId', 'TASK_ROUTE_OWNER_INVALID', 400);
        }
        const normalized = normalizeRoute(route);
        if (route.target === 'server' && typeof route.handler !== 'function') {
            throw createTaskRouteError('服务端任务路由必须提供 handler', 'TASK_ROUTE_HANDLER_INVALID', 400);
        }
        if (route.target === 'display' && !String(route.displayId || '').trim()) {
            throw createTaskRouteError('显示端任务路由缺少 displayId', 'TASK_ROUTE_TARGET_INVALID', 400);
        }

        const key = this._routeKey(normalized.method, normalized.path);
        if (this.routes.has(key)) {
            throw createTaskRouteError(
                `任务路由已被占用: ${normalized.method} ${normalized.path}`,
                'TASK_ROUTE_CONFLICT',
                409
            );
        }

        const routeId = normalizeRouteId(route.routeId || `${instanceId}-${crypto.randomBytes(4).toString('hex')}`);
        if (this.routeIds.has(routeId)) {
            throw createTaskRouteError(`任务路由 ID 已存在: ${routeId}`, 'TASK_ROUTE_ID_CONFLICT', 409);
        }
        const entry = {
            routeId,
            taskName,
            instanceId,
            method: normalized.method,
            path: normalized.path,
            target: route.target,
            displayId: route.displayId || null,
            params: route.params || {},
            handler: route.handler || null,
            key
        };
        this.routes.set(key, entry);
        this.routeIds.set(routeId, entry);
        const instanceRouteIds = this.instanceRoutes.get(instanceId) || new Set();
        instanceRouteIds.add(routeId);
        this.instanceRoutes.set(instanceId, instanceRouteIds);
        this.logger('registered', {
            taskName,
            instanceId,
            routeId,
            method: entry.method,
            path: entry.path,
            target: entry.target,
            displayId: entry.displayId
        });
        return entry;
    }

    unregisterRoute(routeId, instanceId = null) {
        const entry = this.routeIds.get(routeId);
        if (!entry || (instanceId && entry.instanceId !== instanceId)) return false;
        for (const [requestId, pending] of this.pendingRequests) {
            if (pending.route.routeId === routeId) {
                this._rejectPending(requestId, 503, '任务路由已注销', 'TASK_ROUTE_UNAVAILABLE', true);
            }
        }
        this.routes.delete(entry.key);
        this.routeIds.delete(entry.routeId);
        const instanceRouteIds = this.instanceRoutes.get(entry.instanceId);
        if (instanceRouteIds) {
            instanceRouteIds.delete(entry.routeId);
            if (instanceRouteIds.size === 0) this.instanceRoutes.delete(entry.instanceId);
        }
        this.logger('unregistered', {
            taskName: entry.taskName,
            instanceId: entry.instanceId,
            routeId: entry.routeId,
            method: entry.method,
            path: entry.path
        });
        return true;
    }

    unregisterInstance(instanceId) {
        const routeIds = [...(this.instanceRoutes.get(instanceId) || [])];
        for (const routeId of routeIds) this.unregisterRoute(routeId, instanceId);
        return routeIds.length;
    }

    unregisterDisplay(displayId) {
        const pendingIds = [...this.pendingRequests.entries()]
            .filter(([, pending]) => pending.route.displayId === displayId)
            .map(([requestId]) => requestId);
        for (const requestId of pendingIds) {
            this._rejectPending(requestId, 503, '目标显示端已断开', 'TASK_ROUTE_TARGET_UNAVAILABLE', false);
        }

        const targetRoutes = [...this.routes.values()]
            .filter((route) => route.target === 'display' && route.displayId === displayId);
        for (const route of targetRoutes) this.unregisterRoute(route.routeId, route.instanceId);
        return targetRoutes.length;
    }

    getRoutes() {
        return [...this.routes.values()].map((route) => ({
            routeId: route.routeId,
            taskName: route.taskName,
            instanceId: route.instanceId,
            method: route.method,
            path: route.path,
            target: route.target,
            displayId: route.displayId
        }));
    }

    handleRequest(req, res) {
        const requestPath = this._getRequestPath(req);
        const method = String(req?.method || '').toUpperCase();
        const route = this.routes.get(this._routeKey(method, requestPath));
        if (!route) return false;

        const request = {
            method,
            path: requestPath,
            query: toPlainObject(req.query),
            headers: toPlainObject(req.headers),
            body: req.body
        };
        if (route.target === 'server') {
            this._dispatchServerRoute(route, request, res);
            return true;
        }
        this._dispatchDisplayRoute(route, request, res);
        return true;
    }

    _dispatchServerRoute(route, request, res) {
        const response = createExpressResponseAdapter(res);
        Promise.resolve()
            .then(() => route.handler({
                request,
                response,
                taskName: route.taskName,
                instanceId: route.instanceId,
                params: route.params
            }))
            .then((result) => {
                if (response.writableEnded || response.writableFinished) return;
                if (result === undefined) response.end();
                else response.json(result);
            })
            .catch((error) => {
                if (response.writableEnded || response.writableFinished) return;
                const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
                response.status(statusCode).json({
                    error: {
                        code: error?.code || 'TASK_ROUTE_HANDLER_ERROR',
                        message: error?.message || '任务路由处理失败'
                    }
                });
            });
    }

    _dispatchDisplayRoute(route, request, res) {
        const requestId = createRequestId();
        const pending = {
            requestId,
            route,
            response: res,
            timer: null,
            onClose: null
        };
        pending.timer = setTimeout(() => {
            this._rejectPending(requestId, 504, '任务路由请求超时', 'TASK_ROUTE_TIMEOUT', true);
        }, this.timeoutMs);
        if (typeof res.once === 'function') {
            pending.onClose = () => {
                if (!res.writableEnded && !res.writableFinished) {
                    this._rejectPending(requestId, 499, 'HTTP 客户端已断开', 'TASK_ROUTE_CLIENT_DISCONNECTED', true);
                }
            };
            res.once('close', pending.onClose);
        }
        this.pendingRequests.set(requestId, pending);

        const message = {
            type: 'task:route_request',
            payload: {
                routeId: route.routeId,
                requestId,
                taskName: route.taskName,
                instanceId: route.instanceId,
                request
            }
        };
        let sent = false;
        try {
            sent = this.sendToDisplay(route.displayId, message) === true;
        } catch (error) {
            this.logger('send-error', { requestId, message: error.message });
        }
        if (!sent) {
            this._rejectPending(requestId, 503, '目标显示端不在线', 'TASK_ROUTE_TARGET_UNAVAILABLE', false);
        }
    }

    handleDisplayResponse(displayId, payload = {}) {
        const requestId = String(payload.requestId || '').trim();
        const pending = this.pendingRequests.get(requestId);
        if (!pending || pending.route.target !== 'display' || pending.route.displayId !== displayId) return false;
        if (payload.routeId !== pending.route.routeId) return false;
        if (pending.timer) {
            clearTimeout(pending.timer);
            pending.timer = setTimeout(() => {
                this._rejectPending(requestId, 504, '任务路由请求超时', 'TASK_ROUTE_TIMEOUT', true);
            }, this.timeoutMs);
        }

        const response = createExpressResponseAdapter(pending.response);
        try {
            if (payload.event === 'headers') {
                this._applyResponseHeaders(response, payload.statusCode, payload.headers);
                return true;
            }
            if (payload.event === 'chunk') {
                this._applyResponseHeaders(response, payload.statusCode, payload.headers);
                response.write(normalizeChunk(payload.data, payload.encoding));
                return true;
            }
            if (payload.event === 'error') {
                this._rejectPending(
                    requestId,
                    Number.isInteger(payload.statusCode) ? payload.statusCode : 502,
                    payload.message || '显示端任务路由处理失败',
                    payload.code || 'TASK_ROUTE_HANDLER_ERROR',
                    false
                );
                return true;
            }
            if (payload.event !== 'end') return false;

            this._applyResponseHeaders(response, payload.statusCode, payload.headers);
            this._finishPending(requestId);
            if (payload.bodyType === 'json') {
                if (response.headersSent) response.end(JSON.stringify(payload.body));
                else response.json(payload.body);
            } else {
                response.end(normalizeChunk(payload.data, payload.encoding));
            }
            return true;
        } catch (error) {
            this._rejectPending(requestId, 502, error.message, 'TASK_ROUTE_RESPONSE_INVALID', false);
            return true;
        }
    }

    handleDisplayCancel(displayId, payload = {}) {
        const pending = this.pendingRequests.get(String(payload.requestId || '').trim());
        if (!pending || pending.route.displayId !== displayId) return false;
        this._rejectPending(pending.requestId, 499, '显示端取消任务路由请求', 'TASK_ROUTE_CANCELLED', false);
        return true;
    }

    _applyResponseHeaders(response, statusCode, headers) {
        if (Number.isInteger(statusCode) && statusCode >= 100 && statusCode <= 599) {
            response.status(statusCode);
        }
        if (!response.headersSent) {
            for (const [name, value] of Object.entries(toPlainObject(headers))) {
                response.setHeader(name, value);
            }
        }
    }

    _rejectPending(requestId, statusCode, message, code, sendCancel) {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) return false;
        this._finishPending(requestId);
        if (sendCancel && pending.route.displayId) {
            try {
                this.sendToDisplay(pending.route.displayId, {
                    type: 'task:route_cancel',
                    payload: {
                        routeId: pending.route.routeId,
                        requestId,
                        instanceId: pending.route.instanceId
                    }
                });
            } catch (error) {
                this.logger('cancel-send-error', { requestId, message: error.message });
            }
        }
        const response = createExpressResponseAdapter(pending.response);
        if (!response.writableEnded && !response.writableFinished) {
            response.status(statusCode).json({ error: { code, message } });
        }
        return true;
    }

    _finishPending(requestId) {
        const pending = this.pendingRequests.get(requestId);
        if (!pending) return;
        if (pending.timer) clearTimeout(pending.timer);
        if (pending.onClose && typeof pending.response.removeListener === 'function') {
            pending.response.removeListener('close', pending.onClose);
        }
        this.pendingRequests.delete(requestId);
    }

    _getRequestPath(req) {
        if (typeof req?.path === 'string' && req.path) return req.path;
        const rawUrl = String(req?.url || '/');
        return rawUrl.split('?')[0] || '/';
    }

    _routeKey(method, routePath) {
        return `${method} ${routePath}`;
    }

    destroy() {
        for (const requestId of [...this.pendingRequests.keys()]) {
            this._rejectPending(requestId, 503, '任务路由服务已关闭', 'TASK_ROUTE_SHUTDOWN', false);
        }
        this.routes.clear();
        this.routeIds.clear();
        this.instanceRoutes.clear();
    }
}

function createExpressResponseAdapter(res) {
    const adapter = {
        get writableEnded() {
            return res.writableEnded === true;
        },
        get writableFinished() {
            return res.writableFinished === true;
        },
        get headersSent() {
            return res.headersSent === true;
        },
        status(statusCode) {
            if (typeof res.status === 'function') res.status(statusCode);
            else res.statusCode = statusCode;
            return adapter;
        },
        setHeader(name, value) {
            if (typeof res.setHeader === 'function') res.setHeader(name, value);
            return adapter;
        },
        set(name, value) {
            return adapter.setHeader(name, value);
        },
        json(payload) {
            if (typeof res.json === 'function') res.json(payload);
            else {
                adapter.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(JSON.stringify(payload));
            }
            return adapter;
        },
        send(payload) {
            if (typeof res.send === 'function') res.send(payload);
            else res.end(payload);
            return adapter;
        },
        write(chunk) {
            return res.write(chunk);
        },
        end(chunk) {
            return res.end(chunk);
        },
        flushHeaders() {
            if (typeof res.flushHeaders === 'function') res.flushHeaders();
            return adapter;
        },
        once(event, handler) {
            if (typeof res.once === 'function') res.once(event, handler);
            return adapter;
        },
        removeListener(event, handler) {
            if (typeof res.removeListener === 'function') res.removeListener(event, handler);
            return adapter;
        }
    };
    return adapter;
}

module.exports = {
    TaskRouteRegistry,
    createTaskRouteError,
    normalizeRoute
};
