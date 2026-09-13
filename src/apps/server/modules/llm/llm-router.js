'use strict';

function createRouterError(message, code, statusCode = 503, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    Object.assign(error, details);
    return error;
}

function normalizeDisplayId(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeStatus(displayId, status = {}) {
    const capabilities = status.capabilities || {};
    const capability = capabilities.llm || {};
    const hasCapabilityEnabled = capability && typeof capability.enabled === 'boolean';
    const enabled = hasCapabilityEnabled
        ? capability.enabled
        : status.enabled !== false;
    const detectedSupported = status.supported === true
        || status.llmSupported === true
        || capability.supported === true;
    const supported = enabled && detectedSupported;
    const selectedModelId = normalizeDisplayId(status.selectedModelId);
    const state = typeof status.state === 'string' && status.state.trim()
        ? status.state.trim()
        : (status.ready === true ? 'ready' : 'not_ready');
    return {
        displayId,
        state,
        connected: status.connected !== false,
        enabled,
        supported,
        ready: supported && status.ready === true,
        selectedModelId,
        selectedRevision: normalizeDisplayId(status.selectedRevision),
        activeRequests: Number.isInteger(status.activeRequests) && status.activeRequests >= 0
            ? status.activeRequests
            : 0,
        queueDepth: Number.isInteger(status.queueDepth) && status.queueDepth >= 0
            ? status.queueDepth
            : 0,
        error: typeof status.error === 'string' ? status.error : null
    };
}

class LlmRouter {
    constructor({ maxQueueLength = 16, logger = () => {} } = {}) {
        this.maxQueueLength = Number.isInteger(maxQueueLength) && maxQueueLength > 0
            ? maxQueueLength
            : 16;
        this.logger = logger;
        this.displays = new Map();
        this.requests = new Map();
    }

    registerDisplay(displayId, status = {}) {
        const normalizedId = normalizeDisplayId(displayId);
        if (!normalizedId) return null;
        const current = this.displays.get(normalizedId);
        const next = normalizeStatus(normalizedId, {
            ...(current || {}),
            ...status,
            connected: true
        });
        this.displays.set(normalizedId, next);
        return { ...next };
    }

    updateDisplayStatus(displayId, status = {}) {
        return this.registerDisplay(displayId, status);
    }

    unregisterDisplay(displayId) {
        const normalizedId = normalizeDisplayId(displayId);
        if (!normalizedId) return [];
        const current = this.displays.get(normalizedId);
        if (current) {
            this.displays.set(normalizedId, normalizeStatus(normalizedId, {
                ...current,
                connected: false,
                ready: false
            }));
        }
        return [...this.requests.values()]
            .filter((request) => request.displayId === normalizedId)
            .map((request) => request.requestId);
    }

    getDisplayStatus(displayId) {
        const status = this.displays.get(displayId);
        return status ? { ...status } : null;
    }

    listDisplayStatuses() {
        return [...this.displays.values()].map((status) => ({ ...status }));
    }

    getCandidates(modelId) {
        return [...this.displays.values()]
            .filter((display) => display.connected
                && display.supported
                && display.ready
                && display.selectedModelId === modelId)
            .sort((left, right) => {
                const leftLoad = left.activeRequests + left.queueDepth;
                const rightLoad = right.activeRequests + right.queueDepth;
                return leftLoad - rightLoad || left.displayId.localeCompare(right.displayId);
            });
    }

    resolveTarget({ modelId, displayId = null }) {
        const normalizedModelId = normalizeDisplayId(modelId);
        if (!normalizedModelId) {
            throw createRouterError('缺少模型名', 'LLM_MODEL_REQUIRED', 400);
        }
        const normalizedDisplayId = normalizeDisplayId(displayId);
        if (normalizedDisplayId) {
            const target = this.displays.get(normalizedDisplayId);
            if (!target || !target.connected || !target.supported || !target.ready) {
                throw createRouterError('指定显示端不可用', 'LLM_TARGET_UNAVAILABLE', 503, {
                    displayId: normalizedDisplayId
                });
            }
            if (target.selectedModelId !== normalizedModelId) {
                throw createRouterError('指定显示端未加载请求模型', 'LLM_MODEL_MISMATCH', 409, {
                    displayId: normalizedDisplayId
                });
            }
            if (target.activeRequests + target.queueDepth >= this.maxQueueLength) {
                throw createRouterError('指定显示端 LLM 队列已满', 'LLM_QUEUE_FULL', 429, {
                    displayId: normalizedDisplayId
                });
            }
            return { ...target };
        }

        const candidates = this.getCandidates(normalizedModelId);
        const target = candidates.find((candidate) => (
            candidate.activeRequests + candidate.queueDepth < this.maxQueueLength
        ));
        if (target) return { ...target };
        if (candidates.length > 0) {
            throw createRouterError('LLM 队列已满', 'LLM_QUEUE_FULL', 429);
        }
        throw createRouterError('没有可用的本地 LLM 显示端', 'LLM_TARGET_UNAVAILABLE', 503);
    }

    acquire(requestId, { modelId, displayId = null }) {
        const target = this.resolveTarget({ modelId, displayId });
        const current = this.displays.get(target.displayId);
        current.queueDepth += 1;
        const request = {
            requestId,
            modelId,
            displayId: target.displayId,
            active: false
        };
        this.requests.set(requestId, request);
        this.logger('queued', { ...request, targetLoad: current.activeRequests + current.queueDepth });
        return { ...request, target: { ...current } };
    }

    markActive(requestId) {
        const request = this.requests.get(requestId);
        if (!request || request.active) return false;
        const display = this.displays.get(request.displayId);
        if (!display) return false;
        display.queueDepth = Math.max(0, display.queueDepth - 1);
        display.activeRequests += 1;
        request.active = true;
        return true;
    }

    release(requestId) {
        const request = this.requests.get(requestId);
        if (!request) return false;
        const display = this.displays.get(request.displayId);
        if (display) {
            if (request.active) {
                display.activeRequests = Math.max(0, display.activeRequests - 1);
            } else {
                display.queueDepth = Math.max(0, display.queueDepth - 1);
            }
        }
        this.requests.delete(requestId);
        this.logger('released', { ...request });
        return true;
    }

    getRequest(requestId) {
        const request = this.requests.get(requestId);
        return request ? { ...request } : null;
    }
}

module.exports = {
    LlmRouter,
    createRouterError,
    normalizeStatus
};
