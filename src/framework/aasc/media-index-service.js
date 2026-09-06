'use strict';

const http = require('node:http');
const https = require('node:https');

/**
 * AASC 媒体索引服务。
 *
 * 该服务只整理“媒体在哪里”和“目录里有什么”，不复制媒体文件，
 * 也不把媒体库账号密码带入索引结果。远程节点的文件仍由所属节点提供。
 */
class AascMediaIndexService {
    constructor(options = {}) {
        this.mediaLibraryManager = options.mediaLibraryManager;
        this.getNode = options.getNode || (() => ({ nodeId: 'main-server', url: '' }));
        this.getRemoteNodes = options.getRemoteNodes || (() => []);
        // 正式 AASC 节点通过主服务器维护的 WebSocket 会话请求索引；fetchJson
        // 仅保留给旧调用方和单元测试，避免破坏已有本地索引服务接口。
        this.requestRemoteIndex = options.requestRemoteIndex || null;
        this.fetchJson = options.fetchJson || fetchJson;
        this.requestTimeoutMs = options.requestTimeoutMs || 5000;
    }

    async buildLocalIndex(requestedPath = '/') {
        const path = normalizeMediaPath(requestedPath);
        const node = normalizeNode(this.getNode());
        const libraries = await Promise.all(
            this.mediaLibraryManager.listLibraries().map(library => this._buildLibraryIndex(library, path, node))
        );

        return { node, path, libraries };
    }

    async buildNetworkIndex(requestedPath = '/') {
        const path = normalizeMediaPath(requestedPath);
        const localIndex = await this.buildLocalIndex(path);
        const remoteNodes = this.getRemoteNodes()
            .map(normalizeNode)
            .filter(node => node.nodeId !== localIndex.node.nodeId && node.status === 'online' && node.url);
        const settled = await Promise.all(remoteNodes.map(node => this._fetchRemoteIndex(node, path)));

        return {
            path,
            sources: [localIndex, ...settled.filter(result => result.index).map(result => result.index)],
            errors: settled.filter(result => result.error).map(result => result.error)
        };
    }

    async _buildLibraryIndex(library, path, node) {
        try {
            const items = await this.mediaLibraryManager.list(library.id, path);
            return this._libraryRecord(library, path, node, normalizeItems(items, node));
        } catch (error) {
            return this._libraryRecord(library, path, node, [], error.message);
        }
    }

    _libraryRecord(library, path, node, items, error = null) {
        return {
            id: library.id,
            name: library.name,
            type: library.type,
            readonly: library.readonly === true,
            isDefault: library.isDefault === true,
            ownerNodeId: node.nodeId,
            ownerUrl: node.url,
            listUrl: buildLibraryListUrl(node.url, library.id, path),
            proxyUrl: buildLibraryProxyUrl(node.url, library.id),
            items,
            error
        };
    }

    async _fetchRemoteIndex(node, path) {
        try {
            const payload = this.requestRemoteIndex
                ? await this.requestRemoteIndex(node, path, this.requestTimeoutMs)
                : await this.fetchJson(this._buildLegacyIndexUrl(node, path), this.requestTimeoutMs);
            const remoteIndex = payload?.index || payload;
            return { index: normalizeRemoteIndex(remoteIndex, node, path) };
        } catch (error) {
            return { error: { nodeId: node.nodeId, url: node.url, message: error.message } };
        }
    }

    _buildLegacyIndexUrl(node, path) {
        const url = new URL('/api/aasc/media-index', `${node.url.replace(/\/+$/, '')}/`);
        url.searchParams.set('scope', 'local');
        url.searchParams.set('path', path);
        return url.toString();
    }
}

function normalizeNode(node = {}) {
    return {
        nodeId: String(node.nodeId || node.id || 'unknown-node'),
        name: node.name || null,
        url: normalizeBaseUrl(node.url),
        status: node.status || 'online'
    };
}

function normalizeRemoteIndex(index, fallbackNode, fallbackPath) {
    const node = normalizeNode({ ...(index?.node || {}), ...fallbackNode });
    return {
        node,
        path: normalizeMediaPath(index?.path || fallbackPath),
        libraries: Array.isArray(index?.libraries)
            ? index.libraries.map(library => normalizeRemoteLibrary(library, node))
            : []
    };
}

function normalizeRemoteLibrary(library = {}, node) {
    return {
        id: String(library.id || ''),
        name: String(library.name || library.id || '未命名媒体库'),
        type: String(library.type || 'unknown'),
        readonly: library.readonly === true,
        isDefault: library.isDefault === true,
        ownerNodeId: node.nodeId,
        ownerUrl: node.url,
        listUrl: library.listUrl || buildLibraryListUrl(node.url, library.id, library.path || '/'),
        proxyUrl: library.proxyUrl || buildLibraryProxyUrl(node.url, library.id),
        items: normalizeItems(library.items, node),
        error: library.error || null
    };
}

function normalizeItems(items, node) {
    if (!Array.isArray(items)) return [];
    return items.map(item => ({
        name: String(item?.name || ''),
        path: String(item?.path || ''),
        type: item?.type || null,
        size: Number.isFinite(Number(item?.size)) ? Number(item.size) : null,
        modifiedTime: item?.modifiedTime || null,
        ownerNodeId: node.nodeId,
        ownerUrl: node.url
    }));
}

function normalizeMediaPath(value) {
    const input = String(value || '/');
    return input.startsWith('/') ? input : `/${input}`;
}

function normalizeBaseUrl(value) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return '';
    return value.replace(/\/+$/, '');
}

function buildLibraryListUrl(baseUrl, libraryId, path) {
    if (!baseUrl || !libraryId) return '';
    const url = new URL(`/api/media-libraries/${encodeURIComponent(libraryId)}/list`, `${baseUrl}/`);
    url.searchParams.set('path', normalizeMediaPath(path));
    return url.toString();
}

function buildLibraryProxyUrl(baseUrl, libraryId) {
    if (!baseUrl || !libraryId) return '';
    return new URL(`/api/media-libraries/${encodeURIComponent(libraryId)}/proxy/`, `${baseUrl}/`).toString();
}

function fetchJson(url, timeoutMs = 5000) {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    return new Promise((resolve, reject) => {
        const request = client.get({
            hostname: parsed.hostname,
            port: parsed.port || undefined,
            path: `${parsed.pathname}${parsed.search}`,
            rejectUnauthorized: false,
            timeout: timeoutMs
        }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => body += chunk);
            response.once('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(new Error(`媒体索引节点返回 HTTP ${response.statusCode}`));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`媒体索引响应格式无效: ${error.message}`));
                }
            });
        });
        request.once('timeout', () => request.destroy(new Error('媒体索引请求超时')));
        request.once('error', reject);
    });
}

module.exports = {
    AascMediaIndexService,
    buildLibraryListUrl,
    buildLibraryProxyUrl,
    normalizeMediaPath,
    normalizeNode,
    normalizeRemoteIndex
};
