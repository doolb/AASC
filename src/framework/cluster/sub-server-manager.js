const http = require('http');
const https = require('https');
const { URL } = require('url');

class SubServer {
    constructor(id, url, config = {}) {
        this.id = id;
        this.url = url.replace(/\/$/, '');
        this.name = config.name || id;
        this.maxDisplays = config.maxDisplays || 10;
        this.currentDisplays = config.currentDisplays || 0;
        this.priority = config.priority || 0;
        this.enabled = config.enabled !== undefined ? config.enabled : true;
        this.lastHealthCheck = null;
        this.healthy = false;
        this.latency = -1;
    }

    async healthCheck() {
        const startTime = Date.now();
        try {
            const result = await this._request('GET', '/api/health', null, 5000);
            this.healthy = result.status === 'ok';
            this.latency = Date.now() - startTime;
            this.lastHealthCheck = new Date();
            return this.healthy;
        } catch (e) {
            this.healthy = false;
            this.latency = -1;
            this.lastHealthCheck = new Date();
            return false;
        }
    }

    async registerDisplay(displayId, displayData) {
        try {
            const result = await this._request('POST', '/api/displays', {
                displayId,
                displayData
            });
            if (result.status === 'success') {
                this.currentDisplays++;
            }
            return result;
        } catch (e) {
            console.error(`[子服务器:${this.id}] 注册显示端失败:`, e.message);
            return { status: 'error', message: e.message };
        }
    }

    async unregisterDisplay(displayId) {
        try {
            const result = await this._request('DELETE', `/api/displays/${displayId}`);
            if (result.status === 'success') {
                this.currentDisplays = Math.max(0, this.currentDisplays - 1);
            }
            return result;
        } catch (e) {
            console.error(`[子服务器:${this.id}] 注销显示端失败:`, e.message);
            return { status: 'error', message: e.message };
        }
    }

    async sendToDisplay(displayId, data) {
        try {
            return await this._request('POST', `/api/displays/${displayId}/send`, data);
        } catch (e) {
            console.error(`[子服务器:${this.id}] 发送到显示端失败:`, e.message);
            return { status: 'error', message: e.message };
        }
    }

    async getDisplayList() {
        try {
            return await this._request('GET', '/api/displays');
        } catch (e) {
            console.error(`[子服务器:${this.id}] 获取显示端列表失败:`, e.message);
            return { status: 'error', displays: [] };
        }
    }

    _request(method, path, body, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(this.url + path);
            const isHttps = urlObj.protocol === 'https:';
            const httpModule = isHttps ? https : http;

            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || (isHttps ? 443 : 80),
                path: urlObj.pathname + urlObj.search,
                method: method,
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: timeout
            };

            const req = httpModule.request(options, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve({ status: 'error', raw: data });
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('请求超时'));
            });

            if (body) {
                req.write(JSON.stringify(body));
            }
            req.end();
        });
    }

    toJSON() {
        return {
            id: this.id,
            url: this.url,
            name: this.name,
            maxDisplays: this.maxDisplays,
            currentDisplays: this.currentDisplays,
            priority: this.priority,
            enabled: this.enabled,
            healthy: this.healthy,
            latency: this.latency,
            lastHealthCheck: this.lastHealthCheck
        };
    }
}

class SubServerManager {
    constructor() {
        this.servers = new Map();
        this.healthCheckInterval = null;
        this.healthCheckPeriod = 30000;
    }

    addServer(id, url, config) {
        if (this.servers.has(id)) {
            console.warn(`[子服务器管理] 服务器 ${id} 已存在，将更新`);
        }
        const server = new SubServer(id, url, config);
        this.servers.set(id, server);
        console.log(`[子服务器管理] 添加服务器: ${id} (${url})`);
        return server;
    }

    removeServer(id) {
        const server = this.servers.get(id);
        if (server) {
            this.servers.delete(id);
            console.log(`[子服务器管理] 移除服务器: ${id}`);
            return true;
        }
        return false;
    }

    getServer(id) {
        return this.servers.get(id);
    }

    getAllServers() {
        return Array.from(this.servers.values());
    }

    getAvailableServers() {
        return this.getAllServers()
            .filter(s => s.enabled && s.healthy)
            .sort((a, b) => {
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                const aLoad = a.currentDisplays / a.maxDisplays;
                const bLoad = b.currentDisplays / b.maxDisplays;
                return aLoad - bLoad;
            });
    }

    selectBestServer() {
        const available = this.getAvailableServers();
        if (available.length === 0) return null;

        let best = available[0];
        let bestLoad = best.currentDisplays / best.maxDisplays;

        for (let i = 1; i < available.length; i++) {
            const load = available[i].currentDisplays / available[i].maxDisplays;
            if (load < bestLoad) {
                best = available[i];
                bestLoad = load;
            }
        }

        return best;
    }

    async checkAllHealth() {
        const checks = [];
        for (const [id, server] of this.servers) {
            checks.push(server.healthCheck().then(healthy => ({
                id,
                healthy
            })));
        }

        const results = await Promise.allSettled(checks);
        const summary = { total: 0, healthy: 0, unhealthy: 0 };

        results.forEach(result => {
            summary.total++;
            if (result.status === 'fulfilled' && result.value.healthy) {
                summary.healthy++;
            } else {
                summary.unhealthy++;
            }
        });

        return summary;
    }

    startHealthCheck(period) {
        if (period) this.healthCheckPeriod = period;
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.checkAllHealth();

        this.healthCheckInterval = setInterval(() => {
            this.checkAllHealth();
        }, this.healthCheckPeriod);

        console.log(`[子服务器管理] 健康检查已启动，间隔: ${this.healthCheckPeriod}ms`);
    }

    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        console.log('[子服务器管理] 健康检查已停止');
    }

    loadFromConfig(config) {
        if (!config || !config.servers) return;

        config.servers.forEach(s => {
            this.addServer(s.id, s.url, s);
        });

        if (config.healthCheckPeriod) {
            this.healthCheckPeriod = config.healthCheckPeriod;
        }

        console.log(`[子服务器管理] 从配置加载了 ${this.servers.size} 个子服务器`);
    }

    saveToConfig() {
        const servers = [];
        this.servers.forEach((server, id) => {
            servers.push({
                id: server.id,
                url: server.url,
                name: server.name,
                maxDisplays: server.maxDisplays,
                priority: server.priority,
                enabled: server.enabled
            });
        });

        return {
            servers,
            healthCheckPeriod: this.healthCheckPeriod
        };
    }
}

module.exports = { SubServer, SubServerManager };
