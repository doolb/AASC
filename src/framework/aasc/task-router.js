'use strict';

const DISPLAY_TARGETS = new Set(['display', 'subdisplay']);

/**
 * AASC 任务路由器。
 *
 * 自动路由必须显式通过 routing=display-first 或 target=auto 开启，
 * 这样历史任务仍按原目标执行，不会因新增显示端而改变运行位置。
 */
class AascTaskRouter {
    constructor(options = {}) {
        this.getDisplays = options.getDisplays || (() => []);
        this.getCurrentServer = options.getCurrentServer || (() => ({ nodeId: 'main-server' }));
    }

    resolve(task = {}) {
        if (DISPLAY_TARGETS.has(task.target)) {
            return {
                target: task.target,
                displayId: task.displayId || null,
                reason: 'explicit-display'
            };
        }

        if (task.target === 'server' && task.routing !== 'display-first') {
            return this._serverRoute('explicit-server');
        }

        const display = this._findMatchingDisplay(task.requiredCapabilities);
        if (display) {
            return {
                target: 'display',
                displayId: display.id,
                reason: 'capability-match'
            };
        }
        return this._serverRoute('display-unavailable');
    }

    _findMatchingDisplay(requiredCapabilities) {
        const required = normalizeRequiredCapabilities(requiredCapabilities);
        return this.getDisplays().find(display => {
            if (!display || !display.id || display.online === false) return false;
            const capabilities = display.capabilities || {};
            return required.every(capability => capabilities[capability] === true);
        }) || null;
    }

    _serverRoute(reason) {
        const server = this.getCurrentServer() || {};
        return {
            target: 'server',
            nodeId: server.nodeId || server.id || 'main-server',
            reason
        };
    }
}

function normalizeRequiredCapabilities(value) {
    if (Array.isArray(value)) {
        return value.filter(capability => typeof capability === 'string' && capability);
    }
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value)
        .filter(([, enabled]) => enabled === true)
        .map(([capability]) => capability);
}

module.exports = {
    AascTaskRouter,
    normalizeRequiredCapabilities
};
