'use strict';

const { URL } = require('node:url');

/**
 * AASC 服务器节点临时注册表。
 *
 * 该注册表只负责保存主服务器运行期间的节点登记和心跳，不承担认证、发现、
 * 代码下发或媒体文件同步。时间函数可以注入，便于测试心跳过期逻辑。
 */
class AascServerRegistry {
    constructor(options = {}) {
        const {
            heartbeatTimeoutMs = 90000,
            now = () => Date.now()
        } = options;

        if (typeof now !== 'function') {
            throw new TypeError('now 必须是函数');
        }
        if (!Number.isFinite(heartbeatTimeoutMs) || heartbeatTimeoutMs <= 0) {
            throw new TypeError('heartbeatTimeoutMs 必须是正数');
        }

        this.heartbeatTimeoutMs = heartbeatTimeoutMs;
        this.now = now;
        this.records = new Map();
    }

    register(input) {
        const data = this._normalizeRegistration(input, true);
        const current = this.records.get(data.nodeId);
        const timestamp = this.now();
        const record = {
            ...(current || {}),
            ...data,
            registeredAt: current ? current.registeredAt : this._toIso(timestamp),
            lastHeartbeatAt: this._toIso(timestamp),
            lastHeartbeatMs: timestamp,
            status: 'online'
        };

        this.records.set(record.nodeId, record);
        return this._snapshot(record);
    }

    heartbeat(nodeId, input = {}) {
        const record = this.records.get(this._normalizeNodeId(nodeId));
        if (!record) {
            return null;
        }

        const data = this._normalizeRegistration(input, false, false);
        const timestamp = this.now();
        Object.assign(record, data, {
            lastHeartbeatAt: this._toIso(timestamp),
            lastHeartbeatMs: timestamp,
            status: 'online'
        });
        return this._snapshot(record);
    }

    get(nodeId) {
        const record = this.records.get(this._normalizeNodeId(nodeId));
        if (!record) {
            return null;
        }
        this._refreshStatus(record);
        return this._snapshot(record);
    }

    getAll() {
        for (const record of this.records.values()) {
            this._refreshStatus(record);
        }
        return Array.from(this.records.values(), record => this._snapshot(record));
    }

    _normalizeRegistration(input, requireUrl, requireNodeId = true) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) {
            throw new TypeError('注册信息必须是对象');
        }

        const data = {};
        const nodeId = this._normalizeNodeId(input.nodeId);
        if (requireNodeId && !nodeId) {
            throw new TypeError('nodeId 必填');
        }
        if (nodeId && requireNodeId) {
            data.nodeId = nodeId;
        }

        if (requireUrl || input.url !== undefined) {
            data.url = this._normalizeUrl(input.url);
        }
        if (input.name !== undefined) {
            data.name = this._normalizeText(input.name, 'name');
        }
        if (input.version !== undefined) {
            data.version = this._normalizeText(input.version, 'version');
        }
        if (input.capabilities !== undefined) {
            data.capabilities = this._cloneMap(input.capabilities, 'capabilities');
        }
        if (input.metadata !== undefined) {
            data.metadata = this._cloneMap(input.metadata, 'metadata');
        }
        return data;
    }

    _normalizeNodeId(value) {
        if (typeof value !== 'string') {
            return '';
        }
        const nodeId = value.trim();
        if (nodeId.length === 0 || nodeId.length > 128) {
            return '';
        }
        return nodeId;
    }

    _normalizeUrl(value) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new TypeError('url 必填');
        }

        let parsed;
        try {
            parsed = new URL(value.trim());
        } catch (error) {
            throw new TypeError('url 必须是有效地址');
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new TypeError('url 只允许使用 http 或 https');
        }
        return parsed.toString().replace(/\/$/, '');
    }

    _normalizeText(value, fieldName) {
        if (typeof value !== 'string') {
            throw new TypeError(`${fieldName} 必须是字符串`);
        }
        return value.trim().slice(0, 256);
    }

    _cloneMap(value, fieldName) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new TypeError(`${fieldName} 必须是对象`);
        }
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (error) {
            throw new TypeError(`${fieldName} 必须是可序列化对象`);
        }
    }

    _refreshStatus(record) {
        const elapsed = this.now() - record.lastHeartbeatMs;
        record.status = elapsed >= this.heartbeatTimeoutMs ? 'offline' : 'online';
    }

    _snapshot(record) {
        return {
            nodeId: record.nodeId,
            // id 是旧服务器列表使用的兼容字段，后续页面统一迁移到 nodeId。
            id: record.nodeId,
            name: record.name || record.nodeId,
            url: record.url,
            version: record.version || null,
            capabilities: this._cloneMap(record.capabilities || {}, 'capabilities'),
            metadata: this._cloneMap(record.metadata || {}, 'metadata'),
            status: record.status,
            healthy: record.status === 'online',
            registeredAt: record.registeredAt,
            lastHeartbeatAt: record.lastHeartbeatAt,
            // 页面沿用旧字段名称时仍可显示心跳时间。
            lastHealthCheck: record.lastHeartbeatAt
        };
    }

    _toIso(timestamp) {
        return new Date(timestamp).toISOString();
    }
}

module.exports = {
    AascServerRegistry
};
