'use strict';

const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * AASC 当前目标服务器路由管理器。
 *
 * 路由管理器只保存“用户选择的目标”和“因节点离线产生的临时回退”两类状态，
 * 不直接处理 WebSocket 或媒体业务。节点恢复后只有自动回退产生的状态才会自动
 * 恢复；用户手动选择主服务器后，不会被子服务器恢复事件覆盖。
 */
class AascServerRouteManager {
    constructor(options = {}) {
        this.mainNodeId = normalizeNodeId(options.mainNodeId || 'main-server');
        this.getNodes = options.getNodes || (() => []);
        this.onChange = options.onChange || (() => {});
        this.pollIntervalMs = normalizePositiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
        this.setInterval = options.setInterval || ((callback, delay) => setInterval(callback, delay));
        this.clearInterval = options.clearInterval || ((timer) => clearInterval(timer));
        this.timer = null;
        this.selection = {
            nodeId: this.mainNodeId,
            manualMainOverride: false,
            fallbackNodeId: null,
            reason: 'initial'
        };
    }

    start() {
        if (this.timer !== null) return this.getSnapshot();
        this.sync();
        this.timer = this.setInterval(() => this.sync(), this.pollIntervalMs);
        return this.getSnapshot();
    }

    stop() {
        if (this.timer !== null) {
            this.clearInterval(this.timer);
            this.timer = null;
        }
    }

    select(nodeId) {
        const normalizedNodeId = normalizeNodeId(nodeId);
        if (!normalizedNodeId) {
            throw new TypeError('目标服务器 nodeId 必填');
        }

        const node = this._findNode(normalizedNodeId);
        if (!node) {
            throw new Error(`目标服务器不存在: ${normalizedNodeId}`);
        }
        if (normalizedNodeId !== this.mainNodeId && node.status !== 'online') {
            throw new Error(`目标服务器当前离线: ${normalizedNodeId}`);
        }

        const previous = this.getSnapshot();
        this.selection = {
            nodeId: normalizedNodeId,
            manualMainOverride: normalizedNodeId === this.mainNodeId,
            fallbackNodeId: null,
            reason: 'manual-selection'
        };
        this._emitIfChanged(previous);
        return this.getSnapshot();
    }

    sync() {
        const previous = this.getSnapshot();
        const selectedNode = this._findNode(this.selection.nodeId);
        const selectedOnline = selectedNode && selectedNode.status === 'online';

        if (this.selection.manualMainOverride) {
            this.selection.nodeId = this.mainNodeId;
            this.selection.fallbackNodeId = null;
            this.selection.reason = 'manual-main';
            this._emitIfChanged(previous);
            return this.getSnapshot();
        }

        if (this.selection.nodeId !== this.mainNodeId && !selectedOnline) {
            this.selection.fallbackNodeId = this.selection.nodeId;
            this.selection.nodeId = this.mainNodeId;
            this.selection.reason = 'automatic-fallback';
        } else if (
            this.selection.nodeId === this.mainNodeId
            && this.selection.fallbackNodeId
            && this._isOnline(this.selection.fallbackNodeId)
        ) {
            this.selection.nodeId = this.selection.fallbackNodeId;
            this.selection.fallbackNodeId = null;
            this.selection.reason = 'automatic-recovery';
        }

        this._emitIfChanged(previous);
        return this.getSnapshot();
    }

    getSnapshot() {
        const nodes = this._normalizeNodes(this.getNodes());
        const activeNode = nodes.find(node => node.nodeId === this.selection.nodeId) || {
            nodeId: this.mainNodeId,
            id: this.mainNodeId,
            name: '主服务器',
            status: 'online',
            healthy: true
        };
        return {
            activeNodeId: this.selection.nodeId,
            selectedNodeId: this.selection.nodeId,
            fallbackNodeId: this.selection.fallbackNodeId,
            manualMainOverride: this.selection.manualMainOverride,
            reason: this.selection.reason,
            activeNode,
            nodes
        };
    }

    _findNode(nodeId) {
        return this._normalizeNodes(this.getNodes()).find(node => node.nodeId === nodeId) || null;
    }

    _isOnline(nodeId) {
        const node = this._findNode(nodeId);
        return Boolean(node && node.status === 'online');
    }

    _normalizeNodes(nodes) {
        if (!Array.isArray(nodes)) return [];
        return nodes
            .filter(node => node && typeof node === 'object')
            .map(node => ({
                ...node,
                nodeId: normalizeNodeId(node.nodeId || node.id),
                id: normalizeNodeId(node.nodeId || node.id),
                status: node.status || (node.healthy === false ? 'offline' : 'online')
            }))
            .filter(node => node.nodeId);
    }

    _emitIfChanged(previous) {
        const current = this.getSnapshot();
        if (sameRoute(previous, current)) return;
        try {
            Promise.resolve(this.onChange(current, previous)).catch(() => {});
        } catch (error) {
            // 路由状态已更新，通知失败不能阻断心跳和后续自动恢复。
        }
    }
}

function sameRoute(left, right) {
    return left.activeNodeId === right.activeNodeId
        && left.fallbackNodeId === right.fallbackNodeId
        && left.manualMainOverride === right.manualMainOverride
        && left.reason === right.reason;
}

function normalizeNodeId(value) {
    return typeof value === 'string' ? value.trim().slice(0, 128) : '';
}

function normalizePositiveInteger(value, fallback) {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

module.exports = {
    AascServerRouteManager,
    sameRoute
};
