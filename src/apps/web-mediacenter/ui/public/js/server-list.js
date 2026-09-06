'use strict';

// 控制端服务器列表负责观察节点，并提供浏览器级的服务器手动切换。
(() => {
    const AASC_SERVERS_ENDPOINT = '/api/aasc/servers';
    const SERVER_URL_STORAGE_KEY = 'aasc.serverUrl';
    const CONTROL_PAGE_PATH = '/control';
    const state = {
        servers: [],
        mediaIndex: null
    };

    function getElement(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character]));
    }

    function formatValue(value, fallback = '未提供') {
        return value === undefined || value === null || value === ''
            ? fallback
            : escapeHtml(value);
    }

    function formatHealth(server) {
        if (server.healthy === true) {
            return '<span class="server-status server-status-online">在线</span>';
        }
        return '<span class="server-status server-status-offline">离线</span>';
    }

    function formatLatency(latency) {
        if (typeof latency !== 'number' || latency < 0) {
            return '未测量';
        }
        return `${latency} ms`;
    }

    function formatRuntimeCount(server, fieldName) {
        const runtime = server?.runtime;
        const value = runtime?.[fieldName];
        if (Number.isSafeInteger(value) && value >= 0) {
            return String(value);
        }
        return '未上报';
    }

    function formatDisplayCount(server) {
        const runtimeCount = formatRuntimeCount(server, 'displayCount');
        if (runtimeCount !== '未上报') {
            return `${runtimeCount} / ${formatValue(server.maxDisplays, '未限制')}`;
        }
        // 兼容旧 SubServerManager 接口；AASC 节点没有 runtime 时不再伪造 0。
        if (server.currentDisplays !== undefined || server.maxDisplays !== undefined) {
            return `${formatValue(server.currentDisplays, '未上报')} / ${formatValue(server.maxDisplays, '未限制')}`;
        }
        return '未上报 / 未提供上限';
    }

    function formatLastHealthCheck(value) {
        if (!value) {
            return '未检查';
        }
        try {
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return '时间无效';
            }
            return date.toLocaleString('zh-CN');
        } catch (error) {
            return '时间无效';
        }
    }

    function formatCapabilities(capabilities) {
        if (!capabilities || typeof capabilities !== 'object') {
            return '未提供';
        }
        const enabled = Object.entries(capabilities)
            .filter(([, available]) => available === true)
            .map(([name]) => name);
        return enabled.length > 0 ? enabled.map(escapeHtml).join('、') : '无可用能力';
    }

    function normalizeServerUrl(value) {
        let parsed;
        try {
            parsed = new URL(String(value || '').trim());
        } catch (error) {
            throw new Error('服务器地址格式无效');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('只支持 HTTP/HTTPS 服务器地址');
        }
        if (!parsed.hostname || parsed.username || parsed.password) {
            throw new Error('服务器地址必须包含合法主机且不能携带账号密码');
        }
        return parsed.origin;
    }

    function isCurrentServer(url) {
        try {
            return normalizeServerUrl(url) === normalizeServerUrl(window.location.origin);
        } catch (error) {
            return false;
        }
    }

    function renderServer(server) {
        const connectionAction = isCurrentServer(server.url)
            ? '<span class="server-current-label">当前连接</span>'
            : server.healthy === true && server.url
                ? `<button class="server-connect-btn" type="button" data-server-url="${formatValue(server.url, '')}">连接</button>`
                : '<span class="server-unavailable-label">不可连接</span>';
        return `
            <article class="server-card">
                <div class="server-card-header">
                    <div>
                        <h3>${formatValue(server.name, '未命名服务器')}</h3>
                        <p class="server-card-id">${formatValue(server.nodeId || server.id, '未知 ID')}</p>
                    </div>
                    ${formatHealth(server)}
                </div>
                <dl class="server-card-details">
                    <div><dt>地址</dt><dd>${formatValue(server.url)}</dd></div>
                    <div><dt>连接延迟</dt><dd>${formatLatency(server.latency)}</dd></div>
                    <div><dt>显示端</dt><dd>${formatDisplayCount(server)}</dd></div>
                    <div><dt>控制端</dt><dd>${formatRuntimeCount(server, 'controlCount')}</dd></div>
                    <div><dt>媒体库</dt><dd>${formatRuntimeCount(server, 'libraryCount')}</dd></div>
                    <div><dt>优先级</dt><dd>${formatValue(server.priority, '不适用')}</dd></div>
                    <div><dt>版本</dt><dd>${formatValue(server.version)}</dd></div>
                    <div><dt>能力</dt><dd>${formatCapabilities(server.capabilities)}</dd></div>
                    <div><dt>最后心跳</dt><dd>${formatLastHealthCheck(server.lastHeartbeatAt || server.lastHealthCheck)}</dd></div>
                </dl>
                <div class="server-card-actions">${connectionAction}</div>
            </article>`;
    }

    function renderMediaIndex(index) {
        const contentElement = getElement('serverMediaIndexContent');
        if (!contentElement) return;
        const sources = Array.isArray(index?.sources) ? index.sources : [];
        if (sources.length === 0) {
            contentElement.innerHTML = '<div class="empty-list">暂无共享媒体库</div>';
            return;
        }
        contentElement.innerHTML = sources.map(source => {
            const node = source.node || {};
            const libraries = Array.isArray(source.libraries) ? source.libraries : [];
            const libraryHtml = libraries.length > 0
                ? libraries.map(library => {
                    const count = Array.isArray(library.items) ? library.items.length : 0;
                    return `<div class="shared-library-item"><span>${formatValue(library.name, '未命名媒体库')}</span><span>${count} 个条目</span></div>`;
                }).join('')
                : '<div class="empty-list">该服务器暂无媒体库</div>';
            return `<article class="shared-media-source"><div class="shared-media-source-header"><strong>${formatValue(node.name || node.nodeId, '未知服务器')}</strong><span>${formatValue(node.nodeId)}</span></div>${libraryHtml}</article>`;
        }).join('');
    }

    const ServerList = {
        init() {
            const refreshButton = getElement('serverListRefreshBtn');
            if (refreshButton) {
                refreshButton.addEventListener('click', () => this.load());
            }
            const addressButton = getElement('serverAddressConnectBtn');
            if (addressButton) {
                addressButton.addEventListener('click', () => {
                    const input = getElement('serverAddressInput');
                    void this.connectToAddress(input?.value || '').catch(() => {});
                });
            }
            const mediaIndexRefreshButton = getElement('serverMediaIndexRefreshBtn');
            if (mediaIndexRefreshButton) {
                mediaIndexRefreshButton.addEventListener('click', () => this.loadMediaIndex());
            }
            this.render();
            this.load();
            this.loadMediaIndex();
        },

        connectToServer(server) {
            return this.connectToAddress(server?.url || '');
        },

        connectToAddress(address) {
            let origin;
            try {
                origin = normalizeServerUrl(address);
            } catch (error) {
                if (window.showToast) window.showToast(error.message, 'error');
                return Promise.reject(error);
            }
            try {
                window.localStorage?.setItem(SERVER_URL_STORAGE_KEY, origin);
            } catch (error) {
                // 浏览器禁用存储时仍允许本次页面跳转，不影响手动连接。
            }
            window.location.assign(`${origin}${CONTROL_PAGE_PATH}`);
            return Promise.resolve(origin);
        },

        async load() {
            const statusElement = getElement('serverListStatus');
            const refreshButton = getElement('serverListRefreshBtn');
            if (statusElement) {
                statusElement.textContent = '正在刷新...';
            }
            if (refreshButton) {
                refreshButton.disabled = true;
            }

            try {
                const response = await fetch(AASC_SERVERS_ENDPOINT, { cache: 'no-store' });
                const data = await response.json();
                if (!response.ok || data.status !== 'success' || !Array.isArray(data.servers)) {
                    throw new Error(data.message || `HTTP ${response.status}`);
                }
                state.servers = data.servers;
                this.render();
                if (statusElement) {
                    statusElement.textContent = `共 ${state.servers.length} 台服务器`;
                }
            } catch (error) {
                if (statusElement) {
                    statusElement.textContent = `刷新失败：${error.message}`;
                }
                if (window.showToast) {
                    window.showToast(`服务器列表刷新失败：${error.message}`, 'error');
                }
            } finally {
                if (refreshButton) {
                    refreshButton.disabled = false;
                }
            }
        },

        async loadMediaIndex() {
            const statusElement = getElement('serverMediaIndexStatus');
            const refreshButton = getElement('serverMediaIndexRefreshBtn');
            if (statusElement) statusElement.textContent = '正在刷新共享媒体库...';
            if (refreshButton) refreshButton.disabled = true;
            try {
                const response = await fetch('/api/aasc/media-index', { cache: 'no-store' });
                const data = await response.json();
                if (!response.ok || data.status !== 'success' || !data.index) {
                    throw new Error(data.message || `HTTP ${response.status}`);
                }
                state.mediaIndex = data.index;
                renderMediaIndex(state.mediaIndex);
                if (statusElement) statusElement.textContent = `${state.mediaIndex.sources?.length || 0} 个服务器来源`;
            } catch (error) {
                if (statusElement) statusElement.textContent = `刷新失败：${error.message}`;
                if (window.showToast) window.showToast(`共享媒体库刷新失败：${error.message}`, 'error');
            } finally {
                if (refreshButton) refreshButton.disabled = false;
            }
        },

        render(servers = state.servers) {
            const contentElement = getElement('serverListContent');
            if (!contentElement) {
                return;
            }
            if (!Array.isArray(servers) || servers.length === 0) {
                contentElement.innerHTML = '<div class="empty-list">暂无服务器</div>';
                return;
            }
            contentElement.innerHTML = servers.map(renderServer).join('');
            if (typeof contentElement.querySelectorAll === 'function') {
                contentElement.querySelectorAll('[data-server-url]').forEach(button => {
                    button.addEventListener('click', () => {
                        void this.connectToAddress(button.dataset.serverUrl).catch(() => {});
                    });
                });
            }
        }
    };

    window.ServerList = ServerList;
    document.addEventListener('DOMContentLoaded', () => ServerList.init());
})();
