'use strict';

// 控制端服务器列表只负责观察主服务器登记的节点，不在此页面修改节点配置。
(() => {
    const SUBSERVERS_ENDPOINT = '/api/subservers';
    const state = {
        servers: []
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

    function renderServer(server) {
        const displayCount = `${formatValue(server.currentDisplays, '0')} / ${formatValue(server.maxDisplays, '未限制')}`;
        return `
            <article class="server-card">
                <div class="server-card-header">
                    <div>
                        <h3>${formatValue(server.name, '未命名服务器')}</h3>
                        <p class="server-card-id">${formatValue(server.id, '未知 ID')}</p>
                    </div>
                    ${formatHealth(server)}
                </div>
                <dl class="server-card-details">
                    <div><dt>地址</dt><dd>${formatValue(server.url)}</dd></div>
                    <div><dt>连接延迟</dt><dd>${formatLatency(server.latency)}</dd></div>
                    <div><dt>显示端</dt><dd>${displayCount}</dd></div>
                    <div><dt>优先级</dt><dd>${formatValue(server.priority, '0')}</dd></div>
                    <div><dt>版本</dt><dd>${formatValue(server.version)}</dd></div>
                    <div><dt>能力</dt><dd>${formatCapabilities(server.capabilities)}</dd></div>
                    <div><dt>最后检查</dt><dd>${formatLastHealthCheck(server.lastHealthCheck)}</dd></div>
                </dl>
            </article>`;
    }

    const ServerList = {
        init() {
            const refreshButton = getElement('serverListRefreshBtn');
            if (refreshButton) {
                refreshButton.addEventListener('click', () => this.load());
            }
            this.render();
            this.load();
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
                const response = await fetch(SUBSERVERS_ENDPOINT, { cache: 'no-store' });
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
        }
    };

    window.ServerList = ServerList;
    document.addEventListener('DOMContentLoaded', () => ServerList.init());
})();
